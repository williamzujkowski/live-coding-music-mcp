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

/** A detected onset and how loud the transient that produced it was. */
export interface OnsetObservation {
  t: number;
  strength: number;
}

/**
 * Either shape is accepted.
 *
 * Bare timestamps come from the single-sample fallback path and from
 * every direct test of the interval maths, where there is no flux to
 * report; the weighted form comes from `onsetsFromFlux`. Rather than
 * force one to fake the other, both are read through these two helpers.
 */
export type OnsetInput = readonly number[] | readonly OnsetObservation[];

/** Timestamps, whichever shape was passed. */
export function onsetTimes(onsets: OnsetInput): number[] {
  return onsets.map(onset => (typeof onset === 'number' ? onset : onset.t));
}

/** Strengths, or an empty array when the caller had none to give. */
function onsetStrengths(onsets: OnsetInput): number[] {
  if (onsets.length === 0 || typeof onsets[0] === 'number') return [];
  return (onsets as readonly OnsetObservation[]).map(onset => onset.strength);
}

export class AudioAnalyzer {
  private _analysisCache: AudioAnalysisResult | null = null;
  private _cacheTimestamp: number = 0;
  private readonly ANALYSIS_CACHE_TTL = 50; // milliseconds

  // Advanced analysis tracking
  /**
   * Detected onsets, with the flux that produced each one (#352). Bare
   * timestamps would throw away the only signal that distinguishes a
   * kick from a hi-hat.
   */
  private _onsetHistory: OnsetObservation[] = [];
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

  /**
   * How long after a detected transient further frames are treated as
   * part of it rather than as new onsets.
   *
   * 50ms is below anything musical: 16th notes at 200 BPM are 75ms
   * apart, and 32nds are rare enough that resolving them matters less
   * than not shattering every kick into four.
   */
  static readonly ONSET_REFRACTORY_MS = 50;

  /**
   * How much a candidate's octave relatives count toward its score,
   * relative to the candidate itself.
   *
   * 0.25, measured, not chosen. At 0.5 a 90 BPM shuffle (667ms beat with
   * a 2:1 swing putting a hit at 444ms) read 135, because the swung
   * offbeat gives a spurious relative real correlation. Cross-model
   * review predicted that exact number before I measured it.
   *
   * Enough to break a near-tie the prior would otherwise decide the
   * wrong way; not enough to let a relative carry a candidate.
   */
  private static readonly FAMILY_CORROBORATION = 0.25;

  /**
   * Below this, `detectTempo` reports no tempo instead of a number.
   *
   * A BPM with confidence 0.00 is not a weak measurement, it is the
   * tempo prior's centre with a measurement's face on. Reporting zero
   * lets a caller tell "I could not hear a pulse" from "the pulse is
   * 120", which is the distinction #366 turned on.
   */
  private static readonly MIN_TEMPO_CONFIDENCE = 0.1;

  /**
   * How much of the past a tempo reading may be built from.
   *
   * `MAX_HISTORY_LENGTH` bounds the COUNT, which is not the same thing:
   * 100 onsets can span ten seconds of one pattern or five minutes
   * across four. Age is what matters to a tempo.
   *
   * 12s rather than 6s, measured. A 6s window reads dnb correctly about
   * half the time and then flips (174, 115, 115, 174) and drags trap
   * down to 70 on later polls; 12s gives the same answer every poll for
   * every pattern. The reported failure in #352 was a SPREAD, so
   * stability is the property worth buying — even though it costs the
   * occasional lucky-correct reading a short window produces.
   */
  private static readonly MAX_ONSET_AGE_MS = 12_000;

  /**
   * A gap this large between the newest kept onset and the oldest new
   * one means the audio stopped — a different pattern, a stop/play, or
   * an agent that went away and came back.
   *
   * Measured, this is not theoretical: playing dnb at 174 and then house
   * at 125, the FIRST house reading came back 174. The previous
   * pattern's onsets were still in the history and outnumbered the new
   * ones. Every wrong first reading in that run was the pattern before
   * it (#366).
   */
  private static readonly ONSET_CONTINUITY_GAP_MS = 1_500;

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

        /**
         * Rolling flux samples, timestamped, collected continuously.
         *
         * detectTempo used to sample the spectrum ONCE per call and push
         * at most one onset, and four are needed before a BPM is
         * reported — so the inter-onset intervals were the gaps between
         * TOOL CALLS and the answer was a function of how often the
         * agent polled (#322).
         *
         * The page records raw flux here; the ONSET DECISION stays on
         * the server, so the adaptive detector is not duplicated into a
         * copy that would drift.
         */
        fluxSamples: [] as { t: number; flux: number }[],
        fluxTimer: null as ReturnType<typeof setInterval> | null,
        previousMagnitudes: null as number[] | null,
        MAX_FLUX_SAMPLES: 512,

        /** Starts continuous flux sampling. Idempotent. */
        startFluxTracking(intervalMs: number) {
          if (this.fluxTimer !== null) return;
          this.fluxTimer = setInterval(() => {
            if (!this.analyser || !this.dataArray) return;
            this.analyser.getByteFrequencyData(this.dataArray as Uint8Array);
            const current = Array.from(this.dataArray as Uint8Array);
            if (this.previousMagnitudes) {
              let flux = 0;
              for (let i = 0; i < current.length; i++) {
                const diff = current[i] - (this.previousMagnitudes as number[])[i];
                if (diff > 0) flux += diff;
              }
              this.fluxSamples.push({
                t: Date.now(),
                flux: flux / current.length / 255,
              });
              if (this.fluxSamples.length > this.MAX_FLUX_SAMPLES) this.fluxSamples.shift();
            }
            this.previousMagnitudes = current;
          }, intervalMs);
        },

        stopFluxTracking() {
          if (this.fluxTimer !== null) {
            clearInterval(this.fluxTimer);
            this.fluxTimer = null;
          }
        },

        takeFluxSamples() {
          const samples = this.fluxSamples;
          this.fluxSamples = [];
          return samples;
        },

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
              // Sample every 20ms — fine enough to resolve 16ths at
              // 200 BPM (75ms apart) without flooding the buffer.
              (window as any).strudelAudioAnalyzer.startFluxTracking(20);

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
  /**
   * Turns a timestamped flux series into onset timestamps.
   *
   * The page samples flux continuously; this applies the same adaptive
   * decision to the whole series at once. Keeping the decision here
   * rather than in the injected script means the detector is not
   * duplicated into a browser copy that would drift from this one — the
   * failure mode #341 found in the style resource (#322).
   *
   * Returns the flux value alongside the timestamp, because a kick and a
   * hi-hat are not equally good evidence of where the beat is, and the
   * autocorrelation needs to be able to tell them apart (#352).
   *
   * @param samples - Timestamped flux values, oldest first
   * @returns Each detected onset, with the flux that triggered it
   * @example
   * analyzer.onsetsFromFlux([{ t: 0, flux: 0.01 }, { t: 20, flux: 0.4 }]);
   */
  onsetsFromFlux(
    samples: { t: number; flux: number }[],
    continueStream = false
  ): OnsetObservation[] {
    // Resetting between buffers of ONE performance makes every boundary
    // a discontinuity: the first samples of each buffer fall back to the
    // fixed threshold instead of the adaptive one the stream had already
    // learned. Detecting the same audio whole and in 5s pieces then
    // gives different onsets, which is #370. A genuinely new capture
    // still resets — via resetTempoHistory, on pattern change and stop.
    if (!continueStream) this.resetOnsetDetection();
    const candidates: OnsetObservation[] = [];
    for (const sample of samples) {
      if (this.isOnset(sample.flux)) candidates.push({ t: sample.t, strength: sample.flux });
    }
    return AudioAnalyzer.collapseToPeaks(candidates);
  }

  /**
   * Collapses a run of adjacent detections into the one transient it is.
   *
   * A drum hit is not instantaneous. Its flux stays above the adaptive
   * threshold for several consecutive 20ms frames, and without this every
   * frame of it became a separate "onset" — measured on real playback,
   * the median inter-onset interval was 20ms, exactly one sampling step,
   * for dnb, techno and house alike. An envelope of solid blocks has no
   * periodicity to find, the autocorrelation came out flat, and the
   * tempo prior answered on its own: 120 BPM for every pattern, at
   * confidence 0.00 (#366).
   *
   * Keeps the loudest frame of each run, which is also the one whose
   * strength should weight the correlation.
   *
   * @param candidates - Every frame that crossed the threshold, in order
   * @param refractoryMs - Frames closer than this belong to one transient
   * @returns One observation per transient
   */
  static collapseToPeaks(
    candidates: readonly OnsetObservation[],
    refractoryMs = AudioAnalyzer.ONSET_REFRACTORY_MS
  ): OnsetObservation[] {
    const peaks: OnsetObservation[] = [];
    for (const candidate of candidates) {
      const previous = peaks[peaks.length - 1];
      if (previous !== undefined && candidate.t - previous.t < refractoryMs) {
        // Same transient. Keep the louder frame, and its time with it —
        // the peak is a better estimate of when the hit landed than the
        // first frame that happened to cross.
        if (candidate.strength > previous.strength) peaks[peaks.length - 1] = candidate;
        continue;
      }
      peaks.push(candidate);
    }
    return peaks;
  }

  /**
   * Folds newly detected onsets into the history, dropping what no
   * longer belongs to the same performance.
   *
   * @param detected - Onsets from the latest buffer, oldest first
   */
  private mergeOnsetHistory(detected: readonly OnsetObservation[]): void {
    const newest = this._onsetHistory[this._onsetHistory.length - 1];
    const first = detected[0];

    // A silence longer than a bar is a different performance. Keeping
    // the old onsets across it does not add data, it mixes two tempos
    // and puts a multi-second interval between them.
    if (newest !== undefined && first !== undefined &&
        first.t - newest.t > AudioAnalyzer.ONSET_CONTINUITY_GAP_MS) {
      this._onsetHistory = [];
    }

    // A transient that straddles a buffer boundary arrives as the tail of
    // one detection and the head of the next. `collapseToPeaks` merges
    // within a single call and cannot see across one, so one kick counts
    // twice, every buffer.
    //
    // Collapsing `[last kept onset, ...incoming]` rather than special-
    // casing the first element is what makes this EXACTLY the same
    // operation the whole-series path performs. A hand-rolled boundary
    // merge got it nearly right and dropped one onset in 45: it decided
    // the first incoming onset, then pushed the rest unchanged, so an
    // onset that became adjacent to the retained peak was never
    // reconsidered.
    const previous = this._onsetHistory.pop();
    const joined = previous === undefined ? detected : [previous, ...detected];
    this._onsetHistory.push(...AudioAnalyzer.collapseToPeaks(joined));

    const latest = this._onsetHistory[this._onsetHistory.length - 1];
    if (latest !== undefined) {
      const cutoff = latest.t - AudioAnalyzer.MAX_ONSET_AGE_MS;
      // Bound by age first: a count bound alone let a reading span
      // minutes of unrelated audio.
      while (this._onsetHistory.length > 0 && this._onsetHistory[0].t < cutoff) {
        this._onsetHistory.shift();
      }
    }

    while (this._onsetHistory.length > this.MAX_HISTORY_LENGTH) {
      this._onsetHistory.shift();
    }
  }

  /**
   * Forgets every onset collected so far.
   *
   * Called when the pattern changes or the transport stops: the next
   * reading must describe the next performance, not average it with the
   * last one.
   */
  async resetTempoHistory(page?: Page): Promise<void> {
    this._onsetHistory = [];
    this.resetOnsetDetection();

    // The PAGE keeps its own flux buffer, and clearing only the Node
    // side left up to ten seconds of the previous pattern's samples
    // waiting to be drained into the fresh history on the next call.
    // Cross-model review found this: the reset looked complete because
    // everything it could see was cleared, and the contamination lived
    // one process away (#374).
    //
    // Draining and discarding reuses the existing accessor rather than
    // adding a second way to empty the same array.
    if (page !== undefined) {
      try {
        await page.evaluate(/* istanbul ignore next */ () => {
          (window as any).strudelAudioAnalyzer?.takeFluxSamples?.();
        });
      } catch {
        // The page may be gone — a reset that cannot reach it has
        // nothing to contaminate anyway.
      }
    }
  }

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

    let onsets: OnsetInput;

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
          this._onsetHistory.push({ t: Date.now(), strength: flux });
          if (this._onsetHistory.length > this.MAX_HISTORY_LENGTH) {
            this._onsetHistory.shift();
          }
        }

        onsets = [...this._onsetHistory];
      }
    } else {
      // Prefer the page's continuous buffer.
      //
      // Sampling once per call gave at most one onset per tool call, so
      // the intervals measured were the gaps between CALLS. The page
      // samples every 20ms; this reads what it collected and applies the
      // onset decision to the whole series (#322).
      const buffered = await this.takeBufferedFlux(page);
      if (buffered.length >= 8) {
        // Continuing the same stream: the previous buffer's threshold
        // state is what makes this buffer's first samples comparable.
        const detected = this.onsetsFromFlux(buffered, this._onsetHistory.length > 0);
        this.mergeOnsetHistory(detected);
        return this.tempoFromOnsets([...this._onsetHistory]);
      }

      // Fall back to the single-sample path when the page has no buffer
      // — an older injected script, or a capture that just started.
      if (!analyzer.dataArray) {
        throw new Error('Invalid audio data');
      }
      const fftData = new Uint8Array(analyzer.dataArray);
      const flux = this.calculateSpectralFlux(fftData);

      if (this.isOnset(flux)) {
        this._onsetHistory.push({ t: Date.now(), strength: flux });
        if (this._onsetHistory.length > this.MAX_HISTORY_LENGTH) {
          this._onsetHistory.shift();
        }
      }

      onsets = [...this._onsetHistory];
    }

    return this.tempoFromOnsets(onsets);
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
   * Reads and clears the page's continuous flux buffer.
   *
   * @param page - Playwright page with the analyser injected
   * @returns Timestamped flux samples, oldest first
   */
  private async takeBufferedFlux(page: Page): Promise<{ t: number; flux: number }[]> {
    try {
      const samples = await page.evaluate(/* istanbul ignore next */ () => {
        const a = (window as any).strudelAudioAnalyzer;
        return typeof a?.takeFluxSamples === 'function' ? a.takeFluxSamples() : [];
      });
      return Array.isArray(samples) ? samples : [];
    } catch {
      // An older injected script, or a page that went away mid-call.
      // The caller falls back to single-sample detection.
      return [];
    }
  }

  /**
   * Derives a tempo from onset timestamps.
   *
   * @param onsets - Onset times in milliseconds, oldest first
   * @returns Tempo analysis, or bpm 0 when there is not enough to go on
   */
  /**
   * Finds the beat period by autocorrelating the onset series.
   *
   * A central inter-onset interval measures whatever subdivision the
   * onsets happen to land on, not the pulse. A 174 BPM track with hits
   * on 8ths has a 172ms median interval, and the fold-into-range step
   * then picks whichever octave it lands in first — which is why the
   * liquid-dnb example read 108, 117 and 190 across runs (#352).
   *
   * Autocorrelation asks a different question: at what lag does the
   * whole series repeat? Hits on 8ths correlate at 172ms AND at 345ms,
   * and a preference weight centred on 120 BPM breaks the octave tie
   * the way a listener does.
   *
   * @param onsets - Onset times in milliseconds, oldest first
   * @returns Beat period in ms, or null when no periodicity is clear
   * @example
   * // onsets every 172ms from a 174 BPM track -> ~345
   */
  /**
   * How strongly a candidate's whole octave family correlates, not just
   * the candidate.
   *
   * Measured on a real 174 BPM reading, the raw correlation favoured 174
   * over 115 (.0041 against .0039) and the 120-centred prior overturned
   * it: 174 weighs 0.866, 115 weighs 0.998, and 13% was enough. 115 is
   * then a trap — it sits near the prior's centre AND its double, 230
   * BPM, is outside the 40-200 window, so the half-time walk has nowhere
   * to go and the reading can never be corrected.
   *
   * 115 is not an octave of 174 at all. It is a cross-rhythm: six
   * sixteenths where the beat is four.
   *
   * Families separate them on evidence rather than on where the prior's
   * centre was guessed. 43.5 / 87 / 174 all correlate strongly; 115's
   * family is 57.5 / 115 / 230, one weak and one out of range. Whether a
   * tempo's halves and doubles also correlate is a property of the
   * music.
   *
   * Members outside the reportable BPM range still count as evidence —
   * 230 BPM is not an answer this returns, but its correlation says
   * something about whether 115 is real.
   *
   * @param correlation - Autocorrelation of the onset envelope
   * @param lag - Candidate lag, in bins
   * @returns Summed correlation across the candidate's octave family
   */
  static familyStrength(correlation: readonly number[], lag: number): number {
    const own = lag > 0 && lag < correlation.length ? correlation[lag] : 0;
    let relatives = 0;
    for (const multiple of [0.25, 0.5, 2, 4]) {
      const member = Math.round(lag * multiple);
      if (member > 0 && member < correlation.length) relatives += correlation[member];
    }
    // The candidate leads; its family corroborates. A plain sum makes
    // every member of a family score alike and lets a strong relative
    // carry a weak candidate, which broke a pure 90 BPM train (read as
    // 120) and a triplet fixture.
    return own + AudioAnalyzer.FAMILY_CORROBORATION * relatives;
  }

  beatPeriodFromOnsets(onsets: OnsetInput): number | null {
    const times = onsetTimes(onsets);
    const strengths = onsetStrengths(onsets);
    // Autocorrelation needs a series long enough to show periodicity.
    // With 8 onsets over 1.2 seconds it reported 117 for a 174 BPM
    // train — the correlation simply has too few overlapping terms at
    // the lags that matter. Below this the median path is better, and
    // the caller falls through to it (#352).
    const MIN_ONSETS_FOR_AUTOCORRELATION = 12;
    if (times.length < MIN_ONSETS_FOR_AUTOCORRELATION) return null;

    // Impulse train at 10ms resolution — finer than the 20ms flux
    // sampling, so quantization here adds nothing.
    const RESOLUTION_MS = 5;
    const span = times[times.length - 1] - times[0];
    if (span <= 0) return null;
    const length = Math.floor(span / RESOLUTION_MS) + 1;
    if (length < 8) return null;

    // Weighted by flux, not a binary impulse train.
    //
    // A dnb pattern fires onsets on kicks, snares AND hats, and an
    // unweighted train says they are equally likely to be the beat. They
    // are not — measured on a synthetic 174 BPM mix with 16th hats, the
    // unweighted correlation reads 115 BPM, because the 120 BPM prior
    // tips a near-tie between the beat lag and a six-sixteenth lag. With
    // the kick contributing ~2.5x what a hat does, the tie disappears.
    //
    // Normalized so the loudest onset is 1: flux magnitudes are relative
    // to whatever the mix is doing, and only the ratios matter here.
    const loudest = strengths.length > 0 ? Math.max(...strengths) : 1;
    const scale = loudest > 0 ? 1 / loudest : 1;
    const envelope = new Array<number>(length).fill(0);

    // Each onset is spread over a small triangular kernel rather than
    // written to one bin.
    //
    // The flux series is sampled every 20ms, so every onset time is a
    // multiple of 20ms — and most tempos do not divide into it. A 345ms
    // beat (174 BPM) lands alternately on 340 and 360, and a bare
    // impulse train has NO lag that matches both. Measured, tempos whose
    // period is an exact multiple of the sampling step read correctly
    // (120 from 500ms, 100 from 600ms) and tempos that are not read
    // wrong (174, 140) — which is the quantization, not the music.
    //
    // A kernel one sampling step wide either side lets a jittered onset
    // still correlate with the lag it belongs to.
    // Only for flux-derived onsets. The jitter this corrects is an
    // artifact of the 20ms sampling, so an input that was not sampled —
    // exact timestamps from a test, or the mock path — has none, and
    // smearing it only blurs a peak that was already sharp. Measured:
    // applying the kernel to an exact 174 BPM 8th-note train moved it
    // to 117.
    const KERNEL_BINS = strengths.length > 0 ? Math.max(1, Math.round(20 / RESOLUTION_MS)) : 0;
    for (let i = 0; i < times.length; i++) {
      const centre = Math.round((times[i] - times[0]) / RESOLUTION_MS);
      const weight = strengths.length > 0 ? strengths[i] * scale : 1;
      for (let d = -KERNEL_BINS; d <= KERNEL_BINS; d++) {
        const index = centre + d;
        if (index < 0 || index >= length) continue;
        const taper = 1 - Math.abs(d) / (KERNEL_BINS + 1);
        // Keep the strongest contribution rather than summing: two hats
        // quantized together must not outweigh one kick.
        envelope[index] = Math.max(envelope[index], weight * taper);
      }
    }

    const correlation = this.autocorrelate(envelope);

    // Lags corresponding to 40-200 BPM.
    const minLag = Math.floor((60000 / 200) / RESOLUTION_MS);
    const maxLag = Math.ceil((60000 / 40) / RESOLUTION_MS);

    let bestLag = 0;
    let bestScore = 0;
    for (let lag = minLag; lag <= maxLag && lag < correlation.length; lag++) {
      const bpm = 60000 / (lag * RESOLUTION_MS);
      // Preference weight in log-tempo space, centred on 120 BPM. This
      // is what resolves the octave ambiguity: 172ms and 345ms both
      // correlate, and a listener hears the slower one as the beat.
      const octaves = Math.log2(bpm / 120);
      const weight = Math.exp(-(octaves * octaves) / 2);
      const score = AudioAnalyzer.familyStrength(correlation, lag) * weight;
      if (score > bestScore) {
        bestScore = score;
        bestLag = lag;
      }
    }

    if (bestLag === 0 || bestScore <= 0) return null;

    // Prefer the faster reading when it also correlates.
    //
    // The autocorrelation of an impulse train peaks at the period AND
    // at every multiple, and the normalization by (n - lag) slightly
    // favours the longer one — so a 174 BPM series scored highest at
    // 690ms and reported 87. Half-time is a real reading of dnb, but
    // 174 is the one its producer would give, and five existing tests
    // asserted 174.
    //
    // So: if halving the winning lag still correlates substantially,
    // take the halved one. A 120 BPM series on the beat has no
    // correlation at 250ms and keeps 500ms; one on 8ths does, and
    // halves to 250ms — which folds back to 120 anyway.
    // How strongly the halved lag must correlate before it is preferred.
    //
    // Two regimes, because the two inputs carry different information.
    // With flux strengths the loudest onsets mark the beat, the peak is
    // trustworthy, and halving should need a near-tie to win — at 0.4 a
    // 90 BPM pattern with 8th-note hats reads 179. Without strengths
    // every onset looks alike and a train on 8ths is genuinely
    // ambiguous: 172.5ms and 345ms are both perfectly periodic, and 174
    // is a convention rather than a measurement. There, leaning on the
    // halving is what recovers the number a producer would give.
    const HALF_TIME_RATIO = strengths.length > 0 ? 0.8 : 0.4;
    let lag = bestLag;
    for (let i = 0; i < 3; i++) {
      const half = Math.round(lag / 2);
      if (half < minLag || half >= correlation.length) break;
      if (correlation[half] < correlation[lag] * HALF_TIME_RATIO) break;
      lag = half;
    }

    return lag * RESOLUTION_MS;
  }

  /**
   * Tempos an octave either side of a detected one, within range.
   *
   * Half and double time are the SAME onset series — 345ms and 690ms
   * impulse trains are indistinguishable from timing alone, and
   * separating them needs onset strength or spectral cues this detector
   * does not have. Measured at four envelope resolutions from 1ms to
   * 10ms: the ranking never changed, so it is not a quantization
   * artefact.
   *
   * Rather than pick silently, the alternatives are reported. A dnb
   * track detected at 87 lists 174, which is the reading its producer
   * would give (#352).
   *
   * @param bpm - The detected tempo
   * @returns Octave-related tempos inside 40-200, nearest first
   */
  static tempoOctaves(bpm: number): number[] {
    const out: number[] = [];
    for (const factor of [2, 0.5, 4, 0.25]) {
      const candidate = Math.round(bpm * factor);
      if (candidate >= 40 && candidate <= 200) out.push(candidate);
    }
    return out;
  }

  tempoFromOnsets(onsets: OnsetInput): TempoAnalysis {
    const times = onsetTimes(onsets);
    // Need at least 4 onsets for reliable tempo detection
    if (times.length < 4) {
      return { bpm: 0, confidence: 0, method: 'onset' };
    }

    // Calculate inter-onset intervals (IOIs)
    const intervals = this.calculateIntervals(times);

    // Autocorrelation first: it asks at what lag the whole series
    // repeats, rather than measuring whatever subdivision the onsets
    // happen to land on. A central inter-onset interval read the
    // liquid-dnb example as 108, 117 and 190 across runs, because the
    // fold-into-range step picked whichever octave the subdivision
    // landed in first (#352).
    const beatPeriod = this.beatPeriodFromOnsets(onsets);
    if (beatPeriod !== null && beatPeriod > 0) {
      const rawBpm = 60000 / beatPeriod;
      const folded = AudioAnalyzer.foldIntoTempoRange(rawBpm);
      if (folded !== null) {
        const bpm = Math.round(folded);
        const intervals = this.calculateIntervals(times);
        const variance = this.calculateVariance(intervals);
        const mean = intervals.reduce((a, b) => a + b, 0) / intervals.length;
        const cv = mean > 0 ? Math.sqrt(variance) / mean : 1;
        const confidence = Math.min(1, Math.max(0, 1 - cv * 1.5));

        // Below the floor, say nothing rather than say 120.
        //
        // The correlation always has a highest lag, and the tempo prior
        // is centred on 120 — so when the onsets carry no periodicity
        // the answer is the prior's centre, dressed as a measurement.
        // Measured on real playback before #366's onset fix: 120 BPM for
        // dnb, techno and house alike, every run, at confidence 0.00.
        // The code already knew; nothing was reading it.
        if (confidence < AudioAnalyzer.MIN_TEMPO_CONFIDENCE) {
          return { bpm: 0, confidence, method: 'autocorrelation' };
        }

        return {
          bpm,
          confidence,
          method: 'autocorrelation',
          alternatives: AudioAnalyzer.tempoOctaves(bpm),
        };
      }
    }

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
          this._onsetHistory.push({ t: Date.now(), strength: flux });
          if (this._onsetHistory.length > this.MAX_HISTORY_LENGTH) {
            this._onsetHistory.shift();
          }
        }

        onsets = onsetTimes(this._onsetHistory);
      }
    } else {
      // No analyze function, use real-time detection
      const fftData = new Uint8Array(analyzer.dataArray);
      const flux = this.calculateSpectralFlux(fftData);

      if (this.isOnset(flux)) {
        this._onsetHistory.push({ t: Date.now(), strength: flux });
        if (this._onsetHistory.length > this.MAX_HISTORY_LENGTH) {
          this._onsetHistory.shift();
        }
      }

      onsets = onsetTimes(this._onsetHistory);
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