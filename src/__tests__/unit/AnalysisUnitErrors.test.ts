/**
 * Two unit/origin errors in the analysis path (#323).
 *
 * Both are the kind that tests pass over happily, because the code runs
 * and returns a plausible-looking number every time.
 */

import { AudioAnalyzer } from '../../AudioAnalyzer';

type Internals = {
  detectSyncopation(onsets: number[], meanInterval: number): number;
  generatePatternString(onsets: number[], meanInterval: number): string;
};

const internals = (): Internals => new AudioAnalyzer() as unknown as Internals;

describe('syncopation is measured from the first onset, not the epoch (#323)', () => {
  /** Nine onsets exactly 500ms apart, starting at an arbitrary wall-clock time. */
  const grid = (offsetMs: number): number[] =>
    Array.from({ length: 9 }, (_, i) => 1_700_000_000_000 + offsetMs + i * 500);

  it.each([0, 123, 250, 371, 499])(
    'a perfectly regular grid scores 0 at epoch offset +%ims', offset => {
      // `onsets[i] % (meanInterval * 4)` on a Date.now() value made the
      // answer depend on what time of day it was: the same rhythm
      // scored 0.000, 0.984 and 1.000 at different offsets, so a
      // regular grid reported maximum syncopation about three-quarters
      // of the time.
      expect(internals().detectSyncopation(grid(offset), 500)).toBe(0);
    });

  it('is identical across every offset', () => {
    const scores = [0, 123, 250, 371, 499].map(o =>
      internals().detectSyncopation(grid(o), 500));
    expect(new Set(scores).size).toBe(1);
  });

  it('still detects real syncopation', () => {
    // A guard that only ever returns 0 is not a fix.
    const offbeat = [0, 250, 500, 875, 1000, 1375, 1500, 1750]
      .map(x => 1_700_000_000_000 + x);
    expect(internals().detectSyncopation(offbeat, 500)).toBeGreaterThan(0.2);
  });

  it('the pattern string is also epoch-independent', () => {
    const strings = [0, 123, 250, 371].map(o =>
      internals().generatePatternString(grid(o), 500));
    expect(new Set(strings).size).toBe(1);
    expect(strings[0].startsWith('X')).toBe(true);
  });
});

describe('spectral centroid is in Hz, not bins (#323)', () => {
  /**
   * Mirrors the browser-side computation, which cannot be imported: it
   * lives inside a page.evaluate. The point under test is the unit
   * conversion and the threshold scale, both of which are pure
   * arithmetic.
   */
  function brightnessOf(spectrum: number[], sampleRate: number): {
    centroid: number; brightness: string;
  } {
    let sum = 0;
    let weightedSum = 0;
    for (let i = 0; i < spectrum.length; i++) {
      sum += spectrum[i];
      weightedSum += i * spectrum[i];
    }
    const hzPerBin = (sampleRate / 2) / spectrum.length;
    const centroid = (sum > 0 ? weightedSum / sum : 0) * hzPerBin;
    return {
      centroid,
      brightness: centroid > 4000 ? 'bright' : centroid > 1500 ? 'balanced' : 'dark',
    };
  }

  /** Energy only in the given Hz window. */
  function spectrumIn(loHz: number, hiHz: number, bins: number, sampleRate: number): number[] {
    const hzPerBin = (sampleRate / 2) / bins;
    return Array.from({ length: bins }, (_, i) => {
      const hz = i * hzPerBin;
      return hz >= loHz && hz <= hiHz ? 200 : 0;
    });
  }

  it('a 6-10 kHz spectrum reads as bright', () => {
    // It read "dark" before: the raw centroid is a bin index, so
    // "bright" needed bin 500 of 512 — 21.5 kHz out of a 22 kHz
    // maximum, which no real signal reaches.
    const r = brightnessOf(spectrumIn(6000, 10000, 512, 44100), 44100);
    expect(r.centroid).toBeGreaterThan(5000);
    expect(r.brightness).toBe('bright');
  });

  it('a bass-only spectrum reads as dark', () => {
    expect(brightnessOf(spectrumIn(40, 200, 512, 44100), 44100).brightness).toBe('dark');
  });

  it('a full-range spectrum reads as balanced', () => {
    expect(brightnessOf(spectrumIn(200, 4000, 512, 44100), 44100).brightness).toBe('balanced');
  });

  it('is invariant to fftSize for the same input spectrum', () => {
    // #195 made fftSize configurable and scaled the band edges, but not
    // the centroid — so the same audio reported dark / balanced / bright
    // at 1024 / 2048 / 4096.
    const results = [512, 1024, 2048].map(bins =>
      brightnessOf(spectrumIn(6000, 10000, bins, 44100), 44100));
    expect(new Set(results.map(r => r.brightness)).size).toBe(1);
    // Centroids agree to within a bin's worth of rounding.
    const centroids = results.map(r => r.centroid);
    expect(Math.max(...centroids) - Math.min(...centroids)).toBeLessThan(100);
  });

  it('tracks the real sample rate rather than assuming 44100', () => {
    // At 48kHz every reported frequency was 8.8% low — 1.47 semitones,
    // enough to label a real C as B or A#.
    const at44 = brightnessOf(spectrumIn(6000, 10000, 512, 44100), 44100).centroid;
    const at48 = brightnessOf(spectrumIn(6000, 10000, 512, 48000), 48000).centroid;
    // Same Hz window in, same Hz centroid out, whatever the rate.
    expect(Math.abs(at44 - at48) / at44).toBeLessThan(0.05);
  });
});
