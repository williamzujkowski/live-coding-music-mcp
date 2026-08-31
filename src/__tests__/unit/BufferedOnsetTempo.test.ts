/**
 * Tempo comes from continuously sampled flux, not from tool-call
 * cadence (#322).
 *
 * `detectTempo` sampled the spectrum ONCE per call and pushed at most
 * one onset, and four are needed before a BPM is reported — so the
 * inter-onset intervals were the gaps between TOOL CALLS. The reported
 * BPM was a function of how often the agent polled.
 *
 * The page now samples every 20ms. The onset DECISION stays here rather
 * than being duplicated into the injected script, where it would drift
 * from this copy — the failure mode #341 found in the style resource.
 */

import { AudioAnalyzer } from '../../AudioAnalyzer';

const analyzer = () => new AudioAnalyzer();

/**
 * A flux series at 20ms resolution with a transient every `periodMs`.
 * `quiet`/`hit` are the measured values for a real mix and a real kick.
 */
function kickTrain(periodMs: number, durationMs = 4000, quiet = 0.01, hit = 0.06) {
  const step = 20;
  const samples: { t: number; flux: number }[] = [];
  const perPeriod = Math.round(periodMs / step);
  for (let i = 0; i * step < durationMs; i++) {
    // Skip the first few so the adaptive window has a floor to learn.
    const isHit = i >= 8 && i % perPeriod === 0;
    samples.push({ t: 1_700_000_000_000 + i * step, flux: isHit ? hit : quiet });
  }
  return samples;
}

describe('a kick train yields its own tempo (#322)', () => {
  it.each([
    [500, 120, 4000],    // 120 BPM
    [1000, 60, 8000],    // 60 BPM needs a longer window to reach 4 onsets
    [400, 150, 4000],    // 150 BPM
  ])('a transient every %ims reads as %i BPM', (periodMs, expected, durationMs) => {
    const a = analyzer();
    const onsets = a.onsetsFromFlux(kickTrain(periodMs, durationMs));
    expect(a.tempoFromOnsets(onsets).bpm).toBe(expected);
  });

  it('reports no tempo rather than guessing from too few onsets', () => {
    // At 60 BPM a 4-second window yields three onsets after warm-up,
    // and four are required. bpm 0 is the correct answer, not a bug —
    // this is asserted so a future change cannot start inventing one.
    const a = analyzer();
    expect(a.tempoFromOnsets(a.onsetsFromFlux(kickTrain(1000, 4000))).bpm).toBe(0);
  });

  it('174 BPM lands within a BPM or two of the sampling resolution', () => {
    // 345ms quantizes to 340ms at 20ms sampling, so 176 rather than
    // 174. That is inherent to the sample rate, not an error in the
    // maths, and it is under 1.5%.
    const a = analyzer();
    const bpm = a.tempoFromOnsets(a.onsetsFromFlux(kickTrain(345))).bpm;
    expect(Math.abs(bpm - 174)).toBeLessThanOrEqual(3);
  });

  it('reports high confidence for a steady train', () => {
    const a = analyzer();
    const result = a.tempoFromOnsets(a.onsetsFromFlux(kickTrain(500)));
    expect(result.confidence).toBeGreaterThan(0.8);
  });
});

describe('the answer does not depend on how often you ask (#322)', () => {
  it('the same audio gives the same tempo whatever the buffer length', () => {
    // This is the whole point. Before, a longer gap between calls meant
    // a slower reported tempo.
    const a = analyzer();
    const short = a.tempoFromOnsets(a.onsetsFromFlux(kickTrain(500, 3000))).bpm;
    const long = a.tempoFromOnsets(a.onsetsFromFlux(kickTrain(500, 8000))).bpm;
    expect(short).toBe(long);
    expect(short).toBe(120);
  });
});

describe('onsetsFromFlux (#322)', () => {
  it('returns the timestamps of the transients, not of every sample', () => {
    const onsets = analyzer().onsetsFromFlux(kickTrain(500, 2000));
    // 2 seconds at 120 BPM is four beats; the warm-up eats the first.
    expect(onsets.length).toBeGreaterThanOrEqual(2);
    expect(onsets.length).toBeLessThanOrEqual(5);
  });

  it('a flat series produces no onsets', () => {
    const flat = Array.from({ length: 100 }, (_, i) => ({
      t: 1_700_000_000_000 + i * 20, flux: 0.03,
    }));
    expect(analyzer().onsetsFromFlux(flat)).toEqual([]);
  });

  it('silence produces no onsets', () => {
    const silent = Array.from({ length: 100 }, (_, i) => ({
      t: 1_700_000_000_000 + i * 20, flux: 0,
    }));
    expect(analyzer().onsetsFromFlux(silent)).toEqual([]);
  });

  it('resets between calls, so one series does not colour the next', () => {
    const a = analyzer();
    a.onsetsFromFlux(kickTrain(500, 4000, 0.3, 0.9));   // a loud passage
    const quiet = a.onsetsFromFlux(kickTrain(500, 4000));
    expect(quiet.length).toBeGreaterThan(3);
  });
});
