/**
 * Key detection against the canonical Krumhansl-Schmuckler profiles (#320).
 *
 * The scoring used to live inline in `detectKey`, which needs a live
 * Playwright page — so nothing could feed it a known chroma and check
 * the answer. That is how it came to return "dorian" for all twelve
 * canonical minor profiles without anyone noticing. Extracting
 * `detectKeyFromChroma` is half the fix; these tests are the other half.
 */

import { AudioAnalyzer } from '../../AudioAnalyzer';

/** The published K-S profiles, which the implementation transcribes correctly. */
const KS_MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const KS_MINOR = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
const PITCH_CLASSES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/** Rotate a tonic-at-0 profile so its tonic sits at pitch class `tonic`. */
function transpose(profile: number[], tonic: number): number[] {
  return Array.from({ length: 12 }, (_, i) => profile[(i - tonic + 12) % 12]);
}

const analyzer = () => new AudioAnalyzer();

describe('the canonical profiles detect as themselves (#320)', () => {
  it.each(PITCH_CLASSES.map((k, i) => [k, i] as const))(
    '%s major', (name, tonic) => {
      const r = analyzer().detectKeyFromChroma(transpose(KS_MAJOR, tonic));
      expect(r.key).toBe(name);
      expect(r.scale).toBe('major');
    });

  it.each(PITCH_CLASSES.map((k, i) => [k, i] as const))(
    '%s minor', (name, tonic) => {
      // This is the case that failed 12/12 before: right tonic, wrong
      // mode, every time. `dorian *= 1.015` was larger than the 0.0078
      // margin cosine left between minor and dorian, so the thumb on the
      // scale was heavier than the scale.
      const r = analyzer().detectKeyFromChroma(transpose(KS_MINOR, tonic));
      expect(r.key).toBe(name);
      expect(r.scale).toBe('minor');
    });

  it('minor is reachable at all', () => {
    const modes = PITCH_CLASSES.map((_, t) =>
      analyzer().detectKeyFromChroma(transpose(KS_MINOR, t)).scale);
    expect(new Set(modes)).toEqual(new Set(['minor']));
  });
});

describe('confidence means something (#320)', () => {
  it('a flat chroma carries no information and says so', () => {
    // Was 0.787, because confidence was 0.75 * a cosine similarity, and
    // cosine is >= 0.9 for essentially any non-negative vector.
    const r = analyzer().detectKeyFromChroma(new Array(12).fill(1));
    expect(r.confidence).toBeLessThan(0.15);
  });

  it('a clean profile is confident', () => {
    expect(analyzer().detectKeyFromChroma(KS_MAJOR).confidence).toBeGreaterThan(0.5);
  });

  it('a clean profile beats a flat one', () => {
    const clean = analyzer().detectKeyFromChroma(KS_MINOR).confidence;
    const flat = analyzer().detectKeyFromChroma(new Array(12).fill(1)).confidence;
    expect(clean).toBeGreaterThan(flat + 0.3);
  });

  it.each([
    ['flat', new Array(12).fill(1)],
    ['canonical major', KS_MAJOR],
    ['canonical minor', KS_MINOR],
    ['single pitch', [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]],
  ])('%s: no confidence exceeds 1 or drops below 0', (_label, chroma) => {
    // `alternatives` reported the raw boosted score, so it could read
    // 1.049 — and could out-rank the answer it was an alternative to.
    const r = analyzer().detectKeyFromChroma(chroma as number[]);
    for (const c of [r.confidence, ...r.alternatives.map(a => a.confidence)]) {
      expect(c).toBeGreaterThanOrEqual(0);
      expect(c).toBeLessThanOrEqual(1);
    }
  });

  it('no alternative out-ranks the answer', () => {
    const r = analyzer().detectKeyFromChroma(transpose(KS_MINOR, 9));
    for (const alt of r.alternatives) {
      expect(alt.confidence).toBeLessThanOrEqual(r.confidence + 1e-9);
    }
  });
});

describe('Pearson gives usable separation (#320)', () => {
  it('the winner is clearly ahead of every alternative', () => {
    // Under cosine the 24 scores spanned 0.804-1.000 and the top-1 gap
    // was 0.0048 — smaller than the boosts applied on top of them,
    // which is how the boosts came to decide the answer.
    for (const chroma of [KS_MAJOR, KS_MINOR, transpose(KS_MINOR, 9)]) {
      const r = analyzer().detectKeyFromChroma(chroma);
      const highestAlt = Math.max(...r.alternatives.map(a => a.confidence));
      expect(r.confidence - highestAlt).toBeGreaterThan(0.05);
    }
  });
});
