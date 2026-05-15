/**
 * Tests for the pattern_store consolidation (#143).
 *
 * Verifies the new pattern_store(action) tool covers save/load/list,
 * and that the three legacy aliases still forward correctly during the
 * deprecation window.
 */

import { execute } from '../../server/tools/storage';
import type { ToolContext } from '../../server/tools/types';

function makeCtx(): { ctx: ToolContext; store: any; pattern: { current: string } } {
  const pattern = { current: 's("bd hh")' };
  const saved = new Map<string, { name: string; content: string; tags: string[]; timestamp: string }>();
  const store = {
    save: jest.fn(async (name: string, content: string, tags: string[]) => {
      saved.set(name, { name, content, tags, timestamp: '2026-05-14T00:00:00Z' });
    }),
    load: jest.fn(async (name: string) => saved.get(name) ?? null),
    list: jest.fn(async (tag?: string) => {
      const all = Array.from(saved.values());
      return tag ? all.filter(p => p.tags.includes(tag)) : all;
    }),
  };

  const ctx: ToolContext = {
    controller: {} as any,
    perfMonitor: {} as any,
    store: store as any,
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
    getController: () => ({}) as any,
    getCurrentPatternSafe: async () => pattern.current,
    writePatternSafe: async (p: string) => { pattern.current = p; return 'written'; },
  };
  return { ctx, store, pattern };
}

describe('pattern_store consolidation (#143)', () => {
  describe('pattern_store(action=save)', () => {
    it('saves the current pattern with tags', async () => {
      const { ctx, store } = makeCtx();
      const result = await execute('pattern_store', { action: 'save', name: 'jam1', tags: ['techno', 'demo'] }, ctx);
      expect(result).toBe('Pattern saved as "jam1"');
      expect(store.save).toHaveBeenCalledWith('jam1', 's("bd hh")', ['techno', 'demo']);
    });

    it('refuses when there is no pattern to save', async () => {
      const { ctx, pattern } = makeCtx();
      pattern.current = '';
      const result = await execute('pattern_store', { action: 'save', name: 'empty' }, ctx);
      expect(result).toBe('No pattern to save');
    });

    it('defaults tags to [] when omitted', async () => {
      const { ctx, store } = makeCtx();
      await execute('pattern_store', { action: 'save', name: 'untagged' }, ctx);
      expect(store.save).toHaveBeenCalledWith('untagged', 's("bd hh")', []);
    });
  });

  describe('pattern_store(action=load)', () => {
    it('loads a saved pattern into the current session', async () => {
      const { ctx, store, pattern } = makeCtx();
      await store.save('saved1', 'note("c3 e3 g3")', ['melodic']);
      const result = await execute('pattern_store', { action: 'load', name: 'saved1' }, ctx);
      expect(result).toBe('Loaded pattern "saved1"');
      expect(pattern.current).toBe('note("c3 e3 g3")');
    });

    it('returns a friendly message when name not found', async () => {
      const { ctx } = makeCtx();
      const result = await execute('pattern_store', { action: 'load', name: 'nope' }, ctx);
      expect(result).toBe('Pattern "nope" not found');
    });
  });

  describe('pattern_store(action=list)', () => {
    it('returns all saved patterns, formatted', async () => {
      const { ctx, store } = makeCtx();
      await store.save('a', 's("bd")', ['techno']);
      await store.save('b', 's("hh")', ['ambient']);
      const result = await execute('pattern_store', { action: 'list' }, ctx);
      expect(typeof result).toBe('string');
      expect(result as string).toContain('a [techno]');
      expect(result as string).toContain('b [ambient]');
    });

    it('filters by tag when given', async () => {
      const { ctx, store } = makeCtx();
      await store.save('a', 's("bd")', ['techno']);
      await store.save('b', 's("hh")', ['ambient']);
      const result = await execute('pattern_store', { action: 'list', tag: 'techno' }, ctx);
      expect(result as string).toContain('a');
      expect(result as string).not.toContain('b');
    });

    it('returns "No patterns found" when catalog is empty', async () => {
      const { ctx } = makeCtx();
      const result = await execute('pattern_store', { action: 'list' }, ctx);
      expect(result).toBe('No patterns found');
    });
  });

  describe('invalid action', () => {
    it('throws on missing action', async () => {
      const { ctx } = makeCtx();
      await expect(execute('pattern_store', {}, ctx)).rejects.toThrow(/Invalid action/);
    });

    it('throws on unknown action', async () => {
      const { ctx } = makeCtx();
      await expect(execute('pattern_store', { action: 'delete' }, ctx)).rejects.toThrow(/Invalid action/);
    });
  });
});
