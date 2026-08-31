import { chromium, Browser, BrowserContext, Page } from 'playwright';
import { StrudelController, waitForStrudelReady } from '../StrudelController.js';
import { DEFAULT_STRUDEL_URL } from '../utils/ServerConfig.js';
import { Logger } from '../utils/Logger.js';
import type { AudioAnalysisConfig } from '../types/AudioAnalysis.js';

/**
 * Session metadata including creation time and last activity
 */
export interface SessionInfo {
  id: string;
  created: Date;
  lastActivity: Date;
  isPlaying: boolean;
}

/**
 * Session with controller and browser context
 */
interface Session {
  controller: StrudelController;
  context: BrowserContext;
  page: Page;
  created: Date;
  lastActivity: Date;
}

/**
 * Manages multiple concurrent Strudel browser sessions.
 * Uses browser contexts for isolation - one browser instance with multiple contexts.
 * Each context has isolated cookies, storage, and its own page.
 */
export class SessionManager {
  private browser: Browser | null = null;
  private sessions: Map<string, Session> = new Map();

  /**
   * Ids currently being created.
   *
   * Held from before the first await until the session is in `sessions`
   * or the attempt has failed, so the duplicate and limit checks account
   * for creations in flight rather than only completed ones (#263).
   */
  private readonly reservedIds = new Set<string>();
  private defaultSessionId: string = 'default';
  private logger: Logger;
  private isHeadless: boolean;

  /** Maximum concurrent sessions to prevent resource exhaustion */
  private readonly MAX_SESSIONS = 5;

  /** Inactivity timeout in ms (30 minutes) */
  private readonly INACTIVITY_TIMEOUT = 30 * 60 * 1000;

  /** Cleanup interval in ms (5 minutes) */
  private readonly CLEANUP_INTERVAL = 5 * 60 * 1000;

  private cleanupTimer: NodeJS.Timeout | null = null;
  private audioAnalysisConfig?: AudioAnalysisConfig;
  /** Strudel REPL URL; `strudel_url` in config.json (#227). */
  private readonly strudelUrl: string;

  /**
   * Called after a session is removed, however it was removed.
   *
   * Lets the owner drop state it keys by session id without having to
   * intercept every teardown path.
   */
  onSessionDestroyed?: (id: string) => void;

  constructor(
    headless: boolean = false,
    audioAnalysisConfig?: AudioAnalysisConfig,
    strudelUrl: string = DEFAULT_STRUDEL_URL,
  ) {
    this.isHeadless = headless;
    this.audioAnalysisConfig = audioAnalysisConfig;
    this.strudelUrl = strudelUrl;
    this.logger = new Logger();
  }

  /**
   * Ensures the shared browser instance is running
   */
  private async ensureBrowser(): Promise<Browser> {
    if (!this.browser) {
      this.browser = await chromium.launch({
        headless: this.isHeadless,
        args: [
          '--use-fake-ui-for-media-stream',
          '--disable-dev-shm-usage',
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-gpu',
          '--disable-software-rasterizer'
        ],
      });

      // Start cleanup timer when browser is created
      this.startCleanupTimer();
    }
    return this.browser;
  }

  /**
   * Creates a new isolated Strudel session
   * @param id - Unique session identifier
   * @param _headless - Override headless mode for this session (currently a
   *   no-op; sessions share the constructor's browser instance). Kept in the
   *   signature for API stability until multi-session work in #108 lands.
   * @returns Initialized StrudelController for the session
   * @throws {Error} When max sessions limit reached or session ID already exists
   */
  async createSession(id: string, _headless?: boolean): Promise<StrudelController> {
    // Validate session ID
    if (!id || typeof id !== 'string') {
      throw new Error('Session ID must be a non-empty string');
    }

    // Check if session already exists, or is mid-creation
    if (this.sessions.has(id) || this.reservedIds.has(id)) {
      throw new Error(`Session '${id}' already exists`);
    }

    // Check max sessions limit, counting creations in flight
    if (this.sessions.size + this.reservedIds.size >= this.MAX_SESSIONS) {
      throw new Error(
        `Maximum session limit (${this.MAX_SESSIONS}) reached. Destroy an existing session first.`
      );
    }

    // Reserve the id synchronously, before the first await.
    //
    // The two checks above and the set below used to be ~2 seconds apart
    // (ensureBrowser, newContext, newPage, goto, readiness wait), and the
    // MCP SDK does not serialize tool calls. So two concurrent creates
    // with the same id both passed the duplicate check and the second
    // overwrote the first — orphaning a context nothing could reach. Four
    // live sessions plus three concurrent creates all read size === 4 and
    // produced seven on a five-session limit (#263).
    this.reservedIds.add(id);

    let context: BrowserContext | undefined;
    let controller: StrudelController;
    try {
      const browser = await this.ensureBrowser();

      context = await browser.newContext({
        permissions: ['microphone'],
        viewport: { width: 1280, height: 720 },
        reducedMotion: 'reduce',
      });

      const page = await context.newPage();

      controller = new StrudelController(this.isHeadless, this.audioAnalysisConfig, this.strudelUrl);
      await this.initializeControllerWithPage(controller, page);

      const session: Session = {
        controller,
        context,
        page,
        created: new Date(),
        lastActivity: new Date(),
      };

      this.sessions.set(id, session);
    } catch (error) {
      // Close what was allocated. Without this the context stayed alive
      // and unreachable: it never entered `sessions`, so destroyAll, the
      // idle sweep, and the MAX_SESSIONS count could none of them see it.
      // Each failed create leaked a Chromium renderer while the limit
      // still read 0/5, and an agent retrying a transient strudel.cc
      // failure leaked one per attempt.
      if (context !== undefined) {
        try {
          await context.close();
        } catch (closeError: any) {
          this.logger.warn(`Failed to close context for '${id}': ${closeError.message}`);
        }
      }
      throw error;
    } finally {
      this.reservedIds.delete(id);
    }

    this.logger.info(`Session '${id}' created`, {
      totalSessions: this.sessions.size,
    });

    return controller;
  }

  /**
   * Initializes a StrudelController with an existing page
   * This bypasses the normal initialize() which creates its own browser
   */
  private async initializeControllerWithPage(
    controller: StrudelController,
    page: Page
  ): Promise<void> {
    // Set up page routing for resource optimization
    await page.route('**/*', (route) => {
      const resourceType = route.request().resourceType();
      if (['image', 'font', 'media'].includes(resourceType)) {
        route.abort();
      } else {
        route.continue();
      }
    });

    // Navigate to Strudel
    await page.goto(this.strudelUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 15000,
    });

    // Same readiness gate as StrudelController.initialize(). This used to
    // wait on `editor.__view`, which strudel.cc does not expose, so every
    // named session stalled and threw (#228).
    await waitForStrudelReady(page);

    // Inject page into controller via internal method
    (controller as any)._page = page;
    (controller as any).browser = null; // Controller doesn't own the browser

    // Console monitoring was previously only wired up on the single-session
    // path, so diagnostics and validate_pattern_runtime reported zero errors
    // for every named session (#228).
    controller.setupConsoleMonitoring();

    // Inject audio analyzer
    await controller.analyzer.inject(page);
  }

  /**
   * Gets an existing session's controller
   * @param id - Session identifier
   * @returns StrudelController or undefined if session doesn't exist
   */
  getSession(id: string): StrudelController | undefined {
    const session = this.sessions.get(id);
    if (session) {
      session.lastActivity = new Date();
      return session.controller;
    }
    return undefined;
  }

  /**
   * Destroys a session and releases its resources
   * @param id - Session identifier
   * @throws {Error} When session doesn't exist
   */
  async destroySession(id: string): Promise<void> {
    const session = this.sessions.get(id);
    if (!session) {
      throw new Error(`Session '${id}' not found`);
    }

    try {
      // Close the browser context (which closes the page)
      await session.context.close();
    } catch (error: any) {
      this.logger.warn(`Error closing session context: ${error.message}`);
    }

    this.sessions.delete(id);

    // Tell the owner, whichever path got us here. The server keeps its
    // own per-session maps (history bundles, capture services), and those
    // used to be cleared only by the session({action:'destroy'}) tool
    // handler — so idle eviction and destroyAll leaked them, and a
    // session recreated under the same id inherited a dead recorder and
    // a previous session's undo stack (#264).
    try {
      this.onSessionDestroyed?.(id);
    } catch (error: any) {
      this.logger.warn(`Session destroy callback failed for '${id}': ${error.message}`);
    }

    // If this was the default session, reset to 'default'
    if (this.defaultSessionId === id) {
      this.defaultSessionId = 'default';
    }

    this.logger.info(`Session '${id}' destroyed`, {
      totalSessions: this.sessions.size,
    });

    // If no more sessions, close browser
    if (this.sessions.size === 0) {
      await this.closeBrowser();
    }
  }

  /**
   * Lists all active session IDs
   * @returns Array of session identifiers
   */
  listSessions(): string[] {
    return Array.from(this.sessions.keys());
  }

  /**
   * Gets detailed information about all sessions
   * @returns Array of session info objects
   */
  getSessionsInfo(): SessionInfo[] {
    const info: SessionInfo[] = [];
    for (const [id, session] of this.sessions) {
      info.push({
        id,
        created: session.created,
        lastActivity: session.lastActivity,
        isPlaying: session.controller.getPlaybackState(),
      });
    }
    return info;
  }

  /**
   * Gets the default session's controller
   * @returns StrudelController or undefined if no default session exists
   */
  getDefaultSession(): StrudelController | undefined {
    return this.getSession(this.defaultSessionId);
  }

  /**
   * Sets the default session
   * @param id - Session identifier to set as default
   * @throws {Error} When session doesn't exist
   */
  setDefaultSession(id: string): void {
    if (!this.sessions.has(id)) {
      throw new Error(`Session '${id}' not found`);
    }
    this.defaultSessionId = id;
    this.logger.info(`Default session set to '${id}'`);
  }

  /**
   * Gets the current default session ID
   * @returns Default session identifier
   */
  getDefaultSessionId(): string {
    return this.defaultSessionId;
  }

  /**
   * Destroys all sessions and closes the browser
   */
  async destroyAll(): Promise<void> {
    const sessionIds = this.listSessions();

    for (const id of sessionIds) {
      try {
        const session = this.sessions.get(id);
        if (session) {
          await session.context.close();
        }
      } catch (error: any) {
        this.logger.warn(`Error closing session '${id}': ${error.message}`);
      }
    }

    this.sessions.clear();
    await this.closeBrowser();

    this.logger.info('All sessions destroyed');
  }

  /**
   * Closes the shared browser instance
   */
  private async closeBrowser(): Promise<void> {
    this.stopCleanupTimer();

    if (this.browser) {
      try {
        await this.browser.close();
      } catch (error: any) {
        this.logger.warn(`Error closing browser: ${error.message}`);
      }
      this.browser = null;
    }
  }

  /**
   * Starts the automatic cleanup timer
   */
  private startCleanupTimer(): void {
    if (this.cleanupTimer) return;

    this.cleanupTimer = setInterval(() => {
      this.cleanupInactiveSessions().catch((err) => {
        this.logger.error('Cleanup failed', err);
      });
    }, this.CLEANUP_INTERVAL);
  }

  /**
   * Stops the automatic cleanup timer
   */
  private stopCleanupTimer(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  /**
   * Cleans up sessions that have been inactive beyond the timeout
   */
  private async cleanupInactiveSessions(): Promise<void> {
    const now = Date.now();
    const sessionsToDestroy: string[] = [];

    for (const [id, session] of this.sessions) {
      const inactiveTime = now - session.lastActivity.getTime();
      if (inactiveTime > this.INACTIVITY_TIMEOUT) {
        sessionsToDestroy.push(id);
      }
    }

    for (const id of sessionsToDestroy) {
      this.logger.info(`Auto-destroying inactive session '${id}'`);
      try {
        await this.destroySession(id);
      } catch (error: any) {
        this.logger.error(`Failed to destroy session '${id}'`, error);
      }
    }
  }

  /**
   * Gets the number of active sessions
   * @returns Number of active sessions
   */
  getSessionCount(): number {
    return this.sessions.size;
  }

  /**
   * Checks if the browser is running
   * @returns True if browser is initialized
   */
  isBrowserRunning(): boolean {
    return this.browser !== null;
  }

  /**
   * Gets the maximum allowed sessions
   * @returns Maximum session limit
   */
  getMaxSessions(): number {
    return this.MAX_SESSIONS;
  }
}
