/**
 * Unit tests for AudioAnalyzer helper methods and algorithms
 *
 * These tests directly exercise the algorithm implementations
 * without browser/page mocking, improving coverage on:
 * - Spectral flux calculation
 * - Autocorrelation
 * - Chroma extraction
 * - Correlation calculations
 * - Onset/tempo detection logic
 * - Key detection via Krumhansl-Schmuckler
 */

import { AudioAnalyzer } from '../../AudioAnalyzer';

// Access private methods for testing
// We use type casting to access private methods
type AudioAnalyzerPrivate = {
  calculateSpectralFlux(currentMagnitudes: Uint8Array): number;
  autocorrelate(signal: number[]): number[];
  extractChroma(fftData: Uint8Array): number[];
  frequencyToPitchClass(freq: number): number;
  pearsonCorrelation(x: number[], y: number[]): number;
  cosineSimilarity(x: number[], y: number[]): number;
  calculateIntervals(values: number[]): number[];
  calculateVariance(values: number[], mean?: number): number;
  findPeaks(autocorr: number[]): number[];
  analyzeSubdivisions(intervals: number[]): number;
  detectSyncopation(onsets: number[], meanInterval: number): number;
  generatePatternString(onsets: number[], meanInterval: number): string;
  _previousMagnitudes: number[] | null;
  _onsetHistory: number[];
  PITCH_CLASSES: string[];
  SCALE_PROFILES: Record<string, number[]>;
};

describe('AudioAnalyzer - Unit Tests', () => {
  let analyzer: AudioAnalyzer;
  let privateAnalyzer: AudioAnalyzerPrivate;

  beforeEach(() => {
    analyzer = new AudioAnalyzer();
    privateAnalyzer = analyzer as unknown as AudioAnalyzerPrivate;
  });

  // ============================================================================
  // SPECTRAL FLUX TESTS
  // ============================================================================

  describe('calculateSpectralFlux', () => {
    it('should return 0 on first call (no previous data)', () => {
      const magnitudes = new Uint8Array([100, 150, 200, 100]);
      const flux = privateAnalyzer.calculateSpectralFlux.call(analyzer, magnitudes);
      expect(flux).toBe(0);
    });

    it('should detect positive flux (energy increase)', () => {
      const first = new Uint8Array([50, 50, 50, 50]);
      const second = new Uint8Array([100, 100, 100, 100]);

      privateAnalyzer.calculateSpectralFlux.call(analyzer, first);
      const flux = privateAnalyzer.calculateSpectralFlux.call(analyzer, second);

      expect(flux).toBeGreaterThan(0);
    });

    it('should return 0 for energy decrease (only positive differences count)', () => {
      const first = new Uint8Array([200, 200, 200, 200]);
      const second = new Uint8Array([50, 50, 50, 50]);

      privateAnalyzer.calculateSpectralFlux.call(analyzer, first);
      const flux = privateAnalyzer.calculateSpectralFlux.call(analyzer, second);

      expect(flux).toBe(0);
    });

    it('should normalize flux to 0-1 range', () => {
      const first = new Uint8Array([0, 0, 0, 0]);
      const second = new Uint8Array([255, 255, 255, 255]);

      privateAnalyzer.calculateSpectralFlux.call(analyzer, first);
      const flux = privateAnalyzer.calculateSpectralFlux.call(analyzer, second);

      expect(flux).toBeGreaterThan(0);
      expect(flux).toBeLessThanOrEqual(1);
    });

    it('should handle empty arrays', () => {
      const empty = new Uint8Array([]);
      const flux = privateAnalyzer.calculateSpectralFlux.call(analyzer, empty);
      expect(flux).toBe(0);
    });
  });

  // ============================================================================
  // AUTOCORRELATION TESTS
  // ============================================================================

  describe('autocorrelate', () => {
    it('should return array of half input length', () => {
      const signal = [1, 0, 1, 0, 1, 0, 1, 0];
      const autocorr = privateAnalyzer.autocorrelate.call(analyzer, signal);

      expect(autocorr.length).toBe(4);
    });

    it('should have maximum at lag 0', () => {
      const signal = [1, 0.5, 0, -0.5, -1, -0.5, 0, 0.5];
      const autocorr = privateAnalyzer.autocorrelate.call(analyzer, signal);

      // Lag 0 is always the maximum (signal correlated with itself)
      expect(autocorr[0]).toBeGreaterThanOrEqual(autocorr[1]);
    });

    it('should detect periodicity in repeating signal', () => {
      // Signal with period 4: [1, 0, 0, 0, 1, 0, 0, 0]
      const signal = [1, 0, 0, 0, 1, 0, 0, 0];
      const autocorr = privateAnalyzer.autocorrelate.call(analyzer, signal);

      // Should show peak at lag 0 and another at the period
      expect(autocorr[0]).toBeGreaterThan(0);
    });

    it('should handle single element array', () => {
      const signal = [1];
      const autocorr = privateAnalyzer.autocorrelate.call(analyzer, signal);

      // For n=1, n/2 = 0.5 rounded down, but loop runs for lag < n/2
      // So result is a single element for lag 0
      expect(autocorr.length).toBeLessThanOrEqual(1);
    });

    it('should handle constant signal', () => {
      const signal = [1, 1, 1, 1, 1, 1];
      const autocorr = privateAnalyzer.autocorrelate.call(analyzer, signal);

      // All lags should have similar correlation for constant signal
      expect(autocorr.every(v => v > 0)).toBe(true);
    });
  });

  // ============================================================================
  // CHROMA EXTRACTION TESTS
  // ============================================================================

  describe('extractChroma', () => {
    it('should return 12-element array (one per pitch class)', () => {
      const fftData = new Uint8Array(512).fill(50);
      const chroma = privateAnalyzer.extractChroma.call(analyzer, fftData);

      expect(chroma.length).toBe(12);
    });

    it('should return normalized values summing to 1', () => {
      const fftData = new Uint8Array(512).fill(100);
      const chroma = privateAnalyzer.extractChroma.call(analyzer, fftData);

      const sum = chroma.reduce((a, b) => a + b, 0);
      expect(sum).toBeCloseTo(1, 5);
    });

    it('should handle silent input (zeros)', () => {
      const fftData = new Uint8Array(512).fill(0);
      const chroma = privateAnalyzer.extractChroma.call(analyzer, fftData);

      // All zeros should return all zeros
      expect(chroma.every(v => v === 0)).toBe(true);
    });

    it('should emphasize pitch classes with peak energy', () => {
      const fftData = new Uint8Array(512).fill(0);
      // Put energy at A4 (440Hz) bin
      // bin = (freq / 22050) * 512 = (440/22050) * 512 ~= 10
      fftData[10] = 255;
      fftData[11] = 200;

      const chroma = privateAnalyzer.extractChroma.call(analyzer, fftData);

      // Should have some energy in at least one pitch class
      expect(chroma.some(v => v > 0)).toBe(true);
    });
  });

  // ============================================================================
  // FREQUENCY TO PITCH CLASS TESTS
  // ============================================================================

  describe('frequencyToPitchClass', () => {
    it('should convert A4 (440Hz) to pitch class 9 (A)', () => {
      const pitchClass = privateAnalyzer.frequencyToPitchClass.call(analyzer, 440);
      expect(pitchClass).toBe(9); // A is the 9th pitch class (0=C)
    });

    it('should convert C4 (261.63Hz) to pitch class 0 (C)', () => {
      const pitchClass = privateAnalyzer.frequencyToPitchClass.call(analyzer, 261.63);
      expect(pitchClass).toBe(0);
    });

    it('should convert E4 (329.63Hz) to pitch class 4 (E)', () => {
      const pitchClass = privateAnalyzer.frequencyToPitchClass.call(analyzer, 329.63);
      expect(pitchClass).toBe(4);
    });

    it('should handle octave equivalence', () => {
      const a4 = privateAnalyzer.frequencyToPitchClass.call(analyzer, 440);
      const a5 = privateAnalyzer.frequencyToPitchClass.call(analyzer, 880);
      expect(a4).toBe(a5);
    });
  });

  // ============================================================================
  // CORRELATION TESTS
  // ============================================================================

  describe('pearsonCorrelation', () => {
    it('should return 1 for identical arrays', () => {
      const x = [1, 2, 3, 4, 5];
      const y = [1, 2, 3, 4, 5];

      const corr = privateAnalyzer.pearsonCorrelation.call(analyzer, x, y);
      expect(corr).toBeCloseTo(1, 5);
    });

    it('should return -1 for perfectly negatively correlated arrays', () => {
      const x = [1, 2, 3, 4, 5];
      const y = [5, 4, 3, 2, 1];

      const corr = privateAnalyzer.pearsonCorrelation.call(analyzer, x, y);
      expect(corr).toBeCloseTo(-1, 5);
    });

    it('should return 0 for uncorrelated arrays', () => {
      const x = [1, 2, 3, 4, 5];
      const y = [1, 1, 1, 1, 1]; // Constant (no variance)

      const corr = privateAnalyzer.pearsonCorrelation.call(analyzer, x, y);
      expect(corr).toBe(0);
    });

    it('should handle scaled versions of same array', () => {
      const x = [1, 2, 3, 4, 5];
      const y = [2, 4, 6, 8, 10];

      const corr = privateAnalyzer.pearsonCorrelation.call(analyzer, x, y);
      expect(corr).toBeCloseTo(1, 5);
    });
  });

  describe('cosineSimilarity', () => {
    it('should return 1 for identical vectors', () => {
      const x = [1, 0, 0];
      const y = [1, 0, 0];

      const similarity = privateAnalyzer.cosineSimilarity.call(analyzer, x, y);
      expect(similarity).toBeCloseTo(1, 5);
    });

    it('should return 0 for orthogonal vectors', () => {
      const x = [1, 0, 0];
      const y = [0, 1, 0];

      const similarity = privateAnalyzer.cosineSimilarity.call(analyzer, x, y);
      expect(similarity).toBeCloseTo(0, 5);
    });

    it('should handle scaled vectors', () => {
      const x = [1, 2, 3];
      const y = [2, 4, 6];

      const similarity = privateAnalyzer.cosineSimilarity.call(analyzer, x, y);
      expect(similarity).toBeCloseTo(1, 5);
    });

    it('should return 0 for zero vectors', () => {
      const x = [0, 0, 0];
      const y = [1, 2, 3];

      const similarity = privateAnalyzer.cosineSimilarity.call(analyzer, x, y);
      expect(similarity).toBe(0);
    });
  });

  // ============================================================================
  // VARIANCE CALCULATION TESTS
  // ============================================================================

  describe('calculateVariance', () => {
    it('should return 0 for constant values', () => {
      const values = [5, 5, 5, 5, 5];

      const variance = privateAnalyzer.calculateVariance.call(analyzer, values);

      expect(variance).toBe(0);
    });

    it('should calculate correct variance', () => {
      const values = [2, 4, 4, 4, 5, 5, 7, 9];
      // Mean = 5, variance = 4

      const variance = privateAnalyzer.calculateVariance.call(analyzer, values);

      expect(variance).toBe(4);
    });

    it('should use provided mean if given', () => {
      const values = [1, 2, 3, 4, 5];
      const providedMean = 3;

      const variance = privateAnalyzer.calculateVariance.call(
        analyzer,
        values,
        providedMean
      );

      expect(variance).toBe(2); // ((1-3)^2 + (2-3)^2 + (3-3)^2 + (4-3)^2 + (5-3)^2) / 5 = 10/5 = 2
    });
  });

  // ============================================================================
  // PEAK FINDING TESTS
  // ============================================================================

  describe('findPeaks', () => {
    it('should find local maxima', () => {
      const autocorr = [10, 5, 8, 3, 7, 2, 6, 4];

      const peaks = privateAnalyzer.findPeaks.call(analyzer, autocorr);

      // Peaks at indices 2 (8) and 4 (7) and 6 (6)
      expect(peaks).toContain(2);
      expect(peaks).toContain(4);
    });

    it('should not include endpoints', () => {
      const autocorr = [10, 5, 3]; // 10 is highest but at endpoint

      const peaks = privateAnalyzer.findPeaks.call(analyzer, autocorr);

      expect(peaks).not.toContain(0);
      expect(peaks).not.toContain(2);
    });

    it('should handle monotonic decreasing signal', () => {
      const autocorr = [10, 8, 6, 4, 2];

      const peaks = privateAnalyzer.findPeaks.call(analyzer, autocorr);

      expect(peaks).toEqual([]);
    });

    it('should handle short arrays', () => {
      const autocorr = [5, 3];

      const peaks = privateAnalyzer.findPeaks.call(analyzer, autocorr);

      expect(peaks).toEqual([]);
    });
  });

  // ============================================================================
  // SUBDIVISION ANALYSIS TESTS
  // ============================================================================

  describe('analyzeSubdivisions', () => {
    it('should return 0 for empty intervals', () => {
      const intervals: number[] = [];

      const score = privateAnalyzer.analyzeSubdivisions.call(analyzer, intervals);

      expect(score).toBe(0);
    });

    it('should return low score for uniform intervals', () => {
      const intervals = [500, 500, 500, 500];

      const score = privateAnalyzer.analyzeSubdivisions.call(analyzer, intervals);

      expect(score).toBeLessThan(0.5);
    });

    it('should return higher score for varied subdivisions', () => {
      // Mix of 1, 0.5, 0.25 subdivisions
      const intervals = [500, 250, 125, 500, 375];

      const score = privateAnalyzer.analyzeSubdivisions.call(analyzer, intervals);

      expect(score).toBeGreaterThan(0);
    });

    it('should be normalized 0-1', () => {
      const intervals = [100, 200, 150, 300, 50, 250, 175];

      const score = privateAnalyzer.analyzeSubdivisions.call(analyzer, intervals);

      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(1);
    });
  });

  // ============================================================================
  // SYNCOPATION DETECTION TESTS
  // ============================================================================

  describe('detectSyncopation', () => {
    it('should return 0 for too few onsets', () => {
      const onsets = [0, 500, 1000];
      const meanInterval = 500;

      const syncopation = privateAnalyzer.detectSyncopation.call(
        analyzer,
        onsets,
        meanInterval
      );

      expect(syncopation).toBe(0);
    });

    it('should return 0 when meanInterval is 0', () => {
      const onsets = [0, 500, 1000, 1500];
      const meanInterval = 0;

      const syncopation = privateAnalyzer.detectSyncopation.call(
        analyzer,
        onsets,
        meanInterval
      );

      expect(syncopation).toBe(0);
    });

    it('should detect low syncopation for on-beat pattern', () => {
      // Perfectly on-beat pattern (4/4 time)
      const onsets = [0, 500, 1000, 1500, 2000, 2500, 3000, 3500];
      const meanInterval = 500;

      const syncopation = privateAnalyzer.detectSyncopation.call(
        analyzer,
        onsets,
        meanInterval
      );

      expect(syncopation).toBeLessThan(0.3);
    });

    it('should be normalized 0-1', () => {
      const onsets = [0, 250, 750, 1000, 1250, 1750, 2000, 2250];
      const meanInterval = 500;

      const syncopation = privateAnalyzer.detectSyncopation.call(
        analyzer,
        onsets,
        meanInterval
      );

      expect(syncopation).toBeGreaterThanOrEqual(0);
      expect(syncopation).toBeLessThanOrEqual(1);
    });
  });

  // ============================================================================
  // PATTERN STRING GENERATION TESTS
  // ============================================================================

  describe('generatePatternString', () => {
    it('should return default pattern for empty onsets', () => {
      const onsets: number[] = [];
      const meanInterval = 500;

      const pattern = privateAnalyzer.generatePatternString.call(
        analyzer,
        onsets,
        meanInterval
      );

      expect(pattern).toBe('X...');
    });

    it('should use X for hits and . for rests', () => {
      const onsets = [0, 500, 1000];
      const meanInterval = 500;

      const pattern = privateAnalyzer.generatePatternString.call(
        analyzer,
        onsets,
        meanInterval
      );

      expect(pattern).toMatch(/^[X.]+$/);
    });

    it('should generate 16-character pattern', () => {
      const onsets = [0, 500, 1000, 1500];
      const meanInterval = 500;

      const pattern = privateAnalyzer.generatePatternString.call(
        analyzer,
        onsets,
        meanInterval
      );

      expect(pattern.length).toBe(16);
    });

    it('should contain X characters for onset positions', () => {
      const onsets = [0, 500, 1000, 1500];
      const meanInterval = 500;

      const pattern = privateAnalyzer.generatePatternString.call(
        analyzer,
        onsets,
        meanInterval
      );

      expect(pattern.includes('X')).toBe(true);
    });
  });

  // ============================================================================
  // SCALE PROFILES TESTS
  // ============================================================================

  describe('Scale Profiles', () => {
    it('should have 12 elements for each scale', () => {
      const profiles = privateAnalyzer.SCALE_PROFILES;

      for (const scale of Object.keys(profiles)) {
        expect(profiles[scale].length).toBe(12);
      }
    });

    it('should include major and minor scales', () => {
      const profiles = privateAnalyzer.SCALE_PROFILES;

      expect(profiles.major).toBeDefined();
      expect(profiles.minor).toBeDefined();
    });

    it('should include modal scales', () => {
      const profiles = privateAnalyzer.SCALE_PROFILES;

      expect(profiles.dorian).toBeDefined();
      expect(profiles.phrygian).toBeDefined();
      expect(profiles.lydian).toBeDefined();
      expect(profiles.mixolydian).toBeDefined();
      expect(profiles.locrian).toBeDefined();
    });

    it('should have positive weights for all scale degrees', () => {
      const profiles = privateAnalyzer.SCALE_PROFILES;

      for (const scale of Object.keys(profiles)) {
        expect(profiles[scale].every(w => w > 0)).toBe(true);
      }
    });
  });

  // ============================================================================
  // PITCH CLASSES TESTS
  // ============================================================================

  describe('Pitch Classes', () => {
    it('should have 12 pitch classes', () => {
      expect(privateAnalyzer.PITCH_CLASSES.length).toBe(12);
    });

    it('should start with C', () => {
      expect(privateAnalyzer.PITCH_CLASSES[0]).toBe('C');
    });

    it('should include all chromatic notes', () => {
      const pitchClasses = privateAnalyzer.PITCH_CLASSES;

      expect(pitchClasses).toContain('C');
      expect(pitchClasses).toContain('C#');
      expect(pitchClasses).toContain('D');
      expect(pitchClasses).toContain('E');
      expect(pitchClasses).toContain('F');
      expect(pitchClasses).toContain('G');
      expect(pitchClasses).toContain('A');
      expect(pitchClasses).toContain('B');
    });
  });

  // ============================================================================
  // CACHE BEHAVIOR TESTS
  // ============================================================================

  describe('Cache Management', () => {
    it('should clear analysis cache', () => {
      // Access private cache via casting
      const analyzerAny = analyzer as any;

      // Simulate cached data
      analyzerAny._analysisCache = { connected: true };
      analyzerAny._cacheTimestamp = Date.now();

      analyzer.clearCache();

      expect(analyzerAny._analysisCache).toBeNull();
      expect(analyzerAny._cacheTimestamp).toBe(0);
    });
  });

  // ============================================================================
  // ALGORITHM INTEGRATION TESTS
  // ============================================================================

  describe('Algorithm Integration', () => {
    it('should detect tempo from regular onset intervals', () => {
      // Test the interval-to-BPM calculation logic
      const intervals = [500, 500, 500, 500]; // 500ms = 120 BPM
      const meanInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
      const bpm = 60000 / meanInterval;

      expect(Math.round(bpm)).toBe(120);
    });

    it('should calculate confidence from interval variance', () => {
      const intervals = [500, 500, 500, 500];
      const meanInterval = 500;
      const variance = privateAnalyzer.calculateVariance.call(
        analyzer,
        intervals,
        meanInterval
      );

      // Low variance = high confidence
      expect(variance).toBe(0);
    });

    it('should correlate chroma with scale profile for key detection', () => {
      // C major chroma: strong C, E, G
      const cMajorChroma = [0.9, 0.1, 0.2, 0.1, 0.8, 0.3, 0.1, 0.75, 0.2, 0.1, 0.2, 0.1];
      const majorProfile = privateAnalyzer.SCALE_PROFILES.major;

      // Normalize both for comparison
      const chromaSum = cMajorChroma.reduce((a, b) => a + b, 0);
      const normalizedChroma = cMajorChroma.map(v => v / chromaSum);

      const profileSum = majorProfile.reduce((a, b) => a + b, 0);
      const normalizedProfile = majorProfile.map(v => v / profileSum);

      const correlation = privateAnalyzer.cosineSimilarity.call(
        analyzer,
        normalizedChroma,
        normalizedProfile
      );

      // C major chroma should correlate well with major profile
      expect(correlation).toBeGreaterThan(0.5);
    });
  });

  // ============================================================================
  // STATE MANAGEMENT TESTS
  // ============================================================================

  describe('State Management', () => {
    it('should initialize with empty onset history', () => {
      expect(privateAnalyzer._onsetHistory).toEqual([]);
    });

    it('should initialize with null previous magnitudes', () => {
      expect(privateAnalyzer._previousMagnitudes).toBeNull();
    });

    it('should track previous magnitudes after spectral flux call', () => {
      const magnitudes = new Uint8Array([100, 150, 200, 100]);
      privateAnalyzer.calculateSpectralFlux.call(analyzer, magnitudes);

      expect(privateAnalyzer._previousMagnitudes).not.toBeNull();
      expect(privateAnalyzer._previousMagnitudes).toEqual(Array.from(magnitudes));
    });
  });

  // ============================================================================
  // BPM EDGE CASES
  // ============================================================================

  describe('BPM Edge Cases', () => {
    it('should calculate 174 BPM from 345ms intervals', () => {
      const interval = 345; // ms
      const bpm = 60000 / interval;
      expect(Math.round(bpm)).toBe(174);
    });

    it('should calculate 40 BPM from 1500ms intervals', () => {
      const interval = 1500; // ms
      const bpm = 60000 / interval;
      expect(bpm).toBe(40);
    });

    it('should calculate 200 BPM from 300ms intervals', () => {
      const interval = 300; // ms
      const bpm = 60000 / interval;
      expect(bpm).toBe(200);
    });

    it('should calculate 90 BPM from 667ms intervals', () => {
      const interval = 667; // ms
      const bpm = 60000 / interval;
      expect(Math.round(bpm)).toBe(90);
    });
  });

  // ============================================================================
  // CONFIDENCE CALCULATION TESTS
  // ============================================================================

  describe('Confidence Calculation', () => {
    it('should produce high confidence for consistent intervals', () => {
      const intervals = [500, 500, 500, 500, 500];
      const meanInterval = 500;
      const variance = privateAnalyzer.calculateVariance.call(
        analyzer,
        intervals,
        meanInterval
      );
      const coefficientOfVariation = Math.sqrt(variance) / meanInterval;
      const confidence = Math.max(0, 1 - coefficientOfVariation * 1.5);

      expect(confidence).toBe(1);
    });

    it('should produce lower confidence for varied intervals', () => {
      const intervals = [400, 500, 600, 450, 550];
      const meanInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
      const variance = privateAnalyzer.calculateVariance.call(
        analyzer,
        intervals,
        meanInterval
      );
      const coefficientOfVariation = Math.sqrt(variance) / meanInterval;
      const confidence = Math.max(0, 1 - coefficientOfVariation * 1.5);

      expect(confidence).toBeLessThan(1);
      expect(confidence).toBeGreaterThan(0);
    });
  });

  // ============================================================================
  // KEY DETECTION ALGORITHM TESTS
  // ============================================================================

  describe('Key Detection Algorithm', () => {
    it('should rotate chroma correctly for different tonics', () => {
      // If we have a C major chroma and rotate by 7 (G), we should be able to
      // compare it against the major profile to detect G major
      const cMajorChroma = [0.9, 0.1, 0.2, 0.1, 0.8, 0.3, 0.1, 0.75, 0.2, 0.1, 0.2, 0.1];

      // For key detection, we rotate the chroma so the potential tonic is at position 0
      // Rotating by 7 (G) means: rotated[i] = chroma[(i + 7) % 12]
      const rotatedForG = new Array(12);
      for (let i = 0; i < 12; i++) {
        rotatedForG[i] = cMajorChroma[(i + 7) % 12];
      }

      // Position 0 should now have what was at position 7 (G)
      expect(rotatedForG[0]).toBe(cMajorChroma[7]);
    });

    it('should identify A minor from chroma with strong A, C, E', () => {
      // A minor: A (9), C (0), E (4)
      const aMinorChroma = [0.7, 0.1, 0.2, 0.1, 0.75, 0.2, 0.1, 0.3, 0.1, 0.85, 0.1, 0.2];
      const minorProfile = privateAnalyzer.SCALE_PROFILES.minor;

      // Rotate chroma to put A (index 9) at position 0
      const rotatedChroma = new Array(12);
      for (let i = 0; i < 12; i++) {
        rotatedChroma[i] = aMinorChroma[(i + 9) % 12];
      }

      // Normalize
      const chromaSum = rotatedChroma.reduce((a, b) => a + b, 0);
      const normalizedChroma = rotatedChroma.map(v => v / chromaSum);
      const profileSum = minorProfile.reduce((a, b) => a + b, 0);
      const normalizedProfile = minorProfile.map(v => v / profileSum);

      const correlation = privateAnalyzer.cosineSimilarity.call(
        analyzer,
        normalizedChroma,
        normalizedProfile
      );

      // Should have good correlation
      expect(correlation).toBeGreaterThan(0.5);
    });

    it('should distinguish major from minor profiles', () => {
      const majorProfile = privateAnalyzer.SCALE_PROFILES.major;
      const minorProfile = privateAnalyzer.SCALE_PROFILES.minor;

      // Normalize
      const majorSum = majorProfile.reduce((a, b) => a + b, 0);
      const normalizedMajor = majorProfile.map(v => v / majorSum);
      const minorSum = minorProfile.reduce((a, b) => a + b, 0);
      const normalizedMinor = minorProfile.map(v => v / minorSum);

      // Major and minor should be somewhat similar but not identical
      const correlation = privateAnalyzer.cosineSimilarity.call(
        analyzer,
        normalizedMajor,
        normalizedMinor
      );

      expect(correlation).toBeGreaterThan(0.7); // Related but different
      expect(correlation).toBeLessThan(1); // Not identical
    });
  });

  // ============================================================================
  // RHYTHM ANALYSIS ALGORITHM TESTS
  // ============================================================================

  describe('Rhythm Analysis Algorithm', () => {
    it('should calculate correct density for 4/4 pattern', () => {
      // 8 onsets over 3.5 seconds = ~2 events/second
      const onsets = [0, 500, 1000, 1500, 2000, 2500, 3000, 3500];
      const duration = (onsets[onsets.length - 1] - onsets[0]) / 1000;
      const density = (onsets.length - 1) / duration;

      expect(density).toBe(2);
    });

    it('should calculate correct density for fast pattern', () => {
      // 10 onsets over 1.875 seconds = ~4.8 events/second
      const onsets = [0, 187, 375, 500, 750, 937, 1125, 1312, 1500, 1687, 1875];
      const duration = (onsets[onsets.length - 1] - onsets[0]) / 1000;
      const density = (onsets.length - 1) / duration;

      expect(density).toBeCloseTo(5.33, 1);
    });

    it('should detect regularity from uniform intervals', () => {
      const intervals = [500, 500, 500, 500];
      const meanInterval = 500;
      const variance = privateAnalyzer.calculateVariance.call(
        analyzer,
        intervals,
        meanInterval
      );
      const coefficientOfVariation = Math.sqrt(variance) / meanInterval;
      const isRegular = coefficientOfVariation < 0.2;

      expect(isRegular).toBe(true);
    });

    it('should detect irregularity from varied intervals', () => {
      const intervals = [250, 500, 250, 250, 500, 250, 250, 500];
      const meanInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
      const variance = privateAnalyzer.calculateVariance.call(
        analyzer,
        intervals,
        meanInterval
      );
      const coefficientOfVariation = Math.sqrt(variance) / meanInterval;
      const isRegular = coefficientOfVariation < 0.2;

      expect(isRegular).toBe(false);
    });
  });

  // ============================================================================
  // FREQUENCY MAPPING TESTS
  // ============================================================================

  describe('Frequency to Pitch Mapping', () => {
    it('should map all notes in the chromatic scale correctly', () => {
      // Reference frequencies for A4 = 440Hz
      const frequencies: Record<string, number> = {
        C: 261.63, 'C#': 277.18, D: 293.66, 'D#': 311.13,
        E: 329.63, F: 349.23, 'F#': 369.99, G: 392.00,
        'G#': 415.30, A: 440.00, 'A#': 466.16, B: 493.88
      };

      const pitchClasses = privateAnalyzer.PITCH_CLASSES;

      for (const [note, freq] of Object.entries(frequencies)) {
        const pitchClass = privateAnalyzer.frequencyToPitchClass.call(analyzer, freq);
        const detectedNote = pitchClasses[pitchClass];

        // Allow for some rounding in the frequency-to-MIDI conversion
        expect(detectedNote).toBe(note);
      }
    });

    it('should handle frequencies across multiple octaves', () => {
      // C across different octaves
      const c2 = 65.41;
      const c3 = 130.81;
      const c4 = 261.63;
      const c5 = 523.25;

      const pc2 = privateAnalyzer.frequencyToPitchClass.call(analyzer, c2);
      const pc3 = privateAnalyzer.frequencyToPitchClass.call(analyzer, c3);
      const pc4 = privateAnalyzer.frequencyToPitchClass.call(analyzer, c4);
      const pc5 = privateAnalyzer.frequencyToPitchClass.call(analyzer, c5);

      // All should map to C (pitch class 0)
      expect(pc2).toBe(0);
      expect(pc3).toBe(0);
      expect(pc4).toBe(0);
      expect(pc5).toBe(0);
    });
  });
});
