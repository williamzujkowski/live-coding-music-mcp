/**
 * Per-session state teardown and recorder rebinding (#264).
 *
 * The server keys two maps by session id — history bundles and audio
 * capture services — and both were cleared only by the
 * `session({action:'destroy'})` tool handler. Idle eviction calls
 * `SessionManager.destroySession()` directly, which knew nothing about
 * them, so a 30-minute timeout leaked both.
 *
 * The leak was the lesser problem. Recreating a session under the same id
 * returned the evicted session's capture service — bound to a closed page
 * — so every capture failed with "Audio capture not initialized" until
 * restart, and the revived session inherited the old undo stack.
 *
 * The same staleness hit the default session after `init` recovered a
 * dead browser (#206): the cached 'default' service still pointed at the
 * old page, so the recovery mechanism silently broke audio capture.
 */

import { AudioCaptureService } from '../../services/AudioCaptureService';

jest.mock('playwright');

describe('AudioCaptureService page binding', () => {
  const pageA = { evaluate: jest.fn(async () => undefined) } as never;
  const pageB = { evaluate: jest.fn(async () => undefined) } as never;

  it('reports no binding before injection', () => {
    expect(new AudioCaptureService().isInjectedInto(pageA)).toBe(false);
  });

  it('reports the page it was injected into', async () => {
    const service = new AudioCaptureService();
    await service.injectRecorder(pageA);

    expect(service.isInjectedInto(pageA)).toBe(true);
  });

  /** The whole point: a recreated session or recovered browser is a NEW page. */
  it('reports a different page as not bound', async () => {
    const service = new AudioCaptureService();
    await service.injectRecorder(pageA);

    expect(service.isInjectedInto(pageB)).toBe(false);
  });

  it('rebinds when injected into another page', async () => {
    const service = new AudioCaptureService();
    await service.injectRecorder(pageA);
    await service.injectRecorder(pageB);

    expect(service.isInjectedInto(pageB)).toBe(true);
    expect(service.isInjectedInto(pageA)).toBe(false);
  });
});

describe('session teardown notifies the owner', () => {
  /**
   * Verified against the real SessionManager rather than a mock, since
   * the defect was precisely that one teardown path did not notify.
   */
  it('fires the callback from destroySession', async () => {
    jest.resetModules();
    const { SessionManager } = await import('../../services/SessionManager');
    const manager = new SessionManager(true);
    const destroyed: string[] = [];
    manager.onSessionDestroyed = (id: string): void => { destroyed.push(id); };

    // Plant a session without launching a browser.
    (manager as unknown as { sessions: Map<string, unknown> }).sessions.set('live', {
      controller: {}, context: { close: jest.fn(async () => undefined) },
      page: {}, created: new Date(), lastActivity: new Date(),
    });

    await manager.destroySession('live');

    expect(destroyed).toEqual(['live']);
  });

  it('survives a throwing callback rather than aborting teardown', async () => {
    jest.resetModules();
    const { SessionManager } = await import('../../services/SessionManager');
    const manager = new SessionManager(true);
    manager.onSessionDestroyed = (): void => { throw new Error('subscriber blew up'); };

    (manager as unknown as { sessions: Map<string, unknown> }).sessions.set('live', {
      controller: {}, context: { close: jest.fn(async () => undefined) },
      page: {}, created: new Date(), lastActivity: new Date(),
    });

    await expect(manager.destroySession('live')).resolves.toBeUndefined();
    expect((manager as unknown as { sessions: Map<string, unknown> }).sessions.has('live')).toBe(false);
  });
});
