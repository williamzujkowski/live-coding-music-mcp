/**
 * The analyzer's page-side flux collector, exercised for real (#479).
 *
 * Same reasoning as CaptureTimers.browser.test.ts. This state machine
 * lives inside a `page.evaluate` closure, so it cannot be imported, and
 * every existing test of it re-types it into the test file — a copy
 * cannot disagree with its original. It holds a 20ms `setInterval` and
 * a bounded ring of samples, which is the exact shape that produced
 * three undetectable timer bugs in #464.
 *
 * So this drives the REAL `inject()` output in real Chromium: real
 * `setInterval`, real `AnalyserNode`, real timing. An oscillator stands
 * in for Strudel, so it needs no network and runs in a few seconds.
 */
import { chromium, type Browser, type Page } from 'playwright';

import { AudioAnalyzer } from '../../AudioAnalyzer';

jest.setTimeout(60000);

describe('Analyzer flux collection (real page, real timers)', () => {
  let browser: Browser;
  let page: Page;

  beforeAll(async () => {
    browser = await chromium.launch({
      headless: process.env.HEADLESS !== 'false',
      args: ['--autoplay-policy=no-user-gesture-required'],
    });
    page = await browser.newPage();
    await page.goto('about:blank');
  });

  afterAll(async () => {
    await browser?.close();
  });

  /** Inject the real analyzer and wire a live oscillator into it. */
  const injectAndConnect = async (): Promise<void> => {
    await new AudioAnalyzer().inject(page);
    await page.evaluate(/* istanbul ignore next */ () => {
      const a = (window as any).strudelAudioAnalyzer;
      const ctx = new AudioContext();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      const osc = ctx.createOscillator();
      osc.frequency.value = 220;
      // A gain that moves gives the spectrum something to flux about.
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0, ctx.currentTime);
      gain.gain.linearRampToValueAtTime(1, ctx.currentTime + 0.5);
      osc.connect(gain).connect(analyser);
      osc.start();
      a.analyser = analyser;
      a.dataArray = new Uint8Array(analyser.frequencyBinCount);
      a.isConnected = true;
      a.sampleRate = ctx.sampleRate;
    });
  };

  const idle = (ms: number) =>
    page.evaluate(
      /* istanbul ignore next */ (d: number) => new Promise(res => setTimeout(res, d)),
      ms,
    );

  beforeEach(async () => {
    // A fresh page each time: an injected timer belongs to its page.
    await page.evaluate(/* istanbul ignore next */ () => {
      (window as any).strudelAudioAnalyzer?.stopFluxTracking?.();
      delete (window as any).strudelAudioAnalyzer;
    });
  });

  it('collects flux samples once tracking starts', async () => {
    await injectAndConnect();
    await page.evaluate(/* istanbul ignore next */ () =>
      (window as any).strudelAudioAnalyzer.startFluxTracking(20));
    await idle(400);

    const count = await page.evaluate(/* istanbul ignore next */ () =>
      (window as any).strudelAudioAnalyzer.fluxSamples.length);
    // 400ms at 20ms per sample, minus the first frame which has no
    // previous magnitudes to diff against.
    expect(count).toBeGreaterThan(5);
  });

  it('starting twice does not run two collectors', async () => {
    await injectAndConnect();
    await page.evaluate(/* istanbul ignore next */ () => {
      const a = (window as any).strudelAudioAnalyzer;
      a.startFluxTracking(20);
      a.startFluxTracking(20); // documented idempotent
    });
    await idle(400);

    const perTick = await page.evaluate(/* istanbul ignore next */ async () => {
      const a = (window as any).strudelAudioAnalyzer;
      a.takeFluxSamples();
      await new Promise(res => setTimeout(res, 200));
      return a.fluxSamples.length;
    });
    // ~10 in 200ms at one collector; ~20 if the guard failed.
    expect(perTick).toBeLessThan(16);
  });

  it('drains the buffer, so a reading is not counted twice', async () => {
    await injectAndConnect();
    await page.evaluate(/* istanbul ignore next */ () =>
      (window as any).strudelAudioAnalyzer.startFluxTracking(20));
    await idle(300);

    const { first, immediatelyAfter } = await page.evaluate(
      /* istanbul ignore next */ () => {
        const a = (window as any).strudelAudioAnalyzer;
        return { first: a.takeFluxSamples().length, immediatelyAfter: a.fluxSamples.length };
      });
    expect(first).toBeGreaterThan(0);
    expect(immediatelyAfter).toBe(0);
  });

  it('bounds the buffer when nobody drains it', async () => {
    await injectAndConnect();
    // 1ms so the ring fills fast enough to test in seconds.
    await page.evaluate(/* istanbul ignore next */ () =>
      (window as any).strudelAudioAnalyzer.startFluxTracking(1));
    await idle(2500);

    const { length, max } = await page.evaluate(/* istanbul ignore next */ () => {
      const a = (window as any).strudelAudioAnalyzer;
      return { length: a.fluxSamples.length, max: a.MAX_FLUX_SAMPLES };
    });
    // An unbounded buffer at 1ms would be far past this in 2.5s.
    expect(length).toBeLessThanOrEqual(max);
  });

  it('stopFluxTracking actually stops it', async () => {
    await injectAndConnect();
    await page.evaluate(/* istanbul ignore next */ () =>
      (window as any).strudelAudioAnalyzer.startFluxTracking(20));
    await idle(200);

    const stillGrowing = await page.evaluate(/* istanbul ignore next */ async () => {
      const a = (window as any).strudelAudioAnalyzer;
      a.stopFluxTracking();
      a.takeFluxSamples();
      await new Promise(res => setTimeout(res, 300));
      return a.fluxSamples.length;
    });
    expect(stillGrowing).toBe(0);
  });

  it('a re-inject does not leave the old collector running', async () => {
    // `inject()` overwrites `window.strudelAudioAnalyzer` outright. If
    // the previous object's interval is still live it keeps sampling
    // into an orphaned array, holding the old AnalyserNode with it —
    // the same shape as #464's watchdog outliving its capture.
    await injectAndConnect();
    await page.evaluate(/* istanbul ignore next */ () => {
      const a = (window as any).strudelAudioAnalyzer;
      a.startFluxTracking(20);
      (window as any).__orphan = a; // keep a handle on the old object
    });
    await idle(200);

    await injectAndConnect(); // second inject, same page

    const orphanKeptSampling = await page.evaluate(/* istanbul ignore next */ async () => {
      const orphan = (window as any).__orphan;
      orphan.fluxSamples = [];
      await new Promise(res => setTimeout(res, 300));
      return orphan.fluxSamples.length;
    });
    expect(orphanKeptSampling).toBe(0);
  });
});
