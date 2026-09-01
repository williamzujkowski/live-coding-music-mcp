/**
 * The last four #437 findings: reports that did not match reality.
 *
 * Items 1, 5 and 6 were fixed in earlier PRs. These are the remainder,
 * each verified against the source before it was acted on.
 */
import { AudioCaptureService } from '../../services/AudioCaptureService';
import { AudioExportService } from '../../services/AudioExportService';

type Page = Parameters<AudioCaptureService['isPageCapturing']>[0];

describe('item 7: duration 0 is a number the caller passed', () => {
  it('refuses it instead of silently recording five seconds', async () => {
    // `duration || 5000` swallowed zero into the default, so it never
    // reached the 100ms lower bound two lines below.
    const { captureModule } = await import('../../server/tools/capture');
    const result = await captureModule.execute(
      'audio_capture',
      { action: 'sample', duration: 0 },
      { isInitialized: () => true } as never,
    ) as { ok: boolean; errorCategory?: string; message?: string };

    expect(result.ok).toBe(false);
    expect(result.errorCategory).toBe('validation');
    expect(result.message).toMatch(/between 100ms and 60000ms/);
  });
});

describe('item 8: the capturing mirror clears even when the page rejects', () => {
  it('does not stay "capturing" after a failed stop', async () => {
    const service = new AudioCaptureService();
    (service as unknown as { _isCapturing: boolean })._isCapturing = true;

    const page = {
      evaluate: () => Promise.reject(new Error('Target page, context or browser has been closed')),
    } as unknown as Page;

    // The assignment used to sit after the await, so a rejected
    // evaluate skipped it and left the mirror reading "capturing" for
    // a capture that is over.
    await expect(service.stopCapture(page as never)).rejects.toThrow();
    expect(service.isCapturing()).toBe(false);
  });
});

describe('item 9: an export in progress is reported as one', () => {
  const pageSaying = (capturing: boolean) => ({
    evaluate: () => Promise.resolve(capturing),
  }) as unknown as Page;

  it('sees a capture the page is running for someone else', async () => {
    const service = new AudioCaptureService();
    // `export_audio` drives the page-side recorder directly and never
    // touches this service's mirror.
    expect(service.isCapturing()).toBe(false);
    expect(await service.isPageCapturing(pageSaying(true))).toBe(true);
  });

  it('reports an unreadable page as not capturing', async () => {
    const service = new AudioCaptureService();
    const dead = { evaluate: () => Promise.reject(new Error('closed')) } as unknown as Page;
    expect(await service.isPageCapturing(dead)).toBe(false);
  });

  it('reports a quiet page as not capturing', async () => {
    expect(await new AudioCaptureService().isPageCapturing(pageSaying(false))).toBe(false);
  });
});

describe('item 2: not measured is not the same as not silent', () => {
  it('warns when the capture could not be decoded', async () => {
    const service = new AudioExportService();
    // A WebM the browser cannot decode returns without a peak, so the
    // silence test could never fire and the export was reported clean.
    const page = {
      evaluate: () => Promise.resolve({
        success: true,
        base64: Buffer.from('not really audio').toString('base64'),
        duration: 1000,
      }),
    };

    const result = await service.exportAudio(page as never, {
      duration: 1000, format: 'webm', output: 'base64',
    });

    expect(result.success).toBe(true);
    expect(result.warnings).toEqual(
      expect.arrayContaining([expect.stringMatching(/not checked for silence/)]));
  });

  it('says nothing extra when the peak was measured', async () => {
    const service = new AudioExportService();
    const page = {
      evaluate: () => Promise.resolve({
        success: true,
        base64: Buffer.from('audio').toString('base64'),
        duration: 1000,
        peak: 0.8,
        rms: 0.3,
        sampleRate: 48000,
        channels: 2,
      }),
    };

    const result = await service.exportAudio(page as never, {
      duration: 1000, format: 'webm', output: 'base64',
    });
    expect(result.silent).toBe(false);
    expect(result.warnings ?? []).not.toEqual(
      expect.arrayContaining([expect.stringMatching(/not checked/)]));
  });
});
