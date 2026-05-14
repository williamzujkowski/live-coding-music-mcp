/**
 * Tests for the history consolidation (#145).
 *
 * Verifies history(action) covers undo/redo/list/restore/compare and
 * that the five legacy aliases still forward correctly during the
 * deprecation window.
 */

import { execute } from '../../server/tools/history';
import type { HistoryEntry, ToolContext } from '../../server/tools/types';

function makeCtx(initialized = true) {
  let currentPattern = 's("bd")';
  const controller = {
    getCurrentPattern: jest.fn(async () => currentPattern),
    writePattern: jest.fn(async (p: string) => { currentPattern = p; return 'written'; }),
  };
  // Per-session bundles keyed by sid (or 'default'). #179 made history
  // session-scoped; the test uses one bundle since each case mocks one
  // session.
  const bundles = new Map<string, { undoStack: string[]; redoStack: string[]; historyStack: HistoryEntry[] }>();
  function getBundle(id = 'default') {
    let b = bundles.get(id);
    if (!b) {
      b = { undoStack: [], redoStack: [], historyStack: [] };
      bundles.set(id, b);
    }
    return b;
  }
  // Expose the default bundle as `history` for tests that push directly.
  const history = getBundle('default') as any;
  history.maxHistory = 100;
  let idCounter = 0;
  const ctx: ToolContext = {
    controller: controller as any,
    perfMonitor: {} as any,
    store: {} as any,
    generator: {} as any,
    theory: {} as any,
    sessionManager: {} as any,
    geminiService: {} as any,
    strudelEngine: {} as any,
    midiExportService: {} as any,
    getAudioCaptureService: async (_sid?: string) => ({}) as any, dropAudioCaptureService: jest.fn(),
    getHistory: (sid?: string) => {
      const b = getBundle(sid ?? 'default');
      return { ...b, maxHistory: 100 };
    },
    historyEntryId: () => ++idCounter,
    dropHistory: (sid: string) => { bundles.delete(sid); },
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } as any,
    isInitialized: () => initialized,
    ensureInitialized: async () => {},
    getController: () => controller as any,
    getCurrentPatternSafe: async () => currentPattern,
    writePatternSafe: async (p: string) => { currentPattern = p; return 'written'; },
  };
  return { ctx, controller, history, currentPattern: () => currentPattern };
}

function entry(id: number, pattern: string, action = 'write'): HistoryEntry {
  return { id, pattern, action, timestamp: new Date() };
}

describe('history consolidation (#145)', () => {
  describe('history(action=undo)', () => {
    it('pops the undo stack and restores the previous pattern', async () => {
      const { ctx, history, controller } = makeCtx();
      history.undoStack.push('previous');
      const result = await execute('history', { action: 'undo' }, ctx);
      expect(result).toBe('Undone');
      expect(controller.writePattern).toHaveBeenCalledWith('previous');
      expect(history.redoStack).toContain('s("bd")');
    });

    it('returns "Nothing to undo" when stack empty', async () => {
      const { ctx } = makeCtx();
      const result = await execute('history', { action: 'undo' }, ctx);
      expect(result).toBe('Nothing to undo');
    });

    it('returns init error when default session not up', async () => {
      const { ctx, history } = makeCtx(false);
      history.undoStack.push('previous');
      const result = await execute('history', { action: 'undo' }, ctx);
      expect(result).toContain('not initialized');
    });
  });

  describe('history(action=redo)', () => {
    it('pops the redo stack and re-applies', async () => {
      const { ctx, history, controller } = makeCtx();
      history.redoStack.push('next');
      const result = await execute('history', { action: 'redo' }, ctx);
      expect(result).toBe('Redone');
      expect(controller.writePattern).toHaveBeenCalledWith('next');
    });

    it('returns "Nothing to redo" when stack empty', async () => {
      const { ctx } = makeCtx();
      const result = await execute('history', { action: 'redo' }, ctx);
      expect(result).toBe('Nothing to redo');
    });
  });

  describe('history(action=list)', () => {
    it('returns formatted entries with previews', async () => {
      const { ctx, history } = makeCtx();
      history.historyStack.push(entry(1, 's("bd")'));
      history.historyStack.push(entry(2, 'note("c3")'));
      const result = (await execute('history', { action: 'list' }, ctx)) as any;
      expect(result.count).toBe(2);
      expect(result.entries[0].id).toBe(2); // reverse order
      expect(result.entries[0].preview).toContain('note');
    });

    it('respects limit', async () => {
      const { ctx, history } = makeCtx();
      for (let i = 1; i <= 25; i++) history.historyStack.push(entry(i, `p${i}`));
      const result = (await execute('history', { action: 'list', limit: 5 }, ctx)) as any;
      expect(result.showing).toBe(5);
    });

    it('returns clean message when empty', async () => {
      const { ctx } = makeCtx();
      const result = await execute('history', { action: 'list' }, ctx);
      expect(result).toContain('No pattern history yet');
    });
  });

  describe('history(action=restore)', () => {
    it('restores an entry by id, pushing current to undo', async () => {
      const { ctx, history, controller } = makeCtx();
      history.historyStack.push(entry(42, 'old pattern'));
      const result = await execute('history', { action: 'restore', id: 42 }, ctx);
      expect(result).toContain('#42');
      expect(controller.writePattern).toHaveBeenCalledWith('old pattern');
      expect(history.undoStack).toContain('s("bd")');
    });

    it('reports missing id', async () => {
      const { ctx } = makeCtx();
      const result = await execute('history', { action: 'restore', id: 999 }, ctx);
      expect(result).toContain('#999 not found');
    });
  });

  describe('history(action=compare)', () => {
    it('compares two entries by id', async () => {
      const { ctx, history } = makeCtx();
      history.historyStack.push(entry(1, 'aaa'));
      history.historyStack.push(entry(2, 'bbb'));
      const result = (await execute('history', { action: 'compare', id1: 1, id2: 2 }, ctx)) as any;
      expect(result.pattern1.id).toBe(1);
      expect(result.pattern2.id).toBe('#2');
      expect(result.summary).toBeDefined();
    });

    it('compares an entry vs current when id2 omitted', async () => {
      const { ctx, history } = makeCtx();
      history.historyStack.push(entry(1, 'aaa'));
      const result = (await execute('history', { action: 'compare', id1: 1 }, ctx)) as any;
      expect(result.pattern2.id).toBe('current');
    });
  });

  describe('invalid action', () => {
    it('throws on missing action', async () => {
      const { ctx } = makeCtx();
      await expect(execute('history', {}, ctx)).rejects.toThrow(/Invalid action/);
    });

    it('throws on unknown action', async () => {
      const { ctx } = makeCtx();
      await expect(execute('history', { action: 'clear' }, ctx)).rejects.toThrow(/Invalid action/);
    });
  });

  describe('legacy aliases forward (deprecation window)', () => {
    it('undo alias matches history(action=undo)', async () => {
      const { ctx, history } = makeCtx();
      history.undoStack.push('prev');
      const aliasResult = await execute('undo', {}, ctx);
      expect(aliasResult).toBe('Undone');
    });

    it('list_history alias matches history(action=list)', async () => {
      const { ctx, history } = makeCtx();
      history.historyStack.push(entry(1, 'x'));
      const alias = (await execute('list_history', {}, ctx)) as any;
      const direct = (await execute('history', { action: 'list' }, ctx)) as any;
      expect(alias.count).toBe(direct.count);
    });

    it('restore_history alias matches history(action=restore)', async () => {
      const { ctx, history } = makeCtx();
      history.historyStack.push(entry(5, 'restored'));
      const aliasResult = await execute('restore_history', { id: 5 }, ctx);
      expect(aliasResult).toContain('#5');
    });

    it('compare_patterns alias matches history(action=compare)', async () => {
      const { ctx, history } = makeCtx();
      history.historyStack.push(entry(1, 'a'));
      history.historyStack.push(entry(2, 'b'));
      const alias = (await execute('compare_patterns', { id1: 1, id2: 2 }, ctx)) as any;
      const direct = (await execute('history', { action: 'compare', id1: 1, id2: 2 }, ctx)) as any;
      expect(alias.summary).toEqual(direct.summary);
    });
  });
});
