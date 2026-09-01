/**
 * Four generator defects found by cross-model review (codex), each
 * measured against @strudel/core before it was acted on (#482).
 *
 * These assert BEHAVIOUR through the real engine wherever the defect is
 * about behaviour. The test that missed the `bars` bug asserted the
 * literal text `.fast(2)`, which locked in the implementation — the
 * same anti-pattern the tempo postmortem in CLAUDE.md warns about.
 */
import { PatternGenerator } from '../../services/PatternGenerator';
import { defaultTempoFor } from '../../services/StyleRegistry';
import { impliedBpm } from '../../utils/Tempo';

jest.setTimeout(30000);

describe('generateVariation emits callable transforms', () => {
  const generator = new PatternGenerator();

  it.each(['moderate', 'glitch', 'evolving'])(
    '%s calls .rev()/.palindrome() rather than passing the method', (variation) => {
      // `pattern.rev` is a function, not a Pattern, so `every(4, x =>
      // x.rev)` hands Strudel a function where it wants a pattern.
      // Measured against @strudel/core on an application cycle:
      //   .every(4, x => x.rev)   -> undefined@0
      //   .every(4, x => x.rev()) -> "bd"@0.5 "sd"@0
      // One valueless event in place of the music, and it throws
      // nothing.
      const pattern = generator.generateVariation('s("bd sd")', variation);
      expect(pattern).not.toMatch(/\.rev(?!\()/);
      expect(pattern).not.toMatch(/\.palindrome(?!\()/);
    });

  it('leaves .jux(rev) alone — that argument is meant to be a function', () => {
    expect(generator.generateVariation('s("bd sd")', 'extreme')).toContain('jux(rev)');
  });
});

describe('generateFill: bars is a length', () => {
  const generator = new PatternGenerator();

  // The BEHAVIOURAL half of this lives in scripts/verify-sandbox.ts,
  // which runs the real engine: @strudel/core is ESM and Jest is not
  // configured for it, so a unit test cannot query cycles. What is
  // asserted here is the structure that produces that behaviour, and
  // `cat` taking one cycle per argument is measured there.

  it('assembles one cycle of material per requested bar', () => {
    // `.fast(N)` compressed the fill into 1/N of ONE cycle, so the
    // output occupied a single bar however large `bars` got.
    const fill = generator.generateFill('techno', 4);
    const base = generator.generateFill('techno', 1);
    expect(fill.startsWith('cat(')).toBe(true);
    // Three plain bars and one intensified.
    expect(fill.split(base).length - 1).toBe(4);
    expect(fill.endsWith(`${base}.fast(2))`)).toBe(true);
  });

  it('a one-bar fill is just the figure', () => {
    const base = generator.generateFill('techno', 1);
    expect(base).not.toContain('cat(');
    expect(base).not.toContain('.fast(1)');
  });

  it('caps the assembled length', () => {
    const base = generator.generateFill('techno', 1);
    expect(generator.generateFill('techno', 10_000).split(base).length - 1).toBe(64);
  });

  it('treats a non-integer or non-positive bars as one bar', () => {
    const base = generator.generateFill('techno', 1);
    expect(generator.generateFill('techno', 0)).toBe(base);
    expect(generator.generateFill('techno', 2.5)).toBe(base);
  });
});

describe('generateFill style resolution', () => {
  const generator = new PatternGenerator();

  it('resolves an alias, as every other generator does', () => {
    expect(generator.generateFill('triphop', 1)).toBe(generator.generateFill('trip_hop', 1));
  });

  it('resolves a capitalised style', () => {
    expect(generator.generateFill('House', 1)).toBe(generator.generateFill('house', 1));
  });

  it('still falls back to techno for an unknown style', () => {
    expect(generator.generateFill('vaporwave', 1)).toBe(generator.generateFill('techno', 1));
  });
});

describe('generateCompletePattern tempo', () => {
  const generator = new PatternGenerator();

  it.each(['techno', 'trip_hop', 'intelligent_dnb', 'boom_bap'])(
    '%s generates at its registry tempo when none is given', (style) => {
      // The parameter defaulted to 120, so `bpm || 170` could never
      // reach 170 — every per-style fallback was dead code and every
      // genre generated at 120.
      expect(impliedBpm(generator.generateCompletePattern(style))).toBe(defaultTempoFor(style));
    });

  it('still honours an explicit tempo', () => {
    expect(impliedBpm(generator.generateCompletePattern('techno', 'C', 145))).toBe(145);
  });

  it.each(['trip_hop', 'intelligent_dnb', 'boom_bap'])(
    '%s writes setcpm, not a second spelling', (style) => {
      // These three hand-wrote `setcps(t/60/4)` while the generic path
      // wrote `setcpm(t/4)`. Numerically equal, but three spellings of
      // one unit is how #395 happened.
      expect(generator.generateCompletePattern(style)).toContain('setcpm(');
      expect(generator.generateCompletePattern(style)).not.toContain('setcps(');
    });
});
