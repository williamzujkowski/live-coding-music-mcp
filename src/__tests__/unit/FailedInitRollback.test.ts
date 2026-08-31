/**
 * A failed init must not leave a half-built browser (#456).
 *
 * `newPage()` runs before the navigation, so a strudel.cc that will not
 * load left `browser` and `_page` assigned with the page on about:blank.
 * `isAlive()` asks only whether the page is CLOSED, so it said yes — and
 * the server clears `isInitialized` only when `isAlive()` is false. The
 * next call re-entered `initialize()`, took the 'Already initialized'
 * shortcut, and every tool after that failed on a blank page with
 * "editor not found after 3 attempts", permanently.
 *
 * #202 and #206 cover a page that DIED. This is a page that was never
 * born, which their liveness check cannot tell from a healthy one.
 */

let gotoShouldFail = true;
const closed = { browser: 0, context: 0 };

jest.mock('playwright', () => ({
  chromium: {
    launch: jest.fn(async () => ({
      isConnected: () => true,
      close: jest.fn(async () => { closed.browser++; }),
      newContext: jest.fn(async () => ({
        close: jest.fn(async () => { closed.context++; }),
        newPage: jest.fn(async () => ({
          route: jest.fn(),
          on: jest.fn(),
          isClosed: jest.fn(() => false),
          close: jest.fn(async () => undefined),
          goto: jest.fn(async () => {
            if (gotoShouldFail) throw new Error('net::ERR_CONNECTION_REFUSED');
          }),
          evaluate: jest.fn(async () => true),
          // `waitForStrudelReady` uses this; a mock missing it made the
          // second init fail for a reason that has nothing to do with
          // what is under test.
          waitForSelector: jest.fn(async () => ({})),
          waitForFunction: jest.fn(async () => undefined),
          waitForTimeout: jest.fn(async () => undefined),
          addStyleTag: jest.fn(async () => undefined),
          setViewportSize: jest.fn(async () => undefined),
        })),
      })),
    })),
  },
}));

describe('a failed initialize leaves nothing behind (#456)', () => {
  beforeEach(() => { gotoShouldFail = true; closed.browser = 0; closed.context = 0; });

  it('does not report itself alive after the navigation fails', async () => {
    const { StrudelController } = await import('../../StrudelController');
    const controller = new StrudelController(true, undefined, undefined, {
      firstPlayMs: 100, subsequentPlayMs: 100,
    });

    await expect(controller.initialize()).rejects.toThrow();

    // The whole defect: this used to be true, and 'Already initialized'
    // then made the failure permanent.
    expect(controller.isAlive()).toBe(false);
  });

  it('a second initialize is a real attempt, not "Already initialized"', async () => {
    const { StrudelController } = await import('../../StrudelController');
    const controller = new StrudelController(true, undefined, undefined, {
      firstPlayMs: 100, subsequentPlayMs: 100,
    });

    await expect(controller.initialize()).rejects.toThrow();
    gotoShouldFail = false;

    await expect(controller.initialize()).resolves.toContain('initialized');
  });

  it('releases the browser it launched', async () => {
    const { StrudelController } = await import('../../StrudelController');
    const controller = new StrudelController(true, undefined, undefined, {
      firstPlayMs: 100, subsequentPlayMs: 100,
    });

    await expect(controller.initialize()).rejects.toThrow();

    // Otherwise a retrying caller leaks a Chromium per attempt.
    expect(closed.browser).toBeGreaterThan(0);
  });
});
