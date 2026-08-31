/**
 * Three session races, each closed the way the file already closes
 * others (#423 items 5, 6 and 7).
 */

import { SessionManager } from '../../services/SessionManager';

type Sessions = Map<string, Record<string, unknown>>;

/** A manager with planted sessions and no browser. */
function managerWith(ids: string[], lastActivity: Date): {
  manager: SessionManager; sessions: Sessions; closed: string[];
} {
  const manager = new SessionManager(true);
  const closed: string[] = [];
  const sessions = (manager as unknown as { sessions: Sessions }).sessions;
  for (const id of ids) {
    sessions.set(id, {
      controller: {},
      context: { close: async (): Promise<void> => { closed.push(id); } },
      page: {},
      created: new Date(),
      lastActivity,
    });
  }
  return { manager, sessions, closed };
}

describe('the eviction sweep rechecks before it destroys (#423)', () => {
  const longAgo = new Date(Date.now() - 60 * 60 * 1000);

  it('keeps a session that became active during the sweep', async () => {
    // The list is built first and each destroy awaits, so a session used
    // while an earlier one was being torn down was killed anyway.
    const { manager, sessions, closed } = managerWith(['a', 'b'], longAgo);

    // Destroying 'a' refreshes 'b', the way a tool call would.
    const a = sessions.get('a') as Record<string, unknown>;
    a.context = {
      close: async (): Promise<void> => {
        closed.push('a');
        (sessions.get('b') as Record<string, unknown>).lastActivity = new Date();
      },
    };

    await (manager as unknown as { cleanupInactiveSessions: () => Promise<void> })
      .cleanupInactiveSessions();

    expect(closed).toEqual(['a']);
    expect(manager.listSessions()).toEqual(['b']);
  });

  it('still evicts sessions that stay idle', async () => {
    // The recheck must not stop eviction working at all.
    const { manager, closed } = managerWith(['a', 'b'], longAgo);

    await (manager as unknown as { cleanupInactiveSessions: () => Promise<void> })
      .cleanupInactiveSessions();

    expect(closed.sort()).toEqual(['a', 'b']);
    expect(manager.listSessions()).toEqual([]);
  });

  it('leaves a recently used session alone', async () => {
    const { manager, closed } = managerWith(['fresh'], new Date());

    await (manager as unknown as { cleanupInactiveSessions: () => Promise<void> })
      .cleanupInactiveSessions();

    expect(closed).toEqual([]);
  });
});

/**
 * Concurrent `audio_capture` calls must share one recorder injection
 * (#423 item 5).
 *
 * `getAudioCaptureService` was check-then-act: two calls on one uncached
 * session both missed the cache, both constructed a service, both
 * awaited `injectRecorder`, and the last `set` won. `injectRecorder`
 * assigns `window.strudelAudioCapture` unconditionally, so the second
 * injection WIPED a capture the first had started, and the orphaned
 * service still reported itself injected.
 */
describe('concurrent capture-service builds share one injection (#423)', () => {
  it('injects once for two concurrent calls', async () => {
    const { StrudelMCPServer } = await import('../../server/server');
    const server = new StrudelMCPServer() as unknown as Record<string, any>;

    let injections = 0;
    const page = { name: 'page' };
    server.isInitialized = true;
    server.controller = { page };
    // Count injections through the real cache path.
    const { AudioCaptureService } = await import('../../services/AudioCaptureService');
    jest.spyOn(AudioCaptureService.prototype, 'injectRecorder')
      .mockImplementation(async () => {
        injections++;
        // A real injection is not instant, and the whole race lives in
        // this gap.
        await new Promise(resolve => setTimeout(resolve, 20));
      });
    jest.spyOn(AudioCaptureService.prototype, 'isInjectedInto')
      .mockImplementation(async () => true);

    const [a, b] = await Promise.all([
      server.getAudioCaptureService(undefined),
      server.getAudioCaptureService(undefined),
    ]);

    expect(injections).toBe(1);
    // And both callers hold the same recorder, not two fighting over one page.
    expect(a).toBe(b);

    jest.restoreAllMocks();
  });
});
