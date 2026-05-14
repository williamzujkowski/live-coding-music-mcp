/**
 * Tests for the music_theory consolidation (#150).
 */

import { execute } from '../../server/tools/generate';
import type { ToolContext } from '../../server/tools/types';

function makeCtx() {
  let pattern = '';
  const theory = {
    generateScale: jest.fn((root: string, _scale: string) => [root, 'D', 'E', 'F', 'G', 'A', 'B']),
    generateChordProgression: jest.fn((key: string, _style: string) => `${key} G Am F`),
  };
  const generator = {
    generateChords: jest.fn((progression: string) => `chords(${progression})`),
  };
  const ctx: ToolContext = {
    controller: {} as any, perfMonitor: {} as any, store: {} as any,
    generator: generator as any, theory: theory as any,
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
  return { ctx, theory, generator, pattern: () => pattern };
}

describe('music_theory consolidation (#150)', () => {
  it('music_theory(query=scale) returns scale notes as a string', async () => {
    const { ctx } = makeCtx();
    const result = await execute('music_theory', { query: 'scale', root: 'C', scale: 'major' }, ctx);
    expect(result).toBe('C major scale: C, D, E, F, G, A, B');
  });

  it('music_theory(query=chord_progression) writes a chord pattern and returns the progression', async () => {
    const { ctx, pattern, generator } = makeCtx();
    const result = await execute(
      'music_theory',
      { query: 'chord_progression', key: 'C', style: 'pop' },
      ctx,
    );
    expect(result).toBe('Generated pop progression in C: C G Am F');
    expect(pattern()).toBe('chords(C G Am F)');
    expect(generator.generateChords).toHaveBeenCalledWith('C G Am F');
  });

  it('throws on invalid query', async () => {
    const { ctx } = makeCtx();
    await expect(execute('music_theory', { query: 'cadence' }, ctx)).rejects.toThrow(/Invalid query/);
  });

  it('generate_scale alias matches music_theory(query=scale)', async () => {
    const { ctx: a } = makeCtx();
    const { ctx: b } = makeCtx();
    const alias = await execute('generate_scale', { root: 'D', scale: 'minor' }, a);
    const direct = await execute('music_theory', { query: 'scale', root: 'D', scale: 'minor' }, b);
    expect(alias).toBe(direct);
  });

  it('generate_chord_progression alias matches music_theory(query=chord_progression)', async () => {
    const { ctx: a, pattern: pa } = makeCtx();
    const { ctx: b, pattern: pb } = makeCtx();
    await execute('generate_chord_progression', { key: 'C', style: 'pop' }, a);
    await execute('music_theory', { query: 'chord_progression', key: 'C', style: 'pop' }, b);
    expect(pa()).toBe(pb());
  });
});
