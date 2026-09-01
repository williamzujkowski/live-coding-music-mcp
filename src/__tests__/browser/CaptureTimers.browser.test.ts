/**
 * The capture timers, exercised for real.
 *
 * WHY THIS SUITE EXISTS. Every other test of the page-side capture
 * object TRANSCRIBES it: the state machine is re-typed into the test
 * file and the copy is driven with fake timers. That copy cannot
 * disagree with the original, so it proves nothing about the original.
 * Three timer bugs landed inside a commit whose entire subject was a
 * timer bug, and not one of them could fail a test (#464):
 *
 *   - hitting `maxDuration` threw the whole recording away, while the
 *     comment above it claimed the opposite, with a ten-minute default
 *     applied to every capture;
 *   - the 5s stop watchdog was never cleared, so it fired during the
 *     NEXT capture and emptied its chunks;
 *   - the watchdog could return without resolving, which is the hung
 *     request #437 was written to remove.
 *
 * So this drives the REAL `injectRecorder` output in a REAL Chromium
 * page: real MediaRecorder, real setTimeout, real Blobs. No strudel.cc
 * and no network — an oscillator into a MediaStreamDestination is
 * indistinguishable from Strudel's output as far as the recorder is
 * concerned, and it makes the suite fast and deterministic.
 */
import { chromium, type Browser, type Page } from 'playwright';

import { AudioCaptureService } from '../../services/AudioCaptureService';

jest.setTimeout(60000);

describe('Capture timers (real page, real timers)', () => {
  let browser: Browser;
  let page: Page;
  let service: AudioCaptureService;

  beforeAll(async () => {
    browser = await chromium.launch({
      headless: process.env.HEADLESS !== 'false',
      args: ['--autoplay-policy=no-user-gesture-required'],
    });
    page = await browser.newPage();
    await page.goto('about:blank');
    service = new AudioCaptureService();
    await service.injectRecorder(page);

    // Stand in for what `connect()` wires up when Strudel plays: a live
    // audio graph feeding a MediaStreamDestination. Everything the
    // timers touch is downstream of this.
    await page.evaluate(/* istanbul ignore next */ () => {
      const capture = (window as any).strudelAudioCapture;
      const ctx = new AudioContext();
      const dest = ctx.createMediaStreamDestination();
      const osc = ctx.createOscillator();
      osc.frequency.value = 220;
      osc.connect(dest);
      osc.start();
      capture.mediaStreamDest = dest;
      capture.isConnected = true;
    });
  });

  afterAll(async () => {
    await browser?.close();
  });

  const start = (maxDurationMs?: number) =>
    page.evaluate(
      /* istanbul ignore next */ (ms: number | undefined) =>
        (window as any).strudelAudioCapture.startCapture(ms),
      maxDurationMs,
    );

  const stop = () =>
    page.evaluate(/* istanbul ignore next */ async () => {
      const r = await (window as any).strudelAudioCapture.stopCapture();
      // A Blob does not survive serialization; its size is what matters.
      return { ...r, blob: undefined, bytes: r.blob ? r.blob.size : 0 };
    });

  const idle = (ms: number) =>
    page.evaluate(
      /* istanbul ignore next */ (d: number) => new Promise(res => setTimeout(res, d)),
      ms,
    );

  it('returns the audio recorded up to maxDuration, not nothing', async () => {
    expect(await start(700)).toEqual({ success: true });

    // Well past the cap: the recorder has stopped itself and `onstop`
    // has already cleared `isCapturing`. This is the state in which the
    // recording used to be reported as "No capture in progress."
    await idle(2000);

    const result = await stop();
    expect(result.success).toBe(true);
    expect(result.bytes).toBeGreaterThan(0);
    expect(result.warning).toMatch(/maxDuration/);
  });

  it('leaves no timer behind to sabotage the next capture', async () => {
    // Self-contained on purpose: it arms the timers itself rather than
    // relying on an earlier test to have left them lying around. A
    // clean stop arms a 5s watchdog; a capped one arms a cap timer.
    // Both belong to a capture that is over, and if either survives it
    // fires inside the NEXT capture and empties its chunks.
    expect(await start(60000)).toEqual({ success: true });
    await idle(300);
    expect((await stop()).success).toBe(true);

    expect(await start()).toEqual({ success: true });
    await idle(6500); // past the 5s watchdog armed by the stop above

    const state = await page.evaluate(/* istanbul ignore next */ () => {
      const c = (window as any).strudelAudioCapture;
      return { isCapturing: c.isCapturing, chunks: c.chunks.length };
    });
    expect(state.isCapturing).toBe(true);
    expect(state.chunks).toBeGreaterThan(0);

    const result = await stop();
    expect(result.success).toBe(true);
    expect(result.bytes).toBeGreaterThan(0);
    expect(result.warning).toBeUndefined();
  });

  it('an uncapped capture stops normally and reports no warning', async () => {
    expect(await start()).toEqual({ success: true });
    await idle(600);
    const result = await stop();
    expect(result.success).toBe(true);
    expect(result.bytes).toBeGreaterThan(0);
    expect(result.duration).toBeGreaterThan(0);
  });

  it('a stop with nothing in progress is refused, not hung', async () => {
    const result = await stop();
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/No capture in progress/);
  });

  it('concurrent stops share one settle and both return', async () => {
    expect(await start()).toEqual({ success: true });
    await idle(500);

    // Both stops must be issued from INSIDE the page. Two
    // `page.evaluate` round-trips serialize over CDP, so the second
    // would arrive after the first had already settled — a different
    // scenario entirely, and not the one #437 is about.
    const [a, b] = await page.evaluate(/* istanbul ignore next */ async () => {
      const c = (window as any).strudelAudioCapture;
      const results = await Promise.all([c.stopCapture(), c.stopCapture()]);
      return results.map((r: any) => ({ success: r.success, bytes: r.blob ? r.blob.size : 0 }));
    });

    expect(a.success).toBe(true);
    expect(b.success).toBe(true);
    expect(a.bytes).toBe(b.bytes);
    expect(a.bytes).toBeGreaterThan(0);
  });

  it('a re-inject does not leave the old capture\'s timers armed', async () => {
    // `injectRecorder` overwrites `strudelAudioCapture` outright, and
    // `server.ts` can build a fresh service for a page that already
    // carries one. A cap timer or stop watchdog surviving that would
    // fire against the NEW object and empty its chunks — which is
    // exactly how the previous capture's watchdog destroyed the next
    // one in #464, and the shape #479 found on the analyzer.
    expect(await start(60_000)).toEqual({ success: true });
    await idle(200);

    const orphan = await page.evaluate(/* istanbul ignore next */ () => {
      const c = (window as any).strudelAudioCapture;
      (window as any).__orphanCapture = c;
      return { capTimer: c.capTimer !== null };
    });
    expect(orphan.capTimer).toBe(true); // armed before the re-inject

    await service.injectRecorder(page);

    const after = await page.evaluate(/* istanbul ignore next */ () => {
      const old = (window as any).__orphanCapture;
      return { capTimer: old.capTimer, watchdog: old.stopWatchdog, capturing: old.isCapturing };
    });
    expect(after.capTimer).toBeNull();
    expect(after.watchdog).toBeNull();
    expect(after.capturing).toBe(false);

    // And the fresh object is usable.
    await page.evaluate(/* istanbul ignore next */ () => {
      const c = (window as any).strudelAudioCapture;
      const ctx = new AudioContext();
      const dest = ctx.createMediaStreamDestination();
      const osc = ctx.createOscillator();
      osc.connect(dest);
      osc.start();
      c.mediaStreamDest = dest;
      c.isConnected = true;
    });
    expect(await start()).toEqual({ success: true });
    await idle(300);
    expect((await stop()).success).toBe(true);
  });
});
