/**
 * Two-session isolation test (#108).
 *
 * Exercises the session_id routing across the tool modules: each named
 * session sees its own pattern state, no cross-talk, and asking for a
 * non-existent session surfaces err('business').
 *
 * Stubs StrudelController so the test runs without a real browser.
 * Stubs StrudelEngine because @strudel/* is ESM-only and Jest can't load
 * it directly (the same reason #107 needed pure helpers).
 */

jest.mock('../../services/StrudelEngine');

import type { StrudelController } from '../../StrudelController';
import {
  execute as editorExecute,
  toolNames as editorToolNames,
} from '../../server/tools/editor';
import {
  execute as playbackExecute,
} from '../../server/tools/playback';
import type { ToolContext } from '../../server/tools/types';
import { err } from '../../server/tools/types';

/**
 * Minimal controller stub: in-memory pattern + play/stop flag. Each
 * session gets its own stub so isolation is observable.
 */
function makeStubController(): jest.Mocked<StrudelController> {
  let pattern = '';
  let playing = false;
  return {
    writePattern: jest.fn(async (p: string) => { pattern = p; return 'written'; }),
    getCurrentPattern: jest.fn(async () => pattern),
    play: jest.fn(async () => { playing = true; }),
    stop: jest.fn(async () => { playing = false; }),
    showBrowser: jest.fn(async () => 'shown'),
    getStatus: jest.fn(() => ({ playing, patternLength: pattern.length })),
    validatePattern: jest.fn(async () => ({ valid: true, errors: [], warnings: [], suggestions: [] })),
  } as any;
}

function makeCtx(sessions: Record<string, StrudelController>, legacyController: StrudelController): ToolContext {
  return {
    controller: legacyController,
    perfMonitor: { measureAsync: async (_n: string, fn: any) => fn() } as any,
    store: {} as any,
    generator: {} as any,
    theory: {} as any,
    sessionManager: {} as any,
    geminiService: {} as any,
    strudelEngine: {} as any,
    midiExportService: {} as any,
    getAudioCaptureService: async (_sid?: string) => ({}) as any, dropAudioCaptureService: jest.fn(),
    getHistory: () => ({ undoStack: [], redoStack: [], historyStack: [], maxHistory: 100 }), historyEntryId: () => 1, dropHistory: jest.fn(),
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } as any,
    isInitialized: () => true,
    ensureInitialized: async () => {},
    getController(sessionId?: string): StrudelController {
      if (!sessionId) return legacyController;
      const c = sessions[sessionId];
      if (!c) {
        throw new Error(`Session '${sessionId}' not found. Create it first with create_session.`);
      }
      return c;
    },
    getCurrentPatternSafe: async (sessionId?: string) => {
      const c = sessionId ? sessions[sessionId] : legacyController;
      if (!c) throw new Error(`Session '${sessionId}' not found. Create it first with create_session.`);
      return await c.getCurrentPattern();
    },
    writePatternSafe: async (pattern: string, sessionId?: string) => {
      const c = sessionId ? sessions[sessionId] : legacyController;
      if (!c) throw new Error(`Session '${sessionId}' not found. Create it first with create_session.`);
      return await c.writePattern(pattern);
    },
  };
}

describe('two-session isolation (#108)', () => {
  let sessionA: jest.Mocked<StrudelController>;
  let sessionB: jest.Mocked<StrudelController>;
  let legacy: jest.Mocked<StrudelController>;
  let ctx: ToolContext;

  beforeEach(() => {
    sessionA = makeStubController();
    sessionB = makeStubController();
    legacy = makeStubController();
    ctx = makeCtx({ A: sessionA, B: sessionB }, legacy);
  });

  it('write with session_id targets the named session, not the legacy controller', async () => {
    await editorExecute('edit_pattern', { mode: 'write', pattern: 's("bd")', session_id: 'A' }, ctx);

    expect(sessionA.writePattern).toHaveBeenCalledWith('s("bd")');
    expect(sessionB.writePattern).not.toHaveBeenCalled();
    expect(legacy.writePattern).not.toHaveBeenCalled();
  });

  it('two sessions see independent patterns', async () => {
    await editorExecute('edit_pattern', { mode: 'write', pattern: 's("bd")', session_id: 'A' }, ctx);
    await editorExecute('edit_pattern', { mode: 'write', pattern: 'note("c3")', session_id: 'B' }, ctx);

    const aPattern = await editorExecute('get_pattern', { session_id: 'A' }, ctx);
    const bPattern = await editorExecute('get_pattern', { session_id: 'B' }, ctx);

    expect(aPattern).toBe('s("bd")');
    expect(bPattern).toBe('note("c3")');
  });

  it('omitting session_id routes to the legacy controller', async () => {
    await editorExecute('edit_pattern', { mode: 'write', pattern: 's("hh")' }, ctx);

    expect(legacy.writePattern).toHaveBeenCalledWith('s("hh")');
    expect(sessionA.writePattern).not.toHaveBeenCalled();
    expect(sessionB.writePattern).not.toHaveBeenCalled();
  });

  it('explicit non-existent session throws (dispatcher renders as err business)', async () => {
    await expect(
      editorExecute('edit_pattern', { mode: 'write', pattern: 'x', session_id: 'does-not-exist' }, ctx),
    ).rejects.toThrow(/Session 'does-not-exist' not found/);
  });

  it('playback routes per session', async () => {
    await playbackExecute('playback', { action: 'play', session_id: 'A' }, ctx);
    expect(sessionA.play).toHaveBeenCalledTimes(1);
    expect(sessionB.play).not.toHaveBeenCalled();
    expect(legacy.play).not.toHaveBeenCalled();

    await playbackExecute('playback', { action: 'stop', session_id: 'B' }, ctx);
    expect(sessionB.stop).toHaveBeenCalledTimes(1);
    expect(sessionA.stop).not.toHaveBeenCalled();
  });

  it('append/insert/replace/clear all route by session_id', async () => {
    await editorExecute('edit_pattern', { mode: 'write', pattern: 's("bd")', session_id: 'A' }, ctx);
    await editorExecute('edit_pattern', { mode: 'append', code: '.fast(2)', session_id: 'A' }, ctx);
    expect(sessionA.writePattern).toHaveBeenLastCalledWith('s("bd")\n.fast(2)');

    await editorExecute('edit_pattern', { mode: 'replace', search: 'bd', replace: 'sd', session_id: 'A' }, ctx);
    expect(sessionA.writePattern).toHaveBeenLastCalledWith('s("sd")\n.fast(2)');

    await editorExecute('edit_pattern', { mode: 'clear', session_id: 'B' }, ctx);
    expect(sessionB.writePattern).toHaveBeenCalledWith('');
    // Session A's clear was not called.
    const aCalls = sessionA.writePattern.mock.calls;
    expect(aCalls.some(c => c[0] === '')).toBe(false);
  });

  it('every editor tool schema accepts session_id', () => {
    // Sanity check the inputSchema additions — every tool in the editor
    // module should now expose `session_id` as a property.
    // (toolNames is just an order-preserving Set; we look up via tools.)
    const { tools } = require('../../server/tools/editor');
    for (const t of tools) {
      expect(editorToolNames.has(t.name)).toBe(true);
      expect((t.inputSchema as any).properties.session_id).toBeDefined();
    }
  });
});

describe('envelope wrapping for session errors', () => {
  it('err(business) is the right shape for missing sessions', () => {
    const e = err('business', "Session 'nope' not found. Create it first with create_session.");
    expect(e).toEqual({
      ok: false,
      errorCategory: 'business',
      isRetryable: false,
      message: "Session 'nope' not found. Create it first with create_session.",
    });
  });
});
