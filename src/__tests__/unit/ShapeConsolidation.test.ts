/**
 * Tests for the shape consolidation (#154).
 */

import { execute } from '../../server/tools/transform';
import type { ToolContext } from '../../server/tools/types';

function makeCtx() {
  let pattern = 's("bd")';
  const controller = { play: jest.fn(async () => undefined) };
  const ctx: ToolContext = {
    controller: controller as any,
    perfMonitor: {} as any, store: {} as any, generator: {} as any, theory: {} as any,
    sessionManager: {} as any, geminiService: {} as any, strudelEngine: {} as any,
    midiExportService: {} as any, midiImportService: {} as any,
    getAudioCaptureService: async (_sid?: string) => ({}) as any, dropAudioCaptureService: jest.fn(),
    getHistory: () => ({ undoStack: [], redoStack: [], historyStack: [], maxHistory: 100 }), historyEntryId: () => 1, dropHistory: jest.fn(),
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } as any,
    isInitialized: () => true,
    ensureInitialized: async () => {},
    getController: () => controller as any,
    getCurrentPatternSafe: async () => pattern,
    writePatternSafe: async (p: string) => { pattern = p; return 'written'; },
  };
  return { ctx, pattern: () => pattern, controller };
}

describe('shape consolidation (#154)', () => {
  it('shape(dimension=mood) applies a mood profile', async () => {
    const { ctx, pattern } = makeCtx();
    const result = (await execute('shape', { dimension: 'mood', target_mood: 'dark' }, ctx)) as any;
    expect(result.success).toBe(true);
    expect(result.target_mood).toBe('dark');
    expect(pattern()).not.toBe('s("bd")');
  });

  it('shape(dimension=mood) rejects unknown mood', async () => {
    const { ctx } = makeCtx();
    const result = (await execute('shape', { dimension: 'mood', target_mood: 'rage' }, ctx)) as any;
    expect(result.success).toBe(false);
  });

  it('shape(dimension=energy) applies a level', async () => {
    const { ctx, pattern } = makeCtx();
    const result = (await execute('shape', { dimension: 'energy', level: 7 }, ctx)) as any;
    expect(result.success).toBe(true);
    expect(result.level).toBe(7);
    expect(pattern()).toContain('.fast(1.25)');
  });

  it('shape(dimension=energy) rejects out-of-range level', async () => {
    const { ctx } = makeCtx();
    const result = (await execute('shape', { dimension: 'energy', level: 11 }, ctx)) as any;
    expect(result.success).toBe(false);
  });

  it('shape(dimension=refine) applies a known direction', async () => {
    const { ctx, pattern } = makeCtx();
    const result = (await execute('shape', { dimension: 'refine', direction: 'faster' }, ctx)) as any;
    expect(result.success).toBe(true);
    expect(pattern()).toContain('.fast(1.1)');
  });

  it('shape(dimension=refine) rejects unknown direction', async () => {
    const { ctx } = makeCtx();
    const result = (await execute('shape', { dimension: 'refine', direction: 'slanted' }, ctx)) as any;
    expect(result.success).toBe(false);
  });

  it('throws on invalid dimension', async () => {
    const { ctx } = makeCtx();
    await expect(execute('shape', { dimension: 'tempo' }, ctx)).rejects.toThrow(/Invalid dimension/);
  });
});
