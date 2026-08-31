/**
 * Tests for the edit_pattern consolidation (#148).
 *
 * edit_pattern(mode) replaces write/append/insert/replace/clear.
 * get_pattern stays separate (hot read path, not touched).
 */

import { execute } from '../../server/tools/editor';
import type { ToolContext } from '../../server/tools/types';

function makeCtx(initialOrFlag: string | boolean = true) {
  const initialized = typeof initialOrFlag === 'boolean' ? initialOrFlag : true;
  let pattern = typeof initialOrFlag === 'string' ? initialOrFlag : 's("bd")';
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
    midiExportService: {} as any, midiImportService: {} as any,
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

/**
 * #243: replace substituted only the FIRST occurrence and said nothing
 * about it. Given `s("bd*4").gain(0.5).lpf(200).gain(0.8)`, an agent
 * asked to swap gain for pan got one of the two changed with no signal
 * that the other survived — and these callers are LLM agents, which do
 * not reliably re-read the pattern to check.
 *
 * The behaviour was documented, so it was a contract question rather than
 * a defect. Consensus (5/6) chose an explicit opt-in flag over silently
 * flipping the default, since an agent that read the old schema would
 * otherwise be surprised in the opposite direction.
 */
describe('edit_pattern replace occurrence handling (#243)', () => {
  const MULTI = 's("bd*4").gain(0.5).lpf(200).gain(0.8)';

  it('replaces only the first occurrence by default', async () => {
    const { ctx, pattern } = makeCtx(MULTI);

    await execute('edit_pattern', { mode: 'replace', search: 'gain', replace: 'pan' }, ctx);

    expect(pattern()).toBe('s("bd*4").pan(0.5).lpf(200).gain(0.8)');
  });

  it('replaces every occurrence when asked', async () => {
    const { ctx, pattern } = makeCtx(MULTI);

    await execute('edit_pattern',
      { mode: 'replace', search: 'gain', replace: 'pan', replace_all: true }, ctx);

    expect(pattern()).toBe('s("bd*4").pan(0.5).lpf(200).pan(0.8)');
  });

  it('tells the caller what survived', async () => {
    const { ctx } = makeCtx(MULTI);

    const result = (await execute('edit_pattern',
      { mode: 'replace', search: 'gain', replace: 'pan' }, ctx)) as any;

    expect(result).toMatchObject({ matches: 2, replaced: 1, remaining: 1 });
    expect(result.message).toMatch(/replace_all/);
  });

  it('reports nothing remaining after a replace-all', async () => {
    const { ctx } = makeCtx(MULTI);

    const result = (await execute('edit_pattern',
      { mode: 'replace', search: 'gain', replace: 'pan', replace_all: true }, ctx)) as any;

    expect(result).toMatchObject({ matches: 2, replaced: 2, remaining: 0 });
    expect(result.message).not.toMatch(/remain/);
  });

  it('says so when nothing matched', async () => {
    const { ctx, pattern } = makeCtx(MULTI);

    const result = (await execute('edit_pattern',
      { mode: 'replace', search: 'nope', replace: 'x' }, ctx)) as any;

    expect(result).toMatchObject({ matches: 0, replaced: 0, remaining: 0 });
    expect(result.message).toMatch(/No occurrences/);
    expect(pattern()).toBe(MULTI);
  });

  /**
   * Literal string ops throughout — never a RegExp built from `search`.
   * Interpolating caller text into a pattern is how #236 happened: a
   * crafted `(a+)+Z` blocked the event loop for 25 seconds.
   */
  it.each(['(a+)+Z', '.*', 'gain(0.5)', '[', '\\d+', '$&'])(
    'treats %p as a literal, not a pattern',
    async search => {
      const { ctx } = makeCtx('s("bd").gain(0.5)');

      const started = Date.now();
      const result = (await execute('edit_pattern',
        { mode: 'replace', search, replace: 'X', replace_all: true }, ctx)) as any;

      expect(Date.now() - started).toBeLessThan(1000);
      expect(typeof result.matches).toBe('number');
    },
  );

  it('rejects an empty search rather than looping over every character', async () => {
    const { ctx } = makeCtx(MULTI);

    await expect(execute('edit_pattern', { mode: 'replace', search: '', replace: 'x' }, ctx))
      .rejects.toThrow(/non-empty/);
  });

  it('still escapes $ sequences in the replacement', async () => {
    const { ctx, pattern } = makeCtx('s("bd").gain(0.5)');

    await execute('edit_pattern', { mode: 'replace', search: 'gain', replace: '$&x' }, ctx);

    expect(pattern()).toContain('$&x');
  });
});
