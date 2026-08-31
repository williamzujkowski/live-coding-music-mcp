/**
 * Two states that could not be recovered from without a new page (#437).
 *
 * Found by cross-model review; both are the same shape — a flag or a
 * cache entry that says "ready" when the page disagrees, with no path
 * back.
 */

import { AudioCaptureService } from '../../services/AudioCaptureService';
import type { Page } from 'playwright';

/** A page whose `evaluate` answers whatever the test wants it to. */
function pageReporting(recorderPresent: () => boolean): Page {
  return {
    evaluate: jest.fn(async (fn: unknown) => {
      // The injection call returns undefined; the liveness probe returns
      // a boolean. Distinguishing them by what the caller does with the
      // result would be fragile, so the stub answers both.
      void fn;
      return recorderPresent();
    }),
  } as unknown as Page;
}

describe('isInjectedInto asks the page, not object identity (#437)', () => {
  it('reports false after the page reloads and the recorder is gone', async () => {
    // A Playwright `Page` outlives the JS realm it points at. Identity
    // still matched after a reload, so the cached service was returned
    // without re-injecting and every capture failed with "Audio capture
    // not initialized" for the rest of the session — with `init` unable
    // to recover it, since it returns 'Already initialized' whenever the
    // page is alive.
    let recorderPresent = true;
    const page = pageReporting(() => recorderPresent);
    const service = new AudioCaptureService();
    await service.injectRecorder(page);

    expect(await service.isInjectedInto(page)).toBe(true);

    recorderPresent = false; // the user hit reload
    expect(await service.isInjectedInto(page)).toBe(false);
  });

  it('still reports false for a different page without asking it', async () => {
    // The identity check stays as the first gate: it is free, and it
    // catches the recreated-session and recovered-browser cases (#264).
    const pageA = pageReporting(() => true);
    const pageB = pageReporting(() => true);
    const service = new AudioCaptureService();
    await service.injectRecorder(pageA);

    expect(await service.isInjectedInto(pageB)).toBe(false);
    // pageB was never consulted — only the injection on pageA ran.
    expect((pageB as unknown as { evaluate: jest.Mock }).evaluate).not.toHaveBeenCalled();
  });

  it('treats an unreadable page as not injected', async () => {
    const page = {
      evaluate: jest.fn(async () => { throw new Error('Target closed'); }),
    } as unknown as Page;
    const service = new AudioCaptureService();
    // The injection itself fails on a dead page; what matters is that
    // the probe answers false rather than throwing.
    await service.injectRecorder(page).catch(() => undefined);

    await expect(service.isInjectedInto(page)).resolves.toBe(false);
  });
});
