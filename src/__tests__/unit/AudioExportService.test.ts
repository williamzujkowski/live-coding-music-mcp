/**
 * AudioExportService tests (#223).
 *
 * These deliberately do NOT mock the browser payload into a convenient
 * shape. The reason `audio_capture` shipped broken for its entire life is
 * that its tests handed `stopCapture` a real `Blob` that Playwright would
 * never actually deliver — the mock asserted the code's assumptions
 * rather than the boundary's behaviour.
 *
 * So the fake `page.evaluate` here returns exactly what a real
 * `page.evaluate` returns: a plain JSON-serializable object, base64 for
 * the bytes, nothing with methods on it.
 *
 * The browser half — MediaRecorder, decodeAudioData, WAV encoding — is
 * covered by `npm run test:export-audio` against real Chromium, because
 * no mock can meaningfully stand in for it.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  AudioExportService,
  MAX_EXPORT_DURATION_MS,
  MIN_EXPORT_DURATION_MS,
  SILENCE_PEAK_THRESHOLD,
} from '../../services/AudioExportService.js';

/** Bytes the fake browser "recorded". */
const FAKE_AUDIO = Buffer.from('RIFF....WAVEfake-pcm-payload');

/**
 * Stands in for a Playwright Page. `evaluate` returns a plain object, as
 * the real one does after JSON round-tripping.
 */
function makePage(payload: Record<string, unknown>): any {
  return { evaluate: jest.fn(async () => payload) };
}

const audiblePayload = {
  success: true,
  base64: FAKE_AUDIO.toString('base64'),
  duration: 2500,
  sampleRate: 48000,
  channels: 2,
  peak: 0.87,
  rms: 0.19,
};

describe('AudioExportService', () => {
  let dir: string;
  let service: AudioExportService;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'strudel-audio-export-'));
    service = new AudioExportService(dir);
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  describe('file output', () => {
    it('writes the audio and returns its path', async () => {
      const result = await service.exportAudio(makePage(audiblePayload), { filename: 'take-01' });

      expect(result.success).toBe(true);
      expect(result.path).toBe(path.join(dir, 'take-01.wav'));
      expect(fs.readFileSync(result.path!)).toEqual(FAKE_AUDIO);
      expect(result.bytes).toBe(FAKE_AUDIO.length);
    });

    /** The whole point of the tool: a path, not megabytes of base64 (#223). */
    it('does not return base64 inline by default', async () => {
      const result = await service.exportAudio(makePage(audiblePayload), {});

      expect(result.audio).toBeUndefined();
      expect(result.path).toBeDefined();
    });

    it('creates the export directory on demand', async () => {
      fs.rmSync(dir, { recursive: true, force: true });

      const result = await service.exportAudio(makePage(audiblePayload), {});

      expect(fs.existsSync(result.path!)).toBe(true);
    });

    it('names the file by format', async () => {
      const wav = await service.exportAudio(makePage(audiblePayload), { filename: 'x' });
      const webm = await service.exportAudio(makePage(audiblePayload), { filename: 'x', format: 'webm' });

      expect(wav.path!.endsWith('.wav')).toBe(true);
      expect(webm.path!.endsWith('.webm')).toBe(true);
    });

    it('falls back to a timestamped name', async () => {
      const result = await service.exportAudio(makePage(audiblePayload), {});

      expect(path.basename(result.path!)).toMatch(/^strudel-capture-\d+\.wav$/);
    });
  });

  describe('path confinement (#224)', () => {
    it.each([
      '../../../../tmp/pwned',
      '/etc/passwd',
      'nested/dir/take',
      '..\\..\\evil',
    ])('confines %s to the export directory', async filename => {
      const result = await service.exportAudio(makePage(audiblePayload), { filename });

      expect(path.dirname(result.path!)).toBe(dir);
      expect(fs.existsSync(result.path!)).toBe(true);
    });

    it('reports the sanitization rather than rewriting silently', async () => {
      const result = await service.exportAudio(makePage(audiblePayload), {
        filename: '../../secrets/take',
      });

      expect(result.sanitizedFilename).toBe('take.wav');
      expect(result.requestedFilename).toBe('../../secrets/take');
    });
  });

  describe('silence detection', () => {
    it('flags a silent capture and says what to do', async () => {
      const result = await service.exportAudio(
        makePage({ ...audiblePayload, peak: 0, rms: 0 }),
        {},
      );

      expect(result.success).toBe(true);
      expect(result.silent).toBe(true);
      expect(result.warnings?.join(' ')).toMatch(/silent/i);
      expect(result.warnings?.join(' ')).toMatch(/play/i);
    });

    /**
     * Strudel's graph emits a noise floor even when stopped — measured at
     * ~2e-34 — so an exact-zero test would never fire and every silent
     * export would be reported as successful audio.
     */
    it('treats a noise floor below the threshold as silent', async () => {
      const result = await service.exportAudio(
        makePage({ ...audiblePayload, peak: SILENCE_PEAK_THRESHOLD / 2, rms: 1e-30 }),
        {},
      );

      expect(result.silent).toBe(true);
    });

    it('does not flag real audio', async () => {
      const result = await service.exportAudio(makePage(audiblePayload), {});

      expect(result.silent).toBe(false);
      expect(result.warnings).toBeUndefined();
    });

    it('still writes the file so the caller can judge for themselves', async () => {
      const result = await service.exportAudio(makePage({ ...audiblePayload, peak: 0 }), {});

      expect(fs.existsSync(result.path!)).toBe(true);
    });
  });

  describe('duration validation', () => {
    it.each([0, -1, 50, MAX_EXPORT_DURATION_MS + 1, NaN, Infinity])(
      'rejects duration %p without touching the page',
      async duration => {
        const page = makePage(audiblePayload);

        const result = await service.exportAudio(page, { duration: duration as number });

        expect(result.success).toBe(false);
        expect(result.error).toMatch(/Invalid duration/);
        expect(page.evaluate).not.toHaveBeenCalled();
      },
    );

    it.each([MIN_EXPORT_DURATION_MS, 5000, MAX_EXPORT_DURATION_MS])(
      'accepts duration %p',
      async duration => {
        const result = await service.exportAudio(makePage(audiblePayload), { duration });

        expect(result.success).toBe(true);
      },
    );

    it('defaults to 5000ms', async () => {
      const page = makePage(audiblePayload);
      await service.exportAudio(page, {});

      expect(page.evaluate.mock.calls[0][1]).toEqual({ durationMs: 5000, wantWav: true });
    });
  });

  describe('base64 output', () => {
    it('returns bytes inline and writes nothing', async () => {
      const result = await service.exportAudio(makePage(audiblePayload), { output: 'base64' });

      expect(result.audio).toBe(FAKE_AUDIO.toString('base64'));
      expect(result.path).toBeUndefined();
      expect(fs.readdirSync(dir)).toEqual([]);
    });
  });

  describe('failures surface, not throw', () => {
    it('reports a browser-side error', async () => {
      const result = await service.exportAudio(
        makePage({ success: false, error: 'Audio recorder not connected to Strudel output.' }),
        {},
      );

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/not connected/);
    });

    it('reports a page.evaluate rejection', async () => {
      const page = { evaluate: jest.fn(async () => { throw new Error('Target page closed'); }) };

      const result = await service.exportAudio(page as any, {});

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/Target page closed/);
    });

    it('reports a success payload with no bytes rather than writing an empty file', async () => {
      const result = await service.exportAudio(makePage({ success: true }), {});

      expect(result.success).toBe(false);
      expect(fs.readdirSync(dir)).toEqual([]);
    });
  });

  describe('metadata passthrough', () => {
    it('reports what was actually recorded', async () => {
      const result = await service.exportAudio(makePage(audiblePayload), {});

      expect(result).toMatchObject({
        duration: 2500,
        sampleRate: 48000,
        channels: 2,
        peak: 0.87,
        rms: 0.19,
        format: 'wav',
      });
    });

    it('omits decode-only metadata for webm', async () => {
      const result = await service.exportAudio(
        makePage({ success: true, base64: FAKE_AUDIO.toString('base64'), duration: 1000 }),
        { format: 'webm' },
      );

      expect(result.sampleRate).toBeUndefined();
      expect(result.peak).toBeUndefined();
      expect(result.silent).toBeUndefined();
    });
  });

  it('defaults its directory to ./exports', () => {
    expect(new AudioExportService().getExportDirectory()).toBe(path.resolve('./exports'));
  });
});
