/**
 * StrudelEngine - Local Strudel pattern engine for Node.js
 *
 * Executes Strudel patterns without browser automation.
 * Uses @strudel/core, @strudel/mini, and @strudel/transpiler for:
 * - Pattern validation with precise error locations
 * - Event querying for pattern analysis
 * - Syntax checking without browser overhead
 *
 * Note: Audio playback still requires browser (Playwright) - this is for
 * validation and analysis only.
 *
 * @module services/StrudelEngine
 */

import * as strudelCore from '@strudel/core';
// Imported for its side effects as well as its exports: Strudel's
// register() attaches .scale()/.voicing()/.transpose() onto
// Pattern.prototype at module load. Without this, local validation
// rejected `n("0 2 4").scale("C:minor")` — an idiom that appears
// throughout this project's own docs — with the misleading
// "n(...).scale is not a function", while the browser path accepted it
// (#232). Local and browser validation disagreeing about the same
// pattern is worse than either being wrong consistently.
import * as strudelTonal from '@strudel/tonal';
import { mini } from '@strudel/mini';
import { transpiler } from '@strudel/transpiler';
import { assertPatternIsSafe, runPatternCode, PatternSafetyError } from './PatternSandbox.js';
import { clarifyEngineError, explainBrowserOnly, findBrowserOnlyCall } from './BrowserOnlyFunctions.js';
import { probeEventDensity } from './EventDensityProbe.js';
import { ValidationError } from '../utils/CategorisedError.js';
import {
  calculateComplexity,
  checkCommonIssues,
  extractBpm,
  extractFunctionsUsed,
  getSuggestionsForError,
  parseErrorLocation,
} from './StrudelEngineHelpers.js';

/**
 * Result of pattern transpilation
 */
export interface TranspileResult {
  /** Whether transpilation succeeded */
  success: boolean;
  /** Transpiled JavaScript code (if successful) */
  transpiledCode?: string;
  /** Error message (if failed) */
  error?: string;
  /** Error location in source code */
  errorLocation?: {
    line: number;
    column: number;
    offset: number;
  };
  /** Source locations for mini notation strings */
  locations?: Array<{
    start: number;
    end: number;
    value?: string;
    name?: string;
  }>;
}

/**
 * Result of pattern validation
 */
export interface LocalValidationResult {
  /** Whether pattern is valid */
  valid: boolean;
  /** List of errors found */
  errors: string[];
  /** List of warnings */
  warnings: string[];
  /** Suggestions for fixing issues */
  suggestions: string[];
  /** Error location if applicable */
  errorLocation?: {
    line: number;
    column: number;
  };
}

/**
 * A single pattern event (hap)
 */
export interface PatternEvent {
  /** Event value (e.g., { s: 'bd' } for sounds) */
  value: any;
  /** Start time in cycles */
  start: number;
  /** End time in cycles */
  end: number;
  /** Whether this is a whole event or partial */
  isWhole: boolean;
  /** Context information */
  context?: Record<string, any>;
}

/**
 * Pattern metadata extracted from analysis
 */
export interface PatternMetadata {
  /** Estimated events per cycle */
  eventsPerCycle: number;
  /** Unique values in pattern */
  uniqueValues: string[];
  /** Whether pattern uses sound (s) */
  usesSound: boolean;
  /** Whether pattern uses note */
  usesNote: boolean;
  /** Whether pattern is a stack/layer */
  isStack: boolean;
  /** Detected functions used in pattern */
  functionsUsed: string[];
  /** Estimated complexity (0-1) */
  complexity: number;
  /** BPM if setcpm is present */
  bpm?: number;
  /**
   * Whether the pattern could actually be evaluated.
   *
   * When false, `eventsPerCycle` and `uniqueValues` are not measurements
   * — the engine could not run the pattern, and the static fields are all
   * that is real. Reporting `eventsPerCycle: 0` without this was
   * indistinguishable from a genuinely silent pattern, so an agent was
   * told working code produced nothing and would set about fixing it
   * (#276).
   */
  evaluated: boolean;
  /** Why evaluation failed, when it did. */
  evaluationError?: string;
}

/**
 * Local Strudel pattern engine - executes patterns without browser.
 * Replaces fragile browser automation for pattern validation and analysis.
 *
 * @example
 * ```typescript
 * const engine = new StrudelEngine();
 *
 * // Validate a pattern
 * const validation = engine.validate('s("bd hh").fast(2)');
 * if (validation.valid) {
 *   console.log('Pattern is valid');
 * }
 *
 * // Query events
 * const events = engine.queryEvents('s("bd hh sd hh")', 0, 2);
 * console.log(`Found ${events.length} events in 2 cycles`);
 * ```
 */
/**
 * Strudel exports that compile or evaluate source at runtime.
 *
 * Removed from the sandbox context. Each is a route from pattern text
 * to main-realm execution that no legitimate pattern needs: patterns
 * build and combine Strudel values, they do not evaluate new source.
 *
 * @nist si-10 "Information input validation"
 * @nist ac-6 "Least privilege"
 */
/**
 * Most events `queryEvents` will materialize.
 *
 * ~1.5 KB per event in practice, so this bounds a query at roughly
 * 75 MB. Well above any musical pattern: a dense 16-cycle drum pattern
 * is a few thousand events.
 */
export const MAX_QUERY_EVENTS = 50_000;

export const EVALUATOR_EXPORTS: readonly string[] = [
  'evaluate',
  'evalScope',
  'safeEval',
  'webaudioEvaluate',
  'transpiler',
  'transpile',
  'Function',
  'eval',
  'require',
  'process',
  'globalThis',
];

export class StrudelEngine {
  /** Execution context with Strudel functions */
  private readonly context: Record<string, any>;

  constructor() {
    // Build execution context with all Strudel functions
    const context: Record<string, any> = {
      ...strudelCore,
      ...strudelTonal,
      m: mini,
      mini,
    };

    // Strip the evaluators before anything can reach them.
    //
    // @strudel/core exports its own transpile-and-`new Function` under
    // several names. Spreading the module put them in the sandbox
    // context, and every context key is automatically an allowed
    // identifier — so a pattern could call one directly, with no banned
    // syntax, no member access and no destructuring, and run arbitrary
    // JavaScript in the main realm. The AST allowlist cannot defend a
    // context function that is itself an evaluator; the only fix is for
    // it not to be there.
    for (const name of EVALUATOR_EXPORTS) delete context[name];

    this.context = context;
  }

  /**
   * Transpile a Strudel pattern to JavaScript
   *
   * @param code - Strudel pattern code
   * @returns Transpilation result with code or error
   *
   * @example
   * ```typescript
   * const result = engine.transpile('s("bd hh").fast(2)');
   * if (result.success) {
   *   console.log('Transpiled:', result.transpiledCode);
   * }
   * ```
   */
  /**
   * Validates then executes pattern code inside the sandbox.
   *
   * Replaces the bare `new Function(...)` this class used at three sites,
   * which executed caller-supplied JavaScript directly in the server
   * process (#229).
   *
   * @param code - Original pattern source, for the AST allowlist
   * @param transpiledCode - Transpiler output, actually executed
   * @returns The Pattern the code produced
   * @throws {PatternSafetyError} When the pattern is rejected pre-execution
   * @nist si-10 "Information input validation"
   */
  private evaluatePattern(code: string, transpiledCode: string): any {
    assertPatternIsSafe(code, Object.keys(this.context));
    return runPatternCode(transpiledCode, this.context);
  }

  transpile(code: string): TranspileResult {
    if (!code || code.trim().length === 0) {
      return {
        success: false,
        error: 'Empty pattern',
        errorLocation: { line: 1, column: 1, offset: 0 },
      };
    }

    try {
      const result = transpiler(code);
      return {
        success: true,
        transpiledCode: result.output,
        locations: result.locations || [],
      };
    } catch (error: any) {
      const location = parseErrorLocation(error);
      return {
        success: false,
        error: error.message || 'Transpilation failed',
        errorLocation: location,
      };
    }
  }

  /**
   * Validate a pattern by building it in the sandbox
   *
   * Note: this *does* execute the pattern (that is the only way to learn
   * whether it produces a Pattern), but inside PatternSandbox rather than
   * in the server process. The JSDoc previously claimed no execution.
   *
   * @param code - Strudel pattern code
   * @returns Validation result with errors and suggestions
   *
   * @example
   * ```typescript
   * const result = engine.validate('s("bd hh").fast(');
   * if (!result.valid) {
   *   console.log('Errors:', result.errors);
   * }
   * ```
   */
  validate(code: string): LocalValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    const suggestions: string[] = [];

    // Empty check
    if (!code || code.trim().length === 0) {
      return {
        valid: false,
        errors: ['Pattern is empty'],
        warnings: [],
        suggestions: ['Add a pattern like: s("bd hh sd hh")'],
      };
    }

    const transpileResult = this.transpile(code);
    if (!transpileResult.success) {
      // A browser-only call can fail here rather than at execution:
      // samples("github:...") dies as "Invalid argument" because the
      // transpiler rewrites every double-quoted string into mini(), and a
      // URL is not mini notation (#232).
      const browserOnlyAtTranspile = findBrowserOnlyCall(code);
      const transpileError = browserOnlyAtTranspile !== null
        ? (explainBrowserOnly(browserOnlyAtTranspile) ?? transpileResult.error ?? 'Syntax error')
        : (transpileResult.error ?? 'Syntax error');

      return {
        valid: false,
        errors: [transpileError],
        warnings,
        suggestions: getSuggestionsForError(transpileResult.error || ''),
        errorLocation: transpileResult.errorLocation
          ? { line: transpileResult.errorLocation.line, column: transpileResult.errorLocation.column }
          : undefined,
      };
    }

    try {
      const pattern = this.evaluatePattern(code, transpileResult.transpiledCode!);

      if (!pattern || typeof pattern.queryArc !== 'function') {
        errors.push('Code did not produce a valid pattern');
        suggestions.push('Ensure your code returns a pattern (e.g., s("bd"), note("c3"), stack(...))');
      }
    } catch (error: any) {
      // A browser-only function is not a broken pattern. Saying
      // "unknown identifier 'setcpm'" about a core Strudel function
      // reads as "you typo'd" when the truth is "this validator cannot
      // see it" (#232).
      // Check the source too: samples("github:...") fails as "Invalid
      // argument" because the transpiler rewrites the URL into mini(),
      // so the error never names the function.
      const browserOnly = findBrowserOnlyCall(code);
      const clarified = browserOnly !== null
        ? (explainBrowserOnly(browserOnly) ?? error.message)
        : clarifyEngineError(error.message);
      if (clarified !== error.message) {
        errors.push(clarified);
      } else if (error instanceof PatternSafetyError) {
        // Rejected before execution — report it as such rather than as a
        // runtime error, so callers can tell "unsafe" from "buggy" (#229).
        errors.push(`Pattern rejected: ${error.message}`);
      } else {
        errors.push(`Runtime error: ${error.message}`);
        suggestions.push(...getSuggestionsForError(error.message));
      }
    }

    checkCommonIssues(code, warnings, suggestions);

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      suggestions,
    };
  }

  /**
   * Query pattern events for a time range
   *
   * @param code - Strudel pattern code
   * @param start - Start time in cycles
   * @param end - End time in cycles
   * @returns Array of pattern events
   * @throws {Error} If pattern is invalid
   *
   * @example
   * ```typescript
   * const events = engine.queryEvents('s("bd hh sd hh")', 0, 2);
   * events.forEach(e => {
   *   console.log(`${e.value} at ${e.start}-${e.end}`);
   * });
   * ```
   */
  queryEvents(code: string, start: number, end: number): PatternEvent[] {
    const transpileResult = this.transpile(code);
    if (!transpileResult.success) {
      throw new Error(`Transpilation failed: ${transpileResult.error}`);
    }

    try {
      const pattern = this.evaluatePattern(code, transpileResult.transpiledCode!);

      if (!pattern || typeof pattern.queryArc !== 'function') {
        throw new Error('Code did not produce a valid pattern');
      }

      // Probe before materializing.
      //
      // queryArc builds the whole array, so a cap applied to its result
      // is applied after the memory is already gone: `s('bd').fast(1e5)`
      // over one cycle is 100,000 events and 153 MB from a 20-character
      // pattern, and a slightly larger multiplier ends in V8
      // FatalProcessOutOfMemory — which no try/catch can intercept, so
      // the server dies and takes every open browser session with it
      // (#307). The cycle range was capped at 16; events per cycle were
      // not capped at all.
      //
      // The single leading window this used to sample had two holes,
      // both measured: it died on patterns dense enough that 1e-4 of the
      // range was itself too big, and it saw nothing at all when the
      // pattern opened with a rest. See EventDensityProbe (#360).
      const span = end - start;
      const verdict = probeEventDensity(
        (begin: number, until: number) => pattern.queryArc(begin, until),
        start,
        end,
        { maxEvents: MAX_QUERY_EVENTS }
      );

      if (verdict.kind === 'refuse') {
        throw new ValidationError(
          `Pattern produces roughly ${String(verdict.projected)} events over ` +
          `${String(span)} cycle(s), above the ${String(MAX_QUERY_EVENTS)} cap. ` +
          'Narrow the range, or reduce the pattern density (a large .fast() ' +
          'multiplier is the usual cause).'
        );
      }

      const haps = pattern.queryArc(start, end);

      // The probe found events; the full query found none. That is not a
      // silent pattern, it is a query that failed and said nothing —
      // Strudel answers a large enough `.fast()` with an internal
      // "Maximum call stack size exceeded" and an EMPTY array, and
      // reporting that as a successful zero-event result tells an agent
      // its working pattern produces nothing (the #276 mistake again).
      // A stricter bar than "saw anything": a pattern whose sub-arc
      // behaviour genuinely differs from its full-arc behaviour (a mask
      // or a span-conditional transform) could show a stray onset in a
      // probe and legitimately none over the whole range. Requiring a
      // real sample keeps that from being reported as a crash.
      if (verdict.observedOnsets >= 32 && verdict.windowsWithOnsets >= 2 && haps.length === 0) {
        throw new Error(
          'The pattern produced no events, but sampling it found some — the query ' +
          'failed inside Strudel rather than returning an empty result. A very large ' +
          '.fast() or `*` multiplier is the usual cause; reduce it.'
        );
      }

      // Belt and braces: the projection is an extrapolation from a
      // sample, so a pattern whose density is wildly uneven could still
      // land above the cap. Truncating beats returning 40 MB of JSON.
      if (haps.length > MAX_QUERY_EVENTS) {
        throw new ValidationError(
          `Pattern produced ${String(haps.length)} events, above the ` +
          `${String(MAX_QUERY_EVENTS)} cap. Narrow the range.`
        );
      }
      return haps.map((hap: any) => this.hapToEvent(hap));
    } catch (error: any) {
      // Same clarification validate() applies. Without it, queryEvents and
      // compile still emit "references unknown identifier 'setcpm'" — the
      // exact "reads as a typo" wording #232 was filed to remove — and
      // flatten a pre-execution PatternSafetyError into an execution
      // failure, which it is not.
      const browserOnly = findBrowserOnlyCall(code);
      if (browserOnly !== null) {
        // The caller used a function the local engine cannot run. That
        // is their pattern to change — the message even says which tool
        // to use instead — and it was landing in `internal`, which tells
        // an agent the server is broken and not to retry (#382).
        throw new ValidationError(explainBrowserOnly(browserOnly) ?? error.message);
      }
      // Already categorised: the density caps above throw
      // ValidationError, and flattening them here into a generic
      // "Pattern execution failed" was the third time in one day that a
      // verdict was destroyed one frame above the code that reads it.
      if (error instanceof ValidationError) throw error;
      if (error instanceof PatternSafetyError) {
        // The caller's pattern was refused before it ran. That is their
        // input to change, not an internal failure.
        throw new ValidationError(`Pattern rejected: ${error.message}`);
      }
      throw new Error(`Pattern execution failed: ${error.message}`);
    }
  }

  /**
   * Execute a pattern and return the compiled pattern object
   *
   * @param code - Strudel pattern code
   * @returns Compiled pattern object
   * @throws {Error} If pattern is invalid
   */
  compile(code: string): any {
    const transpileResult = this.transpile(code);
    if (!transpileResult.success) {
      throw new Error(`Transpilation failed: ${transpileResult.error}`);
    }

    try {
      const pattern = this.evaluatePattern(code, transpileResult.transpiledCode!);

      if (!pattern || typeof pattern.queryArc !== 'function') {
        throw new Error('Code did not produce a valid pattern');
      }

      return pattern;
    } catch (error: any) {
      // Same clarification validate() applies. Without it, queryEvents and
      // compile still emit "references unknown identifier 'setcpm'" — the
      // exact "reads as a typo" wording #232 was filed to remove — and
      // flatten a pre-execution PatternSafetyError into an execution
      // failure, which it is not.
      const browserOnly = findBrowserOnlyCall(code);
      if (browserOnly !== null) {
        // The caller used a function the local engine cannot run. That
        // is their pattern to change — the message even says which tool
        // to use instead — and it was landing in `internal`, which tells
        // an agent the server is broken and not to retry (#382).
        throw new ValidationError(explainBrowserOnly(browserOnly) ?? error.message);
      }
      // Already categorised: the density caps above throw
      // ValidationError, and flattening them here into a generic
      // "Pattern execution failed" was the third time in one day that a
      // verdict was destroyed one frame above the code that reads it.
      if (error instanceof ValidationError) throw error;
      if (error instanceof PatternSafetyError) {
        // The caller's pattern was refused before it ran. That is their
        // input to change, not an internal failure.
        throw new ValidationError(`Pattern rejected: ${error.message}`);
      }
      throw new Error(`Pattern execution failed: ${error.message}`);
    }
  }

  /**
   * Extract pattern metadata by analyzing events and code
   *
   * @param code - Strudel pattern code
   * @returns Pattern metadata
   *
   * @example
   * ```typescript
   * const meta = engine.analyzePattern('s("bd hh").fast(2)');
   * console.log('Events per cycle:', meta.eventsPerCycle);
   * console.log('Complexity:', meta.complexity);
   * ```
   */
  analyzePattern(code: string): PatternMetadata {
    const metadata: PatternMetadata = {
      eventsPerCycle: 0,
      uniqueValues: [],
      usesSound: /\bs\s*\(/.test(code) || /\bsound\s*\(/.test(code),
      usesNote: /\bnote\s*\(/.test(code),
      isStack: /\bstack\s*\(/.test(code),
      functionsUsed: extractFunctionsUsed(code),
      complexity: 0,
      evaluated: false,
    };

    const bpm = extractBpm(code);
    if (bpm !== undefined) {
      metadata.bpm = bpm;
    }

    try {
      const events = this.queryEvents(code, 0, 1);
      metadata.eventsPerCycle = events.length;

      const values = events.map(e => {
        if (typeof e.value === 'object' && e.value !== null) {
          return e.value.s || e.value.note || e.value.n || JSON.stringify(e.value);
        }
        return String(e.value);
      });
      metadata.uniqueValues = [...new Set(values)];

      metadata.complexity = calculateComplexity(
        {
          uniqueValues: metadata.uniqueValues,
          functionsUsed: metadata.functionsUsed,
          isStack: metadata.isStack,
          codeLength: code.length,
        },
        events.length,
      );
      metadata.evaluated = true;
    } catch (error: any) {
      // Complexity from the static signals only. eventsPerCycle and
      // uniqueValues stay at their defaults, and `evaluated: false` says
      // so — the caller can tell "I could not run this" from "this
      // produces nothing", which sharing the value 0 made impossible.
      metadata.complexity = calculateComplexity({
        uniqueValues: metadata.uniqueValues,
        functionsUsed: metadata.functionsUsed,
        isStack: metadata.isStack,
        codeLength: code.length,
      });
      metadata.evaluationError = clarifyEngineError(String(error?.message ?? error));
    }

    return metadata;
  }

  /**
   * Convert a Strudel Hap to our PatternEvent format
   */
  private hapToEvent(hap: any): PatternEvent {
    return {
      value: hap.value,
      start: hap.whole?.begin?.valueOf() ?? hap.part.begin.valueOf(),
      end: hap.whole?.end?.valueOf() ?? hap.part.end.valueOf(),
      isWhole: hap.whole !== undefined,
      context: hap.context,
    };
  }

  // parseErrorLocation / getSuggestionsForError / checkCommonIssues
  // moved to StrudelEngineHelpers.ts (#107) so they can be unit-tested
  // directly without the @strudel/* ESM/CJS jest mismatch.
}
