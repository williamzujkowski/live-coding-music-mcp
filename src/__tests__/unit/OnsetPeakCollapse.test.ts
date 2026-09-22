/**
 * One transient is one onset (#366).
 *
 * A drum hit is not instantaneous: its flux stays above the adaptive
 * threshold for several consecutive 20ms frames. Every one of those
 * frames used to become a separate onset, which is not a detail —
 * measured against real playback, the median inter-onset interval was
 * 20ms, exactly one sampling step, for dnb, techno and house alike.
 *
 * An envelope of solid blocks has no periodicity to find. The
 * autocorrelation came out flat, and the tempo prior answered on its own
 * at confidence 0.00.
 */

import { AudioAnalyzer } from '../../AudioAnalyzer';

const at = (t: number, strength: number) => ({ t, strength });

describe('collapseToPeaks (#366)', () => {
  it('collapses a run of frames into the single hit it is', () => {
    // A kick ringing across four frames.
    const peaks = AudioAnalyzer.collapseToPeaks([
      at(1000, 0.20), at(1020, 0.31), at(1040, 0.24), at(1060, 0.11),
    ]);
    expect(peaks).toHaveLength(1);
  });

  it('keeps the loudest frame, not the first to cross', () => {
    // The peak is a better estimate of when the hit landed, and its
    // strength is what should weight the correlation.
    const peaks = AudioAnalyzer.collapseToPeaks([
      at(1000, 0.20), at(1020, 0.31), at(1040, 0.24),
    ]);
    expect(peaks[0]).toEqual(at(1020, 0.31));
  });

  it('keeps hits that are genuinely separate', () => {
    // 16ths at 174 BPM are 86ms apart — comfortably outside the window.
    const peaks = AudioAnalyzer.collapseToPeaks([
      at(0, 0.3), at(86, 0.2), at(172, 0.3), at(258, 0.2),
    ]);
    expect(peaks).toHaveLength(4);
  });

  it('does not chain one long run into a single hit', () => {
    // Each frame is within 50ms of the last, but the run spans 400ms.
    // Merging on distance-from-the-previous-PEAK rather than from the
    // previous frame would swallow four separate hits here... which is
    // exactly what this does, and is why the window has to stay below
    // the fastest musical interval rather than being widened to taste.
    const dense = Array.from({ length: 5 }, (_, i) => at(i * 40, 0.3 - i * 0.01));
    expect(AudioAnalyzer.collapseToPeaks(dense, 30)).toHaveLength(5);
  });

  it('is a no-op on an already-clean series', () => {
    const clean = [at(0, 0.3), at(500, 0.3), at(1000, 0.3)];
    expect(AudioAnalyzer.collapseToPeaks(clean)).toEqual(clean);
  });

  it('handles an empty series', () => {
    expect(AudioAnalyzer.collapseToPeaks([])).toEqual([]);
  });

  it('reaches onsetsFromFlux, not just the helper', () => {
    // A transient that rings for three frames every 500ms. Without the
    // collapse this yields three times as many onsets and a median
    // interval of one sampling step.
    const samples: { t: number; flux: number }[] = [];
    for (let i = 0; i < 300; i++) {
      const t = i * 20;
      const phase = t % 500;
      const ringing = i >= 8 && phase < 60;
      samples.push({ t: 1_700_000_000_000 + t, flux: ringing ? 0.06 : 0.01 });
    }
    const onsets = new AudioAnalyzer().onsetsFromFlux(samples);
    const gaps = onsets.slice(1).map((o, i) => o.t - onsets[i].t);
    const median = [...gaps].sort((a, b) => a - b)[Math.floor(gaps.length / 2)];
    expect(median).toBeGreaterThan(400);
  });
});

describe('no pulse means no tempo (#366)', () => {
  it('reports 0, not the prior, when the onsets carry no periodicity', () => {
    // Deterministic, and genuinely aperiodic: intervals drawn flat from
    // 150-900ms by a seeded generator, so the series has no repeat at
    // any lag. The old code answered whatever the 120 BPM prior liked,
    // at confidence 0.00, looking exactly as certain as a real reading.
    //
    // Written with Math.random first, guarded by an if/else that
    // accepted either outcome — which passed with the floor removed. A
    // test that cannot fail is not evidence. Seeded instead.
    const rand = (() => { let x = 4242; return () => (x = (x * 1103515245 + 12345) % 2147483648) / 2147483648; })();
    let t = 1_700_000_000_000;
    const aimless = [t];
    for (let i = 0; i < 30; i++) {
      t += 150 + Math.round(rand() * 750);
      aimless.push(t);
    }
    const result = new AudioAnalyzer().tempoFromOnsets(aimless);
    expect(result.confidence).toBeLessThan(0.25);
    expect(result.bpm).toBe(0);
  });

  it('calls a 100/900 alternation what it is: 60 BPM with a flam', () => {
    // This fixture used to stand in for "no periodicity" above, and it
    // was the wrong example. Onsets at 0, 100, 1000, 1100, 2000, 2100
    // repeat EXACTLY every 1000ms — that is a 60 BPM pulse with a grace
    // note, not an absence of pulse. It only looked pulseless to a
    // coefficient of variation, which is the measure #506 replaced.
    //
    // Kept rather than deleted, asserting what is actually true of it,
    // because the change of answer here is the change being made and it
    // should be visible.
    let t = 1_700_000_000_000;
    const flammed = [t];
    for (let i = 0; i < 30; i++) {
      t += i % 2 === 0 ? 100 : 900;
      flammed.push(t);
    }
    const result = new AudioAnalyzer().tempoFromOnsets(flammed);
    expect(result.bpm).toBe(60);
    expect(result.confidence).toBeGreaterThan(0.9);
  });

  it('still reports a tempo when the pulse is real', () => {
    const analyzer = new AudioAnalyzer();
    const steady = Array.from({ length: 24 }, (_, i) => 1_700_000_000_000 + i * 500);
    const result = analyzer.tempoFromOnsets(steady);
    expect(result.bpm).toBe(120);
    expect(result.confidence).toBeGreaterThan(0.5);
  });
});
