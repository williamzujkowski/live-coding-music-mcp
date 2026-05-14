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

/**
 * Tool result envelope (#130, from #127 finding #4-5).
 *
 * Every tool call resolves to one of these. server.ts dispatch wraps
 * raw returns and thrown errors into the envelope so MCP clients see a
 * consistent shape and can branch on `ok` + `errorCategory` without
 * parsing free-text messages.
 *
 * Tools may also return an Envelope directly (constructed via `ok()` /
 * `err()` / `empty()`); the dispatch passes those through unchanged.
 *
 * Categories:
 *   - `validation`  — caller-supplied input is wrong (don't retry, fix args)
 *   - `transient`   — network / external service hiccup (retry with backoff)
 *   - `business`    — system state prevents the action (e.g. browser not
 *                     initialized; setup needed, not retry)
 *   - `permission`  — auth / config missing (e.g. Gemini key absent)
 *   - `internal`    — unexpected failure inside the server; bug shape
 */
export type ErrorCategory =
  | 'validation'
  | 'transient'
  | 'business'
  | 'permission'
  | 'internal';

export interface OkEnvelope<T = unknown> {
  ok: true;
  data: T;
  /** True when the call succeeded but produced no records (e.g. empty list). */
  empty?: boolean;
}

export interface ErrEnvelope {
  ok: false;
  errorCategory: ErrorCategory;
  isRetryable: boolean;
  message: string;
  /** Partial result if the operation produced something usable before failing. */
  partialResult?: unknown;
}

export type Envelope<T = unknown> = OkEnvelope<T> | ErrEnvelope;

/** Type guard for tools and dispatchers. */
export function isEnvelope(v: unknown): v is Envelope {
  return (
    typeof v === 'object' &&
    v !== null &&
    'ok' in v &&
    typeof (v as { ok: unknown }).ok === 'boolean'
  );
}

/** Construct a success envelope. */
export function ok<T>(data: T): OkEnvelope<T> {
  return { ok: true, data };
}

/**
 * Construct a success envelope that represents a valid-empty result —
 * the call worked but produced nothing (no patterns found, empty
 * history, etc.). Distinct from `err` so agents can choose between
 * "report nothing" and "retry/setup".
 */
export function empty<T>(data: T): OkEnvelope<T> {
  return { ok: true, data, empty: true };
}

/** Construct an error envelope. */
export function err(
  category: ErrorCategory,
  message: string,
  opts?: { isRetryable?: boolean; partialResult?: unknown },
): ErrEnvelope {
  return {
    ok: false,
    errorCategory: category,
    // Default retryability follows category: transient retries, others don't.
    isRetryable: opts?.isRetryable ?? category === 'transient',
    message,
    ...(opts?.partialResult !== undefined ? { partialResult: opts.partialResult } : {}),
  };
}

/**
 * Best-effort error categorization for raw thrown errors. Used by the
 * dispatcher when a tool throws without wrapping. Tools that know better
 * should construct `err(category, message)` directly.
 */
export function categorizeError(error: unknown): ErrorCategory {
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();

  if (
    lower.includes('not initialized') ||
    lower.includes("run 'init' first") ||
    lower.includes('run init first') ||
    lower.includes('not found') ||
    lower.includes('already exists')
  ) {
    return 'business';
  }
  if (
    lower.includes('invalid') ||
    lower.includes('must be') ||
    lower.includes('required') ||
    lower.includes('out of range')
  ) {
    return 'validation';
  }
  if (
    lower.includes('gemini') ||
    lower.includes('api key') ||
    lower.includes('unauthorized') ||
    lower.includes('forbidden')
  ) {
    return 'permission';
  }
  if (
    lower.includes('timeout') ||
    lower.includes('econnrefused') ||
    lower.includes('network') ||
    lower.includes('fetch failed')
  ) {
    return 'transient';
  }
  return 'internal';
}
