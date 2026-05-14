/**
 * Unit tests for the pure helpers extracted from StrudelEngine (#107).
 *
 * These run without @strudel/* — that's the whole point of the split.
 * If a test here needs to mock anything, it probably belongs in the
 * integration suite instead.
 */

import {
  calculateComplexity,
  checkCommonIssues,
  extractBpm,
  extractFunctionsUsed,
  getSuggestionsForError,
  parseErrorLocation,
} from '../../services/StrudelEngineHelpers';

describe('parseErrorLocation', () => {
  it('parses acorn-style errors with .loc and .pos', () => {
    const err = { loc: { line: 3, column: 12 }, pos: 47 };
    expect(parseErrorLocation(err)).toEqual({ line: 3, column: 12, offset: 47 });
  });

  it('defaults offset to 0 when acorn .pos is missing', () => {
    const err = { loc: { line: 1, column: 0 } };
    expect(parseErrorLocation(err)).toEqual({ line: 1, column: 0, offset: 0 });
  });

  it('parses Strudel mini errors with .location.start', () => {
    const err = { location: { start: { line: 2, column: 5, offset: 18 } } };
    expect(parseErrorLocation(err)).toEqual({ line: 2, column: 5, offset: 18 });
  });

  it('falls back to message regex when no structured location present', () => {
    const err = { message: 'Parse error at line 4, column 9' };
    expect(parseErrorLocation(err)).toEqual({ line: 4, column: 9, offset: 0 });
  });

  it('matches the message regex case-insensitively', () => {
    const err = { message: 'Line 7 ... Column 3' };
    expect(parseErrorLocation(err)).toEqual({ line: 7, column: 3, offset: 0 });
  });

  it('returns undefined when no shape matches', () => {
    expect(parseErrorLocation({ message: 'something broke' })).toBeUndefined();
    expect(parseErrorLocation({})).toBeUndefined();
    expect(parseErrorLocation(null)).toBeUndefined();
    expect(parseErrorLocation(undefined)).toBeUndefined();
  });

  it('prefers acorn .loc over the message regex when both present', () => {
    const err = {
      loc: { line: 1, column: 1 },
      pos: 0,
      message: 'fallback line 99 column 99',
    };
    expect(parseErrorLocation(err)).toEqual({ line: 1, column: 1, offset: 0 });
  });

  it('prefers Strudel .location over the message regex when both present', () => {
    const err = {
      location: { start: { line: 2, column: 2, offset: 2 } },
      message: 'fallback line 99 column 99',
    };
    expect(parseErrorLocation(err)).toEqual({ line: 2, column: 2, offset: 2 });
  });
});

describe('getSuggestionsForError', () => {
  it('suggests bracket/quote checks on unexpected token', () => {
    const suggestions = getSuggestionsForError('SyntaxError: Unexpected token (');
    expect(suggestions).toContain('Check for missing quotes, parentheses, or brackets');
    expect(suggestions).toContain('Ensure all function calls have matching ()');
  });

  it('quotes the missing identifier on "is not defined"', () => {
    const suggestions = getSuggestionsForError('ReferenceError: foo is not defined');
    expect(suggestions).toContain('"foo" is not a known Strudel function');
    expect(suggestions).toContain(
      'Check spelling or use a valid function like s(), note(), stack()',
    );
  });

  it('handles "is not defined" with no captured name gracefully', () => {
    // Without the standard "<name> is not defined" pattern there's nothing
    // to quote, but the lower-case branch still fires. Ensure no throw and
    // no garbage entries.
    const suggestions = getSuggestionsForError('is not defined here');
    expect(suggestions).not.toContain('"undefined" is not a known Strudel function');
  });

  it('suggests pattern-method check on "not a function"', () => {
    expect(getSuggestionsForError('x.fast is not a function')).toContain(
      'Check that you are calling methods on a pattern object',
    );
  });

  it('suggests incomplete-bracket check on "unexpected end"', () => {
    expect(getSuggestionsForError('SyntaxError: Unexpected end of input')).toContain(
      'Pattern appears incomplete - check for missing closing brackets',
    );
  });

  it('returns empty array for unrecognised errors', () => {
    expect(getSuggestionsForError('something we never see')).toEqual([]);
  });

  it('matches case-insensitively', () => {
    expect(getSuggestionsForError('UNEXPECTED TOKEN').length).toBeGreaterThan(0);
  });
});

describe('checkCommonIssues', () => {
  function run(code: string) {
    const warnings: string[] = [];
    const suggestions: string[] = [];
    checkCommonIssues(code, warnings, suggestions);
    return { warnings, suggestions };
  }

  it('warns on gain values above 2', () => {
    const { warnings } = run('s("bd").gain(2.5)');
    expect(warnings).toContainEqual(expect.stringContaining('High gain value (2.5)'));
  });

  it('adds a second strong warning on gain values above 5', () => {
    const { warnings } = run('s("bd").gain(7)');
    expect(warnings).toContainEqual(expect.stringContaining('High gain value (7)'));
    expect(warnings).toContainEqual(expect.stringContaining('Dangerous gain value (7)'));
  });

  it('does not warn on safe gain values', () => {
    const { warnings } = run('s("bd").gain(0.8)');
    expect(warnings).toHaveLength(0);
  });

  it('catches multiple gain calls independently', () => {
    const { warnings } = run('stack(s("bd").gain(3), s("hh").gain(6))');
    const gainWarnings = warnings.filter(w => w.includes('gain'));
    // 3 → one warning; 6 → two warnings (above 2 AND above 5)
    expect(gainWarnings).toHaveLength(3);
  });

  it('warns when pattern has no sound source', () => {
    const { warnings, suggestions } = run('// just a comment');
    expect(warnings).toContainEqual(expect.stringContaining('may not produce sound'));
    expect(suggestions).toContainEqual(expect.stringContaining('s("bd")'));
  });

  it('does not warn about sound when s(), note(), or stack() is present', () => {
    expect(run('s("bd")').warnings).not.toContainEqual(
      expect.stringContaining('may not produce sound'),
    );
    expect(run('note("c3")').warnings).not.toContainEqual(
      expect.stringContaining('may not produce sound'),
    );
    expect(run('stack(s("bd"), s("hh"))').warnings).not.toContainEqual(
      expect.stringContaining('may not produce sound'),
    );
    expect(run('n("0 2 4")').warnings).not.toContainEqual(
      expect.stringContaining('may not produce sound'),
    );
  });

  it('suggests tempo when setcpm/setbpm absent', () => {
    expect(run('s("bd")').suggestions).toContainEqual(
      expect.stringContaining('setcpm(120)'),
    );
  });

  it('omits tempo suggestion when any of setcpm/setbpm/cpm/bpm appears', () => {
    expect(run('setcpm(140); s("bd")').suggestions).not.toContainEqual(
      expect.stringContaining('setcpm(120)'),
    );
    expect(run('setbpm(140); s("bd")').suggestions).not.toContainEqual(
      expect.stringContaining('setcpm(120)'),
    );
  });
});

describe('extractBpm', () => {
  it('extracts integer BPM from setcpm', () => {
    expect(extractBpm('setcpm(140)')).toBe(140);
  });

  it('extracts fractional BPM from setcpm', () => {
    expect(extractBpm('setcpm(174.5)')).toBe(174.5);
  });

  it('tolerates whitespace inside the call', () => {
    expect(extractBpm('setcpm ( 128 )')).toBe(128);
  });

  it('returns undefined when setcpm absent', () => {
    expect(extractBpm('s("bd")')).toBeUndefined();
  });

  it('returns the first match when called multiple times', () => {
    expect(extractBpm('setcpm(120); setcpm(140)')).toBe(120);
  });

  it('does not match setbpm (intentional — Strudel uses setcpm)', () => {
    expect(extractBpm('setbpm(140)')).toBeUndefined();
  });
});

describe('extractFunctionsUsed', () => {
  it('extracts simple function names', () => {
    expect(extractFunctionsUsed('s("bd")')).toEqual(['s']);
  });

  it('deduplicates repeated calls', () => {
    const result = extractFunctionsUsed('s("bd"); s("hh"); s("sd")');
    expect(result).toEqual(['s']);
  });

  it('preserves first-seen order', () => {
    expect(extractFunctionsUsed('stack(s("bd"), note("c3"))')).toEqual([
      'stack',
      's',
      'note',
    ]);
  });

  it('matches method chains', () => {
    const result = extractFunctionsUsed('s("bd").fast(2).gain(0.8)');
    expect(result).toEqual(expect.arrayContaining(['s', 'fast', 'gain']));
  });

  it('ignores PascalCase identifiers (constructor-like)', () => {
    expect(extractFunctionsUsed('new Pattern()')).toEqual(expect.not.arrayContaining(['Pattern']));
  });

  it('returns empty array when no function calls present', () => {
    expect(extractFunctionsUsed('42 + "literal"')).toEqual([]);
  });

  it('handles identifiers with digits and underscores', () => {
    const result = extractFunctionsUsed('foo_1("a"); bar2("b")');
    expect(result).toEqual(['foo_1', 'bar2']);
  });
});

describe('calculateComplexity', () => {
  const minimal = {
    uniqueValues: [],
    functionsUsed: [],
    isStack: false,
    codeLength: 0,
  };

  it('returns 0 for empty input', () => {
    expect(calculateComplexity(minimal, 0)).toBe(0);
  });

  it('caps at 1 even for very dense patterns', () => {
    const result = calculateComplexity(
      {
        uniqueValues: new Array(50).fill('').map((_, i) => String(i)),
        functionsUsed: new Array(50).fill('').map((_, i) => `f${i}`),
        isStack: true,
        codeLength: 5000,
      },
      1000,
    );
    expect(result).toBeLessThanOrEqual(1);
    expect(result).toBeGreaterThanOrEqual(0.9);
  });

  it('weights event density at up to 0.3', () => {
    const result = calculateComplexity(minimal, 16);
    expect(result).toBeCloseTo(0.3, 5);
  });

  it('weights variety (uniqueValues) at up to 0.2', () => {
    const result = calculateComplexity(
      { ...minimal, uniqueValues: new Array(8).fill('').map((_, i) => String(i)) },
      0,
    );
    expect(result).toBeCloseTo(0.2, 5);
  });

  it('weights function count at up to 0.3', () => {
    const result = calculateComplexity(
      { ...minimal, functionsUsed: new Array(10).fill('f') },
      0,
    );
    expect(result).toBeCloseTo(0.3, 5);
  });

  it('adds 0.1 for stack', () => {
    const result = calculateComplexity({ ...minimal, isStack: true }, 0);
    expect(result).toBeCloseTo(0.1, 5);
  });

  it('weights code length at up to ~0.1 for 500-char patterns', () => {
    const result = calculateComplexity({ ...minimal, codeLength: 500 }, 0);
    expect(result).toBeCloseTo(0.1, 5);
  });

  it('uses the simpler estimate when eventCount is undefined', () => {
    const result = calculateComplexity({
      uniqueValues: ['ignored', 'when', 'fallback'],
      functionsUsed: new Array(10).fill('f'),
      isStack: true,
      codeLength: 500,
    });
    // 0.5 (functions) + 0.3 (length) + 0.2 (stack) = 1.0
    expect(result).toBeCloseTo(1.0, 5);
  });

  it('fallback path ignores uniqueValues entirely', () => {
    const withValues = calculateComplexity({
      ...minimal,
      uniqueValues: new Array(20).fill('v'),
    });
    const withoutValues = calculateComplexity(minimal);
    expect(withValues).toBe(withoutValues);
  });

  it('handles eventCount=0 distinctly from undefined (zero events still calls the weighted path)', () => {
    const stackOnly = { ...minimal, isStack: true };
    expect(calculateComplexity(stackOnly, 0)).toBeCloseTo(0.1, 5); // event path: just the stack bonus
    expect(calculateComplexity(stackOnly)).toBeCloseTo(0.2, 5); // fallback: bigger stack bonus
  });
});
