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
import type { AudioExportService } from '../../services/AudioExportService.js';
import type { MIDIImportService } from '../../services/MIDIImportService.js';
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
 * Undo / redo / history state for a single session — arrays are passed
 * by reference so the outer server can still push onto them during
 * write/append/etc., and the history module can pop/shift them during
 * undo/redo. The bundle is fetched per-call via `ctx.getHistory(sid)`
 * so that named sessions get their own stacks (#179).
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
  perfMonitor: PerformanceMonitor;
  store: PatternStore;
  generator: PatternGenerator;
  theory: MusicTheory;
  sessionManager: SessionManager;
  geminiService: GeminiService;
  strudelEngine: StrudelEngine;
  midiExportService: MIDIExportService;
  midiImportService: MIDIImportService;
  audioExportService: AudioExportService;
  /**
   * Lazily returns the per-session AudioCaptureService (#180). When no
   * `sessionId` is given, returns the default-session service (legacy
   * single-session behaviour); explicit ids route through SessionManager.
   * Throws if the targeted session isn't initialised yet.
   */
  getAudioCaptureService(sessionId?: string): Promise<AudioCaptureService>;
  /** Drop a session's AudioCaptureService instance (called by session destroy). */
  dropAudioCaptureService(sessionId: string): void;
  /**
   * Resolves the per-session HistoryState (#179). Omitting the session id
   * returns the default-session bundle; named sessions get their own
   * isolated undo/redo/history stacks. Auto-creates the bundle on first
   * access so callers never have to check existence.
   */
  getHistory(sessionId?: string): HistoryState;
  /** Drop a session's history bundle (called by session destroy). */
  dropHistory(sessionId: string): void;
  logger: Logger;
  isInitialized(): boolean;
  /**
   * Initializes the browser if it isn't already, flipping the server's
   * `isInitialized` flag. Used by tools (e.g. `compose`) that promise to
   * auto-init rather than refusing without setup.
   */
  ensureInitialized(): Promise<void>;
  /**
   * Resolves a StrudelController for the requested session (#108).
   *
   * Semantics:
   *   - `undefined` (no session_id) → legacy/default controller; preserves
   *     single-user behaviour for callers that don't know about sessions.
   *   - explicit string → SessionManager.getSession(id); **throws** if the
   *     session doesn't exist. Named sessions must be created via the
   *     `session({ action: 'create' })` before use.
   *
   * The only way to reach a controller: the raw handle was removed
   * because it always returned the default session, so any tool using it
   * would silently ignore `session_id` (#242). The dispatcher wraps the throw into
   * `err('business', 'Session 'X' not found...')` for MCP clients.
   */
  getController(sessionId?: string): StrudelController;
  getCurrentPatternSafe(sessionId?: string): Promise<string>;
  writePatternSafe(pattern: string, sessionId?: string): Promise<string>;
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
/**
 * Whether a tool returned a self-declared failure.
 *
 * Several modules report problems as `{ success: false, message }`
 * rather than throwing or building an envelope. Wrapped with `ok()`
 * those reach MCP clients as successes, with the real outcome hidden in
 * a field the envelope contract says nothing about (#274).
 *
 * @param value - A tool's raw return value
 * @returns True when it declares failure
 */
export function isFailureShaped(
  value: unknown,
): value is { success?: false; message?: unknown; error?: unknown } {
  if (typeof value !== 'object' || value === null) return false;

  const record = value as { success?: unknown; error?: unknown };

  // An explicit success:false is unambiguous.
  if ('success' in record && record.success === false) return true;

  // A bare `{ error: '...' }` with no success flag is equally a failure,
  // and several modules return exactly that — ai.ts and analysis.ts both
  // do. Requiring a `success` key let those through as ok:true, which is
  // the same bug one shape over (#274).
  //
  // Guarded by `success !== true` so a result that genuinely succeeded
  // while carrying a non-fatal `error` field is left alone.
  return (
    record.success !== true &&
    typeof record.error === 'string' &&
    record.error.length > 0
  );
}

export function categorizeError(error: unknown): ErrorCategory {
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();

  // Transient first. It used to be checked last, behind `validation`,
  // which meant a timeout mentioning an invalid state was filed as a
  // caller mistake — and everything not matched fell through to
  // `internal`, whose isRetryable is false.
  //
  // 'timed out' is the important entry: the codebase says that 13 times
  // and 'timeout' twice, and 'timed out'.includes('timeout') is false. So
  // essentially every real timeout was reported to agents as a permanent
  // internal failure not worth retrying. Rate limits had the same
  // problem across 14 throw sites, and a rate limit is the single most
  // retryable error there is.
  if (
    lower.includes('timed out') ||
    lower.includes('timeout') ||
    lower.includes('rate limit') ||
    lower.includes('econnrefused') ||
    lower.includes('econnreset') ||
    lower.includes('etimedout') ||
    lower.includes('network') ||
    lower.includes('fetch failed') ||
    lower.includes('did not become ready')
  ) {
    return 'transient';
  }

  // Auth before business: a CLI that is installed but not logged in is a
  // credential problem, and saying 'not found' about a login is not the
  // same as saying it about a session.
  if (
    lower.includes('gemini') ||
    lower.includes('api key') ||
    lower.includes('unauthorized') ||
    lower.includes('unauthenticated') ||
    lower.includes('not authenticated') ||
    lower.includes('forbidden') ||
    lower.includes('permission denied') ||
    lower.includes('credential')
  ) {
    return 'permission';
  }

  if (
    lower.includes('not initialized') ||
    lower.includes("run 'init' first") ||
    lower.includes('run init first') ||
    lower.includes('not found') ||
    lower.includes('not installed') ||
    lower.includes('no ai transport') ||
    lower.includes('already exists') ||
    lower.includes('already in progress') ||
    lower.includes('not connected') ||
    lower.includes('did not start') ||
    lower.includes('no pattern')
  ) {
    return 'business';
  }

  if (
    lower.includes('invalid') ||
    lower.includes('must be') ||
    lower.includes('required') ||
    lower.includes('out of range') ||
    lower.includes('too many') ||
    lower.includes('too long') ||
    lower.includes('non-empty') ||
    lower.includes('cannot be empty')
  ) {
    return 'validation';
  }

  return 'internal';
}
