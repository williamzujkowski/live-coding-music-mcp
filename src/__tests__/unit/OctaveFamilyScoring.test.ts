/**
 * Octave-family scoring, against onsets from real audio (#370).
 *
 * The fixture is not synthetic. It is `_onsetHistory` dumped at the
 * moment `detectTempo` answered, during headless playback of the shipped
 * drum & bass example at its declared 174 BPM. That reading was 115.
 *
 * Cross-model review (agy) pointed out that the entire tempo suite still
 * passed with `familyStrength` reverted to plain `correlation[lag]` — so
 * the fix had no coverage at all and I was about to merge it. This is
 * that coverage, and it uses the data that motivated the change rather
 * than a fixture built to make it pass.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { AudioAnalyzer } from '../../AudioAnalyzer';

interface Fixture {
  declaredBpm: number;
  readingWithoutFamilyScoring: number;
  onsets: { t: number; strength: number }[];
}

const FIXTURE = JSON.parse(
  readFileSync(path.join(__dirname, '..', 'fixtures', 'dnb-174-onsets.json'), 'utf8')
) as Fixture;

describe('octave-family scoring on real onsets (#370)', () => {
  it('reads the declared tempo of the captured drum & bass', () => {
    // Reverting familyStrength to plain correlation[lag] returns this to
    // 115, which is the whole point of the test.
    const result = new AudioAnalyzer().tempoFromOnsets(FIXTURE.onsets);
    expect(result.bpm).toBe(FIXTURE.declaredBpm);
  });

  it('prefers the family with corroborating octaves over the cross-rhythm', () => {
    // 115 is not an octave of 174 — it is six sixteenths where the beat
    // is four. 43.5/87/174 all correlate; 115's relatives are 57.5 and
    // 230, one weak and one outside the reportable range. That asymmetry
    // is the evidence the score is built on.
    const result = new AudioAnalyzer().tempoFromOnsets(FIXTURE.onsets);
    expect(result.bpm).not.toBe(FIXTURE.readingWithoutFamilyScoring);
  });

  it('does not let a relative outscore the candidate itself', () => {
    // The first attempt summed the family flat, which makes every member
    // of a family score alike and let a strong relative carry a weak
    // candidate — a pure 90 BPM train read as 120. The candidate has to
    // lead.
    const correlation = [0, 0.1, 0.9, 0.1, 0.2, 0.1, 0.1, 0.1, 0.2];
    // Candidate at lag 2 is strong on its own; lag 4 is weak but has
    // strong relatives at 2 and 8.
    expect(AudioAnalyzer.familyStrength(correlation, 2))
      .toBeGreaterThan(AudioAnalyzer.familyStrength(correlation, 4));
  });

  it('ignores family members that fall outside the correlation array', () => {
    const correlation = [0, 0.5, 0.5];
    expect(() => AudioAnalyzer.familyStrength(correlation, 2)).not.toThrow();
    expect(AudioAnalyzer.familyStrength(correlation, 2)).toBeGreaterThan(0);
  });
});

describe('rhythms the family score must not break (#370)', () => {
  const T = 1_700_000_000_000;

  it('reads a 90 BPM shuffle as 90, not 135', () => {
    // A 2:1 swing puts a hit at 444ms inside a 667ms beat, and that
    // offbeat gives the 135 BPM candidate a real relative to lean on.
    // At a corroboration weight of 0.5 this read 135 — cross-model
    // review (agy) predicted the number before I measured it.
    const onsets: number[] = [];
    for (let beat = 0; beat < 18; beat++) {
      onsets.push(T + Math.round(beat * 666.7), T + Math.round(beat * 666.7 + 444));
    }
    expect(new AudioAnalyzer().tempoFromOnsets(onsets).bpm).toBe(90);
  });

  it('reads accented triplets as the beat they are accented on', () => {
    const onsets: { t: number; strength: number }[] = [];
    for (let t = 0; t < 12_000; t += 200) {
      onsets.push({ t: T + t, strength: t % 600 === 0 ? 0.09 : 0.03 });
    }
    expect(new AudioAnalyzer().tempoFromOnsets(onsets).bpm).toBe(100);
  });

  it('keeps straight 8ths and a 3-against-4 polyrhythm on their beat', () => {
    const eighths = Array.from({ length: 56 }, (_, i) => T + i * 214);
    expect(new AudioAnalyzer().tempoFromOnsets(eighths).bpm).toBe(140);

    const poly = new Set<number>();
    for (let t = 0; t < 12_000; t += 500 / 3) poly.add(T + Math.round(t));
    for (let t = 0; t < 12_000; t += 125) poly.add(T + Math.round(t));
    expect(new AudioAnalyzer().tempoFromOnsets([...poly].sort((a, b) => a - b)).bpm).toBe(120);
  });

  it('picks 150 for an UNACCENTED 200ms grid, which is a tie it cannot win', () => {
    // Documented, not asserted as correct. A pure isochronous 200ms
    // train carries no information distinguishing 100 BPM triplets from
    // 150 BPM eighths from 300 BPM sixteenths — every one of them fits
    // exactly. Before family scoring the prior broke the tie at 100
    // because 100 is nearer 120; now the family evidence breaks it at
    // 150. Neither is a measurement.
    //
    // This is pinned so the behaviour is visible rather than silently
    // flipping again, and because the ACCENTED case above is the one
    // that has a real answer.
    const grid = Array.from({ length: 60 }, (_, i) => T + i * 200);
    expect(new AudioAnalyzer().tempoFromOnsets(grid).bpm).toBe(150);
  });
});
