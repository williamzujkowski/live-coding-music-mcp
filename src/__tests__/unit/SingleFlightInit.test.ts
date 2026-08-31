/**
 * Single-flight initialization and transport resolution (#265).
 *
 * The MCP SDK does not serialize tool calls — each request is dispatched
 * through a promise chain and returns immediately, and there is no mutex
 * anywhere in src/. So check-then-act across an await genuinely
 * interleaves.
 *
 * `ensureInitialized` was exactly that shape: two `compose` calls
 * arriving together both passed the `isInitialized` check, both called
 * `initialize()`, and the second assignment orphaned the first Chromium
 * process — unreachable by `cleanup()`, which only closes the current
 * handle. With the default `headless: false` the user also got two
 * windows and half their calls addressing the wrong one.
 */

import { StrudelMCPServer } from '../../server/server';

jest.mock('../../StrudelController');
jest.mock('../../PatternStore');
jest.mock('../../services/MusicTheory');
jest.mock('../../services/PatternGenerator');
jest.mock('../../services/GeminiService');
jest.mock('../../services/AudioCaptureService');
jest.mock('../../services/SessionManager');
jest.mock('../../services/StrudelEngine');
jest.mock('fs', () => ({
  readFileSync: jest.fn().mockReturnValue('{"headless": true}'),
  existsSync: jest.fn().mockReturnValue(true),
  mkdirSync: jest.fn(),
  writeFileSync: jest.fn(),
}));

describe('single-flight auto-init', () => {
  let server: StrudelMCPServer;
  let initialize: jest.Mock;
  let alive: boolean;

  beforeEach(() => {
    server = new StrudelMCPServer();
    alive = false;
    initialize = jest.fn(async () => {
      // A real launch takes ~2s; the window is what made this racy.
      await new Promise(resolve => setTimeout(resolve, 30));
      alive = true;
      return 'Strudel initialized successfully';
    });
    (server as unknown as { controller: unknown }).controller = {
      initialize,
      isAlive: () => alive,
      writePattern: jest.fn(async () => 'written'),
      getCurrentPattern: jest.fn(async () => ''),
      page: {},
    };
  });

  const ensure = (): Promise<void> =>
    (server as unknown as { ensureInitialized(): Promise<void> }).ensureInitialized();

  it('launches one browser for concurrent callers', async () => {
    await Promise.all([ensure(), ensure(), ensure(), ensure()]);

    expect(initialize).toHaveBeenCalledTimes(1);
  });

  it('all concurrent callers see initialization complete', async () => {
    await Promise.all([ensure(), ensure(), ensure()]);

    expect((server as unknown as { isInitialized: boolean }).isInitialized).toBe(true);
  });

  it('does not re-initialize once up', async () => {
    await ensure();
    await ensure();

    expect(initialize).toHaveBeenCalledTimes(1);
  });

  it('releases the in-flight slot so a later failure can retry', async () => {
    initialize.mockRejectedValueOnce(new Error('launch failed'));

    await expect(ensure()).rejects.toThrow('launch failed');

    // A stuck promise here would make the server permanently un-initializable.
    await ensure();
    expect(initialize).toHaveBeenCalledTimes(2);
  });

  /**
   * `isInitialized` was only ever set true, so after the browser died
   * this returned early and never reached the self-healing initialize().
   * `compose` — the tool that advertises auto-init — failed permanently.
   */
  it('re-initializes after the browser dies', async () => {
    await ensure();
    expect(initialize).toHaveBeenCalledTimes(1);

    alive = false; // user closed the window

    await ensure();
    expect(initialize).toHaveBeenCalledTimes(2);
  });

  it('treats an unanswerable liveness check as alive', async () => {
    await ensure();
    (server as unknown as { controller: { isAlive?: unknown } }).controller.isAlive = undefined;

    await ensure();

    // Assuming dead would tear down a working browser on every call.
    expect(initialize).toHaveBeenCalledTimes(1);
  });
});
