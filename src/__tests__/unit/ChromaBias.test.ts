/**
 * Chroma extraction is unbiased and rate-aware (#321).
 *
 * Linear FFT bins do not divide evenly among twelve logarithmic pitch
 * classes. At fftSize=1024 only 92 of 512 bins fall inside the 20-4000
 * Hz window, distributed 4 to 12 per class — A gets 12, C# and D# get
 * 4. Summing raw magnitudes made the classes with more bins louder no
 * matter what the audio was.
 */

import { AudioAnalyzer } from '../../AudioAnalyzer';

const PITCH_CLASSES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const analyzer = () => new AudioAnalyzer();

/** Flat spectrum — every bin equally loud. */
const whiteNoise = (bins: number) => new Uint8Array(bins).fill(128);

/** A single bin at the given frequency. */
function pureTone(hz: number, bins: number, sampleRate = 44100): Uint8Array {
  const data = new Uint8Array(bins);
  const bin = Math.round(hz / ((sampleRate / 2) / bins));
  if (bin < bins) data[bin] = 255;
  return data;
}

describe('white noise produces a flat chroma (#321)', () => {
  it.each([512, 1024, 2048])('at %i bins', bins => {
    const chroma = analyzer().extractChroma(whiteNoise(bins), 44100);
    for (const v of chroma) {
      expect(v).toBeCloseTo(1 / 12, 3);
    }
  });

  it('the max/min ratio is 1, not 3', () => {
    const chroma = analyzer().extractChroma(whiteNoise(512), 44100);
    const nonZero = chroma.filter(v => v > 0);
    expect(Math.max(...nonZero) / Math.min(...nonZero)).toBeCloseTo(1, 2);
  });

  it('white noise does not produce a confident key', () => {
    // It confidently answered "F major, confidence 0.849" before —
    // an answer, from noise, with no music in it at all.
    const chroma = analyzer().extractChroma(whiteNoise(512), 44100);
    expect(analyzer().detectKeyFromChroma(chroma).confidence).toBeLessThan(0.15);
  });
});

describe('the sample rate is honoured, not assumed (#321)', () => {
  it('the same Hz maps to the same pitch class at 44.1k and 48k', () => {
    // 44100 was hardcoded. At 48000 every frequency came out 8.8% low —
    // 1.47 semitones, enough to put A4 in G# or A#.
    for (const hz of [261.63, 329.63, 440, 523.25, 880]) {
      const at44 = analyzer().extractChroma(pureTone(hz, 2048, 44100), 44100);
      const at48 = analyzer().extractChroma(pureTone(hz, 2048, 48000), 48000);
      expect(at48.indexOf(Math.max(...at48))).toBe(at44.indexOf(Math.max(...at44)));
    }
  });

  it('A4 at 48kHz is still A', () => {
    const chroma = analyzer().extractChroma(pureTone(440, 2048, 48000), 48000);
    expect(PITCH_CLASSES[chroma.indexOf(Math.max(...chroma))]).toBe('A');
  });
});

describe('resolution limits are what the docs claim (#321)', () => {
  /**
   * These pin the CHARACTERISATION, not a fix. Twelve logarithmic pitch
   * classes get narrower the lower you go, so bin width sets a floor on
   * how low key detection can work. If someone raises the default
   * fftSize, these tests say what improves.
   */
  const tones: [string, number][] = [
    ['C3', 130.81], ['D3', 146.83], ['E3', 164.81],
    ['E4', 329.63], ['A4', 440], ['C5', 523.25],
  ];

  function correctCount(bins: number): number {
    return tones.filter(([name, hz]) => {
      const chroma = analyzer().extractChroma(pureTone(hz, bins, 44100), 44100);
      return PITCH_CLASSES[chroma.indexOf(Math.max(...chroma))] === name.slice(0, -1);
    }).length;
  }

  it('fftSize 4096 resolves every test tone from C3 up', () => {
    expect(correctCount(2048)).toBe(tones.length);
  });

  it('fftSize 2048 — the shipped default — misses only E3', () => {
    expect(correctCount(1024)).toBe(tones.length - 1);
  });

  it('fftSize 1024 is materially worse, which is why it is not the shipped default', () => {
    expect(correctCount(512)).toBeLessThan(correctCount(1024));
  });

  it('higher resolution is never worse', () => {
    expect(correctCount(2048)).toBeGreaterThanOrEqual(correctCount(1024));
    expect(correctCount(1024)).toBeGreaterThanOrEqual(correctCount(512));
  });
});
