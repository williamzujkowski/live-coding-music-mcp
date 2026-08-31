/**
 * A create must not receive a browser that is being closed (#423).
 *
 * `closeBrowser` awaited `browser.close()` and only then nulled the
 * field, while `ensureBrowser` returns `this.browser` whenever it is
 * non-null. So a create landing in that window got a browser already on
 * its way out, and `newContext()` threw `Target page, context or browser
 * has been closed`. `reservedIds` guards the window BEFORE closeBrowser
 * is entered, not during it.
 *
 * Separately: a crashed Chromium is still a live object with a dead
 * process. Nothing checked, so every future create failed permanently —
 * while the legacy path has had exactly this self-heal since #206.
 */

let launches = 0;

jest.mock('playwright', () => ({
  chromium: {
    launch: jest.fn(async () => {
      launches++;
      const browser: Record<string, unknown> = {
        connected: true,
        newContext: jest.fn(async () => ({
          newPage: jest.fn(async () => ({ route: jest.fn(), goto: jest.fn(), on: jest.fn() })),
          close: jest.fn(async () => undefined),
        })),
        close: jest.fn(async () => {
          // A real close is not instant, and the whole defect lives in
          // this gap.
          await new Promise(resolve => setTimeout(resolve, 30));
          browser.connected = false;
        }),
        isConnected: jest.fn(() => browser.connected),
      };
      return browser;
    }),
  },
}));

describe('closeBrowser and ensureBrowser do not race (#423)', () => {
  /**
   * Every manager these tests launch is torn down.
   *
   * `launchBrowser` starts the idle sweep interval, and leaving one
   * running holds the event loop open — this suite passed in 0.26s and
   * then hung until Jest force-exited, which is the same leak #405
   * traced through a bisection. Not repeating it here.
   */
  const managers: Array<Record<string, any>> = [];

  async function newManager(): Promise<Record<string, any>> {
    const { SessionManager } = await import('../../services/SessionManager');
    const manager = new SessionManager(true) as unknown as Record<string, any>;
    managers.push(manager);
    return manager;
  }

  beforeEach(() => { launches = 0; });

  afterEach(async () => {
    for (const manager of managers.splice(0)) await manager.closeBrowser();
  });

  it('a create during a close waits and gets a live browser', async () => {
    const manager = await newManager();

    await manager.ensureBrowser();
    expect(launches).toBe(1);

    // Start a close and reach for a browser while it is in flight — from
    // OUTSIDE the close. Calling ensureBrowser synchronously from within
    // `browser.close()` deadlocks by construction: it waits on the very
    // close that is waiting on it.
    const closing = manager.closeBrowser();
    await new Promise(resolve => setTimeout(resolve, 5));
    const duringClose = manager.ensureBrowser();
    await closing;

    const browser = await duringClose;
    expect(browser).toBeDefined();
    expect(browser.isConnected()).toBe(true);
    // It launched a fresh one rather than being handed the closing browser.
    expect(launches).toBe(2);
  });

  it('relaunches when the browser is alive as an object but disconnected', async () => {
    const manager = await newManager();

    const first = await manager.ensureBrowser();
    first.connected = false; // Chromium crashed under us.

    const second = await manager.ensureBrowser();

    expect(second).not.toBe(first);
    expect(second.isConnected()).toBe(true);
    expect(launches).toBe(2);
  });

  it('still reuses a healthy browser', async () => {
    // The behaviour the self-heal must not cost: one browser, shared.
    const manager = await newManager();

    const a = await manager.ensureBrowser();
    const b = await manager.ensureBrowser();

    expect(b).toBe(a);
    expect(launches).toBe(1);
  });
});
