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
  /**
   * Upper bound on a streaming capture, in ms.
   *
   * The recorder stops itself at this point and the chunks are kept, so
   * a later `stop` returns what was recorded. Defaults to ten minutes —
   * a streaming capture used to have no bound at all and grew in page
   * memory until someone stopped it (#437).
   */
  maxDuration?: number;
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
  /**
   * Set when the recording is not the one that was asked for — it hit
   * `maxDuration`, or the recorder had to be abandoned. The page said so
   * and the Node side used to drop it on the floor (#464).
   */
  warning?: string;
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
  /** Cap on an unbounded streaming capture. Ten minutes (#437). */
  private static readonly DEFAULT_MAX_CAPTURE_MS = 10 * 60 * 1000;

  /**
   * Injects audio capture code into the Strudel page.
   * Must be called before any capture operations.
   *
   * @param page - Playwright page instance to inject into
   * @throws {Error} When injection fails
   */
  /**
   * The page this service's recorder was injected into.
   *
   * A service is bound to one page: `injectRecorder` defines
   * `window.strudelAudioCapture` there, and every later call evaluates
   * against it. Callers that cache services must be able to tell whether
   * a cached one still matches the page they are about to use — a session
   * recreated under the same id, or a browser recovered by `init`, gets a
   * NEW page, and the old recorder does not exist on it (#264).
   */
  private injectedPage: Page | null = null;

  /**
   * Whether this service's recorder is live on the given page.
   *
   * Asks the page, rather than comparing object identity. A Playwright
   * `Page` outlives the JS realm it points at: reload strudel.cc — which
   * a user can do at any time, since CLAUDE.md makes the visible browser
   * window the intended interface — and `window.strudelAudioCapture` is
   * gone while `injectedPage === page` still holds.
   *
   * The cached service was then returned without re-injecting, and every
   * capture and export failed with "Audio capture not initialized" for
   * the rest of the session. `init` could not recover it either:
   * `initialize()` returns 'Already initialized' whenever the page is
   * alive, so the same page and the same cached service came back (#437).
   *
   * Identity is still checked first — it is free, and it catches the
   * recreated-session and recovered-browser cases (#264) without a round
   * trip to the page.
   */
  async isInjectedInto(page: Page): Promise<boolean> {
    if (this.injectedPage !== page) return false;
    try {
      return await page.evaluate(/* istanbul ignore next */ () =>
        typeof (window as any).strudelAudioCapture === 'object'
        && (window as any).strudelAudioCapture !== null);
    } catch {
      // An unreadable page is not an injected one.
      return false;
    }
  }

  async injectRecorder(page: Page): Promise<void> {
    /* istanbul ignore next -- browser-injected IIFE, covered by integration tests */
    await page.evaluate(/* istanbul ignore next */ () => {
      (window as any).strudelAudioCapture = {
        /** In-flight stop, so a second one waits rather than racing it. */
        stopping: null as Promise<unknown> | null,
        /** Auto-stop at maxDuration; cleared when a stop lands first. */
        capTimer: null as ReturnType<typeof setTimeout> | null,
        /** Set when the cap ended the recording, so a later stop knows. */
        reachedCap: false,
        /** Watchdog for a stop that never completes; cleared when it does. */
        stopWatchdog: null as ReturnType<typeof setTimeout> | null,
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
        startCapture(maxDurationMs?: number): { success: boolean; error?: string } {
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
            // Reset state. Timers included: a leftover timer from an
            // earlier capture fires against THIS one, and both of them
            // reach in and empty `chunks` (#464).
            capture.chunks = [];
            capture.error = null;
            capture.reachedCap = false;
            if (capture.capTimer !== null) {
              clearTimeout(capture.capTimer);
              capture.capTimer = null;
            }
            if (capture.stopWatchdog !== null) {
              clearTimeout(capture.stopWatchdog);
              capture.stopWatchdog = null;
            }
            capture.stopping = null;

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
            // A previous capture's error is not this one's.
            capture.error = null;
            capture.recorder.start(100); // Collect data every 100ms

            // A streaming capture had no upper bound at all: it
            // accumulated a 100ms blob in page memory until someone
            // stopped it, and `maxDuration` — advertised by the tool —
            // was accepted and discarded (#437).
            //
            // The cap stops the recorder and marks WHY. Without the mark
            // the recording was thrown away: `onstop` clears
            // `isCapturing`, so a later `stop` fell into the "No capture
            // in progress" branch with every chunk still sitting in
            // `capture.chunks`. The comment here used to claim the
            // opposite — and with a ten-minute default on every capture,
            // any long take lost all of its audio (#464).
            if (typeof maxDurationMs === 'number' && maxDurationMs > 0) {
              capture.capTimer = setTimeout(() => {
                if (!capture.isCapturing) return;
                capture.reachedCap = true;
                try { capture.recorder.stop(); } catch { /* already stopped */ }
              }, maxDurationMs);
            }

            return { success: true };
          } catch (err: any) {
            // Reset before returning, or the page is wedged for good.
            //
            // `isCapturing` is set just above, and `recorder.start()` can
            // throw — on a track-less stream, for instance. The flag then
            // stayed true while the Node mirror stayed false, so every
            // later start got "Capture already in progress", every export
            // got "A capture is already in progress", and stop was
            // refused by the Node-side gate. Nothing cleared it short of
            // a new page (#437).
            capture.isCapturing = false;
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
          warning?: string;
        }> {
          const capture = (window as any).strudelAudioCapture;

          if (!capture.recorder || !capture.isCapturing) {
            // The cap ended it. That is a finished recording, not an
            // absent one — hand it over (#464).
            if (capture.reachedCap === true && capture.chunks.length > 0) {
              const collected = capture.chunks;
              capture.chunks = [];
              capture.reachedCap = false;
              return {
                success: true,
                blob: new Blob(collected, { type: 'audio/webm;codecs=opus' }),
                duration: Date.now() - capture.startTime,
                format: 'audio/webm;codecs=opus',
                warning: 'Recording stopped at maxDuration; this is the audio up to that point.',
              };
            }

            // A recorder error clears `isCapturing` too, so this branch
            // covered two very different situations with one message.
            // `capture.error` was set and nothing ever read it — the
            // real cause was discarded and the caller was told there had
            // been no capture at all (#437).
            if (capture.error !== null) {
              const failure = capture.error;
              const orphaned = capture.chunks.length;
              capture.error = null;
              capture.chunks = [];
              return {
                success: false,
                error: `${failure}. ${String(orphaned)} chunk(s) were recorded before it and have been discarded.`,
              };
            }
            return { success: false, error: 'No capture in progress.' };
          }

          // A stop already in flight is awaited, not started again.
          //
          // `isCapturing` is cleared inside `onstop`, which has not run
          // yet when a second stop arrives — so both calls got past the
          // check above, the second overwrote the first's `onstop` and
          // called `stop()` on an inactive recorder. The second threw
          // InvalidStateError; the FIRST call's resolver became
          // unreachable, and `page.evaluate` has no timeout, so that MCP
          // request never returned (#437).
          if (capture.stopping) {
            return await capture.stopping;
          }

          capture.stopping = new Promise((resolve) => {
            const recorder = capture.recorder;
            const startTime = capture.startTime;
            // Both timers die on whichever path settles first. The
            // watchdog handle was not kept at all, so it outlived its
            // own capture and fired during the NEXT one — passing its
            // guard, clearing `isCapturing` and emptying `chunks`, which
            // destroyed a recording that was going perfectly well. The
            // cap timer leaked the same way across captures and could
            // stop a recorder that belonged to a later take (#464).
            // Method shorthand, not `const clearTimers = () => {}`:
            // esbuild rewrites the arrow into `__name(fn, "fn")` and
            // `__name` does not exist in page context. Written as an
            // arrow first; PageEvaluateNameWrapping.test.ts caught it.
            const timers = {
              clear(): void {
                if (capture.capTimer !== null) {
                  clearTimeout(capture.capTimer);
                  capture.capTimer = null;
                }
                if (capture.stopWatchdog !== null) {
                  clearTimeout(capture.stopWatchdog);
                  capture.stopWatchdog = null;
                }
              },
            };

            recorder.onstop = () => {
              capture.isCapturing = false;
              timers.clear();

              // An error that fired after this handler was installed
              // still delivers `dataavailable` and `stop`, so this used
              // to return success:true over a truncated recording and
              // the tool reported a normal capture (#437).
              if (capture.error !== null) {
                const failure = capture.error;
                capture.error = null;
                capture.chunks = [];
                resolve({ success: false, error: `${failure} during stop; the recording is incomplete.` });
                return;
              }

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

            // A stop that never completes must not hang the request.
            //
            // `page.evaluate` has no timeout, so if `onstop` never fires
            // — a wedged recorder, a stream whose tracks died — the MCP
            // call waits forever. Resolving with whatever was collected
            // is a worse recording than the caller asked for and an
            // infinitely better outcome than no answer (#437).
            capture.stopWatchdog = setTimeout(() => {
              // Always settles. This used to `return` without resolving
              // when the capture was already flagged done and empty —
              // which is precisely the never-returning request #437 was
              // written to remove, reintroduced by its own fix (#464).
              capture.stopWatchdog = null;
              timers.clear();
              capture.isCapturing = false;
              const collected = capture.chunks;
              capture.chunks = [];
              resolve(collected.length === 0
                ? { success: false, error: 'Recorder did not stop, and nothing was captured.' }
                : {
                    success: true,
                    blob: new Blob(collected, { type: 'audio/webm;codecs=opus' }),
                    duration: Date.now() - startTime,
                    format: 'audio/webm;codecs=opus',
                    warning: 'Recorder did not stop cleanly; returned what was captured.',
                  });
            }, 5000);

            recorder.stop();
          });

          try {
            return await capture.stopping;
          } finally {
            capture.stopping = null;
          }
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

    this.injectedPage = page;
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
  async startCapture(page: Page, config?: AudioCaptureConfig): Promise<void> {
    // Bounded even when the caller does not ask. An unbounded streaming
    // capture grows in page memory until someone remembers to stop it,
    // and nothing here ever timed it out (#437). Ten minutes is far
    // longer than any musical take and far shorter than forever.
    const maxDurationMs = config?.maxDuration ?? AudioCaptureService.DEFAULT_MAX_CAPTURE_MS;

    const result = await page.evaluate(/* istanbul ignore next */ (capMs: number) => {
      const capture = (window as any).strudelAudioCapture;
      if (!capture) {
        return { success: false, error: 'Audio capture not initialized. Call injectRecorder first.' };
      }
      return capture.startCapture(capMs);
    }, maxDurationMs);

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

      const captureResult = await capture.stopCapture();
      if (!captureResult.success || !captureResult.blob) {
        return captureResult;
      }

      // Playwright cannot serialize a browser Blob into a Node Blob with
      // methods intact. Convert to base64 inside the browser context and
      // rehydrate a real Node-side Blob below.
      const buffer = await captureResult.blob.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      let binary = '';
      for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
      }

      return {
        success: true,
        audio: btoa(binary),
        duration: captureResult.duration,
        format: captureResult.format,
        warning: captureResult.warning,
      };
    });

    this._isCapturing = false;

    if (!result.success) {
      throw new Error(result.error || 'Failed to stop capture');
    }

    this.logger.debug(`Audio capture stopped: ${result.duration}ms`);

    const blob = result.audio
      ? new Blob([Buffer.from(result.audio as string, 'base64')], { type: result.format as string })
      : result.blob as Blob;

    return {
      blob,
      duration: result.duration as number,
      format: result.format as string,
      timestamp: Date.now(),
      ...(result.warning ? { warning: result.warning as string } : {}),
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
