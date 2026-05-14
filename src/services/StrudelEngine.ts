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
import { mini } from '@strudel/mini';
import { transpiler } from '@strudel/transpiler';
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
export class StrudelEngine {
  /** Execution context with Strudel functions */
  private readonly context: Record<string, any>;

  constructor() {
    // Build execution context with all Strudel functions
    this.context = {
      ...strudelCore,
      m: mini,
      mini,
    };
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
   * Validate pattern syntax without execution
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
      return {
        valid: false,
        errors: [transpileResult.error || 'Syntax error'],
        warnings,
        suggestions: getSuggestionsForError(transpileResult.error || ''),
        errorLocation: transpileResult.errorLocation
          ? { line: transpileResult.errorLocation.line, column: transpileResult.errorLocation.column }
          : undefined,
      };
    }

    try {
      const fn = new Function(...Object.keys(this.context), transpileResult.transpiledCode!);
      const pattern = fn(...Object.values(this.context));

      if (!pattern || typeof pattern.queryArc !== 'function') {
        errors.push('Code did not produce a valid pattern');
        suggestions.push('Ensure your code returns a pattern (e.g., s("bd"), note("c3"), stack(...))');
      }
    } catch (error: any) {
      errors.push(`Runtime error: ${error.message}`);
      suggestions.push(...getSuggestionsForError(error.message));
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
      const fn = new Function(...Object.keys(this.context), transpileResult.transpiledCode!);
      const pattern = fn(...Object.values(this.context));

      if (!pattern || typeof pattern.queryArc !== 'function') {
        throw new Error('Code did not produce a valid pattern');
      }

      const haps = pattern.queryArc(start, end);
      return haps.map((hap: any) => this.hapToEvent(hap));
    } catch (error: any) {
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
      const fn = new Function(...Object.keys(this.context), transpileResult.transpiledCode!);
      const pattern = fn(...Object.values(this.context));

      if (!pattern || typeof pattern.queryArc !== 'function') {
        throw new Error('Code did not produce a valid pattern');
      }

      return pattern;
    } catch (error: any) {
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
    } catch {
      metadata.complexity = calculateComplexity({
        uniqueValues: metadata.uniqueValues,
        functionsUsed: metadata.functionsUsed,
        isStack: metadata.isStack,
        codeLength: code.length,
      });
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
