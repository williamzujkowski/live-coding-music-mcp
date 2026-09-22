/**
 * The confidence floor the median fallback never had (#419).
 *
 * `MIN_TEMPO_CONFIDENCE` exists so a caller can tell "I could not hear a
 * pulse" from "the pulse is 120" — the distinction #366 turned on. It
 * was applied on the autocorrelation exit of `tempoFromOnsets` and not
 * on the median one, and the median one is the branch sparse material
 * actually reaches: autocorrelation declines below
 * MIN_ONSETS_FOR_AUTOCORRELATION, which is every poll in the first
 * seconds after a write.
 *
 * So `gen/ambient` reported 184 BPM at confidence 0.000 against a
 * declared 130, and `gen/jungle` did the same. Not a weak measurement —
 * the median of nine inter-onset intervals, folded into range, wearing a
 * measurement's face.
 *
 * The fixture is not synthetic. It is `_onsetHistory` dumped during
 * headless playback of the generated patterns, at the polls that
 * produced those readings. Each case carries what `detectTempo` returned
 * before the fix, so the test states what it is preventing.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { AudioAnalyzer } from '../../AudioAnalyzer';

interface Case {
  label: string;
  declaredBpm: number;
  reportedBpm: number;
  reportedConfidence: number;
  onsets: { t: number; strength: number }[];
}

const FIXTURE = JSON.parse(
  readFileSync(path.join(__dirname, '..', 'fixtures', 'sparse-style-onsets.json'), 'utf8')
) as { cases: Case[] };

describe('sparse styles report no tempo rather than a confident wrong one (#419)', () => {
  it.each(FIXTURE.cases.map(c => [`${c.label} (was ${c.reportedBpm} BPM)`, c] as const))(
    '%s reports bpm 0',
    (_name, testCase) => {
      const result = new AudioAnalyzer().tempoFromOnsets(testCase.onsets);
      expect(result.bpm).toBe(0);
    }
  );

  it('each captured reading was below the floor, which is why it is refused', () => {
    // The evidence for the fix rather than a restatement of it: every
    // one of these came back under MIN_TEMPO_CONFIDENCE and was reported
    // anyway. If a future change makes the median path more confident
    // about this audio, this fails and the fixture needs recapturing
    // rather than the assertion relaxing.
    for (const testCase of FIXTURE.cases) {
      const result = new AudioAnalyzer().tempoFromOnsets(testCase.onsets);
      expect(result.confidence).toBeLessThan(0.1);
    }
  });

  it('does not silence the median path for onsets that do carry a pulse', () => {
    // The guard against over-fixing. Seven exact onsets 500ms apart are
    // below MIN_ONSETS_FOR_AUTOCORRELATION and still a real measurement,
    // so the floor must let them through — a blanket refusal of the
    // median path costs this, which is how the first attempt was caught.
    const onsets = Array.from({ length: 7 }, (_, i) => 1_700_000_000_000 + i * 500);
    const result = new AudioAnalyzer().tempoFromOnsets(onsets);
    expect(result.bpm).toBe(120);
    expect(result.confidence).toBeGreaterThanOrEqual(0.1);
  });
});

describe('confidence comes from the correlation, not the interval spread (#506)', () => {
  /** Seeded, so a negative control cannot pass by luck. */
  const seeded = (seed: number) => {
    let x = seed;
    return () => (x = (x * 1103515245 + 12345) % 2147483648) / 2147483648;
  };

  const T = 1_700_000_000_000;

  it.each([7, 99, 4242])('refuses intervals drawn flat (seed %i)', seed => {
    const rand = seeded(seed);
    let t = T;
    const times: number[] = [];
    for (let i = 0; i < 20; i++) { times.push(t); t += 150 + Math.round(rand() * 750); }

    const result = new AudioAnalyzer().tempoFromOnsets(times);

    // Under the interval-spread measure these scored 0.29, 0.45 and
    // 0.42 — all above the floor, and the middle one ABOVE real
    // ambient audio at 0.19. That inversion is the defect.
    expect(result.bpm).toBe(0);
  });

  it.each([11, 555])('refuses onsets scattered through the window (seed %i)', seed => {
    const rand = seeded(seed);
    const times: number[] = [];
    for (let i = 0; i < 24; i++) times.push(T + Math.round(rand() * 12000));
    times.sort((a, b) => a - b);

    expect(new AudioAnalyzer().tempoFromOnsets(times).bpm).toBe(0);
  });

  it('is certain about a clean train and says so', () => {
    const clean = Array.from({ length: 14 }, (_, i) => T + i * 345);
    const result = new AudioAnalyzer().tempoFromOnsets(clean);

    expect(result.bpm).toBe(174);
    expect(result.confidence).toBeGreaterThan(0.9);
  });

  it('separates every negative from every positive with no overlap', () => {
    // The property the threshold rests on, asserted rather than left in
    // a commit message. If a future change narrows this gap the
    // threshold stops being safe, and this is what says so.
    const rand = seeded(4242);
    let t = T;
    const noise: number[] = [];
    for (let i = 0; i < 20; i++) { noise.push(t); t += 150 + Math.round(rand() * 750); }
    const pulse = Array.from({ length: 14 }, (_, i) => T + i * 345);

    const analyzer = new AudioAnalyzer();
    const worstPositive = analyzer.tempoFromOnsets(pulse).confidence;
    const bestNegative = analyzer.tempoFromOnsets(noise).confidence;

    expect(bestNegative).toBeLessThan(worstPositive);
    expect(worstPositive - bestNegative).toBeGreaterThan(0.3);
  });
});
