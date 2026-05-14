/**
 * Pure helpers extracted from StrudelEngine for direct unit testing.
 *
 * StrudelEngine.ts imports @strudel/* packages, which ship as ESM and
 * fight Jest's CJS loader (see #107). Helpers that don't touch @strudel
 * — string parsing, regex extraction, scoring — live here so they can
 * be tested without the ESM workaround dance.
 *
 * @module services/StrudelEngineHelpers
 */

/** Error location shape shared by transpile / validate results. */
export interface ErrorLocation {
  line: number;
  column: number;
  offset: number;
}

/**
 * Pattern metadata used by complexity scoring. Mirrors the relevant
 * subset of PatternMetadata in StrudelEngine.ts so this module stays
 * self-contained.
 */
export interface ComplexityInput {
  uniqueValues: string[];
  functionsUsed: string[];
  isStack: boolean;
  codeLength: number;
}

/**
 * Parse an error location from the assortment of shapes the Strudel
 * stack produces:
 *   - acorn:  { loc: { line, column }, pos }
 *   - mini:   { location: { start: { line, column, offset } } }
 *   - other:  message string containing "line N ... column N"
 * Returns undefined if no shape matches — callers should treat that
 * as "location unknown" rather than an error.
 */
export function parseErrorLocation(error: any): ErrorLocation | undefined {
  if (error?.loc) {
    return {
      line: error.loc.line,
      column: error.loc.column,
      offset: error.pos ?? 0,
    };
  }

  if (error?.location?.start) {
    return {
      line: error.location.start.line,
      column: error.location.start.column,
      offset: error.location.start.offset,
    };
  }

  const lineColMatch = error?.message?.match(/line\s*(\d+).*column\s*(\d+)/i);
  if (lineColMatch) {
    return {
      line: parseInt(lineColMatch[1], 10),
      column: parseInt(lineColMatch[2], 10),
      offset: 0,
    };
  }

  return undefined;
}

/**
 * Produce actionable suggestions for an error message. Recognises four
 * common error families: unexpected token, undefined name, not-a-fn,
 * unexpected end of input. Returns an empty array for anything else
 * (callers should still surface the raw error).
 */
export function getSuggestionsForError(error: string): string[] {
  const suggestions: string[] = [];
  const lowerError = error.toLowerCase();

  if (lowerError.includes('unexpected token')) {
    suggestions.push('Check for missing quotes, parentheses, or brackets');
    suggestions.push('Ensure all function calls have matching ()');
  }

  if (lowerError.includes('is not defined')) {
    const match = error.match(/(\w+) is not defined/);
    if (match) {
      suggestions.push(`"${match[1]}" is not a known Strudel function`);
      suggestions.push('Check spelling or use a valid function like s(), note(), stack()');
    }
  }

  if (lowerError.includes('not a function')) {
    suggestions.push('Check that you are calling methods on a pattern object');
  }

  if (lowerError.includes('unexpected end')) {
    suggestions.push('Pattern appears incomplete - check for missing closing brackets');
  }

  return suggestions;
}

/**
 * Append warnings/suggestions for common pattern-code issues:
 *   - gain values above safe thresholds (2.0 warn, 5.0 strong warn)
 *   - patterns with no sound-producing call (s/sound/note/n/stack)
 *   - patterns with no tempo set (setcpm/setbpm/cpm/bpm)
 *
 * Mutates the passed arrays in-place to match the calling convention
 * in StrudelEngine.validate(). Returns nothing.
 */
export function checkCommonIssues(
  code: string,
  warnings: string[],
  suggestions: string[],
): void {
  const gainMatches = code.match(/\.gain\s*\(\s*(\d+(?:\.\d+)?)\s*\)/g);
  if (gainMatches) {
    for (const match of gainMatches) {
      const value = parseFloat(match.match(/(\d+(?:\.\d+)?)/)?.[1] || '0');
      if (value > 2) {
        warnings.push(`High gain value (${value}) may cause distortion`);
      }
      if (value > 5) {
        warnings.push(`Dangerous gain value (${value}) - consider reducing to 2 or less`);
      }
    }
  }

  if (!/\b(s|sound|note|n)\s*\(/.test(code) && !/\bstack\s*\(/.test(code)) {
    warnings.push('Pattern may not produce sound - no s(), note(), or stack() found');
    suggestions.push('Add a sound source like s("bd") or note("c3")');
  }

  if (!/setcpm|setbpm|cpm|bpm/.test(code)) {
    suggestions.push('Consider setting tempo with setcpm(120)');
  }
}

/**
 * Extract BPM from a `setcpm(<number>)` call. Returns undefined when
 * absent — Strudel's default tempo is documented elsewhere; this helper
 * stays narrow (no fallback) so callers can distinguish "not set" from
 * "set to default".
 */
export function extractBpm(code: string): number | undefined {
  const match = code.match(/setcpm\s*\(\s*(\d+(?:\.\d+)?)\s*\)/);
  return match ? parseFloat(match[1]) : undefined;
}

/**
 * Extract unique function-call names from pattern code. Matches the
 * lowercase-starting identifier immediately before `(` — same heuristic
 * Strudel patterns follow (s, note, stack, fast, ...). Returns names in
 * first-seen order, deduplicated.
 */
export function extractFunctionsUsed(code: string): string[] {
  const matches = code.match(/\b([a-z][a-zA-Z0-9_]*)\s*\(/g);
  if (!matches) return [];
  const names = matches.map(m => m.replace(/\s*\($/, ''));
  return [...new Set(names)];
}

/**
 * Score pattern complexity on a 0..1 scale. Two paths:
 *   - with events: weighted sum across event density, value variety,
 *     function count, stack bonus, code length
 *   - without events (e.g. unqueryable pattern): fall back to a simpler
 *     code-only estimate so we still return something useful
 *
 * Weights and caps are calibrated to keep typical patterns around 0.3–0.7
 * with truly dense patterns reaching 1.0. Changing them shifts every
 * downstream "complexity" report — bump cautiously.
 */
export function calculateComplexity(
  input: ComplexityInput,
  eventCount?: number,
): number {
  if (eventCount === undefined) {
    return Math.min(
      (input.functionsUsed.length / 10) * 0.5 +
      (input.codeLength / 500) * 0.3 +
      (input.isStack ? 0.2 : 0),
      1,
    );
  }

  const factors = [
    Math.min(eventCount / 16, 1) * 0.3,
    Math.min(input.uniqueValues.length / 8, 1) * 0.2,
    Math.min(input.functionsUsed.length / 10, 1) * 0.3,
    input.isStack ? 0.1 : 0,
    (input.codeLength / 500) * 0.1,
  ];
  return Math.min(factors.reduce((a, b) => a + b, 0), 1);
}
