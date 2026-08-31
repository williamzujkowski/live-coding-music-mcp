/**
 * The contract the local (non-browser) pattern tools depend on.
 *
 * Two things implement this: `StrudelEngine`, which evaluates in-process,
 * and `IsolatedStrudelEngine`, which evaluates in a forked child with a
 * heap cap and a deadline (#307). The tool layer talks to this interface
 * so it does not care which.
 *
 * Every method is declared as `T | Promise<T>` rather than `Promise<T>`.
 * That is deliberate: the in-process engine is synchronous, the isolated
 * one cannot be, and `await` handles both. Forcing the synchronous
 * implementation to return promises would buy nothing and would break the
 * direct-call tests that exercise it.
 */

import type {
  LocalValidationResult,
  PatternEvent,
  PatternMetadata,
  TranspileResult,
} from './StrudelEngine.js';

export interface LocalPatternEngine {
  transpile(code: string): TranspileResult | Promise<TranspileResult>;
  validate(code: string): LocalValidationResult | Promise<LocalValidationResult>;
  analyzePattern(code: string): PatternMetadata | Promise<PatternMetadata>;
  queryEvents(code: string, start: number, end: number): PatternEvent[] | Promise<PatternEvent[]>;
}

/** The four methods that cross the isolation boundary. */
export const ISOLATED_METHODS = ['transpile', 'validate', 'analyzePattern', 'queryEvents'] as const;
