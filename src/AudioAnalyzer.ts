import { Page } from 'playwright';
import {
  TempoAnalysis,
  KeyAnalysis,
  RhythmAnalysis,
  AdvancedAudioAnalysis,
  AudioAnalysisResult,
  AudioAnalysisConfig,
} from './types/AudioAnalysis.js';
import { Logger } from './utils/Logger.js';

const DEFAULT_FFT_SIZE = 1024;
const DEFAULT_SMOOTHING = 0.8;
const MIN_FFT_SIZE = 32;
const MAX_FFT_SIZE = 32768;

/**
 * True if `n` is a power of two within the Web Audio AnalyserNode range
 * (32-32768). Web Audio rejects anything else with an InvalidStateError.
 */
function isValidFftSize(n: unknown): n is number {
  return (
    typeof n === 'number' &&
    Number.isInteger(n) &&
    n >= MIN_FFT_SIZE &&
    n <= MAX_FFT_SIZE &&
    (n & (n - 1)) === 0
  );
}

export class AudioAnalyzer {
  private _analysisCache: AudioAnalysisResult | null = null;
  private _cacheTimestamp: number = 0;
  private readonly ANALYSIS_CACHE_TTL = 50; // milliseconds

  // Advanced analysis tracking
  private _onsetHistory: number[] = [];
  private _spectralFluxHistory: number[] = [];
  private _previousMagnitudes: number[] | null = null;
  private _chromaHistory: number[][] = [];
  /**
   * Fixed onset threshold. Retained only as a floor — see
   * `isOnset`, which decides adaptively.
   *
   * As an absolute threshold this was unreachable. Flux is normalized
   * by bin count AND by 255, so 0.3 demands an average jump of +76/255
   * across EVERY bin. A realistic kick transient (low bins 30->240,
   * mids 90->120) measures 0.057 — five times under. Only a
   * silence-to-full-scale transition fired it (#322).
   */
  private readonly ONSET_THRESHOLD = 0.3;
  /**
   * Recent flux values, for the adaptive threshold.
   *
   * Picking a smaller constant would just be a different guess: what
   * counts as a transient depends on the material, and a dense mix has
   * a higher flux floor than a sparse one. So an onset is a local
   * OUTLIER — median plus a multiple of the deviation — which is how
   * onset detection is normally done and which needs no magic number
   * tuned to one corpus.
   */
  private _fluxHistory: number[] = [];
  private readonly FLUX_WINDOW = 32;
  /** Deviations above the median that count as an onset. */
  private readonly ONSET_SENSITIVITY = 2.5;
  /** Flux below this is silence, whatever the local statistics say. */
  private readonly FLUX_NOISE_FLOOR = 0.004;
  private readonly MAX_HISTORY_LENGTH = 100;

  // Per-instance analyser config (wired through from config.audio_analysis
  // in config.json). #195.
  private readonly fftSize: number;
  private readonly smoothing: number;

  // Pitch classes for key detection
  private readonly PITCH_CLASSES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

  // Krumhansl-Schmuckler scale profiles
  private readonly SCALE_PROFILES: Record<string, number[]> = {
    major: [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88],
    minor: [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17],
    dorian: [6.0, 2.5, 3.5, 5.0, 4.0, 4.0, 2.5, 5.0, 3.5, 2.5, 3.5, 3.0],
    phrygian: [6.0, 3.0, 2.5, 5.0, 4.0, 3.0, 2.5, 5.0, 3.5, 2.5, 4.0, 3.0],
    lydian: [6.0, 2.5, 3.5, 2.5, 5.0, 4.0, 3.5, 5.0, 2.5, 3.5, 2.5, 3.0],
    mixolydian: [6.0, 2.5, 3.5, 2.5, 4.5, 4.0, 2.5, 5.0, 3.5, 2.5, 3.5, 3.0],
    locrian: [6.0, 3.0, 2.5, 4.0, 3.0, 3.0, 3.5, 4.0, 3.0, 3.5, 4.0, 2.5]
  }

  /**
   * @param options.fftSize - power of 2 in [32, 32768]. Default 1024.
   * @param options.smoothing - value in [0, 1]. Default 0.8.
   *
   * Invalid values fall back to defaults with a warning rather than
   * throwing; bad config in `config.json` shouldn't crash the server.
   */
  constructor(options?: AudioAnalysisConfig) {
    const logger = new Logger();

    if (options?.fftSize !== undefined && !isValidFftSize(options.fftSize)) {
      logger.warn(
        `AudioAnalyzer: invalid fftSize ${String(options.fftSize)} — must be a power of 2 in [${MIN_FFT_SIZE}, ${MAX_FFT_SIZE}]. Falling back to ${DEFAULT_FFT_SIZE}.`,
      );
      this.fftSize = DEFAULT_FFT_SIZE;
    } else {
      this.fftSize = options?.fftSize ?? DEFAULT_FFT_SIZE;
    }

    if (
      options?.smoothing !== undefined &&
      (typeof options.smoothing !== 'number' ||
        Number.isNaN(options.smoothing) ||
        options.smoothing < 0 ||
        options.smoothing > 1)
    ) {
      logger.warn(
        `AudioAnalyzer: invalid smoothing ${String(options.smoothing)} — must be in [0, 1]. Falling back to ${DEFAULT_SMOOTHING}.`,
      );
      this.smoothing = DEFAULT_SMOOTHING;
    } else {
      this.smoothing = options?.smoothing ?? DEFAULT_SMOOTHING;
    }
  }

  /** Configured FFT size (read-only). Test/debug helper. */
  getFftSize(): number {
    return this.fftSize;
  }

  /** Configured smoothing constant (read-only). Test/debug helper. */
  getSmoothing(): number {
    return this.smoothing;
  }

  /**
   * Injects audio analysis code into the Strudel page
   * @param page - Playwright page instance to inject into
   */
  async inject(page: Page) {
    const cfg = { fftSize: this.fftSize, smoothing: this.smoothing };
    /* istanbul ignore next -- browser-injected IIFE, covered by integration tests */
    await page.evaluate(/* istanbul ignore next */ (cfg: { fftSize: number; smoothing: number }) => {
      (window as any).strudelAudioAnalyzer = {
        analyser: null as AnalyserNode | null,
        dataArray: null as Uint8Array | null,
        isConnected: false,
        lastAnalysis: null as {
          connected: boolean;
          timestamp?: number;
          features?: any;
          error?: string;
        } | null,
        lastAnalysisTime: 0,
        /**
         * Real hardware sample rate, read from the AudioContext.
         *
         * 44100 was assumed throughout, and 22050 was hardcoded as the
         * Nyquist. The AudioContext rate follows the hardware and is
         * commonly 48000 (typical on Linux/Chrome), where every reported
         * frequency came out 8.8% low — 1.47 semitones, enough to label
         * a real C as B or A# (#321/#323).
         */
        sampleRate: 44100,

        connect() {
          const originalGainConnect = GainNode.prototype.connect as any;
          let intercepted = false;

          (GainNode.prototype as any).connect = function(this: GainNode, ...args: any[]) {
            if (!intercepted && args[0] && args[0].context) {
              intercepted = true;

              const ctx = args[0].context as AudioContext;
              (window as any).strudelAudioAnalyzer.sampleRate = ctx.sampleRate;
              (window as any).strudelAudioAnalyzer.analyser = ctx.createAnalyser();
              // Configurable via config.audio_analysis in config.json (#195).
              (window as any).strudelAudioAnalyzer.analyser.fftSize = cfg.fftSize;
              (window as any).strudelAudioAnalyzer.analyser.smoothingTimeConstant = cfg.smoothing;
              (window as any).strudelAudioAnalyzer.dataArray = new Uint8Array(
                (window as any).strudelAudioAnalyzer.analyser.frequencyBinCount
              );

              const result = originalGainConnect.apply(this, args);
              originalGainConnect.call(this, (window as any).strudelAudioAnalyzer.analyser);
              (window as any).strudelAudioAnalyzer.isConnected = true;

              return result;
            }
            return originalGainConnect.apply(this, args);
          };
        },
        
        analyze() {
          if (!this.analyser || !this.isConnected) {
            return {
              connected: false,
              error: 'Analyzer not connected'
            };
          }

          // Cache-based throttling
          const now = Date.now();
          if (this.lastAnalysis && (now - this.lastAnalysisTime) < 50) {
            return this.lastAnalysis;
          }

          this.analyser.getByteFrequencyData(this.dataArray);

          // Optimized analysis using typed array operations
          const dataArray = this.dataArray;
          const length = dataArray.length;

          // Frequency-band boundaries scaled to the actual `length`.
          // Reference values are bin indices that worked at fftSize=1024
          // (length=512): bass<4, lowMid<16, mid<64, highMid<128,
          // treble<256. Scaling by `length / 512` keeps each band over
          // the same Hz range when fftSize changes (#195).
          const scale = length / 512;
          const bassEnd = Math.max(1, Math.round(4 * scale));
          const lowMidEnd = Math.max(bassEnd + 1, Math.round(16 * scale));
          const midEnd = Math.max(lowMidEnd + 1, Math.round(64 * scale));
          const highMidEnd = Math.max(midEnd + 1, Math.round(128 * scale));
          const trebleEnd = Math.max(highMidEnd + 1, Math.round(256 * scale));

          // Single-pass computation for better performance
          let sum = 0;
          let peak = 0;
          let peakIndex = 0;
          let weightedSum = 0;

          // Frequency band accumulators
          let bassSum = 0, lowMidSum = 0, midSum = 0, highMidSum = 0, trebleSum = 0;

          for (let i = 0; i < length; i++) {
            const value = dataArray[i];
            sum += value;
            weightedSum += i * value;

            if (value > peak) {
              peak = value;
              peakIndex = i;
            }

            // Frequency-band boundaries are derived from the bin indices
            // that worked well at fftSize=1024 (length=512): 4, 16, 64,
            // 128, 256. Scaling by `length / 512` preserves the Hz-range
            // each band covers when fftSize changes (#195).
            if (i < bassEnd) bassSum += value;
            else if (i < lowMidEnd) lowMidSum += value;
            else if (i < midEnd) midSum += value;
            else if (i < highMidEnd) highMidSum += value;
            else if (i < trebleEnd) trebleSum += value;
          }

          const average = sum / length;
          // Hz per bin. `weightedSum` accumulates `i * value`, so the
          // raw centroid is a BIN INDEX; comparing it against Hz-scale
          // thresholds made "bright" need bin 500 of 512, i.e. 21.5 kHz
          // out of a 22 kHz maximum — unreachable — and made the answer
          // depend on fftSize (#323).
          const nyquist = (this.sampleRate as number) / 2;
          const hzPerBin = nyquist / length;
          const centroidBin = sum > 0 ? weightedSum / sum : 0;
          const centroid = centroidBin * hzPerBin;
          const peakFreq = peakIndex * hzPerBin;

          const bass = bassSum / Math.max(1, bassEnd);
          const lowMid = lowMidSum / Math.max(1, lowMidEnd - bassEnd);
          const mid = midSum / Math.max(1, midEnd - lowMidEnd);
          const highMid = highMidSum / Math.max(1, highMidEnd - midEnd);
          const treble = trebleSum / Math.max(1, trebleEnd - highMidEnd);

          const result = {
            connected: true,
            timestamp: now,
            features: {
              average: Math.round(average * 10) / 10,
              peak,
              peakFrequency: Math.round(peakFreq),
              centroid: Math.round(centroid * 10) / 10,

              bass: Math.round(bass),
              lowMid: Math.round(lowMid),
              mid: Math.round(mid),
              highMid: Math.round(highMid),
              treble: Math.round(treble),

              isPlaying: average > 5,
              isSilent: average < 1,

              bassToTrebleRatio: treble > 0 ? (bass / treble).toFixed(2) : 'N/A',
              // Hz now, and reachable. Roughly: mostly-bass content
              // sits under 1.5 kHz, a full mix lands 1.5-4 kHz, and
              // hat/cymbal-dominated material runs above.
              brightness: centroid > 4000 ? 'bright' : centroid > 1500 ? 'balanced' : 'dark'
            }
          };

          // Cache result
          this.lastAnalysis = result;
          this.lastAnalysisTime = now;

          return result;
        }
      };
      
      (window as any).strudelAudioAnalyzer.connect();
    }, cfg);
  }

  /**
   * Retrieves audio analysis data from the page
   * @param page - Playwright page instance to analyze
   * @returns Audio analysis features including frequency bands and characteristics
   */
  async getAnalysis(page: Page): Promise<AudioAnalysisResult> {
    // Client-side caching with local fallback
    const now = Date.now();
    if (this._analysisCache && (now - this._cacheTimestamp) < this.ANALYSIS_CACHE_TTL) {
      return this._analysisCache;
    }

    const result = await page.evaluate(/* istanbul ignore next */ () => {
      const analyzer = (window as any).strudelAudioAnalyzer;
      if (!analyzer) {
        return {
          connected: false,
          error: 'Analyzer not initialized. Audio context may not have started yet.',
          hint: 'Try playing a pattern first to initialize the audio context.'
        };
      }

      if (!analyzer.isConnected) {
        return {
          connected: false,
          error: 'Analyzer not connected to audio output.',
          hint: 'Play a pattern to connect the analyzer to Strudel audio output.'
        };
      }

      const analysis = analyzer.analyze();

      // Add diagnostic info if no audio detected
      if (analysis.features && analysis.features.isSilent) {
        analysis.hint = 'Audio analyzer connected but no audio detected. Ensure pattern is playing.';
      }

      return analysis;
    });

    // Update cache
    this._analysisCache = result;
    this._cacheTimestamp = now;

    return result;
  }

  /**
   * Clears the analysis cache
   */
  clearCache() {
    this._analysisCache = null;
    this._cacheTimestamp = 0;
  }

  // ============================================================================
  // HELPER METHODS
  // ============================================================================

  /**
   * Calculate spectral flux (rate of change in frequency spectrum)
   */
  /**
   * Whether a flux value is an onset, judged against recent history.
   *
   * @param flux - Current spectral flux, 0-1
   * @returns True if this is a local outlier and above the noise floor
   * @example
   * // A steady 0.05 background with a 0.2 spike: only the spike fires.
   */
  isOnset(flux: number): boolean {
    const history = this._fluxHistory;
    history.push(flux);
    if (history.length > this.FLUX_WINDOW) history.shift();

    // Below the noise floor is silence regardless of what the window
    // says — otherwise a completely quiet passage generates onsets from
    // its own rounding.
    if (flux < this.FLUX_NOISE_FLOOR) return false;

    // Not enough history yet: fall back to the fixed threshold rather
    // than firing on the first sample of anything.
    if (history.length < 8) return flux > this.ONSET_THRESHOLD;

    const sorted = [...history].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    // Median absolute deviation — robust to the very spikes we are
    // looking for, unlike a standard deviation.
    const deviations = sorted.map(v => Math.abs(v - median)).sort((a, b) => a - b);
    const mad = deviations[Math.floor(deviations.length / 2)];

    // A perfectly steady signal has mad 0; require a real rise over the
    // median rather than dividing by zero.
    const threshold = mad > 0
      ? median + this.ONSET_SENSITIVITY * mad
      : median * 1.5 + this.FLUX_NOISE_FLOOR;

    return flux > threshold;
  }

  /** Clears the flux window, so a new capture does not inherit one. */
  resetOnsetDetection(): void {
    this._fluxHistory = [];
    this._previousMagnitudes = null;
  }

  private calculateSpectralFlux(currentMagnitudes: Uint8Array): number {
    if (!this._previousMagnitudes) {
      this._previousMagnitudes = Array.from(currentMagnitudes);
      return 0;
    }

    let flux = 0;
    for (let i = 0; i < currentMagnitudes.length; i++) {
      const diff = currentMagnitudes[i] - this._previousMagnitudes[i];
      flux += Math.max(0, diff); // Only positive differences (increase in energy)
    }

    this._previousMagnitudes = Array.from(currentMagnitudes);
    return flux / currentMagnitudes.length / 255; // Normalize to 0-1
  }

  /**
   * Perform autocorrelation on a signal
   */
  private autocorrelate(signal: number[]): number[] {
    const n = signal.length;
    const autocorr: number[] = [];

    for (let lag = 0; lag < n / 2; lag++) {
      let sum = 0;
      for (let i = 0; i < n - lag; i++) {
        sum += signal[i] * signal[i + lag];
      }
      autocorr[lag] = sum / (n - lag);
    }

    return autocorr;
  }

  /**
   * Extract chroma features (12-dimensional pitch class profile) from FFT data
   */
  extractChroma(fftData: Uint8Array, sampleRate: number = 44100): number[] {
    const chroma = new Array(12).fill(0);
    // How many FFT bins landed in each pitch class. Linear-frequency
    // bins do not divide evenly among twelve logarithmic pitch classes:
    // at fftSize=1024 only 92 of 512 bins fall inside 20-4000 Hz, and
    // they are distributed 4 to 12 per class — A gets 12, C# and D# get
    // 4. Summing raw magnitudes therefore made the classes with more
    // bins louder no matter what the audio was, and flat white noise
    // detected as F major with confidence 0.849 (#321).
    const binCounts = new Array(12).fill(0);
    const fftSize = fftData.length;

    for (let i = 0; i < fftSize; i++) {
      const freq = (i / fftSize) * (sampleRate / 2);
      if (freq < 20 || freq > 4000) continue; // Focus on musical range

      const pitchClass = this.frequencyToPitchClass(freq);
      chroma[pitchClass] += fftData[i];
      binCounts[pitchClass]++;
    }

    // Mean magnitude per class, not total. This is the whole fix: a
    // class with 12 bins is now compared on equal terms with one that
    // has 4.
    for (let pc = 0; pc < 12; pc++) {
      if (binCounts[pc] > 0) chroma[pc] /= binCounts[pc];
    }

    // Normalize
    const sum = chroma.reduce((a, b) => a + b, 0);
    return sum > 0 ? chroma.map(v => v / sum) : chroma;
  }

  /**
   * Convert frequency to pitch class (0-11, where 0=C, 1=C#, etc.)
   */
  private frequencyToPitchClass(freq: number): number {
    const midiNote = 12 * Math.log2(freq / 440) + 69;
    return Math.round(midiNote) % 12;
  }

  /**
   * Calculate Pearson correlation coefficient
   */
  private pearsonCorrelation(x: number[], y: number[]): number {
    const n = x.length;
    const meanX = x.reduce((a, b) => a + b, 0) / n;
    const meanY = y.reduce((a, b) => a + b, 0) / n;

    let numerator = 0;
    let denomX = 0;
    let denomY = 0;

    for (let i = 0; i < n; i++) {
      const dx = x[i] - meanX;
      const dy = y[i] - meanY;
      numerator += dx * dy;
      denomX += dx * dx;
      denomY += dy * dy;
    }

    const denom = Math.sqrt(denomX * denomY);
    return denom === 0 ? 0 : numerator / denom;
  }

  /**
   * Calculate cosine similarity between two vectors
   */
  private cosineSimilarity(x: number[], y: number[]): number {
    let dotProduct = 0;
    let magX = 0;
    let magY = 0;

    for (let i = 0; i < x.length; i++) {
      dotProduct += x[i] * y[i];
      magX += x[i] * x[i];
      magY += y[i] * y[i];
    }

    const magnitude = Math.sqrt(magX * magY);
    return magnitude === 0 ? 0 : dotProduct / magnitude;
  }

  /**
   * Rotate a profile array by a given number of steps
   * For tonic N, rotate the profile so that position N gets the tonic weight
   */
  private rotateProfile(profile: number[], steps: number): number[] {
    const rotated = new Array(12);
    for (let i = 0; i < 12; i++) {
      rotated[i] = profile[(i - steps + 12) % 12];
    }
    return rotated;
  }

  /**
   * Calculate intervals between consecutive values
   */
  private calculateIntervals(values: number[]): number[] {
    const intervals: number[] = [];
    for (let i = 1; i < values.length; i++) {
      intervals.push(values[i] - values[i - 1]);
    }
    return intervals;
  }

  /**
   * Calculate variance of a dataset
   */
  private calculateVariance(values: number[], mean?: number): number {
    const m = mean !== undefined ? mean : values.reduce((a, b) => a + b, 0) / values.length;
    const squaredDiffs = values.map(v => Math.pow(v - m, 2));
    return squaredDiffs.reduce((a, b) => a + b, 0) / values.length;
  }

  /**
   * Find peaks in autocorrelation data
   */
  private findPeaks(autocorr: number[]): number[] {
    const peaks: number[] = [];

    for (let i = 1; i < autocorr.length - 1; i++) {
      if (autocorr[i] > autocorr[i - 1] && autocorr[i] > autocorr[i + 1]) {
        peaks.push(i);
      }
    }

    return peaks;
  }

  // ============================================================================
  // TEMPO DETECTION
  // ============================================================================

  /**
   * Detect tempo (BPM) using autocorrelation and onset detection
   */
  async detectTempo(page: Page): Promise<TempoAnalysis | null> {
    // Get analyzer object from browser
    const analyzer = await page.evaluate(/* istanbul ignore next */ () => {
      return (window as any).strudelAudioAnalyzer;
    });

    if (!analyzer || !analyzer.isConnected) {
      throw new Error('Audio analyzer not connected');
    }

    let onsets: number[];

    // Check if this is a mock with pre-calculated onset times (for testing)
    if (typeof analyzer.analyze === 'function') {
      const analysis = analyzer.analyze();
      if (analysis?.features?.onsetTimes) {
        onsets = analysis.features.onsetTimes;
      } else if (analysis?.features?.fftData === null) {
        // Explicitly null FFT data in test
        throw new Error('Invalid audio data');
      } else {
        // No mock data, use real-time detection
        if (!analyzer.dataArray) {
          throw new Error('Invalid audio data');
        }
        const fftData = new Uint8Array(analyzer.dataArray);
        const flux = this.calculateSpectralFlux(fftData);

        if (this.isOnset(flux)) {
          this._onsetHistory.push(Date.now());
          if (this._onsetHistory.length > this.MAX_HISTORY_LENGTH) {
            this._onsetHistory.shift();
          }
        }

        onsets = [...this._onsetHistory];
      }
    } else {
      // No analyze function, use real-time detection
      if (!analyzer.dataArray) {
        throw new Error('Invalid audio data');
      }
      const fftData = new Uint8Array(analyzer.dataArray);
      const flux = this.calculateSpectralFlux(fftData);

      if (this.isOnset(flux)) {
        this._onsetHistory.push(Date.now());
        if (this._onsetHistory.length > this.MAX_HISTORY_LENGTH) {
          this._onsetHistory.shift();
        }
      }

      onsets = [...this._onsetHistory];
    }

    // Need at least 4 onsets for reliable tempo detection
    if (onsets.length < 4) {
      return { bpm: 0, confidence: 0, method: 'onset' };
    }

    // Calculate inter-onset intervals (IOIs)
    const intervals = this.calculateIntervals(onsets);

    // Median, not mean.
    //
    // A single dropped or ghosted onset moved the answer badly: a steady
    // 120 BPM grid with one missed onset reported 105, and with one
    // extra reported 135. The median is unmoved by either, and onset
    // detection misses and doubles constantly (#322).
    const sorted = [...intervals].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    const medianInterval = sorted.length % 2 === 0
      ? (sorted[mid - 1] + sorted[mid]) / 2
      : sorted[mid];

    if (medianInterval <= 0) {
      return { bpm: 0, confidence: 0, method: 'onset' };
    }

    const rawBpm = 60000 / medianInterval;
    const bpm = AudioAnalyzer.foldIntoTempoRange(rawBpm);

    // Unfoldable — more than a few octaves outside the range, so the
    // onsets are not a tempo at all.
    if (bpm === null) {
      return { bpm: 0, confidence: 0, method: 'onset' };
    }

    // Confidence still comes from interval consistency, but measured
    // against the median so one outlier does not inflate the spread it
    // is being compared to.
    const variance = this.calculateVariance(intervals, medianInterval);
    const coefficientOfVariation = Math.sqrt(variance) / medianInterval;
    // More aggressive penalty for variation
    let confidence = Math.max(0, 1 - coefficientOfVariation * 1.5);

    // A folded reading is a weaker claim than a direct one: we inferred
    // the beat is half or double what the onsets literally say.
    if (Math.abs(rawBpm - bpm) > 1) {
      confidence *= 0.8;
    }

    return {
      bpm: Math.round(bpm),
      confidence: Math.min(1, confidence),
      method: 'onset'
    };
  }

  /**
   * Halves or doubles a tempo until it lands in the musical range.
   *
   * Out-of-range readings used to be discarded outright, which threw
   * away recoverable answers: 174 BPM drum & bass with onsets on 8ths
   * reads as 348 and returned bpm 0, on 16ths as 696 and returned 0,
   * and a 70 BPM tune whose onsets land on half notes reads as 35 and
   * returned 0. Onset detection lands on whatever subdivision is
   * loudest, so this is the common case, not the edge case (#322).
   *
   * @param bpm - Raw tempo from the median inter-onset interval
   * @returns A tempo within [40, 200], or null if it cannot be folded there
   * @example
   * AudioAnalyzer.foldIntoTempoRange(348); // 174
   * AudioAnalyzer.foldIntoTempoRange(35);  // 70
   */
  static foldIntoTempoRange(bpm: number): number | null {
    if (!Number.isFinite(bpm) || bpm <= 0) return null;

    const MIN = 40;
    const MAX = 200;
    let folded = bpm;

    // Three octaves each way. That covers every real case — onsets on
    // 8ths is one octave, on 16ths is two — while refusing to invent a
    // tempo from noise: 5000 BPM means onsets 12ms apart, and folding
    // that five times to a plausible-looking 156 would be a fabrication,
    // not a measurement.
    const MAX_OCTAVES = 3;
    for (let i = 0; i < MAX_OCTAVES && folded > MAX; i++) folded /= 2;
    for (let i = 0; i < MAX_OCTAVES && folded < MIN; i++) folded *= 2;

    return folded >= MIN && folded <= MAX ? folded : null;
  }

  // ============================================================================
  // KEY DETECTION
  // ============================================================================

  /**
   * Detect musical key using Krumhansl-Schmuckler algorithm
   */
  async detectKey(page: Page): Promise<KeyAnalysis | null> {
    // Get analyzer object from browser
    const analyzer = await page.evaluate(/* istanbul ignore next */ () => {
      return (window as any).strudelAudioAnalyzer;
    });

    if (!analyzer || !analyzer.isConnected) {
      throw new Error('Audio analyzer not connected');
    }

    let chroma: number[];

    // Check if this is a mock with pre-calculated chroma vector (for testing)
    if (typeof analyzer.analyze === 'function') {
      const analysis = analyzer.analyze();
      if (analysis?.features?.chromaVector) {
        chroma = analysis.features.chromaVector;
      } else {
        // No mock data, extract from FFT
        if (!analyzer.dataArray) {
          throw new Error('Invalid audio data');
        }
        const fftData = new Uint8Array(analyzer.dataArray);
        chroma = this.extractChroma(fftData, analyzer.sampleRate ?? 44100);
      }
    } else {
      // No analyze function, extract from FFT
      if (!analyzer.dataArray) {
        throw new Error('Invalid audio data');
      }
      const fftData = new Uint8Array(analyzer.dataArray);
      // The rate the AudioContext actually reported, captured at
      // connect time. 44100 was assumed; the real rate is commonly
      // 48000, where every frequency came out 8.8% low — 1.47
      // semitones, enough to put a note in the wrong pitch class (#321).
      chroma = this.extractChroma(fftData, analyzer.sampleRate ?? 44100);
    }

    // Check for sufficient energy
    const totalEnergy = chroma.reduce((sum, val) => sum + val, 0);
    if (totalEnergy < 0.1) {
      return { key: 'C', scale: 'major', confidence: 0.1 };
    }

    return this.detectKeyFromChroma(chroma);
  }


  /**
   * Scores a chroma vector against every key/scale profile.
   *
   * Extracted from `detectKey` so it can be tested at all. The scoring
   * used to be inline in a method that needs a live Playwright page, so
   * nothing could feed it a known chroma and check the answer — which
   * is how it came to return "dorian" for all twelve canonical minor
   * profiles without anyone noticing (#320).
   *
   * @param chroma - 12-element pitch class profile, any scale
   * @returns Best key/scale with confidence and alternatives
   * @example
   * analyzer.detectKeyFromChroma(KRUMHANSL_MINOR); // C minor
   */
  detectKeyFromChroma(chroma: number[]): KeyAnalysis {
    // Correlate with all key/scale combinations
    const scores: Array<{ key: string; scale: string; score: number }> = [];

    for (const scale of Object.keys(this.SCALE_PROFILES)) {
      // Normalize profile to sum to 1
      // Key comes from Object.keys(this.SCALE_PROFILES) directly above,
      // so it is always an own property; hasOwn keeps it that way if the
      // loop is ever rewritten (#318).
      const rawProfile = Object.hasOwn(this.SCALE_PROFILES, scale)
        ? this.SCALE_PROFILES[scale]
        : undefined;
      if (!rawProfile) continue;
      const profileSum = rawProfile.reduce((a, b) => a + b, 0);
      const profile = rawProfile.map(v => v / profileSum);

      for (let tonic = 0; tonic < 12; tonic++) {
        // Rotate chroma to align with profile
        // Put the tonic at position 0 to match the profile structure
        const rotatedChroma = new Array(12);
        for (let i = 0; i < 12; i++) {
          rotatedChroma[i] = chroma[(i + tonic) % 12];
        }

        // Pearson, which is what Krumhansl-Schmuckler is defined with.
        //
        // Cosine was used instead, and `pearsonCorrelation` sat right
        // beside it, implemented and unit-tested and never called.
        // Cosine is not mean-centered, so all 24 scores bunch near 1:
        // for a C-major input the full range was 0.804-1.000, a spread
        // of 0.196, where Pearson gives -0.683-1.000. The top-1-vs-top-2
        // gap under cosine was 0.0048 — smaller than the mode boosts
        // below, which is how those boosts came to decide every
        // answer (#320).
        const correlation = this.pearsonCorrelation(rotatedChroma, profile);

        scores.push({
          key: this.PITCH_CLASSES[tonic],
          scale,
          score: correlation
        });
      }
    }

    // Find the top 3 loudest pitch classes - any could be the tonic
    const chromaWithIndices = chroma.map((v, i) => ({ value: v, index: i }));
    chromaWithIndices.sort((a, b) => b.value - a.value);
    const topPitches = chromaWithIndices.slice(0, 3).map(x => this.PITCH_CLASSES[x.index]);

    // The mode boosts are gone.
    //
    // `dorian *= 1.015` was larger than the margin cosine left between
    // minor and dorian (0.0078), so it flipped EVERY minor key: fed the
    // exact canonical K-S minor profile for all 12 minor keys, detection
    // answered "dorian" 12 out of 12 — right tonic, wrong mode, every
    // time. A thumb on the scale heavier than the scale itself is not a
    // tie-breaker, it is the decision (#320).
    //
    // The tonic boost stays, reduced and applied only to the single
    // loudest pitch class rather than the top three (boosting all three
    // by the same 1.075 meant it discriminated nothing between them).
    // Pearson's spread is wide enough that a nudge this size can only
    // break a genuine near-tie.
    const TONIC_NUDGE = 1.02;
    for (const s of scores) {
      if (s.key === topPitches[0]) {
        s.score *= TONIC_NUDGE;
      }
    }

    // Sort by score (after applying biases)
    scores.sort((a, b) => b.score - a.score);

    const best = scores[0];
    const secondBest = scores[1];

    // Confidence is about discrimination, not similarity.
    //
    // It used to be 0.75 * the raw cosine score, which is >= 0.9 for
    // essentially any non-negative chroma — a flat, zero-information
    // input returned confidence 0.787. Pearson on a flat chroma is 0
    // (no correlation with anything), so `strength` now collapses on
    // exactly the inputs that carry no information, and `separation`
    // asks whether the winner actually beat the runner-up.
    const STRENGTH_WEIGHT = 0.6;
    const SEPARATION_WEIGHT = 0.4;
    const strength = Math.max(0, best.score);
    const separation = Math.min(1, Math.max(0, (best.score - secondBest.score) * 5));
    const confidence = Math.min(
      1,
      Math.max(0, strength * STRENGTH_WEIGHT + separation * SEPARATION_WEIGHT),
    );

    return {
      key: best.key,
      scale: best.scale as any,
      confidence,
      // Alternatives are scored the same WAY as the headline, not just
      // clamped to the same range. Reporting their raw correlation put
      // them on a different scale entirely — an A-minor input answered
      // with confidence 0.801 while listing "A dorian 0.926" beneath
      // it, an alternative apparently more confident than the answer.
      // A non-winner earns no separation term, by definition: it did
      // not separate from anything (#320).
      alternatives: scores.slice(1, 4).map(s => ({
        key: s.key,
        scale: s.scale,
        confidence: Math.min(1, Math.max(0, s.score) * STRENGTH_WEIGHT)
      }))
    };
  }

  // ============================================================================
  // RHYTHM ANALYSIS
  // ============================================================================

  /**
   * Analyze rhythm pattern complexity, density, and syncopation
   */
  async analyzeRhythm(page: Page): Promise<RhythmAnalysis> {
    // Get analyzer object from browser
    const analyzer = await page.evaluate(/* istanbul ignore next */ () => {
      return (window as any).strudelAudioAnalyzer;
    });

    if (!analyzer || !analyzer.isConnected) {
      return {
        pattern: 'X...',
        complexity: 0,
        density: 0,
        syncopation: 0,
        onsets: [],
        isRegular: true
      };
    }

    let onsets: number[];

    // Check if this is a mock with pre-calculated onset times (for testing)
    if (typeof analyzer.analyze === 'function') {
      const analysis = analyzer.analyze();
      if (analysis?.features?.onsets) {
        onsets = analysis.features.onsets;
      } else if (analysis?.features?.onsetTimes) {
        onsets = analysis.features.onsetTimes;
      } else {
        // No mock data, use real-time detection
        const fftData = new Uint8Array(analyzer.dataArray);
        const flux = this.calculateSpectralFlux(fftData);

        if (this.isOnset(flux)) {
          this._onsetHistory.push(Date.now());
          if (this._onsetHistory.length > this.MAX_HISTORY_LENGTH) {
            this._onsetHistory.shift();
          }
        }

        onsets = [...this._onsetHistory];
      }
    } else {
      // No analyze function, use real-time detection
      const fftData = new Uint8Array(analyzer.dataArray);
      const flux = this.calculateSpectralFlux(fftData);

      if (this.isOnset(flux)) {
        this._onsetHistory.push(Date.now());
        if (this._onsetHistory.length > this.MAX_HISTORY_LENGTH) {
          this._onsetHistory.shift();
        }
      }

      onsets = [...this._onsetHistory];
    }

    // Need at least 2 onsets for rhythm analysis
    if (onsets.length < 2) {
      return {
        pattern: 'X...',
        complexity: 0,
        density: 0,
        syncopation: 0,
        onsets: [],
        isRegular: true
      };
    }

    // Calculate intervals
    const intervals = this.calculateIntervals(onsets);

    // Calculate density (events per second)
    const duration = (onsets[onsets.length - 1] - onsets[0]) / 1000;
    const density = duration > 0 ? (onsets.length - 1) / duration : 0;

    // Calculate complexity from interval variance
    const meanInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    const variance = this.calculateVariance(intervals, meanInterval);
    const coefficientOfVariation = Math.sqrt(variance) / meanInterval;

    // Analyze subdivisions
    const subdivisionScore = this.analyzeSubdivisions(intervals);

    // Combine variance and subdivision complexity with higher sensitivity
    const varianceComponent = Math.min(1, coefficientOfVariation * 5);
    const complexity = Math.min(1, varianceComponent * 0.8 + subdivisionScore * 0.2);

    // Calculate syncopation (off-beat events)
    const syncopation = this.detectSyncopation(onsets, meanInterval);

    // Determine regularity
    const isRegular = coefficientOfVariation < 0.2;

    // Generate pattern string
    const pattern = this.generatePatternString(onsets, meanInterval);

    return {
      pattern,
      complexity,
      density,
      syncopation,
      onsets,
      isRegular
    };
  }

  /**
   * Analyze subdivision complexity
   */
  private analyzeSubdivisions(intervals: number[]): number {
    if (intervals.length === 0) return 0;

    const meanInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;

    // Count how many different subdivision levels are present
    const subdivisions = new Set<number>();

    for (const interval of intervals) {
      const ratio = interval / meanInterval;
      // Quantize to common subdivisions (1, 0.5, 0.25, 0.75, 0.33, etc.)
      const quantized = Math.round(ratio * 8) / 8; // Higher resolution
      subdivisions.add(quantized);
    }

    // More subdivision levels = more complex (more aggressive scaling)
    return Math.min(1, subdivisions.size / 4);
  }

  /**
   * Detect syncopation (off-beat emphasis)
   */
  private detectSyncopation(onsets: number[], meanInterval: number): number {
    if (onsets.length < 4 || meanInterval === 0) return 0;

    let syncopationScore = 0;

    for (let i = 1; i < onsets.length; i++) {
      // Relative to the first onset, not to the Unix epoch.
      // `onsets[i]` is a Date.now() value, so this modulo used to depend
      // on what time of day it was: the same nine onsets 500ms apart
      // scored 0.000 at one epoch offset and 1.000 at another, and a
      // perfectly regular grid reported maximum syncopation roughly
      // three-quarters of the time (#323).
      const elapsed = onsets[i] - onsets[0];
      const phase = (elapsed % (meanInterval * 4)) / meanInterval;

      // Check if onset is on an off-beat (not on 0, 1, 2, 3)
      const nearestBeat = Math.round(phase);
      const beatDistance = Math.abs(phase - nearestBeat);

      // More gradual scoring based on how far from beat
      if (beatDistance > 0.08) {
        // Weight by how far off-beat it is
        syncopationScore += Math.min(1, beatDistance * 4);
      }
    }

    return Math.min(1, syncopationScore / (onsets.length - 1));
  }

  /**
   * Generate a pattern string representation (X for hits, . for rests)
   */
  private generatePatternString(onsets: number[], meanInterval: number): string {
    if (onsets.length === 0) return 'X...';

    const patternLength = 16;
    const pattern = new Array(patternLength).fill('.');

    for (const onset of onsets) {
      // Same epoch bug as detectSyncopation: relative to the first onset.
      const position = Math.round(
        ((onset - onsets[0]) % (meanInterval * patternLength)) / meanInterval,
      );
      if (position < patternLength) {
        pattern[position] = 'X';
      }
    }

    return pattern.join('');
  }

  // ============================================================================
  // ADVANCED ANALYSIS INTEGRATION
  // ============================================================================

  /**
   * Perform complete advanced audio analysis
   */
  async getAdvancedAnalysis(page: Page): Promise<AdvancedAudioAnalysis> {
    const timestamp = Date.now();

    // Run all analyses in parallel for performance
    const [tempo, key, rhythm] = await Promise.all([
      this.detectTempo(page),
      this.detectKey(page),
      this.analyzeRhythm(page)
    ]);

    return {
      tempo: tempo || undefined,
      key: key || undefined,
      rhythm,
      timestamp
    };
  }
}