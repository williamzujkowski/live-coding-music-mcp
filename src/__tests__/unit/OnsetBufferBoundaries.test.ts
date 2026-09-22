/**
 * Detecting a stream in pieces must equal detecting it whole (#370).
 *
 * The live path reads a 5-second flux buffer per poll and merges each
 * result into the history. Offline, replaying the SAME captured audio as
 * one concatenated series reads 174 BPM correctly, while the live path
 * reads 115 every time — so the discrepancy is in how buffers are
 * joined, not in the correlation.
 *
 * Two mechanisms make a boundary a discontinuity:
 *
 *   `onsetsFromFlux` resets the adaptive threshold on entry, so the
 *   first samples of every buffer fall back to the fixed threshold
 *   instead of the learned one.
 *
 *   `collapseToPeaks` merges a run of frames within ONE call, so a
 *   transient straddling a boundary survives as two partial onsets.
 *
 * This is the equivalence nothing was checking.
 */

import { AudioAnalyzer } from '../../AudioAnalyzer';

type Sample = { t: number; flux: number };

/** A kick every `periodMs`, ringing for three frames, with hats between. */
function kit(periodMs: number, durationMs: number, hatDiv = 4): Sample[] {
  const STEP = 20;
  const hatMs = periodMs / hatDiv;
  const samples: Sample[] = [];
  for (let i = 0; i * STEP < durationMs; i++) {
    const t = i * STEP;
    let flux = 0.01;
    if (i >= 8) {
      if (t % hatMs < STEP) flux = 0.025;
      // A kick rings for three frames, so it straddles boundaries.
      if (t % periodMs < STEP * 3) flux = 0.06;
    }
    samples.push({ t: 1_700_000_000_000 + t, flux });
  }
  return samples;
}

function detectWhole(samples: Sample[]): number[] {
  return new AudioAnalyzer().onsetsFromFlux(samples).map(o => o.t);
}

/**
 * Mirrors what `detectTempo` does per poll: detect this buffer, telling
 * the detector whether it is continuing a stream, then merge. If this
 * helper stops matching production the test stops meaning anything.
 */
function detectInBuffers(samples: Sample[], bufferMs: number): number[] {
  const analyzer = new AudioAnalyzer();
  const inner = analyzer as unknown as {
    mergeOnsetHistory: (o: unknown[]) => void;
    _onsetHistory: { t: number }[];
  };
  const start = samples[0].t;
  const buffers: Sample[][] = [];
  for (const sample of samples) {
    const index = Math.floor((sample.t - start) / bufferMs);
    (buffers[index] ??= []).push(sample);
  }
  for (const buffer of buffers) {
    inner.mergeOnsetHistory(
      analyzer.onsetCandidatesFromFlux(buffer, inner._onsetHistory.length > 0)
    );
  }
  return inner._onsetHistory.map(o => o.t);
}

describe('buffered detection equals whole-series detection (#370)', () => {
  // 345ms is 174 BPM: the tempo that reads correctly offline and wrongly
  // live, and the one whose transients land on boundaries awkwardly.
  // Short enough that MAX_HISTORY_LENGTH never truncates: the merged
  // history and the whole-series detection have to be comparable, and a
  // count bound applied to one and not the other is a difference in the
  // TEST, not in the code. (My first version compared a truncated
  // history against an untruncated detection and blamed the code.)
  const SAMPLES = kit(345, 4_000);

  it('finds the same onsets whether the stream arrives whole or in buffers', () => {
    const whole = detectWhole(SAMPLES);
    const buffered = detectInBuffers(SAMPLES, 2_000);
    expect(buffered).toEqual(whole);
  });

  // Was `it.failing` while the residual was open: at a boundary of
  // 1745ms the buffered path found 44 onsets to the whole-series path's
  // 45, and threshold continuity plus boundary collapse explained
  // neither. It does now.
  //
  // The buffer was collapsed on its own and then collapsed AGAIN at the
  // boundary, which is not the same operation as collapsing the stream
  // once: the first candidates of a buffer merged among themselves
  // before they could be compared with what the previous buffer kept,
  // so a frame the whole-series pass would have chosen as the peak was
  // discarded before the merge ever saw it. `detectTempo` now hands
  // `mergeOnsetHistory` the uncollapsed candidates and lets it collapse
  // across the join (#370, #502).
  it('matches the whole-series count at every buffer boundary', () => {
    const whole = detectWhole(SAMPLES);
    const buffered = detectInBuffers(SAMPLES, 1_745);
    expect(buffered.length).toBe(whole.length);
  });

  it('matches exactly at every boundary, not just closely', () => {
    // This used to bound the damage at "no more than one onset differs"
    // because one did. Widening ONSET_REFRACTORY_MS to cover the
    // smoothing tail took that to two, which is what sent anyone
    // looking for the cause instead of raising the bound (#502).
    const whole = detectWhole(SAMPLES);
    for (const bufferMs of [1_745, 2_000, 2_500, 3_000]) {
      const buffered = detectInBuffers(SAMPLES, bufferMs);
      expect(buffered).toEqual(whole);
    }
  });

  it('reports the same tempo either way', () => {
    const analyzer = new AudioAnalyzer();
    const whole = analyzer.tempoFromOnsets(new AudioAnalyzer().onsetsFromFlux(SAMPLES));
    const bufferedAnalyzer = new AudioAnalyzer();
    const merge = (bufferedAnalyzer as unknown as { mergeOnsetHistory: (o: unknown[]) => void })
      .mergeOnsetHistory.bind(bufferedAnalyzer);
    const start = SAMPLES[0].t;
    const buffers: Sample[][] = [];
    for (const sample of SAMPLES) {
      (buffers[Math.floor((sample.t - start) / 2_000)] ??= []).push(sample);
    }
    const hist = (bufferedAnalyzer as unknown as { _onsetHistory: unknown[] })._onsetHistory;
    for (const buffer of buffers) merge(bufferedAnalyzer.onsetsFromFlux(buffer, hist.length > 0));
    const history = hist;
    expect(bufferedAnalyzer.tempoFromOnsets(history as never).bpm).toBe(whole.bpm);
  });
});
