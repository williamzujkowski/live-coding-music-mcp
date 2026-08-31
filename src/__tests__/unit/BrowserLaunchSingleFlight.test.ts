/**
 * One Chromium, however many concurrent creates (#317).
 *
 * `ensureBrowser` was:
 *
 *     if (!this.browser) { this.browser = await chromium.launch(...) }
 *
 * with an await between the check and the assignment. The MCP SDK does
 * not serialize tool calls — dispatch runs a promise chain with no
 * mutex — so three concurrent session({action:'create'}) calls each saw
 * `browser === null`, each launched, and only the last assignment
 * survived. The other two Chromium processes leaked with no handle left
 * to close them.
 *
 * Same class as #263, one level up: that leaked browser contexts, this
 * leaked whole browsers.
 */

import { chromium } from 'playwright';
import { SessionManager } from '../../services/SessionManager';

jest.mock('playwright', () => ({
  chromium: {
    launch: jest.fn(async () => {
      // A real launch takes ~1s. Any delay at all opens the window; this
      // keeps the test fast while still exercising it.
      await new Promise(resolve => setTimeout(resolve, 20));
      return {
        newContext: jest.fn(async () => ({
          newPage: jest.fn(async () => ({ route: jest.fn(), goto: jest.fn(), on: jest.fn() })),
          close: jest.fn(async () => undefined),
        })),
        close: jest.fn(async () => undefined),
      };
    }),
  },
}));

function manager() {
  const m = new SessionManager(true) as unknown as {
    initializeControllerWithPage(): Promise<void>;
    createSession(id: string): Promise<unknown>;
    destroySession(id: string): Promise<void>;
    destroyAll(): Promise<void>;
    stopCleanupTimer(): void;
  };
  m.initializeControllerWithPage = async () => {};
  return m;
}

describe('concurrent createSession (#317)', () => {
  beforeEach(() => { (chromium.launch as jest.Mock).mockClear(); });

  it('launches exactly one Chromium for three concurrent creates', async () => {
    const m = manager();
    await Promise.all([m.createSession('a'), m.createSession('b'), m.createSession('c')]);

    // Was 3 — two leaked processes with no handle to close them.
    expect((chromium.launch as jest.Mock).mock.calls).toHaveLength(1);

    m.stopCleanupTimer();
    await m.destroyAll().catch(() => undefined);
  });

  it('launches one for five, too', async () => {
    const m = manager();
    await Promise.all(['a', 'b', 'c', 'd', 'e'].map(id => m.createSession(id)));
    expect((chromium.launch as jest.Mock).mock.calls).toHaveLength(1);

    m.stopCleanupTimer();
    await m.destroyAll().catch(() => undefined);
  });

  it('sequential creates still reuse the one browser', async () => {
    const m = manager();
    await m.createSession('a');
    await m.createSession('b');
    expect((chromium.launch as jest.Mock).mock.calls).toHaveLength(1);

    m.stopCleanupTimer();
    await m.destroyAll().catch(() => undefined);
  });

  it('relaunches after everything is destroyed', async () => {
    const m = manager();
    await m.createSession('a');
    await m.destroySession('a');
    await m.createSession('b');

    // The single-flight promise must be cleared after it settles, or the
    // second create would await a browser that has since been closed.
    expect((chromium.launch as jest.Mock).mock.calls).toHaveLength(2);

    m.stopCleanupTimer();
    await m.destroyAll().catch(() => undefined);
  });

  it('a failed launch does not poison later creates', async () => {
    const m = manager();
    (chromium.launch as jest.Mock).mockRejectedValueOnce(new Error('launch failed'));

    await expect(m.createSession('a')).rejects.toThrow('launch failed');
    // A cached rejected promise would make every subsequent create fail
    // forever. Clearing it in `finally` is what prevents that.
    await expect(m.createSession('b')).resolves.toBeDefined();

    m.stopCleanupTimer();
    await m.destroyAll().catch(() => undefined);
  });
});
