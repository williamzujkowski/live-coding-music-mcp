/**
 * `detectKey` must refuse a spectrum that carries no audio (#412).
 *
 * The guard was `chroma.reduce(sum) < 0.1`, and `extractChroma`
 * normalizes its output to sum 1 whenever any bin is non-zero — so the
 * test could only pass on an exactly all-zero spectrum. Measured before
 * the fix, a single bin at magnitude 1 out of 1024:
 *
 *     chromaSum = 1.000  ->  { key: 'C', scale: 'locrian', conf: 0.793 }
 *
 * That is a key reported, with confidence, for silence. The magnitude
 * has to be read before normalization throws it away.
 */

import { AudioAnalyzer } from '../../AudioAnalyzer';
import type { Page } from 'playwright';

/** A page whose analyzer hands back exactly this spectrum. */
function pageWith(fftData: Uint8Array): Page {
  return {
    evaluate: async () => ({
      isConnected: true,
      dataArray: Array.from(fftData),
      sampleRate: 44100,
    }),
  } as unknown as Page;
}

function spectrum(fill: (i: number) => number): Uint8Array {
  const data = new Uint8Array(1024);
  for (let i = 0; i < data.length; i++) data[i] = fill(i);
  return data;
}

describe('detectKey refuses a spectrum with no audio in it (#412)', () => {
  it.each([
    ['all zero', spectrum(() => 0)],
    ['one bin at magnitude 1', spectrum(i => (i === 100 ? 1 : 0))],
    ['two bins at magnitude 1', spectrum(i => (i === 100 || i === 200 ? 1 : 0))],
  ])('reports no confidence for %s', async (_label, data) => {
    const result = await new AudioAnalyzer().detectKey(pageWith(data));
    expect(result?.confidence).toBe(0);
  });

  it('still reads a spectrum that has real content', async () => {
    // Loud, harmonically structured: the gate must not swallow it.
    const loud = spectrum(i => (i % 64 === 24 || i % 64 === 36 || i % 64 === 48 ? 200 : 5));
    const result = await new AudioAnalyzer().detectKey(pageWith(loud));
    expect(result?.confidence).toBeGreaterThan(0);
  });

  it('the normalized chroma cannot distinguish these, which was the bug', () => {
    // Kept as the reason the guard has to live upstream of normalization:
    // silence and music produce the same chroma sum.
    const analyzer = new AudioAnalyzer();
    const silent = analyzer.extractChroma(spectrum(i => (i === 100 ? 1 : 0)), 44100);
    const loud = analyzer.extractChroma(
      spectrum(i => (i % 64 === 24 ? 200 : 5)), 44100);
    const sum = (v: number[]): number => v.reduce((a, b) => a + b, 0);
    expect(sum(silent)).toBeCloseTo(1, 6);
    expect(sum(loud)).toBeCloseTo(1, 6);
  });
});
