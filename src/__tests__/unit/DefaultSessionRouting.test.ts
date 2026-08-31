/**
 * A call with no `session_id` goes to the session you switched to (#421).
 *
 * Two helpers resolved "no session_id" two different ways.
 * `getControllerForSession` went through
 * `sessionManager.getDefaultSession()`; `getCurrentPatternSafe`,
 * `writePatternSafe` and `getAudioCaptureService` went straight to the
 * legacy controller. So after `session({action:'switch'})`, `playback`
 * followed the switch and `edit_pattern` did not.
 *
 * Reproduced against a real browser before the fix:
 *
 *     session(create:'live'); session(switch:'live')
 *     edit_pattern(write, 's("bd*4") // MARKER')      // no session_id
 *     get_pattern(session_id:'live') -> "$: s("[bd <hh oh>]*2")..."   <- untouched
 *     get_pattern()                  -> 's("bd*4") // MARKER'         <- legacy
 *
 * These tests reproduce it without one, by giving the server a session
 * manager that holds a named default session.
 */

import { StrudelMCPServer } from '../../server/server';

interface FakeController {
  getCurrentPattern: jest.Mock;
  writePattern: jest.Mock;
  page: unknown;
}

function fakeController(name: string): FakeController {
  let pattern = `pattern-of-${name}`;
  return {
    getCurrentPattern: jest.fn(async () => pattern),
    writePattern: jest.fn(async (p: string) => { pattern = p; return 'written'; }),
    page: { name },
  };
}

/** A server whose SessionManager holds one session, set as default. */
function serverWithDefaultSession(sessionId: string) {
  const server = new StrudelMCPServer() as unknown as Record<string, any>;
  const sessionController = fakeController(sessionId);
  const legacyController = fakeController('legacy');

  server.controller = legacyController;
  server.isInitialized = true;
  server.sessionManager = {
    getSession: jest.fn((id: string) => (id === sessionId ? sessionController : undefined)),
    getDefaultSession: jest.fn(() => sessionController),
    getDefaultSessionId: jest.fn(() => sessionId),
    getSessionsInfo: jest.fn(() => [{ id: sessionId }]),
    getMaxSessions: jest.fn(() => 5),
  };

  return { server, sessionController, legacyController };
}

describe('a call with no session_id follows the default session (#421)', () => {
  it('writes to the default session, not the legacy controller', async () => {
    const { server, sessionController, legacyController } = serverWithDefaultSession('live');

    await server.writePatternSafe('s("bd*4") // MARKER');

    expect(sessionController.writePattern).toHaveBeenCalledWith('s("bd*4") // MARKER');
    expect(legacyController.writePattern).not.toHaveBeenCalled();
  });

  it('reads from the default session, not the legacy controller', async () => {
    const { server, sessionController, legacyController } = serverWithDefaultSession('live');

    const read = await server.getCurrentPatternSafe();

    expect(read).toBe('pattern-of-live');
    expect(sessionController.getCurrentPattern).toHaveBeenCalled();
    expect(legacyController.getCurrentPattern).not.toHaveBeenCalled();
  });

  it('reads and writes the SAME controller, which was the actual bug', async () => {
    // Either helper alone could be argued either way. The defect was
    // that they disagreed, so this asserts agreement directly.
    const { server, legacyController } = serverWithDefaultSession('live');

    await server.writePatternSafe('marker');
    const read = await server.getCurrentPatternSafe();

    expect(read).toBe('marker');
    expect(legacyController.writePattern).not.toHaveBeenCalled();
  });

  it('falls back to the legacy controller when no session exists', async () => {
    // The fallback is the whole reason a legacy controller still exists;
    // routing everything at SessionManager would break a server that has
    // only ever run init.
    const server = new StrudelMCPServer() as unknown as Record<string, any>;
    const legacyController = fakeController('legacy');
    server.controller = legacyController;
    server.isInitialized = true;
    server.sessionManager = {
      getSession: jest.fn(() => undefined),
      getDefaultSessionId: jest.fn(() => 'default'),
    };

    await server.writePatternSafe('legacy write');

    expect(legacyController.writePattern).toHaveBeenCalledWith('legacy write');
  });

  it('an explicit session_id still wins over the default', async () => {
    const { server, sessionController } = serverWithDefaultSession('live');

    await expect(server.getCurrentPatternSafe('nope')).rejects.toThrow(/not found/i);
    expect(sessionController.getCurrentPattern).not.toHaveBeenCalled();
  });
});
