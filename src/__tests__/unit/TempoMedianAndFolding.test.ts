/**
 * Two self-contained tempo defects (#322).
 *
 * The structural problem in that issue — onsets are collected one per
 * tool call, so the reported BPM is a function of the agent's polling
 * cadence — is NOT fixed here. It needs onset collection to move into
 * the page, and that deserves its own design. These are the two that
 * stand alone.
 */

import { AudioAnalyzer } from '../../AudioAnalyzer';
import type { Page } from 'playwright';

/** Timestamps from a list of inter-onset intervals. */
function onsetsFrom(intervals: number[], start = 1_700_000_000_000): number[] {
  const out = [start];
  for (const d of intervals) out.push(out[out.length - 1] + d);
  return out;
}

/** A page whose analyzer exists but exposes no analyze(), so the history is used. */
const stubPage = (): Page => ({
  evaluate: async () => ({ dataArray: new Uint8Array(512), isConnected: true }),
} as unknown as Page);

async function bpmFor(intervals: number[]): Promise<number> {
  const analyzer = new AudioAnalyzer();
  (analyzer as unknown as { _onsetHistory: number[] })._onsetHistory = onsetsFrom(intervals);
  return (await analyzer.detectTempo(stubPage())).bpm;
}

describe('median inter-onset interval (#322)', () => {
  it('a clean 120 BPM grid reads 120', async () => {
    expect(await bpmFor([500, 500, 500, 500, 500, 500, 500])).toBe(120);
  });

  it('one dropped onset does not move the answer', async () => {
    // Mean gave 105 here — onset detection misses beats constantly, so
    // this is the normal case, not a corner.
    expect(await bpmFor([500, 500, 500, 1000, 500, 500, 500])).toBe(120);
  });

  it('one ghost onset does not move the answer', async () => {
    // Mean gave 135.
    expect(await bpmFor([500, 500, 250, 250, 500, 500, 500])).toBe(120);
  });

  it('a genuinely irregular sequence still reports low confidence', async () => {
    const analyzer = new AudioAnalyzer();
    (analyzer as unknown as { _onsetHistory: number[] })._onsetHistory =
      onsetsFrom([500, 900, 300, 700, 400, 800]);
    const result = await analyzer.detectTempo(stubPage());
    // The median makes it robust, not credulous.
    expect(result.confidence).toBeLessThan(0.6);
  });
});

describe('octave folding (#322)', () => {
  it.each([
    [348, 174],   // 174 BPM dnb, onsets on 8ths
    [696, 174],   // ...on 16ths
    [1392, 174],  // ...on 32nds
    [35, 70],     // 70 BPM, onsets on half notes
    [174, 174],   // already in range, untouched
    [120, 120],
    [40, 40],     // the bounds themselves
    [200, 200],
  ])('%i folds to %i', (raw, expected) => {
    expect(AudioAnalyzer.foldIntoTempoRange(raw)).toBe(expected);
  });

  it.each([
    [5000, 'onsets 12ms apart is a buzz, not a beat'],
    [0.01, 'one onset every 100 minutes is not a tempo'],
    [0, 'zero'],
    [-120, 'negative'],
    [NaN, 'not a number'],
    [Infinity, 'infinite'],
  ])('%p returns null — %s', raw => {
    expect(AudioAnalyzer.foldIntoTempoRange(raw as number)).toBeNull();
  });

  it('never invents a tempo more than three octaves away', () => {
    // Folding 5000 five times lands on a plausible-looking 156. That
    // would be a fabrication, not a measurement.
    for (const raw of [3000, 5000, 10000]) {
      expect(AudioAnalyzer.foldIntoTempoRange(raw)).toBeNull();
    }
  });

  it('recovers 174 BPM from 8th-note onsets end to end', async () => {
    // Returned bpm 0 before: out-of-range readings were discarded
    // rather than folded, and onset detection lands on whatever
    // subdivision is loudest.
    expect(await bpmFor([172, 172, 172, 172, 172, 172, 172])).toBe(174);
  });

  it('a folded reading is less confident than a direct one', async () => {
    const direct = new AudioAnalyzer();
    (direct as unknown as { _onsetHistory: number[] })._onsetHistory =
      onsetsFrom([345, 345, 345, 345, 345, 345]);
    const folded = new AudioAnalyzer();
    (folded as unknown as { _onsetHistory: number[] })._onsetHistory =
      onsetsFrom([172, 172, 172, 172, 172, 172]);

    const a = await direct.detectTempo(stubPage());
    const b = await folded.detectTempo(stubPage());
    // Both land on 174; inferring the beat is double what the onsets
    // literally say is a weaker claim than reading it off directly.
    expect(a.bpm).toBe(b.bpm);
    expect(b.confidence).toBeLessThan(a.confidence);
  });
});
