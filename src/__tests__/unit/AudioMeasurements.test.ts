/**
 * Measurement-description tests (#252).
 *
 * The audio feedback path sends numbers rather than a waveform, because
 * no installed CLI can decode audio — asked directly they answer "CANNOT
 * DECODE AUDIO", and `agy` will confabulate detailed analysis of audio it
 * never examined rather than admit it.
 *
 * So the description has to carry its own meaning: a bare "peak: 1.12"
 * invites the model to guess what scale that is on, where "CLIPPING —
 * above full scale" does not.
 */

import {
  toDbfs,
  describeMeasurements,
  buildMeasurementPrompt,
} from '../../services/ai/AudioMeasurements.js';

describe('toDbfs', () => {
  it.each([
    [1, 0],
    [0.5, -6.02],
    [0.8058, -1.88],
    [0.1, -20],
  ])('converts %p to %p dBFS', (amplitude, expected) => {
    expect(toDbfs(amplitude)).toBeCloseTo(expected, 1);
  });

  it('reports silence as -Infinity rather than NaN', () => {
    expect(toDbfs(0)).toBe(-Infinity);
  });

  /**
   * Cross-check against an independent decode: an earlier capture measured
   * peak 0.8058 here, and a separate tool reported the same file at
   * -1.88 dBFS. The conversion has to keep agreeing with the rest of the
   * world's arithmetic.
   */
  it('agrees with an independently measured dBFS figure', () => {
    expect(toDbfs(0.8058)).toBeCloseTo(-1.88, 2);
  });
});

describe('describeMeasurements', () => {
  it('names clipping explicitly rather than leaving a bare number', () => {
    const text = describeMeasurements({ durationMs: 5000, peak: 1.1215 });

    expect(text).toMatch(/CLIPPING/);
    expect(text).toMatch(/1\.1215/);
  });

  it('reports headroom when there is some', () => {
    const text = describeMeasurements({ durationMs: 5000, peak: 0.8058 });

    expect(text).not.toMatch(/CLIPPING/);
    expect(text).toMatch(/headroom/);
    expect(text).toMatch(/-1\.88 dBFS/);
  });

  it('warns when a take is close to full scale without clipping', () => {
    expect(describeMeasurements({ durationMs: 5000, peak: 0.97 }))
      .toMatch(/little headroom/);
  });

  it('derives crest factor from peak and RMS', () => {
    // 20*log10(0.8/0.2) = 12.04 dB
    const text = describeMeasurements({ durationMs: 5000, peak: 0.8, rms: 0.2 });

    expect(text).toMatch(/Crest factor: 12\.0 dB/);
    expect(text).toMatch(/moderate dynamics/);
  });

  it.each([
    [0.5, 0.4, /compressed/],
    [0.9, 0.05, /dynamic/],
  ])('characterises crest factor for peak %p rms %p', (peak, rms, expected) => {
    expect(describeMeasurements({ durationMs: 5000, peak, rms })).toMatch(expected);
  });

  it('omits sections it has no data for', () => {
    const text = describeMeasurements({ durationMs: 1000 });

    expect(text).not.toMatch(/Peak/);
    expect(text).not.toMatch(/tempo/i);
    expect(text).toMatch(/Duration/);
  });

  it('includes tempo, key, spectrum and rhythm when measured', () => {
    const text = describeMeasurements({
      durationMs: 5000,
      tempo: { bpm: 130.4, confidence: 0.9 },
      key: { key: 'C', scale: 'minor', confidence: 0.7 },
      spectrum: { bass: 200, lowMid: 150, mid: 100, highMid: 80, treble: 40, centroid: 1200, brightness: 'dark' },
      rhythm: { complexity: 0.6, density: 0.8, syncopation: 0.3 },
    });

    expect(text).toMatch(/130 BPM/);
    expect(text).toMatch(/C minor/);
    expect(text).toMatch(/centroid: 1200 Hz \(dark\)/);
    expect(text).toMatch(/syncopation 0\.30/);
  });
});

describe('buildMeasurementPrompt', () => {
  const M = { durationMs: 5000, peak: 1.12, rms: 0.36 };

  it('tells the model the numbers are ground truth', () => {
    expect(buildMeasurementPrompt(M)).toMatch(/ground truth/i);
  });

  it('includes the pattern so advice can name the offending layer', () => {
    const prompt = buildMeasurementPrompt(M, 'stack(s("bd*4"), s("~ cp"))');

    expect(prompt).toMatch(/stack\(s\("bd\*4"\)/);
  });

  it('states the intended style, bpm and key when given', () => {
    const prompt = buildMeasurementPrompt(M, 's("bd")', { style: 'techno', bpm: 130, key: 'C' });

    expect(prompt).toMatch(/intended style: techno/);
    expect(prompt).toMatch(/intended BPM: 130/);
    expect(prompt).toMatch(/intended key: C/);
  });

  it('asks for exactly the AudioFeedback contract', () => {
    const prompt = buildMeasurementPrompt(M);

    for (const field of ['mood', 'style', 'energy', 'suggestions', 'confidence']) {
      expect(prompt).toContain(`"${field}"`);
    }
  });

  /** Otherwise the model narrates timbre it has no basis for. */
  it('forbids claiming timbral detail the measurements do not support', () => {
    expect(buildMeasurementPrompt(M)).toMatch(/not[\s\S]*claim to have heard/i);
  });

  it('omits the pattern block when there is no pattern', () => {
    expect(buildMeasurementPrompt(M)).not.toMatch(/```javascript/);
  });
});
