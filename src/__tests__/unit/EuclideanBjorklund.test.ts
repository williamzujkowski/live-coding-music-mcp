/**
 * Euclidean rhythms match Strudel's own `bjork()` (#319).
 *
 * The old implementation was `floor(i * steps / hits)` — a maximally-
 * even construction, not Bjorklund. An exhaustive check found it
 * produced 0 genuinely wrong necklaces but 163 rotation-only
 * differences over n <= 24: always evenly spread, often starting on the
 * wrong step.
 *
 * That is user-visible and self-contradictory, because one session can
 * run both:
 *
 *   generate_rhythm euclid(3,8)  ->  1 ~ 1 ~ ~ 1 ~ ~
 *   s("bd").euclid(3,8)          ->  1 ~ ~ 1 ~ ~ 1 ~
 *
 * E(3,8) is the tresillo. We were emitting a rotation of one of the
 * most recognisable rhythms there is.
 *
 * Every expected value below was READ OUT OF STRUDEL, not recalled.
 * That matters: my own remembered "canonical" values for E(3,4),
 * E(7,8) and E(9,16) were all wrong, and had I trusted them I would
 * have written three failing tests against correct code.
 */

import { MusicTheory } from '../../services/MusicTheory';

/** Rendered as a bit string for legibility. */
function bits(hits: number, steps: number): string {
  return MusicTheory.bjorklund(hits, steps).map(h => (h ? '1' : '0')).join('');
}

describe('bjorklund matches Strudel (#319)', () => {
  it.each([
    [3, 8, '10010010'],   // tresillo
    [5, 8, '10110110'],   // cinquillo
    [2, 5, '10100'],
    [5, 12, '100101001010'],
    [7, 16, '1001010100101010'],
    [4, 9, '101010100'],
    [3, 4, '1110'],
    [7, 8, '11111110'],
    [9, 16, '1011010101101010'],
    [1, 4, '1000'],
    [4, 4, '1111'],
    [1, 1, '1'],
  ])('E(%i,%i) = %s', (hits, steps, expected) => {
    expect(bits(hits, steps)).toBe(expected);
  });

  it('always produces exactly the requested number of onsets', () => {
    for (let steps = 1; steps <= 32; steps++) {
      for (let hits = 0; hits <= steps; hits++) {
        const onsets = MusicTheory.bjorklund(hits, steps).filter(Boolean).length;
        expect(onsets).toBe(hits);
      }
    }
  });

  it('always produces exactly the requested number of steps', () => {
    for (let steps = 1; steps <= 32; steps++) {
      for (let hits = 0; hits <= steps; hits++) {
        expect(MusicTheory.bjorklund(hits, steps)).toHaveLength(steps);
      }
    }
  });

  it('starts on step 0 whenever there is at least one onset', () => {
    for (let steps = 1; steps <= 24; steps++) {
      for (let hits = 1; hits <= steps; hits++) {
        expect(MusicTheory.bjorklund(hits, steps)[0]).toBe(true);
      }
    }
  });

  it('is maximally even — inter-onset gaps differ by at most one', () => {
    for (let steps = 2; steps <= 24; steps++) {
      for (let hits = 2; hits <= steps; hits++) {
        const idx = MusicTheory.bjorklund(hits, steps)
          .map((h, i) => (h ? i : -1)).filter(i => i >= 0);
        const gaps = idx.map((v, i) => (i === 0 ? v + steps - idx[idx.length - 1] : v - idx[i - 1]));
        expect(Math.max(...gaps) - Math.min(...gaps)).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe('generateEuclideanRhythm renders Strudel-compatible mini-notation (#319)', () => {
  const theory = new MusicTheory();

  it('E(3,8) is the tresillo, not a rotation of it', () => {
    expect(theory.generateEuclideanRhythm(3, 8)).toBe('1 ~ ~ 1 ~ ~ 1 ~');
  });

  it('E(5,8) matches', () => {
    expect(theory.generateEuclideanRhythm(5, 8)).toBe('1 ~ 1 1 ~ 1 1 ~');
  });

  it('still refuses more hits than steps', () => {
    expect(() => theory.generateEuclideanRhythm(9, 8)).toThrow(/cannot exceed/i);
  });

  it('handles zero hits without crashing', () => {
    expect(theory.generateEuclideanRhythm(0, 4)).toBe('~ ~ ~ ~');
  });
});
