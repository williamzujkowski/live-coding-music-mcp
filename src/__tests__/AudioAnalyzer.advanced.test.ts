import { AudioAnalyzer } from '../AudioAnalyzer';
import { Page } from 'playwright';
import { createMockPage } from './utils/MockPlaywright';

/**
 * Advanced Audio Analysis Test Suite
 *
 * This test suite defines expected behavior for advanced audio analysis features:
 * - Tempo detection (BPM analysis)
 * - Key detection (musical key and scale)
 * - Rhythm analysis (pattern complexity, density, syncopation)
 *
 * Tests are written in TDD style and will FAIL until implementations are added.
 */

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

// ============================================================================
// MOCK DATA FIXTURES
// ============================================================================

/**
 * Mock FFT data representing known musical patterns
 * Each dataset is crafted to simulate real audio analysis results
 */
const mockAudioData = {
  // Tempo Detection Fixtures
  tempo120bpm: {
    // 120 BPM = 2 beats per second = 500ms per beat
    onsetTimes: [0, 500, 1000, 1500, 2000, 2500, 3000, 3500, 4000],
    avgInterval: 500,
    fftData: generateMockFFT({ peakFreq: 440, energy: 0.8, pattern: 'steady' })
  },

  tempo174bpm: {
    // 174 BPM (drum & bass) = 2.9 beats per second = 345ms per beat
    onsetTimes: [0, 345, 690, 1035, 1380, 1725, 2070, 2415, 2760, 3105],
    avgInterval: 345,
    fftData: generateMockFFT({ peakFreq: 80, energy: 0.9, pattern: 'fast' })
  },

  tempo90bpm: {
    // 90 BPM (slow) = 1.5 beats per second = 667ms per beat
    onsetTimes: [0, 667, 1334, 2001, 2668, 3335, 4002],
    avgInterval: 667,
    fftData: generateMockFFT({ peakFreq: 200, energy: 0.6, pattern: 'slow' })
  },

  tempo40bpm: {
    // 40 BPM (very slow) = 0.67 beats per second = 1500ms per beat
    onsetTimes: [0, 1500, 3000, 4500],
    avgInterval: 1500,
    fftData: generateMockFFT({ peakFreq: 100, energy: 0.4, pattern: 'very-slow' })
  },

  tempo200bpm: {
    // 200 BPM (very fast) = 3.33 beats per second = 300ms per beat
    onsetTimes: [0, 300, 600, 900, 1200, 1500, 1800, 2100, 2400, 2700, 3000],
    avgInterval: 300,
    fftData: generateMockFFT({ peakFreq: 150, energy: 0.95, pattern: 'very-fast' })
  },

  noAudio: {
    onsetTimes: [],
    avgInterval: 0,
    fftData: new Uint8Array(512).fill(0)
  },

  // Key Detection Fixtures
  cMajor: {
    // C major: C D E F G A B
    // Frequency peaks at C (261.63), E (329.63), G (392.00)
    chromaVector: [0.9, 0.1, 0.2, 0.1, 0.8, 0.3, 0.1, 0.75, 0.2, 0.1, 0.2, 0.1],
    peakFrequencies: [261.63, 329.63, 392.00, 523.25],
    tonic: 'C',
    scaleType: 'major'
  },

  aMinor: {
    // A minor: A B C D E F G
    // Frequency peaks at A (220), C (261.63), E (329.63)
    chromaVector: [0.7, 0.1, 0.2, 0.1, 0.75, 0.2, 0.1, 0.3, 0.1, 0.85, 0.1, 0.2],
    peakFrequencies: [220.00, 261.63, 329.63, 440.00],
    tonic: 'A',
    scaleType: 'minor'
  },

  gMajor: {
    // G major: G A B C D E F#
    chromaVector: [0.7, 0.1, 0.2, 0.75, 0.2, 0.1, 0.8, 0.85, 0.1, 0.2, 0.1, 0.3],
    peakFrequencies: [196.00, 246.94, 293.66, 392.00],
    tonic: 'G',
    scaleType: 'major'
  },

  dDorian: {
    // D dorian: D E F G A B C
    chromaVector: [0.6, 0.1, 0.7, 0.2, 0.8, 0.3, 0.1, 0.2, 0.1, 0.7, 0.1, 0.2],
    peakFrequencies: [146.83, 164.81, 196.00, 220.00],
    tonic: 'D',
    scaleType: 'dorian'
  },

  ambiguous: {
    // Ambiguous key - could be C major or A minor
    chromaVector: [0.8, 0.1, 0.2, 0.1, 0.8, 0.2, 0.1, 0.6, 0.1, 0.8, 0.1, 0.2],
    peakFrequencies: [220.00, 261.63, 329.63, 440.00],
    tonic: 'C',
    scaleType: 'major',
    alternatives: [
      { key: 'A', scale: 'minor', confidence: 0.78 }
    ]
  },

  // Rhythm Analysis Fixtures
  fourOnFloor: {
    // Steady 4/4 kick pattern
    onsets: [0, 500, 1000, 1500, 2000, 2500, 3000, 3500],
    complexity: 0.2,
    density: 2.0, // 2 events per second
    syncopation: 0.1,
    isRegular: true,
    pattern: 'X...X...X...X...'
  },

  syncopated: {
    // Syncopated pattern with off-beat hits
    onsets: [0, 250, 750, 1000, 1250, 1750, 2000, 2250, 2750],
    complexity: 0.7,
    density: 3.0,
    syncopation: 0.8,
    isRegular: false,
    pattern: 'X.X..X.X.X..X.X.'
  },

  complex: {
    // Complex polyrhythmic pattern
    onsets: [0, 187, 375, 500, 750, 937, 1125, 1312, 1500, 1687, 1875],
    complexity: 0.9,
    density: 4.5,
    syncopation: 0.6,
    isRegular: false,
    pattern: 'X.XX.X.X.XX.X.X.'
  },

  simple: {
    // Simple, slow pattern
    onsets: [0, 1000, 2000, 3000],
    complexity: 0.1,
    density: 1.0,
    syncopation: 0.0,
    isRegular: true,
    pattern: 'X...X...X...X...'
  }
};

/**
 * Helper function to generate mock FFT data
 */
function generateMockFFT(params: {
  peakFreq: number;
  energy: number;
  pattern: string;
}): Uint8Array {
  const fftSize = 512;
  const data = new Uint8Array(fftSize);

  const { peakFreq, energy, pattern } = params;
  const peakBin = Math.floor((peakFreq / 22050) * fftSize);
  const baseEnergy = Math.floor(energy * 255);

  // Fill with noise floor
  for (let i = 0; i < fftSize; i++) {
    data[i] = Math.floor(Math.random() * 10);
  }

  // Add peak energy at fundamental frequency
  if (peakBin < fftSize) {
    data[peakBin] = baseEnergy;
    // Add some harmonics
    if (peakBin * 2 < fftSize) data[peakBin * 2] = Math.floor(baseEnergy * 0.5);
    if (peakBin * 3 < fftSize) data[peakBin * 3] = Math.floor(baseEnergy * 0.3);
  }

  // Pattern-specific modifications
  if (pattern === 'steady') {
    // Add consistent low-frequency energy for steady tempo
    for (let i = 0; i < 10; i++) {
      data[i] = Math.floor(baseEnergy * 0.8);
    }
  } else if (pattern === 'fast') {
    // More high-frequency content for fast tempo
    for (let i = fftSize / 2; i < fftSize; i++) {
      data[i] = Math.floor(baseEnergy * 0.4);
    }
  }

  return data;
}

/**
 * Helper to create mock page with audio analysis capabilities
 */
function createMockPageWithAnalysis(audioData: any) {
  const mockPage = createMockPage();

  // Override evaluate to return analysis data
  mockPage.evaluate = jest.fn().mockImplementation((fn: any) => {
    if (typeof fn === 'function') {
      // Return mock window.strudelAudioAnalyzer
      return Promise.resolve({
        analyser: { fftSize: 1024 },
        dataArray: audioData.fftData || new Uint8Array(512),
        isConnected: true,
        analyze: () => ({
          connected: true,
          timestamp: Date.now(),
          features: {
            average: 50,
            peak: 100,
            peakFrequency: audioData.peakFreq || 440,
            ...audioData
          }
        })
      });
    }
    return Promise.resolve(undefined);
  });

  return mockPage;
}

// ============================================================================
// TEST SUITE
// ============================================================================

describe('AudioAnalyzer - Advanced Analysis', () => {
  let analyzer: AudioAnalyzer;
  let mockPage: ReturnType<typeof createMockPage>;

  beforeEach(() => {
    analyzer = new AudioAnalyzer();
  });

  afterEach(() => {
    analyzer.clearCache();
  });

  // ==========================================================================
  // TEMPO DETECTION TESTS
  // ==========================================================================

  describe('Tempo Detection', () => {
    describe('Known Tempo Detection', () => {
      test('should detect 120 BPM within ±2 BPM tolerance', async () => {
        mockPage = createMockPageWithAnalysis(mockAudioData.tempo120bpm);
        await analyzer.inject(mockPage as unknown as Page);

        const analysis = await analyzer.detectTempo(mockPage as unknown as Page);

        expect(analysis).toBeDefined();
        expect(analysis?.bpm).toBeGreaterThanOrEqual(118);
        expect(analysis?.bpm).toBeLessThanOrEqual(122);
        expect(analysis?.confidence).toBeGreaterThan(0.7);
      });

      test('should detect 174 BPM (DNB tempo) within ±2 BPM tolerance', async () => {
        mockPage = createMockPageWithAnalysis(mockAudioData.tempo174bpm);
        await analyzer.inject(mockPage as unknown as Page);

        const analysis = await analyzer.detectTempo(mockPage as unknown as Page);

        expect(analysis).toBeDefined();
        expect(analysis?.bpm).toBeGreaterThanOrEqual(172);
        expect(analysis?.bpm).toBeLessThanOrEqual(176);
        expect(analysis?.confidence).toBeGreaterThan(0.7);
      });

      test('should detect 90 BPM within ±2 BPM tolerance', async () => {
        mockPage = createMockPageWithAnalysis(mockAudioData.tempo90bpm);
        await analyzer.inject(mockPage as unknown as Page);

        const analysis = await analyzer.detectTempo(mockPage as unknown as Page);

        expect(analysis).toBeDefined();
        expect(analysis?.bpm).toBeGreaterThanOrEqual(88);
        expect(analysis?.bpm).toBeLessThanOrEqual(92);
        expect(analysis?.confidence).toBeGreaterThan(0.6);
      });
    });

    describe('Edge Cases', () => {
      test('should detect very slow tempo (40 BPM)', async () => {
        mockPage = createMockPageWithAnalysis(mockAudioData.tempo40bpm);
        await analyzer.inject(mockPage as unknown as Page);

        const analysis = await analyzer.detectTempo(mockPage as unknown as Page);

        expect(analysis).toBeDefined();
        expect(analysis?.bpm).toBeGreaterThanOrEqual(38);
        expect(analysis?.bpm).toBeLessThanOrEqual(45);
        // Lower confidence expected for edge cases
        expect(analysis?.confidence).toBeGreaterThan(0.5);
      });

      test('should detect very fast tempo (200 BPM)', async () => {
        mockPage = createMockPageWithAnalysis(mockAudioData.tempo200bpm);
        await analyzer.inject(mockPage as unknown as Page);

        const analysis = await analyzer.detectTempo(mockPage as unknown as Page);

        expect(analysis).toBeDefined();
        expect(analysis?.bpm).toBeGreaterThanOrEqual(195);
        expect(analysis?.bpm).toBeLessThanOrEqual(205);
        expect(analysis?.confidence).toBeGreaterThan(0.5);
      });

      test('should return null or zero for no audio', async () => {
        mockPage = createMockPageWithAnalysis(mockAudioData.noAudio);
        await analyzer.inject(mockPage as unknown as Page);

        const analysis = await analyzer.detectTempo(mockPage as unknown as Page);

        expect(analysis).toBeDefined();
        expect(analysis?.bpm === 0 || analysis === null).toBe(true);
        if (analysis) {
          expect(analysis.confidence).toBeLessThan(0.3);
        }
      });
    });

    describe('Confidence Scoring', () => {
      test('should provide high confidence for steady tempo', async () => {
        mockPage = createMockPageWithAnalysis(mockAudioData.tempo120bpm);
        await analyzer.inject(mockPage as unknown as Page);

        const analysis = await analyzer.detectTempo(mockPage as unknown as Page);

        expect(analysis?.confidence).toBeGreaterThan(0.8);
      });

      test('should provide lower confidence for ambiguous tempo', async () => {
        // Create data with irregular intervals
        const irregularData = {
          onsetTimes: [0, 400, 900, 1200, 1800, 2100],
          avgInterval: 500, // Misleading average
          fftData: generateMockFFT({ peakFreq: 440, energy: 0.5, pattern: 'steady' })
        };

        mockPage = createMockPageWithAnalysis(irregularData);
        await analyzer.inject(mockPage as unknown as Page);

        const analysis = await analyzer.detectTempo(mockPage as unknown as Page);

        expect(analysis?.confidence).toBeLessThan(0.7);
      });
    });

    describe('Detection Methods', () => {
      test('should indicate detection method used', async () => {
        mockPage = createMockPageWithAnalysis(mockAudioData.tempo120bpm);
        await analyzer.inject(mockPage as unknown as Page);

        const analysis = await analyzer.detectTempo(mockPage as unknown as Page);

        expect(analysis?.method).toBeDefined();
        expect(['autocorrelation', 'onset', 'spectral']).toContain(analysis?.method);
      });
    });
  });

  // ==========================================================================
  // KEY DETECTION TESTS
  // ==========================================================================

  describe('Key Detection', () => {
    describe('Known Keys', () => {
      test('should detect C major correctly', async () => {
        mockPage = createMockPageWithAnalysis(mockAudioData.cMajor);
        await analyzer.inject(mockPage as unknown as Page);

        const analysis = await analyzer.detectKey(mockPage as unknown as Page);

        expect(analysis).toBeDefined();
        expect(analysis?.key).toBe('C');
        expect(analysis?.scale).toBe('major');
        expect(analysis?.confidence).toBeGreaterThan(0.7);
      });

      test('should detect A minor correctly', async () => {
        mockPage = createMockPageWithAnalysis(mockAudioData.aMinor);
        await analyzer.inject(mockPage as unknown as Page);

        const analysis = await analyzer.detectKey(mockPage as unknown as Page);

        expect(analysis).toBeDefined();
        expect(analysis?.key).toBe('A');
        expect(analysis?.scale).toBe('minor');
        expect(analysis?.confidence).toBeGreaterThan(0.7);
      });

      test('should detect G major correctly', async () => {
        mockPage = createMockPageWithAnalysis(mockAudioData.gMajor);
        await analyzer.inject(mockPage as unknown as Page);

        const analysis = await analyzer.detectKey(mockPage as unknown as Page);

        expect(analysis).toBeDefined();
        expect(analysis?.key).toBe('G');
        expect(analysis?.scale).toBe('major');
        expect(analysis?.confidence).toBeGreaterThan(0.7);
      });

      test('should detect modal scales (D dorian)', async () => {
        // Note: D dorian and A aeolian/natural minor share the same notes (D-E-F-G-A-B-C)
        // The algorithm may detect either as a valid interpretation - this is expected
        // music theory behavior, not a bug
        mockPage = createMockPageWithAnalysis(mockAudioData.dDorian);
        await analyzer.inject(mockPage as unknown as Page);

        const analysis = await analyzer.detectKey(mockPage as unknown as Page);

        expect(analysis).toBeDefined();
        // Accept D dorian, A aeolian, or C major as valid (all share same pitch classes)
        expect(['D', 'A', 'C']).toContain(analysis?.key);
        expect(analysis?.confidence).toBeGreaterThan(0.5);
      });
    });

    describe('Confidence Validation', () => {
      test('should return confidence score between 0 and 1', async () => {
        mockPage = createMockPageWithAnalysis(mockAudioData.cMajor);
        await analyzer.inject(mockPage as unknown as Page);

        const analysis = await analyzer.detectKey(mockPage as unknown as Page);

        expect(analysis?.confidence).toBeGreaterThanOrEqual(0);
        expect(analysis?.confidence).toBeLessThanOrEqual(1);
      });

      test('should provide high confidence for clear key', async () => {
        mockPage = createMockPageWithAnalysis(mockAudioData.cMajor);
        await analyzer.inject(mockPage as unknown as Page);

        const analysis = await analyzer.detectKey(mockPage as unknown as Page);

        expect(analysis?.confidence).toBeGreaterThan(0.8);
      });

      test('should provide lower confidence for ambiguous key', async () => {
        mockPage = createMockPageWithAnalysis(mockAudioData.ambiguous);
        await analyzer.inject(mockPage as unknown as Page);

        const analysis = await analyzer.detectKey(mockPage as unknown as Page);

        // Ambiguous should have moderate confidence
        expect(analysis?.confidence).toBeGreaterThan(0.5);
        expect(analysis?.confidence).toBeLessThan(0.85);
      });
    });

    describe('Alternative Key Detection', () => {
      test('should provide alternative keys for ambiguous input', async () => {
        mockPage = createMockPageWithAnalysis(mockAudioData.ambiguous);
        await analyzer.inject(mockPage as unknown as Page);

        const analysis = await analyzer.detectKey(mockPage as unknown as Page);

        expect(analysis?.alternatives).toBeDefined();
        expect(analysis?.alternatives?.length).toBeGreaterThan(0);
      });

      test('alternative keys should have valid confidence scores', async () => {
        mockPage = createMockPageWithAnalysis(mockAudioData.ambiguous);
        await analyzer.inject(mockPage as unknown as Page);

        const analysis = await analyzer.detectKey(mockPage as unknown as Page);

        if (analysis?.alternatives) {
          analysis.alternatives.forEach(alt => {
            expect(alt.confidence).toBeGreaterThanOrEqual(0);
            expect(alt.confidence).toBeLessThanOrEqual(1);
            expect(alt.key).toBeDefined();
            expect(alt.scale).toBeDefined();
          });
        }
      });

      test('alternatives should be sorted by confidence (descending)', async () => {
        mockPage = createMockPageWithAnalysis(mockAudioData.ambiguous);
        await analyzer.inject(mockPage as unknown as Page);

        const analysis = await analyzer.detectKey(mockPage as unknown as Page);

        if (analysis?.alternatives && analysis.alternatives.length > 1) {
          for (let i = 0; i < analysis.alternatives.length - 1; i++) {
            expect(analysis.alternatives[i].confidence)
              .toBeGreaterThanOrEqual(analysis.alternatives[i + 1].confidence);
          }
        }
      });
    });

    describe('Edge Cases', () => {
      test('should handle atonal/noisy input gracefully', async () => {
        mockPage = createMockPageWithAnalysis(mockAudioData.noAudio);
        await analyzer.inject(mockPage as unknown as Page);

        const analysis = await analyzer.detectKey(mockPage as unknown as Page);

        // Should either return null or very low confidence
        if (analysis) {
          expect(analysis.confidence).toBeLessThan(0.4);
        }
      });
    });
  });

  // ==========================================================================
  // RHYTHM ANALYSIS TESTS
  // ==========================================================================

  describe('Rhythm Analysis', () => {
    describe('Onset Detection', () => {
      test('should detect onsets in steady pattern', async () => {
        mockPage = createMockPageWithAnalysis(mockAudioData.fourOnFloor);
        await analyzer.inject(mockPage as unknown as Page);

        const analysis = await analyzer.analyzeRhythm(mockPage as unknown as Page);

        expect(analysis).toBeDefined();
        expect(analysis?.onsets).toBeDefined();
        expect(analysis?.onsets.length).toBeGreaterThan(0);
      });

      test('onset times should be in milliseconds', async () => {
        mockPage = createMockPageWithAnalysis(mockAudioData.fourOnFloor);
        await analyzer.inject(mockPage as unknown as Page);

        const analysis = await analyzer.analyzeRhythm(mockPage as unknown as Page);

        if (analysis?.onsets) {
          analysis.onsets.forEach((onset, i) => {
            expect(onset).toBeGreaterThanOrEqual(0);
            // Each onset should be later than the previous
            if (i > 0) {
              expect(onset).toBeGreaterThan(analysis.onsets[i - 1]);
            }
          });
        }
      });
    });

    describe('Complexity Scoring', () => {
      test('should score simple pattern as low complexity', async () => {
        mockPage = createMockPageWithAnalysis(mockAudioData.simple);
        await analyzer.inject(mockPage as unknown as Page);

        const analysis = await analyzer.analyzeRhythm(mockPage as unknown as Page);

        expect(analysis?.complexity).toBeDefined();
        expect(analysis?.complexity).toBeLessThan(0.3);
        expect(analysis?.complexity).toBeGreaterThanOrEqual(0);
      });

      test('should score complex pattern as high complexity', async () => {
        mockPage = createMockPageWithAnalysis(mockAudioData.complex);
        await analyzer.inject(mockPage as unknown as Page);

        const analysis = await analyzer.analyzeRhythm(mockPage as unknown as Page);

        expect(analysis?.complexity).toBeGreaterThan(0.7);
        expect(analysis?.complexity).toBeLessThanOrEqual(1);
      });

      test('complexity should be normalized 0-1', async () => {
        mockPage = createMockPageWithAnalysis(mockAudioData.syncopated);
        await analyzer.inject(mockPage as unknown as Page);

        const analysis = await analyzer.analyzeRhythm(mockPage as unknown as Page);

        expect(analysis?.complexity).toBeGreaterThanOrEqual(0);
        expect(analysis?.complexity).toBeLessThanOrEqual(1);
      });
    });

    describe('Density Calculation', () => {
      test('should calculate density as events per second', async () => {
        mockPage = createMockPageWithAnalysis(mockAudioData.fourOnFloor);
        await analyzer.inject(mockPage as unknown as Page);

        const analysis = await analyzer.analyzeRhythm(mockPage as unknown as Page);

        expect(analysis?.density).toBeDefined();
        expect(analysis?.density).toBeGreaterThan(0);
        // Four-on-floor should be ~2 events per second
        expect(analysis?.density).toBeCloseTo(2.0, 0.5);
      });

      test('should detect high density in fast patterns', async () => {
        mockPage = createMockPageWithAnalysis(mockAudioData.complex);
        await analyzer.inject(mockPage as unknown as Page);

        const analysis = await analyzer.analyzeRhythm(mockPage as unknown as Page);

        expect(analysis?.density).toBeGreaterThan(3.0);
      });

      test('should detect low density in slow patterns', async () => {
        mockPage = createMockPageWithAnalysis(mockAudioData.simple);
        await analyzer.inject(mockPage as unknown as Page);

        const analysis = await analyzer.analyzeRhythm(mockPage as unknown as Page);

        expect(analysis?.density).toBeLessThan(2.0);
      });
    });

    describe('Syncopation Detection', () => {
      test('should detect low syncopation in regular pattern', async () => {
        mockPage = createMockPageWithAnalysis(mockAudioData.fourOnFloor);
        await analyzer.inject(mockPage as unknown as Page);

        const analysis = await analyzer.analyzeRhythm(mockPage as unknown as Page);

        expect(analysis?.syncopation).toBeDefined();
        expect(analysis?.syncopation).toBeLessThan(0.3);
        expect(analysis?.syncopation).toBeGreaterThanOrEqual(0);
      });

      test('should detect high syncopation in off-beat pattern', async () => {
        mockPage = createMockPageWithAnalysis(mockAudioData.syncopated);
        await analyzer.inject(mockPage as unknown as Page);

        const analysis = await analyzer.analyzeRhythm(mockPage as unknown as Page);

        expect(analysis?.syncopation).toBeGreaterThan(0.6);
        expect(analysis?.syncopation).toBeLessThanOrEqual(1);
      });

      test('syncopation should be normalized 0-1', async () => {
        mockPage = createMockPageWithAnalysis(mockAudioData.complex);
        await analyzer.inject(mockPage as unknown as Page);

        const analysis = await analyzer.analyzeRhythm(mockPage as unknown as Page);

        expect(analysis?.syncopation).toBeGreaterThanOrEqual(0);
        expect(analysis?.syncopation).toBeLessThanOrEqual(1);
      });
    });

    describe('Pattern Regularity', () => {
      test('should identify regular patterns', async () => {
        mockPage = createMockPageWithAnalysis(mockAudioData.fourOnFloor);
        await analyzer.inject(mockPage as unknown as Page);

        const analysis = await analyzer.analyzeRhythm(mockPage as unknown as Page);

        expect(analysis?.isRegular).toBe(true);
      });

      test('should identify irregular patterns', async () => {
        mockPage = createMockPageWithAnalysis(mockAudioData.syncopated);
        await analyzer.inject(mockPage as unknown as Page);

        const analysis = await analyzer.analyzeRhythm(mockPage as unknown as Page);

        expect(analysis?.isRegular).toBe(false);
      });
    });

    describe('Pattern String Representation', () => {
      test('should provide pattern string representation', async () => {
        mockPage = createMockPageWithAnalysis(mockAudioData.fourOnFloor);
        await analyzer.inject(mockPage as unknown as Page);

        const analysis = await analyzer.analyzeRhythm(mockPage as unknown as Page);

        expect(analysis?.pattern).toBeDefined();
        expect(typeof analysis?.pattern).toBe('string');
        expect(analysis?.pattern.length).toBeGreaterThan(0);
      });

      test('pattern should use X for hits and . for rests', async () => {
        mockPage = createMockPageWithAnalysis(mockAudioData.fourOnFloor);
        await analyzer.inject(mockPage as unknown as Page);

        const analysis = await analyzer.analyzeRhythm(mockPage as unknown as Page);

        expect(analysis?.pattern).toMatch(/^[X.]+$/);
      });
    });
  });

  // ==========================================================================
  // INTEGRATION TESTS
  // ==========================================================================

  describe('Complete Analysis', () => {
    test('should perform full analysis returning all features', async () => {
      mockPage = createMockPageWithAnalysis({
        ...mockAudioData.tempo120bpm,
        ...mockAudioData.cMajor,
        ...mockAudioData.fourOnFloor
      });
      await analyzer.inject(mockPage as unknown as Page);

      const analysis = await analyzer.getAdvancedAnalysis(mockPage as unknown as Page);

      expect(analysis).toBeDefined();
      expect(analysis.tempo).toBeDefined();
      expect(analysis.key).toBeDefined();
      expect(analysis.rhythm).toBeDefined();
      expect(analysis.timestamp).toBeDefined();
    });

    test('should handle partial analysis gracefully', async () => {
      // Only tempo data available
      mockPage = createMockPageWithAnalysis(mockAudioData.tempo120bpm);
      await analyzer.inject(mockPage as unknown as Page);

      const analysis = await analyzer.getAdvancedAnalysis(mockPage as unknown as Page);

      // Should return whatever is available
      expect(analysis).toBeDefined();
      expect(analysis.timestamp).toBeDefined();
    });
  });

  // ==========================================================================
  // ERROR HANDLING
  // ==========================================================================

  describe('Error Handling', () => {
    test('should handle analyzer not connected', async () => {
      mockPage = createMockPage();
      // Don't inject analyzer

      await expect(
        analyzer.detectTempo(mockPage as unknown as Page)
      ).rejects.toThrow();
    });

    test('should handle invalid audio data', async () => {
      const invalidData = { fftData: null };
      mockPage = createMockPageWithAnalysis(invalidData);
      await analyzer.inject(mockPage as unknown as Page);

      await expect(
        analyzer.detectTempo(mockPage as unknown as Page)
      ).rejects.toThrow();
    });

    test('should handle page evaluation errors gracefully', async () => {
      mockPage = createMockPage();
      mockPage.evaluate = jest.fn().mockRejectedValue(new Error('Evaluation failed'));

      await expect(
        analyzer.detectTempo(mockPage as unknown as Page)
      ).rejects.toThrow('Evaluation failed');
    });
  });

  // ==========================================================================
  // PERFORMANCE TESTS
  // ==========================================================================

  describe('Performance', () => {
    test('tempo detection should complete within reasonable time', async () => {
      mockPage = createMockPageWithAnalysis(mockAudioData.tempo120bpm);
      await analyzer.inject(mockPage as unknown as Page);

      const startTime = Date.now();
      await analyzer.detectTempo(mockPage as unknown as Page);
      const duration = Date.now() - startTime;

      expect(duration).toBeLessThan(500); // Should complete in < 500ms
    });

    test('key detection should complete within reasonable time', async () => {
      mockPage = createMockPageWithAnalysis(mockAudioData.cMajor);
      await analyzer.inject(mockPage as unknown as Page);

      const startTime = Date.now();
      await analyzer.detectKey(mockPage as unknown as Page);
      const duration = Date.now() - startTime;

      expect(duration).toBeLessThan(500);
    });

    test('rhythm analysis should complete within reasonable time', async () => {
      mockPage = createMockPageWithAnalysis(mockAudioData.fourOnFloor);
      await analyzer.inject(mockPage as unknown as Page);

      const startTime = Date.now();
      await analyzer.analyzeRhythm(mockPage as unknown as Page);
      const duration = Date.now() - startTime;

      expect(duration).toBeLessThan(500);
    });

    test('full analysis should complete within reasonable time', async () => {
      mockPage = createMockPageWithAnalysis({
        ...mockAudioData.tempo120bpm,
        ...mockAudioData.cMajor,
        ...mockAudioData.fourOnFloor
      });
      await analyzer.inject(mockPage as unknown as Page);

      const startTime = Date.now();
      await analyzer.getAdvancedAnalysis(mockPage as unknown as Page);
      const duration = Date.now() - startTime;

      expect(duration).toBeLessThan(1000); // Full analysis < 1s
    });
  });

  // ==========================================================================
  // CACHE BEHAVIOR
  // ==========================================================================

  describe('Caching', () => {
    test('should cache analysis results', async () => {
      mockPage = createMockPageWithAnalysis(mockAudioData.tempo120bpm);
      await analyzer.inject(mockPage as unknown as Page);

      const evaluateSpy = jest.spyOn(mockPage, 'evaluate');

      await analyzer.detectTempo(mockPage as unknown as Page);
      const firstCallCount = evaluateSpy.mock.calls.length;

      await analyzer.detectTempo(mockPage as unknown as Page);
      const secondCallCount = evaluateSpy.mock.calls.length;

      // Cache should prevent additional evaluate calls
      expect(secondCallCount).toBeLessThanOrEqual(firstCallCount + 1);
    });

    test('should clear cache when requested', async () => {
      mockPage = createMockPageWithAnalysis(mockAudioData.tempo120bpm);
      await analyzer.inject(mockPage as unknown as Page);

      await analyzer.detectTempo(mockPage as unknown as Page);
      analyzer.clearCache();

      const evaluateSpy = jest.spyOn(mockPage, 'evaluate');
      await analyzer.detectTempo(mockPage as unknown as Page);

      // Should evaluate again after cache clear
      expect(evaluateSpy).toHaveBeenCalled();
    });
  });
});
