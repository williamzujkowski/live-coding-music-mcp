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
