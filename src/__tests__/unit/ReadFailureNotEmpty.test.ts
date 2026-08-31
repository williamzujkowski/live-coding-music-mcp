/**
 * A read failure is not an empty pattern (#277).
 *
 * `getCurrentPatternSafe` used to catch any read error and return `''`.
 * But `''` already means "the editor is empty", and every
 * read-modify-write caller treats that as a blank canvas:
 *
 *   const current = await ctx.getCurrentPatternSafe(sid);
 *   return await ctx.writePatternSafe(current + '\n' + args.code, sid);
 *
 * So a transient CDP failure made `append` OVERWRITE the live pattern
 * with just the appended line, and report success.
 *
 * Undo could not help: the history pre-hook read through its own bare
 * catch, so the same fault that emptied `current` also skipped the
 * `undoStack.push`. The failure destroyed the work and disabled the one
 * mechanism for getting it back — the same shape as #262, reached by a
 * different path.
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

describe('read failures during an edit', () => {
  let server: StrudelMCPServer;
  let live: string;
  let readFails: boolean;
  let writePattern: jest.Mock;

  beforeEach(() => {
    server = new StrudelMCPServer();
    live = 's("bd*4").gain(0.5).lpf(200)';
    readFails = false;
    writePattern = jest.fn(async (p: string) => { live = p; return 'written'; });
    (server as unknown as { controller: unknown }).controller = {
      initialize: jest.fn(async () => 'ok'),
      isAlive: () => true,
      writePattern,
      getCurrentPattern: jest.fn(async () => {
        if (readFails) throw new Error('Target page, context or browser has been closed');
        return live;
      }),
      page: {},
    };
    (server as unknown as { isInitialized: boolean }).isInitialized = true;
  });

  const dispatch = (tool: string, args: Record<string, unknown>): Promise<{ ok: boolean; message?: string }> =>
    (server as unknown as {
      dispatchToolCall(t: string, a: Record<string, unknown>): Promise<{ ok: boolean; message?: string }>;
    }).dispatchToolCall(tool, args);

  it('does not overwrite the pattern when the read fails', async () => {
    const before = live;
    readFails = true;

    await dispatch('edit_pattern', { mode: 'append', code: '.room(0.3)' });

    expect(live).toBe(before);
  });

  it('reports the failure rather than claiming the append worked', async () => {
    readFails = true;

    const envelope = await dispatch('edit_pattern', { mode: 'append', code: '.room(0.3)' });

    expect(envelope.ok).toBe(false);
  });

  it('does not write a pattern built from an empty read', async () => {
    readFails = true;

    await dispatch('edit_pattern', { mode: 'append', code: '.room(0.3)' });

    // The old bug wrote exactly '\n.room(0.3)' — the appended line alone.
    expect(writePattern).not.toHaveBeenCalledWith(expect.stringMatching(/^\s*\.room/));
  });

  it('insert is affected the same way, and equally protected', async () => {
    const before = live;
    readFails = true;

    await dispatch('edit_pattern', { mode: 'insert', position: 0, code: 'x' });

    expect(live).toBe(before);
  });

  it('still appends normally when the read succeeds', async () => {
    const envelope = await dispatch('edit_pattern', { mode: 'append', code: '.room(0.3)' });

    expect(envelope.ok).toBe(true);
    expect(live).toContain('.room(0.3)');
    expect(live).toContain('s("bd*4")');
  });

  /**
   * transform has no history pre-hook, so it reaches getCurrentPatternSafe
   * directly. This is the case that actually pins that fix — the
   * edit_pattern cases above are protected by the history hook first, so
   * they pass either way and prove less than they appear to.
   */
  it('transform does not rebuild the pattern from an empty read', async () => {
    const before = live;
    readFails = true;

    const envelope = await dispatch('transform', { op: 'reverse' });

    expect(envelope.ok).toBe(false);
    expect(live).toBe(before);
    expect(writePattern).not.toHaveBeenCalled();
  });

  it('transform still works when the read succeeds', async () => {
    const envelope = await dispatch('transform', { op: 'reverse' });

    expect(envelope.ok).toBe(true);
    expect(live).toContain('.rev');
  });

  /**
   * A write does not read first, so it used to succeed while the history
   * hook silently failed to capture the prior state — leaving nothing to
   * undo to.
   */
  it('does not silently proceed with a write it cannot snapshot', async () => {
    readFails = true;

    const envelope = await dispatch('edit_pattern', { mode: 'write', pattern: 'REPLACEMENT' });

    expect(envelope.ok).toBe(false);
    expect(live).not.toBe('REPLACEMENT');
  });
});
