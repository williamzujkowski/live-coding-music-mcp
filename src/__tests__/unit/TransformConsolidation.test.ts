/**
 * Tests for the transform consolidation (#147).
 *
 * transform(op) replaces 8 transform verbs. Effects, mood/energy/refine,
 * and set_tempo stay separate (Phase 3 / future).
 */

import { execute } from '../../server/tools/transform';
import type { ToolContext } from '../../server/tools/types';

function makeCtx() {
  let pattern = 'note("c3")';
  const generator = {
    generateVariation: jest.fn((p: string, type: string) => `${p}.vary(${type})`),
  };
  const ctx: ToolContext = {
    controller: {} as any,
    perfMonitor: {} as any,
    store: {} as any,
    generator: generator as any,
    theory: {} as any,
    sessionManager: {} as any,
    geminiService: {} as any,
    strudelEngine: {} as any,
    midiExportService: {} as any,
    getAudioCaptureService: async () => ({}) as any,
    history: { undoStack: [], redoStack: [], historyStack: [], maxHistory: 100 },
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } as any,
    isInitialized: () => true,
    ensureInitialized: async () => {},
    getController: () => ({ play: jest.fn() }) as any,
    getCurrentPatternSafe: async () => pattern,
    writePatternSafe: async (p: string) => { pattern = p; return 'written'; },
  };
  return { ctx, generator, pattern: () => pattern };
}

describe('transform consolidation (#147)', () => {
  describe('transform(op)', () => {
    it('op=transpose shifts notes', async () => {
      const { ctx, pattern } = makeCtx();
      await execute('transform', { op: 'transpose', semitones: 7 }, ctx);
      expect(pattern()).not.toBe('note("c3")');
      // c3 + 7 = g3
      expect(pattern()).toContain('g3');
    });

    it('op=transpose throws on non-integer semitones', async () => {
      const { ctx } = makeCtx();
      await expect(execute('transform', { op: 'transpose', semitones: 1.5 }, ctx))
        .rejects.toThrow(/integer/);
    });

    it('op=reverse appends .rev', async () => {
      const { ctx, pattern } = makeCtx();
      await execute('transform', { op: 'reverse' }, ctx);
      expect(pattern()).toBe('note("c3").rev');
    });

    it('op=stretch appends .slow(factor)', async () => {
      const { ctx, pattern } = makeCtx();
      await execute('transform', { op: 'stretch', factor: 2 }, ctx);
      expect(pattern()).toContain('.slow(2)');
    });

    it('op=quantize appends .struct', async () => {
      const { ctx, pattern } = makeCtx();
      await execute('transform', { op: 'quantize', grid: '1/16' }, ctx);
      expect(pattern()).toContain('.struct("1/16")');
    });

    it('op=humanize appends .nudge', async () => {
      const { ctx, pattern } = makeCtx();
      await execute('transform', { op: 'humanize', amount: 0.05 }, ctx);
      expect(pattern()).toContain('.nudge');
    });

    it('op=swing appends .swing(amount)', async () => {
      const { ctx, pattern } = makeCtx();
      await execute('transform', { op: 'swing', amount: 0.3 }, ctx);
      expect(pattern()).toContain('.swing(0.3)');
    });

    it('op=scale appends .scale("root:scale")', async () => {
      const { ctx, pattern } = makeCtx();
      await execute('transform', { op: 'scale', root: 'C', scale: 'minor' }, ctx);
      expect(pattern()).toContain('.scale("C:minor")');
    });

    it('op=vary defers to PatternGenerator.generateVariation', async () => {
      const { ctx, generator, pattern } = makeCtx();
      await execute('transform', { op: 'vary', type: 'glitch' }, ctx);
      expect(generator.generateVariation).toHaveBeenCalledWith('note("c3")', 'glitch');
      expect(pattern()).toContain('.vary(glitch)');
    });

    it('op=vary defaults type to subtle', async () => {
      const { ctx, generator } = makeCtx();
      await execute('transform', { op: 'vary' }, ctx);
      expect(generator.generateVariation).toHaveBeenCalledWith('note("c3")', 'subtle');
    });

    it('throws on invalid op', async () => {
      const { ctx } = makeCtx();
      await expect(execute('transform', { op: 'fold' }, ctx)).rejects.toThrow(/Invalid op/);
    });
  });

  describe('legacy aliases forward (deprecation window)', () => {
    it('transpose alias matches transform(op=transpose)', async () => {
      const { ctx: a, pattern: pa } = makeCtx();
      const { ctx: b, pattern: pb } = makeCtx();
      await execute('transpose', { semitones: 5 }, a);
      await execute('transform', { op: 'transpose', semitones: 5 }, b);
      expect(pa()).toBe(pb());
    });

    it('reverse alias forwards', async () => {
      const { ctx, pattern } = makeCtx();
      await execute('reverse', {}, ctx);
      expect(pattern()).toBe('note("c3").rev');
    });

    it('stretch alias forwards', async () => {
      const { ctx, pattern } = makeCtx();
      await execute('stretch', { factor: 0.5 }, ctx);
      expect(pattern()).toContain('.slow(0.5)');
    });

    it('quantize alias forwards', async () => {
      const { ctx, pattern } = makeCtx();
      await execute('quantize', { grid: '1/8' }, ctx);
      expect(pattern()).toContain('.struct("1/8")');
    });

    it('humanize alias forwards', async () => {
      const { ctx, pattern } = makeCtx();
      await execute('humanize', { amount: 0.02 }, ctx);
      expect(pattern()).toContain('.nudge');
    });

    it('generate_variation alias matches transform(op=vary)', async () => {
      const { ctx: a, pattern: pa } = makeCtx();
      const { ctx: b, pattern: pb } = makeCtx();
      await execute('generate_variation', { type: 'evolving' }, a);
      await execute('transform', { op: 'vary', type: 'evolving' }, b);
      expect(pa()).toBe(pb());
    });

    it('add_swing alias forwards', async () => {
      const { ctx, pattern } = makeCtx();
      await execute('add_swing', { amount: 0.4 }, ctx);
      expect(pattern()).toContain('.swing(0.4)');
    });

    it('apply_scale alias forwards', async () => {
      const { ctx, pattern } = makeCtx();
      await execute('apply_scale', { root: 'D', scale: 'dorian' }, ctx);
      expect(pattern()).toContain('.scale("D:dorian")');
    });
  });

  describe('untouched tools still work (separate consolidations)', () => {
    it('add_effect still mutates as before', async () => {
      const { ctx, pattern } = makeCtx();
      await execute('add_effect', { effect: 'reverb', params: '0.5' }, ctx);
      expect(pattern()).toContain('.reverb(0.5)');
    });

    it('set_tempo still prepends setcpm', async () => {
      const { ctx, pattern } = makeCtx();
      await execute('set_tempo', { bpm: 140 }, ctx);
      expect(pattern()).toContain('setcpm(140)');
    });
  });
});
