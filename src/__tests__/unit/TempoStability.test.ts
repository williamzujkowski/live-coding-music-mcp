/**
 * A tempo reading is held until a second window agrees with it
 * (#374, #501).
 *
 * `detectTempo` answered from scratch on every poll, so the answer moved
 * while the onset window filled. On audio that never changed:
 *
 *     amen break            167, 83, 83, 83
 *     gen/intelligent_dnb   130, 130, 86, 130
 *
 * At most one of 167 and 83 is a measurement. The other is an artifact
 * of how much history had accumulated, and a caller holding one poll has
 * no way to tell which it got.
 *
 * The fixture is not synthetic. It is `_onsetHistory` dumped at each
 * successive poll of real headless playback, and replaying the polls in
 * order reproduces the live readings exactly — `unstableBpm` in the
 * fixture is what each poll actually returned before the fix.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Page } from 'playwright';
import { AudioAnalyzer } from '../../AudioAnalyzer';

interface Poll {
  poll: number;
  unstableBpm: number;
  onsets: { t: number; strength: number }[];
}
interface Case {
  label: string;
  declaredBpm: number;
  why: string;
  polls: Poll[];
}

const FIXTURE = JSON.parse(
  readFileSync(path.join(__dirname, '..', 'fixtures', 'unstable-tempo-polls.json'), 'utf8')
) as { cases: Case[] };

/** An analyzer whose page has no `analyze()`, so the history is used. */
const stubPage = (): Page => ({
  evaluate: async () => ({ dataArray: new Uint8Array(512), isConnected: true }),
} as unknown as Page);

/**
 * Replays a capture's polls in order, one window per poll.
 *
 * Assigning `_onsetHistory` before each call is what makes the window
 * MOVE between polls, which is the condition the stability rule keys
 * off — a window that has not moved cannot produce a new answer, so its
 * reading is reported at once.
 */
async function replay(testCase: Case): Promise<number[]> {
  const analyzer = new AudioAnalyzer();
  const page = stubPage();
  const reported: number[] = [];
  for (const poll of testCase.polls) {
    (analyzer as unknown as { _onsetHistory: unknown })._onsetHistory = poll.onsets;
    reported.push((await analyzer.detectTempo(page)).bpm);
  }
  return reported;
}

describe('the reported tempo does not change on unchanging audio (#374, #501)', () => {
  it.each(FIXTURE.cases.map(c => [c.label, c] as const))(
    '%s settles on one answer and keeps it',
    async (_label, testCase) => {
      const reported = await replay(testCase);
      const answered = reported.filter(bpm => bpm > 0);

      // The point of the whole exercise. Withholding would be worthless
      // if what followed still moved.
      expect(new Set(answered).size).toBe(1);
      // And it has to actually answer — a detector that says nothing
      // forever is stable and useless.
      expect(answered.length).toBeGreaterThan(0);
    }
  );

  it('the fixture really did flip before the fix, or this proves nothing', () => {
    // Guards the fixture rather than the code. If a recapture ever
    // produces polls that already agree, these cases stop testing
    // anything and should be replaced rather than quietly kept.
    for (const testCase of FIXTURE.cases) {
      const raw = testCase.polls.map(p => p.unstableBpm).filter(bpm => bpm > 0);
      expect(new Set(raw).size).toBeGreaterThan(1);
    }
  });

  it('never reports a number it then retracts', async () => {
    // Stronger than "settles": nothing may be reported before the
    // answer that sticks. A run of 130, 0, 86, 130 would pass a
    // uniqueness check on non-zero values only by luck.
    for (const testCase of FIXTURE.cases) {
      const reported = await replay(testCase);
      const firstAnswer = reported.findIndex(bpm => bpm > 0);
      expect(firstAnswer).toBeGreaterThanOrEqual(0);
      for (const bpm of reported.slice(firstAnswer)) {
        expect(bpm).toBe(reported[firstAnswer]);
      }
    }
  });

  it('the amen break settles on the pulse aubio also hears, modulo octave', async () => {
    // aubio 0.4.9, given the WAV of this same playback, reports 83.09.
    // Our settled answer on this capture is 83; on other captures it
    // settles on 164 instead, because which of the two gets confirmed
    // first depends on the window. Both are the same pulse.
    //
    // So the assertion is octave-relative, deliberately. The octave
    // itself is NOT claimed to be correct and cannot be: on a click
    // track with no ambiguity at all, librosa reads a 165 BPM signal as
    // 82.0 or 166.7 depending only on its own start_bpm, and aubio
    // reads a 174 BPM click as 87.8. Every estimator supplies the
    // octave from a prior. What is claimed is that our prior lands on
    // the same pulse an independent one does — and #374 asks for the
    // same octave on every poll, "whichever octave that is", not for a
    // particular one.
    const amen = FIXTURE.cases.find(c => c.label === 'amen-break');
    expect(amen).toBeDefined();
    const reported = (await replay(amen as Case)).filter(bpm => bpm > 0);

    const AUBIO_BPM = 83.09;
    let ratio = Math.max(reported[0], AUBIO_BPM) / Math.min(reported[0], AUBIO_BPM);
    while (ratio >= 2) ratio /= 2;
    const samePulse = Math.abs(ratio - 1) <= 0.04 || Math.abs(ratio - 2) <= 0.04;
    expect(samePulse).toBe(true);
  });
});

describe('the stability rule does not withhold forever', () => {
  it('reports at once when the window cannot change any more', async () => {
    // The guard against over-fixing. A fixture or a mock hands over the
    // same onsets every poll, and so does real audio once it stops:
    // nothing new can arrive, so waiting cannot improve the answer and
    // holding it back would be pure latency.
    const analyzer = new AudioAnalyzer();
    const page = stubPage();
    const steady = Array.from({ length: 8 }, (_, i) => 1_700_000_000_000 + i * 500);
    (analyzer as unknown as { _onsetHistory: unknown })._onsetHistory = steady;

    const first = await analyzer.detectTempo(page);
    const second = await analyzer.detectTempo(page);

    expect(first.bpm).toBe(0);
    expect(second.bpm).toBe(120);
  });

  it('forgets its settled answer when the pattern changes', async () => {
    // `resetTempoHistory` is the pattern-change boundary —
    // `StrudelController.writePattern` and `stop()` both call it. A
    // tempo confirmed for the previous pattern must not be reported for
    // the next one.
    const analyzer = new AudioAnalyzer();
    const page = stubPage();
    const steady = Array.from({ length: 8 }, (_, i) => 1_700_000_000_000 + i * 500);
    (analyzer as unknown as { _onsetHistory: unknown })._onsetHistory = steady;

    await analyzer.detectTempo(page);
    expect((await analyzer.detectTempo(page)).bpm).toBe(120);

    await analyzer.resetTempoHistory();
    (analyzer as unknown as { _onsetHistory: unknown })._onsetHistory = steady;
    expect((await analyzer.detectTempo(page)).bpm).toBe(0);
  });

  it('one deviant poll does not displace a settled answer', async () => {
    // The 130, 130, 86, 130 shape, reduced to its mechanism: a reading
    // that disagrees with the confirmed one has to be seen twice before
    // it is believed, exactly like the reading it would replace.
    const analyzer = new AudioAnalyzer();
    const page = stubPage();
    const at = (n: number, gap: number) =>
      Array.from({ length: n }, (_, i) => 1_700_000_000_000 + i * gap);

    (analyzer as unknown as { _onsetHistory: unknown })._onsetHistory = at(8, 500);
    await analyzer.detectTempo(page);
    (analyzer as unknown as { _onsetHistory: unknown })._onsetHistory = at(9, 500);
    expect((await analyzer.detectTempo(page)).bpm).toBe(120);

    // A window that says something else, once.
    (analyzer as unknown as { _onsetHistory: unknown })._onsetHistory = at(10, 700);
    expect((await analyzer.detectTempo(page)).bpm).toBe(120);
  });
});

describe('a held reading is distinguishable from no pulse at all (#374)', () => {
  // Raised by two independent reviewers on the design: `bpm: 0` now
  // means two different things. It is the "there is no pulse" sentinel
  // #288 introduced, and it is also "there is one, I have a candidate,
  // and I am waiting for a second window to agree".
  //
  // The distinction is not cosmetic. The tool's message told the caller
  // to "ensure audio is playing" — advice that sends an agent to fix
  // the wrong thing when audio IS playing and the detector is merely
  // settling. A pad with a slow attack would be told to retry forever.

  it('marks a withheld reading as settling', async () => {
    const analyzer = new AudioAnalyzer();
    const page = stubPage();
    const at = (n: number, gap: number) =>
      Array.from({ length: n }, (_, i) => 1_700_000_000_000 + i * gap);

    (analyzer as unknown as { _onsetHistory: unknown })._onsetHistory = at(8, 500);
    const held = await analyzer.detectTempo(page);

    expect(held.bpm).toBe(0);
    expect(held.settling).toBe(true);
  });

  it('does not mark genuine silence as settling', async () => {
    // Fewer than four onsets is not a candidate awaiting corroboration,
    // it is nothing to corroborate. The caller's next move differs, so
    // the two must not look alike.
    const analyzer = new AudioAnalyzer();
    (analyzer as unknown as { _onsetHistory: unknown })._onsetHistory =
      [1_700_000_000_000, 1_700_000_000_500];

    const quiet = await analyzer.detectTempo(stubPage());

    expect(quiet.bpm).toBe(0);
    expect(quiet.settling).toBeUndefined();
  });

  it('drops the flag once a reading is confirmed', async () => {
    const analyzer = new AudioAnalyzer();
    const page = stubPage();
    (analyzer as unknown as { _onsetHistory: unknown })._onsetHistory =
      Array.from({ length: 8 }, (_, i) => 1_700_000_000_000 + i * 500);

    await analyzer.detectTempo(page);
    const settled = await analyzer.detectTempo(page);

    expect(settled.bpm).toBe(120);
    expect(settled.settling).toBeUndefined();
  });
});
