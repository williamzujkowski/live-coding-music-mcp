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

// Translate config.audio_analysis (snake_case in JSON) to the camelCase
// AudioAnalysisConfig the analyzer expects. Invalid values are normalized
// to undefined here so the analyzer falls back to its own defaults
// without a downstream warning for a value the user never set. (#195)
const audioAnalysisConfig: { fftSize?: number; smoothing?: number } | undefined =
  config.audio_analysis
    ? {
        fftSize: typeof config.audio_analysis.fft_size === 'number' ? config.audio_analysis.fft_size : undefined,
        smoothing: typeof config.audio_analysis.smoothing === 'number' ? config.audio_analysis.smoothing : undefined,
      }
    : undefined;

export class StrudelMCPServer {
  private server: Server;
  private controller: StrudelController;
  private store: PatternStore;
  private theory: MusicTheory;
  private generator: PatternGenerator;
  private geminiService: GeminiService;
  /**
   * Per-session AudioCaptureService instances (#180). Keyed by session id
   * (or 'default' for the legacy/single-session path). Each session's
   * recorder injects into its own page, so concurrent captures across
   * sessions no longer conflict.
   */
  private audioCaptureServices: Map<string, AudioCaptureService> = new Map();
  private midiExportService: MIDIExportService;
  private sessionManager: SessionManager;
  private logger: Logger;
  private perfMonitor: PerformanceMonitor;
  private strudelEngine: StrudelEngine;
  private sessionHistory: string[] = [];
  /**
   * Per-session undo/redo/history bundles (#179). Keyed by session id;
   * 'default' for the legacy/single-session path. Bundles are lazily
   * created on first access via getHistory().
   */
  private historyBundles: Map<string, {
    undoStack: string[];
    redoStack: string[];
    historyStack: HistoryEntry[];
  }> = new Map();
  /** Server-wide history-entry counter; IDs unique across all sessions. */
  private historyIdCounter: number = 0;
  /** Maximum history entries per session to prevent memory leaks */
  private readonly MAX_HISTORY = 100;
  private isInitialized: boolean = false;
  private generatedPatterns: Map<string, string> = new Map();

  constructor() {
    this.server = new Server(
      {
        name: 'live-coding-music-mcp',
        version: '4.0.0',
      },
      {
        capabilities: {
          tools: {},
          resources: {},
        },
      }
    );

    this.controller = new StrudelController(config.headless, audioAnalysisConfig);
    this.store = new PatternStore('./patterns');
    this.theory = new MusicTheory();
    this.generator = new PatternGenerator();
    this.geminiService = new GeminiService();
    this.midiExportService = new MIDIExportService();
    this.sessionManager = new SessionManager(config.headless, audioAnalysisConfig);
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
      // must be created via `session({ action: "create" })` before they're useful.
      const sessionController = this.sessionManager.getSession(sessionId);
      if (!sessionController) {
        throw new Error(`Session '${sessionId}' not found. Create it first with session({ action: "create" }).`);
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
        throw new Error(`Session '${sessionId}' not found. Create it first with session({ action: "create" }).`);
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
        throw new Error(`Session '${sessionId}' not found. Create it first with session({ action: "create" }).`);
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

    // Save current state for undo and history (#41) before any edit
    // (#179): route to the session-specific bundle. Default session is
    // 'default'; named sessions get their own isolated stacks.
    if (name === 'edit_pattern') {
      const sid: string | undefined = args?.session_id;
      const canRead = sid !== undefined || this.isInitialized;
      if (canRead) {
        try {
          const controller = this.getControllerForSession(sid);
          const current = await controller.getCurrentPattern();
          const bundle = this.getHistoryBundle(sid ?? 'default');
          bundle.undoStack.push(current);

          this.historyIdCounter++;
          bundle.historyStack.push({
            id: this.historyIdCounter,
            pattern: current,
            timestamp: new Date(),
            action: args?.mode ?? 'write',
          });

          if (bundle.undoStack.length > this.MAX_HISTORY) bundle.undoStack.shift();
          if (bundle.historyStack.length > this.MAX_HISTORY) bundle.historyStack.shift();
          bundle.redoStack.length = 0;
        } catch {
          // Controller might not be initialized yet, or session is gone
        }
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
      getAudioCaptureService: (sessionId?: string) => this.getAudioCaptureService(sessionId),
      dropAudioCaptureService: (sessionId: string) => { this.audioCaptureServices.delete(sessionId); },
      getHistory: (sessionId?: string) => {
        const bundle = this.getHistoryBundle(sessionId ?? 'default');
        return {
          undoStack: bundle.undoStack,
          redoStack: bundle.redoStack,
          historyStack: bundle.historyStack,
          maxHistory: this.MAX_HISTORY,
        };
      },
      historyEntryId: () => ++this.historyIdCounter,
      dropHistory: (sessionId: string) => { this.historyBundles.delete(sessionId); },
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

  /**
   * Lazily get or create the per-session history bundle (#179). Bundle is
   * a mutable triple — callers push/shift directly on the arrays.
   */
  private getHistoryBundle(sessionId: string): {
    undoStack: string[];
    redoStack: string[];
    historyStack: HistoryEntry[];
  } {
    let bundle = this.historyBundles.get(sessionId);
    if (!bundle) {
      bundle = { undoStack: [], redoStack: [], historyStack: [] };
      this.historyBundles.set(sessionId, bundle);
    }
    return bundle;
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

  // Audio capture + MIDI export logic lives in src/server/tools/capture.ts.
  // Server still owns AudioCaptureService lifecycles so tests can mock
  // the class. Post-#180: per-session — each session's recorder injects
  // into its own page; concurrent captures across sessions no longer
  // share a singleton stream.
  private async getAudioCaptureService(sessionId?: string): Promise<AudioCaptureService> {
    // Resolve the right page: explicit session via SessionManager, or
    // legacy/default via this.controller.
    let page;
    let key: string;
    if (sessionId) {
      const sessionController = this.sessionManager.getSession(sessionId);
      if (!sessionController) {
        throw new Error(`Session '${sessionId}' not found. Create it first with session({ action: "create" }).`);
      }
      if (!sessionController.page) {
        throw new Error(`Session '${sessionId}' has no active page yet.`);
      }
      page = sessionController.page;
      key = sessionId;
    } else {
      if (!this.isInitialized || !this._page) {
        throw new Error('Browser not initialized. Run init first.');
      }
      page = this._page;
      key = 'default';
    }

    let service = this.audioCaptureServices.get(key);
    if (!service) {
      service = new AudioCaptureService();
      await service.injectRecorder(page);
      this.audioCaptureServices.set(key, service);
    }
    return service;
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