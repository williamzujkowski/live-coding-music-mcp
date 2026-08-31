/**
 * Tempo detection against a mixed kit, not a bare click (#352).
 *
 * The issue reported 108-190 BPM across four runs on the same 174 BPM
 * audio, and proposed weighting the onset envelope by flux magnitude so
 * a kick counts for more than a hi-hat. That was necessary and it was
 * not the cause. This fixture is what showed the difference: it
 * reproduces the symptom synthetically, and the pattern of which tempos
 * fail names the real problem.
 *
 *   120 BPM (500ms) -> correct     500 / 20ms = 25 exactly
 *   100 BPM (600ms) -> correct     600 / 20ms = 30 exactly
 *   174 BPM (345ms) -> WRONG       345 / 20ms = 17.25
 *   140 BPM (428ms) -> WRONG       428 / 20ms = 21.4
 *
 * Tempos whose beat period divides evenly into the flux sampling step
 * read correctly; the rest do not. A 345ms beat lands alternately on
 * 340ms and 360ms, and an impulse train has no lag that matches both.
 * That is the sampling grid, not the music.
 *
 * These are synthetic flux series, not recordings. They cover the
 * arithmetic; they say nothing about how a real mix's spectrum behaves.
 */

import { AudioAnalyzer } from '../../AudioAnalyzer';

/**
 * A 20ms flux series for a kit playing `subdiv` notes to the beat.
 *
 * `kick` and `hat` are the measured flux of a real kick and a real
 * closed hat in this codebase's own units — the point is the ratio.
 */
function kit(beatMs: number, subdiv: number, durationMs = 8000, kick = 0.06, hat = 0.025) {
  const STEP = 20;
  const subMs = beatMs / subdiv;
  const samples: { t: number; flux: number }[] = [];
  for (let i = 0; i * STEP < durationMs; i++) {
    const t = i * STEP;
    let flux = 0.01; // the mix's noise floor between transients
    // The first few samples give the adaptive threshold a floor to learn.
    if (i >= 8) {
      if (t % subMs < STEP) flux = hat;
      if (t % beatMs < STEP) flux = kick;
    }
    samples.push({ t: 1_700_000_000_000 + t, flux });
  }
  return samples;
}

function bpmOf(beatMs: number, subdiv: number): number {
  const analyzer = new AudioAnalyzer();
  return analyzer.tempoFromOnsets(analyzer.onsetsFromFlux(kit(beatMs, subdiv))).bpm;
}

describe('tempo survives the sampling grid (#352)', () => {
  // Every one of these is a beat period that is NOT a whole number of
  // 20ms samples, except the two that are — kept deliberately, because a
  // fix that only works on the awkward ones would be suspicious.
  it.each([
    ['174 with 16th hats', 345, 4, 174],
    ['174 with 8th hats', 345, 2, 174],
    ['174 kick only', 345, 1, 174],
    ['140 with 16th hats', 428, 4, 140],
    ['160 with 16th hats', 375, 4, 160],
    ['128 with 8th hats', 469, 2, 128],
    ['120 with 16th hats', 500, 4, 120],
    ['100 with triplets', 600, 3, 100],
    ['90 with 8th hats', 667, 2, 90],
    ['85 with 16th hats', 706, 4, 85],
  ])('%s reads within 5%%', (_name, beatMs, subdiv, expected) => {
    const bpm = bpmOf(beatMs, subdiv);
    expect(Math.abs(bpm - expected) / expected).toBeLessThan(0.05);
  });

  it('reads the beat, not the subdivision, across every subdivision', () => {
    // The issue's own hypothesis: onsets land on the grid, not the
    // pulse. Same tempo, three different hat densities, one answer.
    const readings = [1, 2, 4].map(subdiv => bpmOf(345, subdiv));
    for (const bpm of readings) {
      expect(Math.abs(bpm - 174) / 174).toBeLessThan(0.05);
    }
  });

  it('is stable across repeated runs on the same series', () => {
    // The reported symptom was a spread, not a bias. A deterministic
    // input must give a deterministic answer.
    const readings = Array.from({ length: 5 }, () => bpmOf(345, 4));
    expect(new Set(readings).size).toBe(1);
  });

  // There was a test here asserting that a kit with hats as loud as its
  // kicks must NOT read 174, on the theory that without weighting there
  // is no beat to find. Octave-family scoring (#370) then found 174 from
  // the flat grid too — correctly, since a flat 16th grid at 86ms IS
  // 174 BPM — and the test failed while nothing was broken.
  //
  // Rewriting it to assert the mechanism directly did not work either:
  // with family scoring in place, weighted and unweighted inputs reach
  // the same answer on that fixture. Rather than keep a weaker test that
  // proves nothing, it is gone. The cases above already carry the
  // proof — disabling flux weighting fails "100 with triplets", "90 with
  // 8th hats" and "85 with 16th hats". That is what makes it
  // load-bearing, and a redundant restatement of it would only look
  // like more coverage.

  it('carries the flux value through with each onset', () => {
    // The whole mechanism depends on this reaching beatPeriodFromOnsets.
    const analyzer = new AudioAnalyzer();
    const onsets = analyzer.onsetsFromFlux(kit(345, 4));
    expect(onsets.length).toBeGreaterThan(12);
    const strengths = new Set(onsets.map(o => o.strength));
    // Kicks and hats are different heights, so more than one value.
    expect(strengths.size).toBeGreaterThan(1);
  });
});
