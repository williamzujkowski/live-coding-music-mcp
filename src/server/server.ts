import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
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
import type { ToolContext, HistoryEntry } from './tools/types.js';

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

      try {
        this.logger.info(`Executing tool: ${name}`, args);

        // Measure performance
        const result = await this.perfMonitor.measureAsync(
          name,
          () => this.executeTool(name, args)
        );

        return {
          content: [{
            type: 'text',
            text: typeof result === 'string' ? result : JSON.stringify(result, null, 2)
          }],
        };
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(`Tool execution failed: ${name}`, { error: message });
        return {
          content: [{
            type: 'text',
            text: `Error: ${message}`
          }],
        };
      }
    });
  }

  private requiresInitialization(toolName: string): boolean {
    const toolsRequiringInit = [
      'write', 'append', 'insert', 'replace', 'play', 'pause', 'stop',
      'clear', 'get_pattern', 'analyze', 'analyze_spectrum', 'analyze_rhythm',
      'transpose', 'reverse', 'stretch', 'humanize', 'generate_variation',
      'add_effect', 'add_swing', 'set_tempo', 'save', 'undo', 'redo',
      'validate_pattern_runtime'
    ];
    
    const toolsRequiringWrite = [
      'generate_pattern', 'generate_drums', 'generate_bassline', 'generate_melody',
      'generate_chord_progression', 'generate_euclidean', 'generate_polyrhythm',
      'generate_fill'
    ];
    
    return toolsRequiringInit.includes(toolName) || toolsRequiringWrite.includes(toolName);
  }

  private async getCurrentPatternSafe(): Promise<string> {
    if (!this.isInitialized) {
      // Return the last generated pattern if available
      const lastPattern = Array.from(this.generatedPatterns.values()).pop();
      return lastPattern || '';
    }
    
    try {
      return await this.controller.getCurrentPattern();
    } catch (e) {
      return '';
    }
  }

  private async writePatternSafe(pattern: string): Promise<string> {
    if (!this.isInitialized) {
      // Store the pattern for later use
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
    // Check if tool needs initialization
    if (this.requiresInitialization(name) && !this.isInitialized && name !== 'init') {
      // For generation tools that don't require browser, handle them specially
      const generationTools = [
        'generate_pattern', 'generate_drums', 'generate_bassline', 'generate_melody',
        'generate_chord_progression', 'generate_euclidean', 'generate_polyrhythm', 'generate_fill'
      ];
      
      if (!generationTools.includes(name)) {
        return `Browser not initialized. Run 'init' first to use ${name}.`;
      }
    }

    // Save current state for undo and history (#41) (only if initialized)
    if (['write', 'append', 'insert', 'replace', 'clear'].includes(name) && this.isInitialized) {
      try {
        const current = await this.controller.getCurrentPattern();
        this.undoStack.push(current);

        // Add to history stack with metadata (#41)
        this.historyIdCounter++;
        this.historyStack.push({
          id: this.historyIdCounter,
          pattern: current,
          timestamp: new Date(),
          action: name
        });

        // Enforce bounds to prevent memory leaks
        if (this.undoStack.length > this.MAX_HISTORY) {
          this.undoStack.shift();
        }
        if (this.historyStack.length > this.MAX_HISTORY) {
          this.historyStack.shift();
        }
        this.redoStack = [];
      } catch (e) {
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
      getCurrentPatternSafe: () => this.getCurrentPatternSafe(),
      writePatternSafe: (p: string) => this.writePatternSafe(p),
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