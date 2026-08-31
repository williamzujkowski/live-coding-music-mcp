/**
 * Tests for the effect consolidation (#153).
 */

import { execute } from '../../server/tools/transform';
import type { ToolContext } from '../../server/tools/types';

function makeCtx(initial = 's("bd")') {
  let pattern = initial;
  const ctx: ToolContext = {
    perfMonitor: {} as any, store: {} as any, generator: {} as any,
    theory: {} as any, sessionManager: {} as any, geminiService: {} as any,
    strudelEngine: {} as any, midiExportService: {} as any, midiImportService: {} as any,
    getAudioCaptureService: async (_sid?: string) => ({}) as any, dropAudioCaptureService: jest.fn(),
    getHistory: () => ({ undoStack: [], redoStack: [], historyStack: [], maxHistory: 100 }), dropHistory: jest.fn(),
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } as any,
    isInitialized: () => true,
    ensureInitialized: async () => {},
    getController: () => ({}) as any,
    getCurrentPatternSafe: async () => pattern,
    writePatternSafe: async (p: string) => { pattern = p; return 'written'; },
  };
  return { ctx, pattern: () => pattern };
}

describe('effect consolidation (#153)', () => {
  it('effect(action=add, with params) appends .effect(params)', async () => {
    const { ctx, pattern } = makeCtx();
    const result = await execute('effect', { action: 'add', effect: 'lpf', params: '1000' }, ctx);
    expect(pattern()).toContain('.lpf(1000)');
    expect(result).toBe('Added lpf effect');
  });

  it('effect(action=add, no params) appends .effect()', async () => {
    const { ctx, pattern } = makeCtx();
    await execute('effect', { action: 'add', effect: 'rev' }, ctx);
    expect(pattern()).toContain('.rev()');
  });

  it('effect(action=remove) strips matching effect call', async () => {
    const { ctx, pattern } = makeCtx();
    await execute('effect', { action: 'add', effect: 'lpf', params: '1000' }, ctx);
    await execute('effect', { action: 'remove', effect: 'lpf' }, ctx);
    expect(pattern()).not.toContain('lpf');
  });

  it('effect(action=remove) reports clean message when nothing to remove', async () => {
    const { ctx } = makeCtx();
    const result: any = await execute('effect', { action: 'remove', effect: 'reverb' }, ctx);
    expect(result.ok).toBe(true);
      // Nothing matched: the strip ran and found none — valid-empty (#288).
      expect(result.empty).toBe(true);
      expect(result.data).toContain('No reverb effect found');
  });

  it('throws on invalid action', async () => {
    const { ctx } = makeCtx();
    await expect(execute('effect', { action: 'toggle', effect: 'lpf' }, ctx)).rejects.toThrow(/Invalid action/);
  });

  /**
   * #236: `effect` was interpolated raw into `new RegExp(...)`, so a
   * caller controlled regex *syntax* as well as the subject string.
   * `(a+)+Z` against a crafted pattern blocked the event loop for 25
   * seconds — the whole server stops answering stdio, with no timeout to
   * break out of a synchronous String.replace.
   *
   * Removal no longer builds a RegExp at all, so the sink is gone rather
   * than guarded; the identifier check remains as the input contract.
   */
  describe('regex injection (#236)', () => {
    it('rejects a catastrophic-backtracking effect name, quickly', async () => {
      const { ctx } = makeCtx('s("bd").' + 'a'.repeat(30) + 'x');

      const started = Date.now();
      await expect(
        execute('effect', { action: 'remove', effect: '(a+)+Z' }, ctx),
      ).rejects.toThrow(/Invalid effect/);

      // The unguarded version took ~25s on this input.
      expect(Date.now() - started).toBeLessThan(1000);
    });

    it.each(['(a+)+Z', '.*', 'a|b', 'lpf()', 'lpf;rm -rf ~', '2fast', ''])(
      'rejects %p as an effect name',
      async effect => {
        const { ctx } = makeCtx();
        await expect(
          execute('effect', { action: 'remove', effect }, ctx),
        ).rejects.toThrow();
      },
    );

    it('rejects an injected effect name on add too', async () => {
      const { ctx } = makeCtx();
      await expect(
        execute('effect', { action: 'add', effect: 'gain(9).x', params: '1' }, ctx),
      ).rejects.toThrow(/Invalid effect/);
    });

    it('still accepts ordinary effect names', async () => {
      const { ctx, pattern } = makeCtx();
      await execute('effect', { action: 'add', effect: 'lpf', params: '1000' }, ctx);
      expect(pattern()).toContain('lpf');
    });
  });

  /**
   * The old `\.effect\([^)]*\)` regex stopped at the FIRST `)`, so a
   * nested call left a stray paren behind and produced a pattern that no
   * longer parsed. Scanning balanced parens fixes that too.
   */
  describe('removal handles nested parentheses', () => {
    it('removes a call containing a nested call', async () => {
      const { ctx, pattern } = makeCtx('s("bd").lpf(add(1,2)).gain(0.5)');

      await execute('effect', { action: 'remove', effect: 'lpf' }, ctx);

      expect(pattern()).toBe('s("bd").gain(0.5)');
    });

    it('removes every occurrence, not just the first', async () => {
      const { ctx, pattern } = makeCtx('s("bd").gain(0.5).lpf(200).gain(0.8)');

      await execute('effect', { action: 'remove', effect: 'gain' }, ctx);

      expect(pattern()).toBe('s("bd").lpf(200)');
    });

    it('removes an empty-argument call', async () => {
      const { ctx, pattern } = makeCtx('s("bd").rev().gain(0.5)');

      await execute('effect', { action: 'remove', effect: 'rev' }, ctx);

      expect(pattern()).toBe('s("bd").gain(0.5)');
    });

    it('leaves an unbalanced pattern alone rather than mangling it', async () => {
      const { ctx } = makeCtx('s("bd").lpf(200');

      const result: any = await execute('effect', { action: 'remove', effect: 'lpf' }, ctx);

      expect(result.ok).toBe(true);
      // Nothing matched: the strip ran and found none — valid-empty (#288).
      expect(result.empty).toBe(true);
      expect(result.data).toContain('No lpf effect found');
    });

    it('does not match an effect name that is only a suffix', async () => {
      const { ctx } = makeCtx('s("bd").hicutoff(200)');

      const result: any = await execute('effect', { action: 'remove', effect: 'cutoff' }, ctx);

      expect(result.ok).toBe(true);
      // Nothing matched: the strip ran and found none — valid-empty (#288).
      expect(result.empty).toBe(true);
      expect(result.data).toContain('No cutoff effect found');
    });
  });
});
