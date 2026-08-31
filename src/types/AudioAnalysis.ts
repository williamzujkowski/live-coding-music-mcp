/**
 * Type definitions for advanced audio analysis
 */

export interface TempoAnalysis {
  bpm: number;
  confidence: number;
  method?: 'autocorrelation' | 'onset' | 'spectral';
  /**
   * Octave-related readings of the same onset series.
   *
   * Half and double time are indistinguishable from onset timing alone
   * — a 345ms and a 690ms impulse train are the same data. Rather than
   * pick silently, both are surfaced: a dnb track detected at 87 lists
   * 174, which is the reading its producer would give (#352).
   */
  alternatives?: number[];
}

export interface KeyAnalysis {
  key: string;
  scale: 'major' | 'minor' | 'dorian' | 'phrygian' | 'lydian' | 'mixolydian' | 'locrian';
  confidence: number;
  alternatives?: Array<{ key: string; scale: string; confidence: number }>;
}

export interface RhythmAnalysis {
  pattern: string;
  complexity: number; // 0-1 scale
  density: number; // events per second
  syncopation: number; // 0-1 scale
  onsets: number[];
  isRegular: boolean;
}

export interface AdvancedAudioAnalysis {
  tempo?: TempoAnalysis;
  key?: KeyAnalysis;
  rhythm?: RhythmAnalysis;
  timestamp: number;
}

/**
 * Basic audio analysis features from frequency spectrum
 */
export interface AudioAnalysisFeatures {
  average: number;
  peak: number;
  peakFrequency: number;
  centroid: number;
  bass: number;
  lowMid: number;
  mid: number;
  highMid: number;
  treble: number;
  isPlaying: boolean;
  isSilent: boolean;
  bassToTrebleRatio: number | string;
  brightness: 'bright' | 'balanced' | 'dark';
}

/**
 * Audio analysis result with connection status
 */
export interface AudioAnalysisResult {
  connected: boolean;
  timestamp?: number;
  features?: AudioAnalysisFeatures;
  error?: string;
}

/**
 * Runtime configuration for the AnalyserNode that AudioAnalyzer attaches
 * to Strudel's audio graph. Maps to `config.audio_analysis` in config.json
 * (snake_case there → camelCase here).
 */
export interface AudioAnalysisConfig {
  /**
   * FFT bin count. Must be a power of 2 in [32, 32768] per the Web Audio
   * spec (https://developer.mozilla.org/en-US/docs/Web/API/AnalyserNode/fftSize).
   * Larger = better frequency resolution, more CPU per analysis call.
   * Default: 1024, which is 512 bins at 43 Hz/bin for 44.1 kHz. (This
   * comment previously said ~21 Hz/bin; that is fftSize 2048, which is
   * what config.json actually ships.)
   *
   * Resolution matters for key detection specifically, because 12
   * logarithmic pitch classes get narrower the lower you go. Measured
   * against pure tones:
   *
   *   fftSize 1024 (43.1 Hz/bin)  C3 ok, D3 -> C, E3 -> F, E4 -> F
   *   fftSize 2048 (21.5 Hz/bin)  only E3 (164.8 Hz) misplaced
   *   fftSize 4096 (10.8 Hz/bin)  all correct from C3 up
   *
   * So key detection is unreliable below roughly 500 Hz at 1024, and
   * below roughly 170 Hz at the shipped 2048. Raise it to 4096 if you
   * care about bass-register key detection (#321).
   */
  fftSize?: number;
  /**
   * Smoothing time constant for the analyser. Must be in [0, 1]. Higher
   * smooths the spectrum more (steadier, but laggier). Default: 0.8.
   */
  smoothing?: number;
}

/**
 * Pattern statistics
 */
export interface PatternStats {
  lines: number;
  chars: number;
  sounds: number;
  notes: number;
  effects: number;
  functions: number;
}

/**
 * Error statistics by operation
 */
export interface ErrorStats {
  /** Failures in the last minute that were NOT rescued. */
  count: number;
  lastError: Date | null;
  /**
   * Failures in the last minute that a retry or fallback did rescue.
   * Reported separately because success clears `count`, which used to
   * erase exactly the signal an operator wants — "flaky but
   * recovering" looked identical to "no trouble at all" (#286).
   */
  recovered: number;
  lastRecovery: Date | null;
}

/**
 * Browser diagnostics information
 */
export interface BrowserDiagnostics {
  browserConnected: boolean;
  pageLoaded: boolean;
  editorReady: boolean;
  audioConnected: boolean;
  cacheStatus: {
    hasCache: boolean;
    cacheAge: number;
  };
  errorStats: Record<string, ErrorStats>;
}
