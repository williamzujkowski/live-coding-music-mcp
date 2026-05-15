/**
 * Tests for the edit_pattern consolidation (#148).
 *
 * edit_pattern(mode) replaces write/append/insert/replace/clear.
 * get_pattern stays separate (hot read path, not touched).
 */

import { execute } from '../../server/tools/editor';
import type { ToolContext } from '../../server/tools/types';

function makeCtx(initialized = true) {
  let pattern = 's("bd")';
  let played = false;
  const controller = {
    validatePattern: jest.fn(async () => ({ valid: true, errors: [], warnings: [], suggestions: [] })),
    play: jest.fn(async () => { played = true; }),
  };
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
    getHistory: () => ({ undoStack: [], redoStack: [], historyStack: [], maxHistory: 100 }), historyEntryId: () => 1, dropHistory: jest.fn(),
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } as any,
    isInitialized: () => initialized,
    ensureInitialized: async () => {},
    getController: () => controller as any,
    getCurrentPatternSafe: async () => pattern,
    writePatternSafe: async (p: string) => { pattern = p; return 'written'; },
  };
  return { ctx, controller, pattern: () => pattern, played: () => played };
}

describe('edit_pattern consolidation (#148)', () => {
  describe('edit_pattern(mode)', () => {
    it('default mode is write', async () => {
      const { ctx, pattern } = makeCtx();
      await execute('edit_pattern', { pattern: 'new pattern' }, ctx);
      expect(pattern()).toBe('new pattern');
    });

    it('mode=write replaces editor contents', async () => {
      const { ctx, pattern } = makeCtx();
      await execute('edit_pattern', { mode: 'write', pattern: 'fresh' }, ctx);
      expect(pattern()).toBe('fresh');
    });

    it('mode=write runs pattern validation by default', async () => {
      const { ctx, controller } = makeCtx();
      await execute('edit_pattern', { mode: 'write', pattern: 'x' }, ctx);
      expect(controller.validatePattern).toHaveBeenCalledWith('x');
    });

    it('mode=write returns validation failure object when validation fails', async () => {
      const { ctx, controller } = makeCtx();
      (controller.validatePattern as jest.Mock).mockResolvedValueOnce({
        valid: false,
        errors: ['bad syntax'],
        warnings: [],
        suggestions: ['try this'],
      });
      const result = (await execute('edit_pattern', { mode: 'write', pattern: 'bad' }, ctx)) as any;
      expect(result.success).toBe(false);
      expect(result.errors).toContain('bad syntax');
    });

    it('mode=write with auto_play triggers play', async () => {
      const { ctx, played } = makeCtx();
      const result = await execute('edit_pattern', { mode: 'write', pattern: 'x', auto_play: true }, ctx);
      expect(played()).toBe(true);
      expect(result as string).toContain('Playing');
    });

    it('mode=write with validate=false skips validation', async () => {
      const { ctx, controller } = makeCtx();
      await execute('edit_pattern', { mode: 'write', pattern: 'x', validate: false }, ctx);
      expect(controller.validatePattern).not.toHaveBeenCalled();
    });

    it('mode=append concatenates with newline', async () => {
      const { ctx, pattern } = makeCtx();
      await execute('edit_pattern', { mode: 'append', code: '.fast(2)' }, ctx);
      expect(pattern()).toBe('s("bd")\n.fast(2)');
    });

    it('mode=insert places code at the given line', async () => {
      const { ctx, pattern } = makeCtx();
      // Use position=1 — validator requires a positive integer
      await execute('edit_pattern', { mode: 'insert', position: 1, code: 'setcpm(140)' }, ctx);
      // splice at index 1 inserts after the first line; pattern starts as one line `s("bd")`
      expect(pattern()).toContain('setcpm(140)');
    });

    it('mode=replace does string substitution', async () => {
      const { ctx, pattern } = makeCtx();
      await execute('edit_pattern', { mode: 'replace', search: 'bd', replace: 'sd' }, ctx);
      expect(pattern()).toBe('s("sd")');
    });

    it('mode=clear empties the editor', async () => {
      const { ctx, pattern } = makeCtx();
      await execute('edit_pattern', { mode: 'clear' }, ctx);
      expect(pattern()).toBe('');
    });

    it('throws on invalid mode', async () => {
      const { ctx } = makeCtx();
      await expect(execute('edit_pattern', { mode: 'delete', pattern: 'x' }, ctx)).rejects.toThrow(/Invalid mode/);
    });

    it('refuses when default session not initialized', async () => {
      const { ctx } = makeCtx(false);
      const result = await execute('edit_pattern', { mode: 'write', pattern: 'x' }, ctx);
      expect(result).toContain('not initialized');
    });
  });

  describe('get_pattern stays distinct (hot read path)', () => {
    it('get_pattern returns current contents without mutating', async () => {
      const { ctx, pattern } = makeCtx();
      const result = await execute('get_pattern', {}, ctx);
      expect(result).toBe('s("bd")');
      expect(pattern()).toBe('s("bd")');
    });
  });
});
