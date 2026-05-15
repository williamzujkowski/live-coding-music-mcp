/**
 * Tests for AudioAnalyzer constructor + config validation (#195).
 *
 * Covers the part of the analyzer that can be tested without a browser:
 * config plumbing, validation, fallback behavior. The injected
 * browser-side IIFE is `istanbul ignore next`'d and covered by browser
 * integration tests.
 */

import { AudioAnalyzer } from '../../AudioAnalyzer';

describe('AudioAnalyzer config', () => {
  describe('defaults', () => {
    it('uses fftSize 1024 and smoothing 0.8 when no options are passed', () => {
      const a = new AudioAnalyzer();
      expect(a.getFftSize()).toBe(1024);
      expect(a.getSmoothing()).toBe(0.8);
    });

    it('uses defaults when an empty options object is passed', () => {
      const a = new AudioAnalyzer({});
      expect(a.getFftSize()).toBe(1024);
      expect(a.getSmoothing()).toBe(0.8);
    });
  });

  describe('valid options', () => {
    it.each([32, 64, 128, 256, 512, 1024, 2048, 4096, 8192, 16384, 32768])(
      'accepts power-of-2 fftSize %i',
      (fftSize) => {
        const a = new AudioAnalyzer({ fftSize });
        expect(a.getFftSize()).toBe(fftSize);
      },
    );

    it.each([0, 0.25, 0.5, 0.8, 0.95, 1])('accepts smoothing %f', (smoothing) => {
      const a = new AudioAnalyzer({ smoothing });
      expect(a.getSmoothing()).toBe(smoothing);
    });

    it('accepts both options together', () => {
      const a = new AudioAnalyzer({ fftSize: 2048, smoothing: 0.5 });
      expect(a.getFftSize()).toBe(2048);
      expect(a.getSmoothing()).toBe(0.5);
    });
  });

  describe('invalid fftSize falls back to 1024', () => {
    it.each([
      ['non-power-of-2', 1000],
      ['below minimum (16)', 16],
      ['above maximum (65536)', 65536],
      ['zero', 0],
      ['negative', -1024],
      ['non-integer (1024.5)', 1024.5],
    ])('rejects %s and falls back to 1024', (_label, fftSize) => {
      const a = new AudioAnalyzer({ fftSize: fftSize as number });
      expect(a.getFftSize()).toBe(1024);
    });

    it.each(['1024', null, NaN])('rejects non-number value %p and falls back to 1024', (badValue) => {
      const a = new AudioAnalyzer({ fftSize: badValue as unknown as number });
      expect(a.getFftSize()).toBe(1024);
    });
  });

  describe('invalid smoothing falls back to 0.8', () => {
    it.each([
      ['negative', -0.1],
      ['above 1', 1.1],
      ['large negative', -5],
      ['large positive', 100],
    ])('rejects %s and falls back to 0.8', (_label, smoothing) => {
      const a = new AudioAnalyzer({ smoothing });
      expect(a.getSmoothing()).toBe(0.8);
    });

    it.each(['0.5', null, NaN])('rejects non-number value %p and falls back to 0.8', (badValue) => {
      const a = new AudioAnalyzer({ smoothing: badValue as unknown as number });
      expect(a.getSmoothing()).toBe(0.8);
    });
  });

  describe('partial / mixed options', () => {
    it('keeps default fftSize when only smoothing is set', () => {
      const a = new AudioAnalyzer({ smoothing: 0.3 });
      expect(a.getFftSize()).toBe(1024);
      expect(a.getSmoothing()).toBe(0.3);
    });

    it('keeps default smoothing when only fftSize is set', () => {
      const a = new AudioAnalyzer({ fftSize: 4096 });
      expect(a.getFftSize()).toBe(4096);
      expect(a.getSmoothing()).toBe(0.8);
    });

    it('falls back on each invalid field independently', () => {
      const a = new AudioAnalyzer({ fftSize: 999, smoothing: 0.5 });
      expect(a.getFftSize()).toBe(1024);  // invalid → default
      expect(a.getSmoothing()).toBe(0.5); // valid → kept
    });
  });
});
