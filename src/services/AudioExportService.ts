/**
 * AudioExportService - records live Strudel audio and writes it to disk
 *
 * `audio_capture` returns base64 inline in the MCP response. For a 30s
 * capture that is roughly 1.5MB of response text — hundreds of thousands
 * of tokens dropped into the calling agent's context, for data the agent
 * cannot listen to anyway. And WebM/Opus is not what a DAW or a person
 * wants at the other end (#223).
 *
 * This service exports instead: record a window, decode and encode it
 * *in the browser*, and hand back a path.
 *
 * Everything that can happen in page context does. The bytes cross the
 * CDP boundary once, as a base64 string, because that is the only shape
 * Playwright serializes losslessly — returning a `Blob` yields `{}` on the
 * Node side with no `arrayBuffer` method, which is the bug that made
 * `audio_capture` silently broken since it was written.
 *
 * @module services/AudioExportService
 * @nist si-10 "Information input validation"
 * @nist ac-3 "Access enforcement"
 */

import { mkdirSync, writeFileSync } from 'fs';
import type { Page } from 'playwright';
import { Logger } from '../utils/Logger.js';
import { resolveSafeOutputPath, resolveExportDirectory } from '../utils/SafePath.js';

/** Longest window a single export may record. */
export const MAX_EXPORT_DURATION_MS = 30_000;

/** Shortest window worth recording. */
export const MIN_EXPORT_DURATION_MS = 100;

/**
 * Peak amplitude at or below which a capture counts as silent.
 *
 * Strudel's graph emits a low noise floor even with nothing playing, so
 * an exact-zero test would never fire and every silent export would be
 * reported as successful audio.
 */
export const SILENCE_PEAK_THRESHOLD = 0.0005;

/** What the caller asked for. */
export interface AudioExportOptions {
  /** Window to record, in ms (100–30000, default 5000). */
  duration?: number;
  /** `wav` decodes and re-encodes; `webm` writes the recorder output as-is. */
  format?: 'wav' | 'webm';
  /** Output filename; sanitized and confined to the export directory. */
  filename?: string;
  /** `file` writes to disk and returns a path; `base64` returns bytes inline. */
  output?: 'file' | 'base64';
}

/** Result of an audio export. */
export interface AudioExportResult {
  success: boolean;
  /** Absolute path written, when `output: 'file'`. */
  path?: string;
  /** Base64 payload, when `output: 'base64'`. */
  audio?: string;
  /** Bytes of audio produced. */
  bytes: number;
  /** Recorded window in ms. */
  duration: number;
  format: 'wav' | 'webm';
  /** Sample rate of the decoded audio (wav only). */
  sampleRate?: number;
  /** Channel count of the decoded audio (wav only). */
  channels?: number;
  /** True when the capture recorded nothing audible. */
  silent?: boolean;
  /** Peak amplitude in [0,1] (wav only). */
  peak?: number;
  /** RMS amplitude in [0,1] (wav only). */
  rms?: number;
  /** Set when the requested filename had to be sanitized. */
  sanitizedFilename?: string;
  /** The caller's original filename, when it was sanitized. */
  requestedFilename?: string;
  /** Non-fatal problems worth surfacing (e.g. silence). */
  warnings?: string[];
  error?: string;
}

/** Shape returned by the in-page recorder/encoder. */
interface BrowserExportPayload {
  success: boolean;
  error?: string;
  base64?: string;
  duration?: number;
  sampleRate?: number;
  channels?: number;
  peak?: number;
  rms?: number;
}

export class AudioExportService {
  private readonly exportDir: string;
  private readonly logger: Logger;

  /**
   * @param exportDir - Directory exports are confined to (default `./exports`)
   */
  constructor(exportDir?: string) {
    this.exportDir = resolveExportDirectory(exportDir);
    this.logger = new Logger();
  }

  /** Directory this service writes to. */
  getExportDirectory(): string {
    return this.exportDir;
  }

  /**
   * Records a window of live audio and exports it.
   *
   * @param page - Page with the Strudel audio graph, already playing
   * @param options - Duration, format, filename, and output mode
   * @returns Path or base64 payload, plus what was actually recorded
   *
   * @example
   * const result = await service.exportAudio(page, { duration: 3000 });
   * // -> { success: true, path: '<cwd>/exports/capture.wav', silent: false, ... }
   */
  async exportAudio(page: Page, options: AudioExportOptions = {}): Promise<AudioExportResult> {
    const format = options.format ?? 'wav';
    const output = options.output ?? 'file';
    const duration = options.duration ?? 5000;

    if (!Number.isFinite(duration) || duration < MIN_EXPORT_DURATION_MS || duration > MAX_EXPORT_DURATION_MS) {
      return {
        success: false,
        bytes: 0,
        duration: 0,
        format,
        error:
          `Invalid duration: ${String(options.duration)}. ` +
          `Must be between ${MIN_EXPORT_DURATION_MS} and ${MAX_EXPORT_DURATION_MS} ms.`,
      };
    }

    let payload: BrowserExportPayload;
    try {
      payload = await page.evaluate(
        AudioExportService.browserCapture,
        { durationMs: duration, wantWav: format === 'wav' },
      );
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, bytes: 0, duration: 0, format, error: `Audio export failed: ${message}` };
    }

    if (!payload.success || payload.base64 === undefined) {
      return {
        success: false,
        bytes: 0,
        duration: 0,
        format,
        error: payload.error ?? 'Audio export failed for an unknown reason.',
      };
    }

    const bytes = Buffer.from(payload.base64, 'base64');
    const warnings: string[] = [];

    // Report silence rather than writing a silent file and calling it a
    // success — the caller has no way to hear the difference (#223).
    const silent = payload.peak !== undefined && payload.peak <= SILENCE_PEAK_THRESHOLD;
    if (silent) {
      warnings.push(
        'Captured audio is silent. Is a pattern playing? ' +
        'Call playback({ action: "play" }) before exporting.'
      );
    } else if (payload.peak === undefined) {
      // Not measured is not the same as not silent.
      //
      // A WebM capture the browser could not decode returns without a
      // peak, so `silent` is false and the check above never fires. The
      // tool promises it "reports silent captures instead of writing a
      // silent file and claiming success" — and that promise was kept
      // by staying quiet about a file it had not been able to look at
      // (#437 item 2). Say so instead.
      warnings.push(
        'Captured audio could not be decoded, so it was not checked for silence. '
        + 'The bytes are the recorder\'s own output and may be empty.'
      );
    }

    const base: AudioExportResult = {
      success: true,
      bytes: bytes.length,
      duration: payload.duration ?? duration,
      format,
      ...(payload.sampleRate !== undefined ? { sampleRate: payload.sampleRate } : {}),
      ...(payload.channels !== undefined ? { channels: payload.channels } : {}),
      ...(payload.peak !== undefined ? { peak: payload.peak, rms: payload.rms, silent } : {}),
      ...(warnings.length > 0 ? { warnings } : {}),
    };

    if (output === 'base64') {
      return { ...base, audio: payload.base64 };
    }

    try {
      const target = resolveSafeOutputPath(options.filename, {
        directory: this.exportDir,
        extension: format === 'wav' ? '.wav' : '.webm',
        defaultName: `strudel-capture-${String(Date.now())}.${format}`,
      });

      mkdirSync(this.exportDir, { recursive: true });
      writeFileSync(target.path, bytes);

      this.logger.debug(`Exported ${String(bytes.length)} bytes to ${target.path}`);

      return {
        ...base,
        path: target.path,
        ...(target.wasModified
          ? { sanitizedFilename: target.filename, requestedFilename: target.requested }
          : {}),
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return { ...base, success: false, error: `Failed to write audio file: ${message}` };
    }
  }

  /**
   * Runs in page context: record, decode, measure, encode.
   *
   * Defined as a static so the function passed to `page.evaluate` is a
   * plain closure over its argument with no `this` — Playwright
   * serializes the source, so anything captured from the enclosing scope
   * would be undefined at runtime.
   *
   * Returns base64 rather than a Blob or Uint8Array: a Blob does not
   * survive the CDP boundary at all, and a large typed array round-trips
   * as a slow object map.
   */
  /* istanbul ignore next -- runs in the browser; covered by npm run test:export-audio */
  private static browserCapture = async (
    args: { durationMs: number; wantWav: boolean },
  ): Promise<BrowserExportPayload> => {
    const capture = (window as { strudelAudioCapture?: any }).strudelAudioCapture;
    if (!capture) {
      return { success: false, error: 'Audio recorder not injected. Run init first.' };
    }
    if (!capture.isConnected) {
      return {
        success: false,
        error: 'Audio recorder not connected to Strudel output. Play a pattern first.',
      };
    }
    if (capture.isCapturing) {
      return { success: false, error: 'A capture is already in progress.' };
    }

    const started = capture.startCapture();
    if (started.success !== true) {
      return { success: false, error: started.error ?? 'Failed to start capture.' };
    }

    await new Promise(resolve => setTimeout(resolve, args.durationMs));

    const stopped = await capture.stopCapture();
    if (stopped.success !== true || !stopped.blob) {
      return { success: false, error: stopped.error ?? 'Capture produced no audio.' };
    }

    const recorded: ArrayBuffer = await stopped.blob.arrayBuffer();

    // Helpers live as object METHODS, not `const fn = () => {}`.
    // esbuild (which tsx uses) rewrites a named inner function into
    // `__name(fn, "fn")` to preserve `.name`, and `__name` does not exist
    // in page context — so the whole evaluate throws
    // `ReferenceError: __name is not defined` under `npm run dev`, while
    // working fine from `dist/` where tsc emits it untouched. Method
    // shorthand is the one form esbuild leaves alone.
    const h = {
      toBase64(buffer: ArrayBuffer): string {
        const view = new Uint8Array(buffer);
        let binary = '';
        // Chunked: String.fromCharCode(...view) blows the stack on a
        // multi-megabyte capture.
        const CHUNK = 0x8000;
        for (let i = 0; i < view.length; i += CHUNK) {
          binary += String.fromCharCode(...view.subarray(i, i + CHUNK));
        }
        return btoa(binary);
      },
      writeAscii(view: DataView, offset: number, text: string): void {
        for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
      },
    };

    // Decode for BOTH formats.
    //
    // The webm path used to return here, before anything measured the
    // signal — so `peak` was undefined, the silence check upstream
    // (`payload.peak !== undefined && ...`) was false, and a silent webm
    // was reported as a clean export. The tool description promises
    // "Reports silent captures instead of writing a silent file and
    // claiming success" with no format qualifier, and that promise held
    // only for wav (#437).
    //
    // webm still ships the ORIGINAL Opus bytes; the decode is only to
    // measure them. A decode failure is fatal for wav, which needs the
    // samples, and merely means "no peak reported" for webm, which does
    // not.
    const AudioCtx = (window as any).AudioContext ?? (window as any).webkitAudioContext;
    const ctx = new AudioCtx();
    let decoded: AudioBuffer | null = null;
    let decodeError = '';
    try {
      decoded = await ctx.decodeAudioData(recorded.slice(0));
    } catch (error: any) {
      decodeError = String(error?.message ?? error);
    }

    if (decoded === null) {
      await ctx.close();
      if (args.wantWav) {
        return { success: false, error: `Failed to decode captured audio: ${decodeError}` };
      }
      return { success: true, base64: h.toBase64(recorded), duration: stopped.duration };
    }

    const channels = decoded.numberOfChannels;
    const frames = decoded.length;
    const sampleRate = decoded.sampleRate;

    const channelData: Float32Array[] = [];
    for (let c = 0; c < channels; c++) channelData.push(decoded.getChannelData(c));

    // Measure before quantising, so the numbers describe the real signal.
    let peak = 0;
    let sumSquares = 0;
    for (const data of channelData) {
      for (let i = 0; i < data.length; i++) {
        const v = Math.abs(data[i]);
        if (v > peak) peak = v;
        sumSquares += data[i] * data[i];
      }
    }
    const rms = frames > 0 ? Math.sqrt(sumSquares / (frames * channels)) : 0;

    if (!args.wantWav) {
      await ctx.close();
      return {
        success: true,
        base64: h.toBase64(recorded),
        // The audio's own length, not the wall clock. `stopped.duration`
        // is `Date.now() - startTime`, which counts the time spent
        // starting and stopping the recorder as if it were sound (#437).
        duration: Math.round((frames / sampleRate) * 1000),
        peak,
        rms,
        sampleRate,
        channels,
      };
    }

    // 16-bit PCM WAV: 44-byte RIFF header then interleaved samples.
    const bytesPerSample = 2;
    const blockAlign = channels * bytesPerSample;
    const dataSize = frames * blockAlign;
    const buffer = new ArrayBuffer(44 + dataSize);
    const view = new DataView(buffer);

    h.writeAscii(view, 0, 'RIFF');
    view.setUint32(4, 36 + dataSize, true);
    h.writeAscii(view, 8, 'WAVE');
    h.writeAscii(view, 12, 'fmt ');
    view.setUint32(16, 16, true);           // PCM chunk size
    view.setUint16(20, 1, true);            // format: PCM
    view.setUint16(22, channels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * blockAlign, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, 16, true);           // bits per sample
    h.writeAscii(view, 36, 'data');
    view.setUint32(40, dataSize, true);

    let offset = 44;
    for (let i = 0; i < frames; i++) {
      for (let c = 0; c < channels; c++) {
        const sample = Math.max(-1, Math.min(1, channelData[c][i]));
        view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
        offset += bytesPerSample;
      }
    }

    await ctx.close();

    return {
      success: true,
      base64: h.toBase64(buffer),
      // The audio's own length. `stopped.duration` is
      // `Date.now() - startTime`, so it counted the time spent starting
      // and stopping the recorder as if it were sound — and a caller
      // could compute (bytes - 44) / (sampleRate * channels * 2) from
      // this very response and get a different answer (#437).
      duration: Math.round((frames / sampleRate) * 1000),
      sampleRate,
      channels,
      peak,
      rms,
    };
  };
}
