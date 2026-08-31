/**
 * Valid-empty results are reported as such, not as prose (#288).
 *
 * The envelope contract has always had three constructors — ok(), err()
 * and empty(). Before this change `empty()` had zero call sites in all
 * of `src/`: it was defined, documented, exported, passed through
 * unchanged by the dispatcher, and never produced. Eleven sites returned
 * a human-readable "there is nothing here" string that the dispatcher
 * wrapped as `{ok:true, data:"No pattern history yet"}`, which an agent
 * cannot tell apart from a rich result without parsing the prose.
 */

import { execute as historyExecute } from '../../server/tools/history';
import { execute as diagnosticsExecute } from '../../server/tools/diagnostics';
import { execute as transformExecute } from '../../server/tools/transform';
import { execute as sessionExecute } from '../../server/tools/session';
import { execute as editorExecute } from '../../server/tools/editor';
import type { ToolContext, HistoryEntry } from '../../server/tools/types';

function baseCtx(over: Record<string, unknown> = {}): ToolContext {
  let current = 's("bd*4").gain(0.5)';
  const controller = {
    getCurrentPattern: jest.fn(async () => current),
    writePattern: jest.fn(async (p: string) => { current = p; return 'written'; }),
    play: jest.fn(),
    getConsoleErrors: jest.fn(() => []),
    getConsoleWarnings: jest.fn(() => []),
  };
  const bundle = { undoStack: [] as string[], redoStack: [] as string[], historyStack: [] as HistoryEntry[] };
  return {
    perfMonitor: { start: jest.fn(), end: jest.fn() },
    store: {}, generator: {}, theory: {},
    sessionManager: {
      getSessionsInfo: () => [],
      getMaxSessions: () => 5,
      getDefaultSessionId: () => 'default',
    },
    geminiService: { isAvailable: () => false },
    strudelEngine: { queryEvents: () => [] },
    midiExportService: {}, midiImportService: {}, audioExportService: {},
    getAudioCaptureService: async () => ({}),
    dropAudioCaptureService: jest.fn(),
    getHistory: () => ({ ...bundle, maxHistory: 100 }),
    dropHistory: jest.fn(),
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
    isInitialized: () => true,
    ensureInitialized: async () => {},
    getController: () => controller,
    getCurrentPatternSafe: async () => current,
    writePatternSafe: async (p: string) => { current = p; return 'written'; },
    ...over,
  } as unknown as ToolContext;
}

describe('valid-empty results carry the empty flag (#288)', () => {
  it('history undo with a bare stack', async () => {
    const r: any = await historyExecute('history', { action: 'undo' }, baseCtx());
    expect(r).toMatchObject({ ok: true, empty: true, data: 'Nothing to undo' });
  });

  it('history redo with a bare stack', async () => {
    const r: any = await historyExecute('history', { action: 'redo' }, baseCtx());
    expect(r).toMatchObject({ ok: true, empty: true, data: 'Nothing to redo' });
  });

  it('history list returns records, not prose', async () => {
    const r: any = await historyExecute('history', { action: 'list' }, baseCtx());
    expect(r.ok).toBe(true);
    expect(r.empty).toBe(true);
    // The populated branch returns { count, showing, entries }. The
    // empty one must match it so a caller can read `entries`
    // unconditionally instead of branching on a string.
    expect(r.data).toMatchObject({ count: 0, showing: 0, entries: [] });
    expect(Array.isArray(r.data.entries)).toBe(true);
  });

  it('diagnostics level=errors with a clean console', async () => {
    const r: any = await diagnosticsExecute('diagnostics', { level: 'errors' }, baseCtx());
    expect(r.ok).toBe(true);
    expect(r.empty).toBe(true);
  });

  it('effect remove that matched nothing', async () => {
    const r: any = await transformExecute(
      'effect', { action: 'remove', effect: 'reverb' }, baseCtx());
    expect(r.ok).toBe(true);
    expect(r.empty).toBe(true);
    expect(r.data).toContain('No reverb effect found');
  });

  it('session list with no sessions', async () => {
    const r: any = await sessionExecute('session', { action: 'list' }, baseCtx());
    expect(r.ok).toBe(true);
    expect(r.empty).toBe(true);
    expect(r.data.sessions).toEqual([]);
  });

  it('edit_pattern replace that matched nothing', async () => {
    const r: any = await editorExecute(
      'edit_pattern', { mode: 'replace', search: 'nope', replace: 'x' }, baseCtx());
    expect(r.ok).toBe(true);
    expect(r.empty).toBe(true);
    expect(r.data).toMatchObject({ matches: 0, replaced: 0, remaining: 0 });
  });
});

describe('non-empty results are NOT flagged empty (#288)', () => {
  it('effect remove that actually removed something', async () => {
    const r: any = await transformExecute(
      'effect', { action: 'remove', effect: 'gain' }, baseCtx());
    // A plain string return, auto-wrapped by the dispatcher — no flag here.
    expect(typeof r).toBe('string');
    expect(r).toContain('Removed gain');
  });

  it('session list with a session present', async () => {
    const ctx = baseCtx({
      sessionManager: {
        getSessionsInfo: () => [{
          id: 'a', created: new Date(), lastActivity: new Date(), isPlaying: false,
        }],
        getMaxSessions: () => 5,
        getDefaultSessionId: () => 'a',
      },
    });
    const r: any = await sessionExecute('session', { action: 'list' }, ctx);
    expect(r.ok).toBe(true);
    expect(r.empty).toBeUndefined();
    expect(r.data.count).toBe(1);
  });

  it('edit_pattern replace that changed something', async () => {
    const r: any = await editorExecute(
      'edit_pattern', { mode: 'replace', search: 'gain', replace: 'pan' }, baseCtx());
    expect(r.ok).toBe(true);
    expect(r.empty).toBeUndefined();
    expect(r.data.matches).toBe(1);
  });

  it('history list with entries', async () => {
    const stack: HistoryEntry[] = [
      { id: 1, pattern: 's("bd")', action: 'write', timestamp: new Date() },
    ];
    const ctx = baseCtx({
      getHistory: () => ({ undoStack: [], redoStack: [], historyStack: stack, maxHistory: 100 }),
    });
    const r: any = await historyExecute('history', { action: 'list' }, ctx);
    expect(r.empty).toBeUndefined();
    expect(r.count).toBe(1);
  });
});

describe('analysis reports non-measurements as null, not zero (#288)', () => {
  // getTempo/getKey are sub-results composed into analyze's object, so
  // they carry no envelope of their own — an envelope nested inside a
  // data payload is not the contract. The honesty lives in the payload.
  const { execute } = require('../../server/tools/analysis');

  function analysisCtx(detect: Record<string, unknown>): ToolContext {
    return baseCtx({
      getController: () => ({
        getCurrentPattern: jest.fn(async () => 's("bd")'),
        isPlaying: jest.fn(async () => true),
        ...detect,
      }),
    });
  }

  it('no tempo detected gives null, not a measured zero', async () => {
    const r: any = await execute('analyze', { include: ['tempo'] },
      analysisCtx({ detectTempo: async () => ({ bpm: 0, confidence: 0 }) }));
    expect(r.tempo.bpm).toBeNull();
    expect(r.tempo.detected).toBe(false);
  });

  it('a detection error also gives null', async () => {
    const r: any = await execute('analyze', { include: ['tempo'] },
      analysisCtx({ detectTempo: async () => { throw new Error('boom'); } }));
    expect(r.tempo.bpm).toBeNull();
    expect(r.tempo.detected).toBe(false);
    expect(r.tempo.error).toContain('boom');
  });

  it('a real detection is unchanged', async () => {
    const r: any = await execute('analyze', { include: ['tempo'] },
      analysisCtx({ detectTempo: async () => ({ bpm: 174, confidence: 0.9, method: 'onset' }) }));
    expect(r.tempo.bpm).toBe(174);
    expect(r.tempo.detected).toBeUndefined();
  });

  it('no key detected gives null, not the string "Unknown"', async () => {
    const r: any = await execute('analyze', { include: ['key'] },
      analysisCtx({ detectKey: async () => ({ key: 'X', scale: 'major', confidence: 0.05 }) }));
    expect(r.key.key).toBeNull();
    expect(r.key.scale).toBeNull();
    expect(r.key.detected).toBe(false);
  });
});
