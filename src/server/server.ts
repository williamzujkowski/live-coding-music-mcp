import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
  Tool,
} from '@modelcontextprotocol/sdk/types.js';
import { StrudelController } from '../StrudelController.js';
import { PatternStore } from '../PatternStore.js';
import { MusicTheory } from '../services/MusicTheory.js';
import { PatternGenerator } from '../services/PatternGenerator.js';
import { GeminiService } from '../services/GeminiService.js';
import { AudioCaptureService } from '../services/AudioCaptureService.js';
import { MIDIExportService } from '../services/MIDIExportService.js';
import { SessionManager } from '../services/SessionManager.js';
import { readFileSync, existsSync } from 'fs';
import { Logger } from '../utils/Logger.js';
import { PerformanceMonitor } from '../utils/PerformanceMonitor.js';
import { StrudelEngine } from '../services/StrudelEngine.js';
import { diagnosticsModule } from './tools/diagnostics.js';
import { playbackModule } from './tools/playback.js';
import { storageModule } from './tools/storage.js';
import { historyModule } from './tools/history.js';
import { analysisModule } from './tools/analysis.js';
import { editorModule } from './tools/editor.js';
import { transformModule } from './tools/transform.js';
import { generateModule } from './tools/generate.js';
import { sessionModule } from './tools/session.js';
import { captureModule } from './tools/capture.js';
import { aiModule } from './tools/ai.js';
import { composeModule } from './tools/compose.js';
import type { Envelope, ToolContext, HistoryEntry } from './tools/types.js';
import { categorizeError, err, isEnvelope, ok } from './tools/types.js';
import { readResource, resources as mcpResources } from './resources.js';
import { join } from 'node:path';

const configPath = './config.json';
const config = existsSync(configPath)
  ? JSON.parse(readFileSync(configPath, 'utf-8'))
  : { headless: false };

export class StrudelMCPServer {
  private server: Server;
  private controller: StrudelController;
  private store: PatternStore;
  private theory: MusicTheory;
  private generator: PatternGenerator;
  private geminiService: GeminiService;
  private audioCaptureService: AudioCaptureService | null = null;
  private midiExportService: MIDIExportService;
  private sessionManager: SessionManager;
  private logger: Logger;
  private perfMonitor: PerformanceMonitor;
  private strudelEngine: StrudelEngine;
  private sessionHistory: string[] = [];
  private undoStack: string[] = [];
  private redoStack: string[] = [];
  /** Pattern history with metadata for browsing (#41) */
  private historyStack: HistoryEntry[] = [];
  private historyIdCounter: number = 0;
  /** Maximum history entries to prevent memory leaks */
  private readonly MAX_HISTORY = 100;
  private isInitialized: boolean = false;
  private generatedPatterns: Map<string, string> = new Map();

  constructor() {
    this.server = new Server(
      {
        name: 'live-coding-music-mcp',
        version: '2.0.1',
      },
      {
        capabilities: {
          tools: {},
          resources: {},
        },
      }
    );

    this.controller = new StrudelController(config.headless);
    this.store = new PatternStore('./patterns');
    this.theory = new MusicTheory();
    this.generator = new PatternGenerator();
    this.geminiService = new GeminiService();
    this.midiExportService = new MIDIExportService();
    this.sessionManager = new SessionManager(config.headless);
    this.logger = new Logger();
    this.perfMonitor = new PerformanceMonitor();
    this.strudelEngine = new StrudelEngine();
    this.setupHandlers();
  }

  private getTools(): Tool[] {
    return [
      {
        name: 'init',
        description: 'Initialize Strudel in browser',
        inputSchema: { type: 'object', properties: {} },
      },
      ...editorModule.tools,
      ...playbackModule.tools,
      ...transformModule.tools,
      ...generateModule.tools,
      ...analysisModule.tools,
      ...storageModule.tools,
      ...historyModule.tools,
      ...diagnosticsModule.tools,
      ...composeModule.tools,
      ...aiModule.tools,
      ...captureModule.tools,
      ...sessionModule.tools,
    ];
  }

  private setupHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: this.getTools()
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;
      const envelope = await this.dispatchToolCall(name, args);
      return {
        content: [{ type: 'text', text: JSON.stringify(envelope, null, 2) }],
      };
    });

    // MCP resources — read-only catalogs (#131). Resource handlers stay
    // here in server.ts because they're protocol surface, not tool calls.
    this.server.setRequestHandler(ListResourcesRequestSchema, async () => ({
      resources: mcpResources,
    }));

    this.server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      const uri = request.params.uri;
      try {
        const content = await readResource(uri, {
          store: this.store,
          examplesDir: join(process.cwd(), 'patterns', 'examples'),
        });
        return { contents: [content] };
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(`Resource read failed: ${uri}`, { error: message });
        throw error;
      }
    });
  }

  /**
   * Wraps every tool call into the shared envelope (#130).
   *
   * Tools may return:
   *   - a raw value → auto-wrapped via `ok(value)`
   *   - a pre-built Envelope (via the `ok()`/`err()`/`empty()` helpers in
   *     `tools/types.ts`) → passed through unchanged
   *   - an "error-shaped" string (starts with "Error: " or "Browser not
   *     initialized") → converted to `err(...)` so legacy modules still
   *     surface as failures while their internal migration to envelope
   *     helpers proceeds incrementally
   *
   * Thrown errors are caught and converted to `err(...)` with a category
   * inferred from the message (see `categorizeError`).
   */
  private async dispatchToolCall(name: string, args: unknown): Promise<Envelope> {
    try {
      this.logger.info(`Executing tool: ${name}`, args);
      const result = await this.perfMonitor.measureAsync(
        name,
        () => this.executeTool(name, args),
      );

      if (isEnvelope(result)) {
        return result;
      }

      // Convert legacy "Error: ..." / "Browser not initialized" string returns
      // into the envelope. Module-level migration is incremental — this branch
      // shrinks as modules adopt the helpers natively.
      if (typeof result === 'string') {
        if (result.startsWith('Error: ')) {
          return err('internal', result.slice('Error: '.length));
        }
        if (result.startsWith('Browser not initialized')) {
          return err('business', result);
        }
        return ok(result);
      }

      return ok(result);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Tool execution failed: ${name}`, { error: message });
      return err(categorizeError(error), message);
    }
  }

  // requiresInitialization() removed (#141 / #108): each module's
  // execute() does its own session-aware init check. The hardcoded
  // tool-name lists had drifted and were silently wrong for explicit
  // session_id.

  private async getCurrentPatternSafe(sessionId?: string): Promise<string> {
    if (sessionId) {
      // Explicit session — strict lookup, no pre-init stash. Named sessions
      // must be created via `create_session` before they're useful.
      const sessionController = this.sessionManager.getSession(sessionId);
      if (!sessionController) {
        throw new Error(`Session '${sessionId}' not found. Create it first with create_session.`);
      }
      try {
        return await sessionController.getCurrentPattern();
      } catch {
        return '';
      }
    }

    if (!this.isInitialized) {
      // Default session: return the last pre-init generated pattern if any
      const lastPattern = Array.from(this.generatedPatterns.values()).pop();
      return lastPattern || '';
    }

    try {
      return await this.controller.getCurrentPattern();
    } catch {
      return '';
    }
  }

  private async writePatternSafe(pattern: string, sessionId?: string): Promise<string> {
    if (sessionId) {
      const sessionController = this.sessionManager.getSession(sessionId);
      if (!sessionController) {
        throw new Error(`Session '${sessionId}' not found. Create it first with create_session.`);
      }
      return await sessionController.writePattern(pattern);
    }

    if (!this.isInitialized) {
      // Default session: stash the pattern for the next init/auto-init
      const id = `pattern_${Date.now()}`;
      this.generatedPatterns.set(id, pattern);
      return `Pattern generated (initialize Strudel to use it): ${pattern.substring(0, 50)}...`;
    }

    return await this.controller.writePattern(pattern);
  }

  /**
   * Gets a StrudelController for the specified session, or the default session.
   * Falls back to the legacy single controller if no sessions exist.
   * @param sessionId - Optional session ID. Uses default session if not specified.
   * @returns StrudelController for the session
   * @throws {Error} If session doesn't exist
   */
  private getControllerForSession(sessionId?: string): StrudelController {
    // If session_id is specified, use the SessionManager
    if (sessionId) {
      const controller = this.sessionManager.getSession(sessionId);
      if (!controller) {
        throw new Error(`Session '${sessionId}' not found. Create it first with create_session.`);
      }
      return controller;
    }

    // If sessions exist and there's a default, use it
    const defaultController = this.sessionManager.getDefaultSession();
    if (defaultController) {
      return defaultController;
    }

    // Fall back to legacy single controller for backwards compatibility
    return this.controller;
  }

  /**
   * Checks if a session exists (or default/legacy controller is initialized)
   * @param sessionId - Optional session ID
   * @returns True if controller is available
   */
  private hasSession(sessionId?: string): boolean {
    if (sessionId) {
      return this.sessionManager.getSession(sessionId) !== undefined;
    }
    // Check if we have a default session or the legacy controller is initialized
    return this.sessionManager.getDefaultSession() !== undefined || this.isInitialized;
  }

  private async executeTool(name: string, args: any): Promise<any> {
    // Pre-flight init check removed (#141): every module's execute() does
    // its own session-aware init check via ctx.isInitialized() /
    // ctx.getController(sid). The old hardcoded tool-name list drifted as
    // tools moved between modules and #108 made it silently wrong for
    // explicit session_id (it returned "Browser not initialized" instead
    // of "Session 'X' not found").

    // Save current state for undo and history (#41) before any edit on the
    // default session. Named-session edits bypass the legacy undo stack —
    // per-session history is tracked in #140 follow-up.
    if (['write', 'append', 'insert', 'replace', 'clear'].includes(name) && this.isInitialized && !args?.session_id) {
      try {
        const current = await this.controller.getCurrentPattern();
        this.undoStack.push(current);

        this.historyIdCounter++;
        this.historyStack.push({
          id: this.historyIdCounter,
          pattern: current,
          timestamp: new Date(),
          action: name
        });

        if (this.undoStack.length > this.MAX_HISTORY) {
          this.undoStack.shift();
        }
        if (this.historyStack.length > this.MAX_HISTORY) {
          this.historyStack.shift();
        }
        this.redoStack = [];
      } catch {
        // Controller might not be initialized yet
      }
    }

    // Delegate to extracted per-domain tool modules before the big switch.
    // Part of the #104 file split — each module owns its own definitions
    // and handlers. server.ts keeps the protocol + state-tracking shell.
    const ctx: ToolContext = {
      controller: this.controller,
      perfMonitor: this.perfMonitor,
      store: this.store,
      generator: this.generator,
      theory: this.theory,
      sessionManager: this.sessionManager,
      geminiService: this.geminiService,
      strudelEngine: this.strudelEngine,
      midiExportService: this.midiExportService,
      getAudioCaptureService: () => this.getAudioCaptureService(),
      history: {
        undoStack: this.undoStack,
        redoStack: this.redoStack,
        historyStack: this.historyStack,
        maxHistory: this.MAX_HISTORY,
      },
      logger: this.logger,
      isInitialized: () => this.isInitialized,
      ensureInitialized: () => this.ensureInitialized(),
      getController: (sessionId?: string) => this.getControllerForSession(sessionId),
      getCurrentPatternSafe: (sessionId?: string) => this.getCurrentPatternSafe(sessionId),
      writePatternSafe: (p: string, sessionId?: string) => this.writePatternSafe(p, sessionId),
    };
    if (diagnosticsModule.toolNames.has(name)) {
      return await diagnosticsModule.execute(name, args, ctx);
    }
    if (playbackModule.toolNames.has(name)) {
      return await playbackModule.execute(name, args, ctx);
    }
    if (storageModule.toolNames.has(name)) {
      return await storageModule.execute(name, args, ctx);
    }
    if (historyModule.toolNames.has(name)) {
      return await historyModule.execute(name, args, ctx);
    }
    if (analysisModule.toolNames.has(name)) {
      return await analysisModule.execute(name, args, ctx);
    }
    if (editorModule.toolNames.has(name)) {
      return await editorModule.execute(name, args, ctx);
    }
    if (transformModule.toolNames.has(name)) {
      return await transformModule.execute(name, args, ctx);
    }
    if (generateModule.toolNames.has(name)) {
      return await generateModule.execute(name, args, ctx);
    }
    if (sessionModule.toolNames.has(name)) {
      return await sessionModule.execute(name, args, ctx);
    }
    if (captureModule.toolNames.has(name)) {
      return await captureModule.execute(name, args, ctx);
    }
    if (aiModule.toolNames.has(name)) {
      return await aiModule.execute(name, args, ctx);
    }
    if (composeModule.toolNames.has(name)) {
      return await composeModule.execute(name, args, ctx);
    }

    if (name === 'init') {
      const initResult = await this.controller.initialize();
      this.isInitialized = true;
      // Replay any pattern generated before init landed.
      if (this.generatedPatterns.size > 0) {
        const lastPattern = Array.from(this.generatedPatterns.values()).pop();
        if (lastPattern) {
          await this.controller.writePattern(lastPattern);
          return `${initResult}. Loaded generated pattern.`;
        }
      }
      return initResult;
    }

    throw new Error(`Unknown tool: ${name}`);
  }

  /** Idempotent browser bring-up. Used by tools that promise auto-init (e.g. `compose`). */
  private async ensureInitialized(): Promise<void> {
    if (this.isInitialized) return;
    await this.controller.initialize();
    this.isInitialized = true;
  }

  /** Getter for page access in audio capture. */
  private get _page() {
    return this.controller.page;
  }

  // Audio capture + MIDI export logic moved to src/server/tools/capture.ts.
  // Server still owns the AudioCaptureService lifecycle so tests can mock
  // the class and the module fetches the (possibly mocked) instance via
  // ctx.getAudioCaptureService() instead of caching its own.
  private async getAudioCaptureService(): Promise<AudioCaptureService> {
    if (!this.isInitialized || !this._page) {
      throw new Error('Browser not initialized. Run init first.');
    }
    if (!this.audioCaptureService) {
      this.audioCaptureService = new AudioCaptureService();
      await this.audioCaptureService.injectRecorder(this._page);
    }
    return this.audioCaptureService;
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    this.logger.info('Enhanced Strudel MCP server v2.0.1 running (fixed)');

    process.on('SIGINT', async () => {
      this.logger.info('Shutting down...');
      await this.controller.cleanup();
      await this.sessionManager.destroyAll();
      process.exit(0);
    });
  }
}