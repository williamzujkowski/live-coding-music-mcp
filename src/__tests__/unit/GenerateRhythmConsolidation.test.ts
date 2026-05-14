/**
 * Tests for the generate_rhythm consolidation (#151).
 */

import { execute } from '../../server/tools/generate';
import type { ToolContext } from '../../server/tools/types';

function makeCtx() {
  let pattern = '';
  const generator = {
    generateEuclideanPattern: jest.fn((h, s, sound) => `euc(${h}/${s}/${sound})`),
    generatePolyrhythm: jest.fn((sounds, patterns) => `poly(${sounds.join(',')}/${patterns.join(',')})`),
  };
  const ctx: ToolContext = {
    controller: {} as any, perfMonitor: {} as any, store: {} as any,
    generator: generator as any, theory: {} as any,
    sessionManager: {} as any, geminiService: {} as any, strudelEngine: {} as any,
    midiExportService: {} as any,
    getAudioCaptureService: async () => ({}) as any,
    getHistory: () => ({ undoStack: [], redoStack: [], historyStack: [], maxHistory: 100 }), historyEntryId: () => 1, dropHistory: jest.fn(),
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } as any,
    isInitialized: () => true,
    ensureInitialized: async () => {},
    getController: () => ({}) as any,
    getCurrentPatternSafe: async () => pattern,
    writePatternSafe: async (p: string) => { pattern = p; return 'written'; },
  };
  return { ctx, generator, pattern: () => pattern };
}

describe('generate_rhythm consolidation (#151)', () => {
  it('generate_rhythm(type=euclidean) appends euclidean pattern', async () => {
    const { ctx, generator } = makeCtx();
    const result = await execute('generate_rhythm', { type: 'euclidean', hits: 3, steps: 8 }, ctx);
    expect(generator.generateEuclideanPattern).toHaveBeenCalledWith(3, 8, 'bd');
    expect(result).toContain('3/8');
  });

  it('generate_rhythm(type=euclidean) accepts custom sound', async () => {
    const { ctx, generator } = makeCtx();
    await execute('generate_rhythm', { type: 'euclidean', hits: 5, steps: 16, sound: 'hh' }, ctx);
    expect(generator.generateEuclideanPattern).toHaveBeenCalledWith(5, 16, 'hh');
  });

  it('generate_rhythm(type=polyrhythm) appends polyrhythm', async () => {
    const { ctx, generator } = makeCtx();
    const result = await execute('generate_rhythm', { type: 'polyrhythm', sounds: ['bd', 'hh'], patterns: [3, 5] }, ctx);
    expect(generator.generatePolyrhythm).toHaveBeenCalledWith(['bd', 'hh'], [3, 5]);
    expect(result).toBe('Generated polyrhythm');
  });

  it('throws on invalid type', async () => {
    const { ctx } = makeCtx();
    await expect(execute('generate_rhythm', { type: 'random' }, ctx)).rejects.toThrow(/Invalid type/);
  });

  it('generate_euclidean alias matches generate_rhythm(type=euclidean)', async () => {
    const { ctx: a, pattern: pa } = makeCtx();
    const { ctx: b, pattern: pb } = makeCtx();
    await execute('generate_euclidean', { hits: 3, steps: 8 }, a);
    await execute('generate_rhythm', { type: 'euclidean', hits: 3, steps: 8 }, b);
    expect(pa()).toBe(pb());
  });

  it('generate_polyrhythm alias matches generate_rhythm(type=polyrhythm)', async () => {
    const { ctx: a, pattern: pa } = makeCtx();
    const { ctx: b, pattern: pb } = makeCtx();
    await execute('generate_polyrhythm', { sounds: ['bd', 'hh'], patterns: [3, 5] }, a);
    await execute('generate_rhythm', { type: 'polyrhythm', sounds: ['bd', 'hh'], patterns: [3, 5] }, b);
    expect(pa()).toBe(pb());
  });
});
