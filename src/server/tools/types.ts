/**
 * Shared types for the per-domain tool modules under src/server/tools/.
 *
 * Part of the file-split work tracked in #104. Each domain file exports a
 * `tools` array of MCP tool definitions and an `execute(name, args, ctx)`
 * dispatcher. The server keeps the MCP protocol layer thin and delegates
 * to these modules.
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { StrudelController } from '../../StrudelController.js';
import type { PatternStore } from '../../PatternStore.js';
import type { PatternGenerator } from '../../services/PatternGenerator.js';
import type { MusicTheory } from '../../services/MusicTheory.js';
import type { SessionManager } from '../../services/SessionManager.js';
import type { MIDIExportService } from '../../services/MIDIExportService.js';
import type { AudioCaptureService } from '../../services/AudioCaptureService.js';
import type { GeminiService } from '../../services/GeminiService.js';
import type { StrudelEngine } from '../../services/StrudelEngine.js';
import type { Logger } from '../../utils/Logger.js';
import type { PerformanceMonitor } from '../../utils/PerformanceMonitor.js';

/** History entry with metadata for pattern browsing (used by history.ts). */
export interface HistoryEntry {
  id: number;
  pattern: string;
  timestamp: Date;
  action: string;
}

/**
 * Undo / redo / history state — arrays are passed by reference so the
 * outer server can still push onto them during write/append/etc., and
 * the history module can pop/shift them during undo/redo.
 */
export interface HistoryState {
  undoStack: string[];
  redoStack: string[];
  historyStack: HistoryEntry[];
  readonly maxHistory: number;
}

/**
 * Runtime context passed into every tool executor. Getters rather than
 * values so that mutable server state (isInitialized flag) stays live.
 * Helpers like getCurrentPatternSafe/writePatternSafe wrap server-side
 * state (e.g. the generated-pattern cache used before init).
 */
export interface ToolContext {
  controller: StrudelController;
  perfMonitor: PerformanceMonitor;
  store: PatternStore;
  generator: PatternGenerator;
  theory: MusicTheory;
  sessionManager: SessionManager;
  geminiService: GeminiService;
  strudelEngine: StrudelEngine;
  midiExportService: MIDIExportService;
  /**
   * Lazily returns the shared AudioCaptureService (the server owns its
   * lifecycle). Callers only get a service when init has run and a page
   * exists; this method throws otherwise.
   */
  getAudioCaptureService(): Promise<AudioCaptureService>;
  history: HistoryState;
  logger: Logger;
  isInitialized(): boolean;
  /**
   * Initializes the browser if it isn't already, flipping the server's
   * `isInitialized` flag. Used by tools (e.g. `compose`) that promise to
   * auto-init rather than refusing without setup.
   */
  ensureInitialized(): Promise<void>;
  getCurrentPatternSafe(): Promise<string>;
  writePatternSafe(pattern: string): Promise<string>;
}

/**
 * Shape every domain module exports.
 */
export interface ToolModule {
  /** MCP tool definitions for this domain. */
  tools: Tool[];
  /** Names of tools this module handles — used by the dispatcher. */
  toolNames: Set<string>;
  /** Execute a tool by name. Throws if the name is unknown to this module. */
  execute(name: string, args: any, ctx: ToolContext): Promise<unknown>;
}
