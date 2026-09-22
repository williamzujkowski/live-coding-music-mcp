/**
 * The two teardown findings left over from #423: items 1 and 9.
 *
 * **Item 1.** `createSession` launches the browser and starts the idle
 * sweep, then fails inside `initializeControllerWithPage`. It closed the
 * context and rethrew — leaving Chromium up and a 5-minute interval
 * ticking with `sessions.size === 0` and nothing on that path able to
 * close either. The next create reuses the browser, so this is not an
 * unbounded leak; a server whose create failed and which never makes
 * another holds a browser for nothing.
 *
 * **Item 9.** A `close()` that rejected was logged and the handle
 * dropped, so nothing could ever try again. Playwright gives no process
 * handle for a browser from `chromium.launch()` — `process()` is on
 * BrowserServer and ElectronApplication, not Browser — so retaining the
 * handle and retrying is the strongest move available.
 */

let launches = 0;
/** Flipped by a test to make the next browser close reject. */
let browserCloseFails = false;

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
          if (browserCloseFails) throw new Error('browser will not close');
          browser.connected = false;
        }),
        isConnected: jest.fn(() => browser.connected),
      };
      return browser;
    }),
  },
}));

/**
 * Every manager is torn down: `launchBrowser` starts the idle sweep, and
 * a leftover interval holds the event loop open (the #405 shape).
 */
const managers: Array<Record<string, any>> = [];

async function newManager(init: () => Promise<void>): Promise<Record<string, any>> {
  const { SessionManager } = await import('../../services/SessionManager');
  const manager = new SessionManager(true) as unknown as Record<string, any>;
  manager.initializeControllerWithPage = init;
  managers.push(manager);
  return manager;
}

beforeEach(() => {
  launches = 0;
  browserCloseFails = false;
});

afterEach(async () => {
  browserCloseFails = false;
  for (const manager of managers.splice(0)) await manager.closeBrowser();
});

describe('a create that fails does not strand the browser (#423 item 1)', () => {
  it('closes the browser and stops the sweep when nothing was created', async () => {
    const manager = await newManager(async () => { throw new Error('strudel.cc timed out'); });

    await expect(manager.createSession('a')).rejects.toThrow('strudel.cc timed out');

    expect(manager.getSessionCount()).toBe(0);
    expect(manager.isBrowserRunning()).toBe(false);
    expect(manager.cleanupTimer).toBeNull();
  });

  /** The guard that stops the fix from being too eager. */
  it('keeps the browser when another session is still using it', async () => {
    let fail = false;
    const manager = await newManager(async () => { if (fail) throw new Error('transient'); });

    await manager.createSession('live');
    fail = true;
    await expect(manager.createSession('b')).rejects.toThrow('transient');

    expect(manager.getSessionCount()).toBe(1);
    expect(manager.isBrowserRunning()).toBe(true);
    expect(launches).toBe(1);
  });

  it('a later create relaunches rather than reusing a closed browser', async () => {
    let fail = true;
    const manager = await newManager(async () => { if (fail) throw new Error('transient'); });

    await expect(manager.createSession('a')).rejects.toThrow('transient');
    expect(launches).toBe(1);

    fail = false;
    await manager.createSession('a');

    expect(manager.getSessionCount()).toBe(1);
    expect(launches).toBe(2);
  });
});

describe('a handle that will not close is retained (#423 item 9)', () => {
  it('keeps a context that refuses to close, and retries it later', async () => {
    const manager = await newManager(async () => undefined);
    await manager.createSession('a');

    const session = manager.sessions.get('a');
    let refuse = true;
    session.context.close = jest.fn(async () => {
      if (refuse) throw new Error('context wedged');
    });

    await manager.destroySession('a');

    // Gone from the map either way — a context that will not close is
    // not a reason to keep serving it.
    expect(manager.getSessionCount()).toBe(0);
    expect(manager.getPendingCloseCount()).toBe(1);

    refuse = false;
    await manager.closeBrowser();

    expect(manager.getPendingCloseCount()).toBe(0);
    // Three: the destroy, the retry inside the closeBrowser that destroy
    // triggers once the last session is gone, and the retry here.
    expect(session.context.close).toHaveBeenCalledTimes(3);
  });

  it('keeps a browser that refuses to close', async () => {
    const manager = await newManager(async () => undefined);
    await manager.createSession('a');

    browserCloseFails = true;
    await manager.destroySession('a');

    // The field is cleared regardless, so nothing is handed a browser
    // that is on its way out.
    expect(manager.isBrowserRunning()).toBe(false);
    expect(manager.getPendingCloseCount()).toBe(1);

    browserCloseFails = false;
    await manager.closeBrowser();

    expect(manager.getPendingCloseCount()).toBe(0);
  });

  it('destroyAll still fires onSessionDestroyed when a close fails', async () => {
    const manager = await newManager(async () => undefined);
    await manager.createSession('a');
    await manager.createSession('b');

    manager.sessions.get('a').context.close = jest.fn(async () => {
      throw new Error('context wedged');
    });

    const destroyed: string[] = [];
    manager.onSessionDestroyed = (id: string) => { destroyed.push(id); };

    await manager.destroyAll();

    // The callback used to sit inside the same try as the close, so a
    // context that would not close skipped the teardown #424 added.
    expect(destroyed.sort()).toEqual(['a', 'b']);
    expect(manager.getSessionCount()).toBe(0);
  });
});
