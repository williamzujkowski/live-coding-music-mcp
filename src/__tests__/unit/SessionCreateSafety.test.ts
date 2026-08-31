/**
 * Session creation under failure and concurrency (#263).
 *
 * `createSession` allocated a browser context ~2 seconds before it
 * inserted the session, and the MCP SDK does not serialize tool calls —
 * each request is dispatched through a promise chain and returns
 * immediately, with no mutex anywhere in src/.
 *
 * Two consequences, both invisible from outside:
 *
 *  - A failure between allocation and insertion orphaned the context. It
 *    never entered `sessions`, so destroyAll, the idle sweep, and the
 *    MAX_SESSIONS count could none of them see it. Each failed create
 *    leaked a Chromium renderer while the limit still read 0/5 — and a
 *    transient strudel.cc failure is exactly the kind of thing an agent
 *    retries.
 *  - The duplicate and limit checks were stale by the time the session
 *    landed, so concurrent creates could duplicate an id or exceed the
 *    limit.
 */

import { SessionManager } from '../../services/SessionManager';

/** Counts contexts so a leak is observable rather than inferred. */
function fakeBrowser() {
  const open = new Set<object>();
  const browser = {
    newContext: jest.fn(async () => {
      const context = {
        newPage: jest.fn(async () => ({ route: jest.fn(), goto: jest.fn(), on: jest.fn() })),
        close: jest.fn(async () => { open.delete(context); }),
      };
      open.add(context);
      return context;
    }),
    close: jest.fn(async () => undefined),
  };
  return { browser, openContexts: () => open.size };
}

function managerWith(browser: unknown, init: () => Promise<void>) {
  const manager = new SessionManager(true);
  (manager as unknown as { ensureBrowser(): Promise<unknown> }).ensureBrowser = async () => browser;
  (manager as unknown as { initializeControllerWithPage(): Promise<void> })
    .initializeControllerWithPage = init;
  return manager;
}

describe('createSession failure handling', () => {
  it('closes the context when initialization fails', async () => {
    const { browser, openContexts } = fakeBrowser();
    const manager = managerWith(browser, async () => { throw new Error('strudel.cc timed out'); });

    await expect(manager.createSession('a')).rejects.toThrow('strudel.cc timed out');

    expect(openContexts()).toBe(0);
  });

  it('does not leak one context per retry', async () => {
    const { browser, openContexts } = fakeBrowser();
    const manager = managerWith(browser, async () => { throw new Error('nope'); });

    for (let i = 0; i < 5; i++) {
      await manager.createSession('a').catch(() => undefined);
    }

    expect(openContexts()).toBe(0);
  });

  /** A failed create must not consume a slot on the limit. */
  it('leaves the id free after a failure', async () => {
    const { browser } = fakeBrowser();
    let fail = true;
    const manager = managerWith(browser, async () => {
      if (fail) throw new Error('transient');
    });

    await expect(manager.createSession('a')).rejects.toThrow('transient');
    fail = false;

    await expect(manager.createSession('a')).resolves.toBeDefined();
  });
});

describe('createSession concurrency', () => {
  const slowInit = async (): Promise<void> => {
    await new Promise(resolve => setTimeout(resolve, 30));
  };

  it('rejects a duplicate id raced against a create in flight', async () => {
    const { browser, openContexts } = fakeBrowser();
    const manager = managerWith(browser, slowInit);

    const results = await Promise.allSettled([
      manager.createSession('same'),
      manager.createSession('same'),
    ]);

    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(r => r.status === 'rejected')).toHaveLength(1);
    // The loser must not have left a context behind.
    expect(openContexts()).toBe(1);
  });

  it('holds MAX_SESSIONS under concurrent creates', async () => {
    const { browser } = fakeBrowser();
    const manager = managerWith(browser, slowInit);

    const results = await Promise.allSettled(
      ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map(id => manager.createSession(id)),
    );

    // MAX_SESSIONS is 5; without reservation all seven read size === 0.
    expect(results.filter(r => r.status === 'fulfilled').length).toBeLessThanOrEqual(5);
    expect(manager.listSessions().length).toBeLessThanOrEqual(5);
  });

  it('frees the reservation so the id is reusable after destroy', async () => {
    const { browser } = fakeBrowser();
    const manager = managerWith(browser, slowInit);

    await manager.createSession('a');
    await manager.destroySession('a');

    await expect(manager.createSession('a')).resolves.toBeDefined();
  });
});
