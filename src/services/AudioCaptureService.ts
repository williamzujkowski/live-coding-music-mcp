import { Page } from 'playwright';
import { Logger } from '../utils/Logger.js';

/**
 * Configuration for audio capture
 */
export interface AudioCaptureConfig {
  /** Audio format: 'webm' or 'opus' (default: 'webm') */
  format?: 'webm' | 'opus';
  /** Sample rate in Hz (default: 48000) */
  sampleRate?: number;
  /** Recording duration in milliseconds (default: 5000) */
  durationMs?: number;
}

/**
 * Result of audio capture operation
 */
export interface AudioCaptureResult {
  /** Audio data as Blob */
  blob: Blob;
  /** Actual recording duration in milliseconds */
  duration: number;
  /** MIME type of the recorded audio */
  format: string;
  /** Timestamp when recording completed */
  timestamp: number;
}

/**
 * Internal state for browser-side recorder
 */
interface RecorderState {
  isCapturing: boolean;
  startTime: number;
  chunks: Blob[];
}

/**
 * AudioCaptureService captures audio from Strudel's output using MediaRecorder API.
 *
 * Uses the same GainNode interception pattern as AudioAnalyzer to connect
 * a MediaStreamDestination for recording without interfering with playback.
 *
 * @example
 * const capture = new AudioCaptureService();
 * await capture.injectRecorder(page);
 * const result = await capture.captureForDuration(page, 5000);
 * // result.blob contains WebM/Opus audio data
 */
export class AudioCaptureService {
  private logger = new Logger();
  private _isCapturing = false;
  private _startTime = 0;

  // Default configuration
  private readonly DEFAULT_FORMAT = 'webm';
  private readonly DEFAULT_SAMPLE_RATE = 48000;
  private readonly DEFAULT_DURATION_MS = 5000;
  private readonly MIME_TYPE = 'audio/webm;codecs=opus';

  /**
   * Injects audio capture code into the Strudel page.
   * Must be called before any capture operations.
   *
   * @param page - Playwright page instance to inject into
   * @throws {Error} When injection fails
   */
  async injectRecorder(page: Page): Promise<void> {
    /* istanbul ignore next -- browser-injected IIFE, covered by integration tests */
    await page.evaluate(() => {
      (window as any).strudelAudioCapture = {
        mediaStreamDest: null as MediaStreamAudioDestinationNode | null,
        recorder: null as MediaRecorder | null,
        isConnected: false,
        isCapturing: false,
        startTime: 0,
        chunks: [] as Blob[],
        error: null as string | null,

        /**
         * Connects to Strudel's audio output via GainNode interception
         */
        connect() {
          const originalGainConnect = GainNode.prototype.connect as any;
          let intercepted = false;

          (GainNode.prototype as any).connect = function(this: GainNode, ...args: any[]) {
            if (!intercepted && args[0] && args[0].context) {
              intercepted = true;

              const ctx = args[0].context as AudioContext;
              const capture = (window as any).strudelAudioCapture;

              // Create MediaStreamDestination for recording
              capture.mediaStreamDest = ctx.createMediaStreamDestination();

              // Connect GainNode to both original destination and our capture node
              const result = originalGainConnect.apply(this, args);
              originalGainConnect.call(this, capture.mediaStreamDest);

              capture.isConnected = true;
              return result;
            }
            return originalGainConnect.apply(this, args);
          };
        },

        /**
         * Starts audio capture
         * @returns Success status and any error message
         */
        startCapture(): { success: boolean; error?: string } {
          const capture = (window as any).strudelAudioCapture;

          if (!capture.isConnected || !capture.mediaStreamDest) {
            return {
              success: false,
              error: 'Audio capture not connected. Play a pattern first to initialize audio.'
            };
          }

          if (capture.isCapturing) {
            return { success: false, error: 'Capture already in progress.' };
          }

          try {
            // Reset state
            capture.chunks = [];
            capture.error = null;

            // Create MediaRecorder with WebM/Opus codec (Gemini compatible)
            const options: MediaRecorderOptions = {
              mimeType: 'audio/webm;codecs=opus'
            };

            capture.recorder = new MediaRecorder(capture.mediaStreamDest.stream, options);

            capture.recorder.ondataavailable = (event: BlobEvent) => {
              if (event.data.size > 0) {
                capture.chunks.push(event.data);
              }
            };

            capture.recorder.onerror = (_event: Event) => {
              capture.error = 'MediaRecorder error occurred';
              capture.isCapturing = false;
            };

            capture.recorder.onstop = () => {
              capture.isCapturing = false;
            };

            capture.startTime = Date.now();
            capture.isCapturing = true;
            capture.recorder.start(100); // Collect data every 100ms

            return { success: true };
          } catch (err: any) {
            return { success: false, error: err.message || 'Failed to start capture' };
          }
        },

        /**
         * Stops audio capture and returns recorded data
         * @returns Recorded audio data or error
         */
        async stopCapture(): Promise<{
          success: boolean;
          blob?: Blob;
          duration?: number;
          format?: string;
          error?: string;
        }> {
          const capture = (window as any).strudelAudioCapture;

          if (!capture.recorder || !capture.isCapturing) {
            return { success: false, error: 'No capture in progress.' };
          }

          return new Promise((resolve) => {
            const recorder = capture.recorder;
            const startTime = capture.startTime;

            recorder.onstop = () => {
              capture.isCapturing = false;
              const duration = Date.now() - startTime;

              if (capture.chunks.length === 0) {
                resolve({ success: false, error: 'No audio data captured.' });
                return;
              }

              const blob = new Blob(capture.chunks, { type: 'audio/webm;codecs=opus' });
              capture.chunks = [];

              resolve({
                success: true,
                blob,
                duration,
                format: 'audio/webm;codecs=opus'
              });
            };

            recorder.stop();
          });
        },

        /**
         * Returns current capture state
         */
        getState(): RecorderState {
          const capture = (window as any).strudelAudioCapture;
          return {
            isCapturing: capture.isCapturing,
            startTime: capture.startTime,
            chunks: capture.chunks
          };
        }
      };

      // Initialize connection interception
      (window as any).strudelAudioCapture.connect();
    });

    this.logger.debug('Audio capture injected');
  }

  /**
   * Starts audio capture on the page.
   *
   * @param page - Playwright page instance
   * @param _config - Optional capture configuration (currently unused;
   *   recorder config is fixed at injectRecorder time)
   * @throws {Error} When capture fails to start
   */
  async startCapture(page: Page, _config?: AudioCaptureConfig): Promise<void> {
    const result = await page.evaluate(/* istanbul ignore next */ () => {
      const capture = (window as any).strudelAudioCapture;
      if (!capture) {
        return { success: false, error: 'Audio capture not initialized. Call injectRecorder first.' };
      }
      return capture.startCapture();
    });

    if (!result.success) {
      throw new Error(result.error || 'Failed to start capture');
    }

    this._isCapturing = true;
    this._startTime = Date.now();
    this.logger.debug('Audio capture started');
  }

  /**
   * Stops audio capture and returns the recorded audio.
   *
   * @param page - Playwright page instance
   * @returns Captured audio result with blob, duration, and format
   * @throws {Error} When capture fails or no data was recorded
   */
  async stopCapture(page: Page): Promise<AudioCaptureResult> {
    const result = await page.evaluate(/* istanbul ignore next */ async () => {
      const capture = (window as any).strudelAudioCapture;
      if (!capture) {
        return { success: false, error: 'Audio capture not initialized.' };
      }
      return await capture.stopCapture();
    });

    this._isCapturing = false;

    if (!result.success) {
      throw new Error(result.error || 'Failed to stop capture');
    }

    this.logger.debug(`Audio capture stopped: ${result.duration}ms`);

    return {
      blob: result.blob as Blob,
      duration: result.duration as number,
      format: result.format as string,
      timestamp: Date.now()
    };
  }

  /**
   * Captures audio for a specified duration.
   * Convenience method that handles start, wait, and stop.
   *
   * @param page - Playwright page instance
   * @param durationMs - Duration to record in milliseconds (default: 5000)
   * @returns Captured audio result
   * @throws {Error} When capture fails
   *
   * @example
   * const result = await capture.captureForDuration(page, 5000);
   * console.log(`Captured ${result.duration}ms of audio`);
   */
  async captureForDuration(page: Page, durationMs?: number): Promise<AudioCaptureResult> {
    const duration = durationMs ?? this.DEFAULT_DURATION_MS;

    await this.startCapture(page);

    // Wait for the specified duration
    await new Promise(resolve => setTimeout(resolve, duration));

    return await this.stopCapture(page);
  }

  /**
   * Returns whether audio capture is currently in progress.
   *
   * @returns True if capturing, false otherwise
   */
  isCapturing(): boolean {
    return this._isCapturing;
  }

  /**
   * Returns the elapsed capture time in milliseconds.
   * Returns 0 if not currently capturing.
   *
   * @returns Elapsed time in milliseconds
   */
  getElapsedTime(): number {
    if (!this._isCapturing) {
      return 0;
    }
    return Date.now() - this._startTime;
  }

  /**
   * Checks if audio capture is connected to Strudel's audio output.
   *
   * @param page - Playwright page instance
   * @returns Connection status
   */
  async isConnected(page: Page): Promise<boolean> {
    return await page.evaluate(/* istanbul ignore next */ () => {
      const capture = (window as any).strudelAudioCapture;
      return capture?.isConnected ?? false;
    });
  }

  /**
   * Clears any recorded chunks without stopping capture.
   * Useful for discarding unwanted audio.
   *
   * @param page - Playwright page instance
   */
  async clearChunks(page: Page): Promise<void> {
    await page.evaluate(/* istanbul ignore next */ () => {
      const capture = (window as any).strudelAudioCapture;
      if (capture) {
        capture.chunks = [];
      }
    });
  }

  /**
   * Gets the MIME type used for recording.
   *
   * @returns MIME type string
   */
  getMimeType(): string {
    return this.MIME_TYPE;
  }
}
