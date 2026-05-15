/**
 * Type definitions for advanced audio analysis
 */

export interface TempoAnalysis {
  bpm: number;
  confidence: number;
  method?: 'autocorrelation' | 'onset' | 'spectral';
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
   * Default: 1024 (~21 Hz/bin at 44.1 kHz, ~12 ms per analyse call).
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
  count: number;
  lastError: Date | null;
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
