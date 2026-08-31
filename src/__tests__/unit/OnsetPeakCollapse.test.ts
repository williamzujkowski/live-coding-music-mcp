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
    // Deterministic, not random: intervals alternating 100ms and 900ms
    // have a correlation peak at 1000ms like anything else, but a
    // coefficient of variation that says the series has no steady pulse.
    // The old code answered 60 BPM at confidence 0.00 and looked exactly
    // as certain as a real reading.
    //
    // Written with random intervals first, guarded by an if/else that
    // accepted either outcome — which passed with the floor removed. A
    // test that cannot fail is not evidence.
    const analyzer = new AudioAnalyzer();
    let t = 1_700_000_000_000;
    const lurching = [t];
    for (let i = 0; i < 30; i++) {
      t += i % 2 === 0 ? 100 : 900;
      lurching.push(t);
    }
    const result = analyzer.tempoFromOnsets(lurching);
    expect(result.confidence).toBeLessThan(0.1);
    expect(result.bpm).toBe(0);
  });

  it('still reports a tempo when the pulse is real', () => {
    const analyzer = new AudioAnalyzer();
    const steady = Array.from({ length: 24 }, (_, i) => 1_700_000_000_000 + i * 500);
    const result = analyzer.tempoFromOnsets(steady);
    expect(result.bpm).toBe(120);
    expect(result.confidence).toBeGreaterThan(0.5);
  });
});
