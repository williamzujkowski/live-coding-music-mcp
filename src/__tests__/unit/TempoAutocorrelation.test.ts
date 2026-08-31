/**
 * Tempo comes from the periodicity of the onset series (#352).
 *
 * A central inter-onset interval measures whatever subdivision the
 * onsets land on, not the pulse — and the fold-into-range step then
 * picks whichever octave that lands in first. The liquid-dnb example
 * read 108, 117 and 190 across consecutive runs for the same audio.
 *
 * Autocorrelation asks a different question: at what lag does the whole
 * series repeat?
 */

import { AudioAnalyzer } from '../../AudioAnalyzer';

const analyzer = () => new AudioAnalyzer();

/** `count` onsets `periodMs` apart. */
const train = (periodMs: number, count: number): number[] =>
  Array.from({ length: count }, (_, i) => 1_700_000_000_000 + Math.round(i * periodMs));

describe('the pulse is found, not the subdivision (#352)', () => {
  it.each([
    ['on the beat', 500, 24],
    ['on 8ths', 250, 48],
    ['on 16ths', 125, 96],
  ])('120 BPM %s reads as 120', (_label, period, count) => {
    // The median-interval approach reported the subdivision: 8ths gave
    // 240, folded to whatever landed in range first.
    expect(analyzer().tempoFromOnsets(train(period, count)).bpm).toBe(120);
  });

  it.each([[70, 857], [150, 400], [90, 667]])(
    '%i BPM is read exactly', (expected, period) => {
      expect(analyzer().tempoFromOnsets(train(period, 20)).bpm).toBe(expected);
    });
});

describe('the answer is deterministic (#352)', () => {
  it('the same series gives the same tempo every time', () => {
    // This is the property that failed: 108, 117, 190 for one track.
    const results = Array.from({ length: 10 }, () =>
      analyzer().tempoFromOnsets(train(500, 24)).bpm);
    expect(new Set(results).size).toBe(1);
  });

  it('a longer series gives the same answer as a shorter one', () => {
    expect(analyzer().tempoFromOnsets(train(500, 12)).bpm)
      .toBe(analyzer().tempoFromOnsets(train(500, 40)).bpm);
  });
});

describe('the octave ambiguity is reported, not hidden (#352)', () => {
  it.each([
    ['on the beat', 345, 24],
    ['on 8ths', 172.5, 48],
  ])('174 BPM %s reads as 174, with 87 offered', (_label, period, count) => {
    // The autocorrelation of an impulse train peaks at the period AND
    // every multiple, and the normalization slightly favours the longer
    // one — so this first reported 87. Half-time is a real reading of
    // dnb, but 174 is the one its producer would give.
    const result = analyzer().tempoFromOnsets(train(period, count));
    expect(result.bpm).toBe(174);
    expect(result.alternatives).toContain(87);
  });

  it('alternatives stay inside the musical range', () => {
    for (const period of [345, 500, 857, 400]) {
      const result = analyzer().tempoFromOnsets(train(period, 20));
      for (const alt of result.alternatives ?? []) {
        expect(alt).toBeGreaterThanOrEqual(40);
        expect(alt).toBeLessThanOrEqual(200);
      }
    }
  });

  it('reports the method used, so a caller knows which path ran', () => {
    expect(analyzer().tempoFromOnsets(train(500, 24)).method).toBe('autocorrelation');
  });

  it.each([[120, [60]], [70, [140]], [150, [75]]])(
    '%i BPM lists %p', (bpm, expected) => {
      expect(AudioAnalyzer.tempoOctaves(bpm)).toEqual(expected);
    });
});

describe('degenerate input still refuses to guess (#352)', () => {
  it('too few onsets reports no tempo', () => {
    expect(analyzer().tempoFromOnsets([1, 2, 3]).bpm).toBe(0);
  });

  it('identical timestamps report no tempo', () => {
    expect(analyzer().tempoFromOnsets([100, 100, 100, 100, 100]).bpm).toBe(0);
  });

  it('random onsets report low confidence', () => {
    const random = [0, 137, 402, 511, 890, 1203, 1250, 1899]
      .map(t => 1_700_000_000_000 + t);
    expect(analyzer().tempoFromOnsets(random).confidence).toBeLessThan(0.7);
  });
});
