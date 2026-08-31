/**
 * Pre-init pattern replay (#262).
 *
 * A pattern produced before a browser exists is stashed so the next
 * `init` can load it. The stash was never cleared, so a SECOND init
 * replayed it over whatever the user had since composed — silently, and
 * unrecoverably, because the replay writes through the controller and
 * only `edit_pattern` pushes history.
 *
 * No concurrency needed. `init` reports "Already initialized" when the
 * browser is alive, which reads as a no-op, so agents call it routinely —
 * especially as a recovery step after any error, which is exactly when
 * the work being destroyed matters most.
 */

import { StrudelMCPServer } from '../../server/server';

// Same mock set the other server tests use: server.ts transitively pulls
// in @strudel/core, which is ESM and this Jest setup cannot load.
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

describe('pre-init pattern replay', () => {
  let server: StrudelMCPServer;
  let controller: { writePattern: jest.Mock; getCurrentPattern: jest.Mock; initialize: jest.Mock; page: unknown };

  beforeEach(() => {
    server = new StrudelMCPServer();
    let live = '';
    controller = {
      initialize: jest.fn(async () => 'Strudel initialized successfully'),
      writePattern: jest.fn(async (p: string) => { live = p; return 'written'; }),
      getCurrentPattern: jest.fn(async () => live),
      page: {},
    };
    (server as unknown as { controller: typeof controller }).controller = controller;
  });

  const exec = (tool: string, args: Record<string, unknown> = {}): Promise<unknown> =>
    (server as unknown as { executeTool(t: string, a: Record<string, unknown>): Promise<unknown> })
      .executeTool(tool, args);

  /** Puts a pattern in the pre-init stash the way a real caller would. */
  const stash = (pattern: string): void => {
    (server as unknown as { pendingPattern: string | null }).pendingPattern = pattern;
  };

  it('replays a pre-init pattern on the first init', async () => {
    stash('s("bd*4")');

    const result = await exec('init');

    expect(controller.writePattern).toHaveBeenCalledWith('s("bd*4")');
    expect(String(result)).toContain('Loaded generated pattern');
  });

  /** The bug: this is what destroyed twenty minutes of composing. */
  it('does not replay it again over later work', async () => {
    stash('PRE_INIT');
    await exec('init');

    await controller.writePattern('COMPOSED_LATER');
    controller.writePattern.mockClear();

    await exec('init');

    expect(controller.writePattern).not.toHaveBeenCalledWith('PRE_INIT');
    expect(await controller.getCurrentPattern()).toBe('COMPOSED_LATER');
  });

  it('says nothing about loading a pattern on a repeat init', async () => {
    stash('PRE_INIT');
    await exec('init');

    expect(String(await exec('init'))).not.toContain('Loaded generated pattern');
  });

  it('keeps only the most recent pre-init pattern', async () => {
    stash('FIRST');
    stash('SECOND');

    await exec('init');

    expect(controller.writePattern).toHaveBeenCalledWith('SECOND');
    expect(controller.writePattern).not.toHaveBeenCalledWith('FIRST');
  });

  /**
   * Two stashes in the same millisecond used to collide on a
   * `pattern_${Date.now()}` key and one was silently dropped.
   */
  it('is not confused by rapid successive stashes', async () => {
    for (const p of ['A', 'B', 'C', 'D']) stash(p);

    await exec('init');

    expect(controller.writePattern).toHaveBeenCalledWith('D');
  });

  it('does not grow without bound', async () => {
    for (let i = 0; i < 50; i++) stash(`p${String(i)}`);

    // One slot, not a map that retains every pre-init pattern forever.
    const pending = (server as unknown as { pendingPattern: string | null }).pendingPattern;
    expect(pending).toBe('p49');
  });

  // No end-to-end case through generate_part: PatternGenerator is mocked
  // here (server.ts pulls in @strudel/core, which is ESM and this Jest
  // setup cannot load), so nothing is produced to stash. The stash field
  // is set directly above instead, and the replay logic — which is what
  // #262 broke — is exercised in full.

  it('init with nothing stashed does not write', async () => {
    await exec('init');

    expect(controller.writePattern).not.toHaveBeenCalled();
  });
});
