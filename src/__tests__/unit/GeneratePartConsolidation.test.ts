/**
 * Tests for the generate_part consolidation (#149).
 */

import { execute } from '../../server/tools/generate';
import type { ToolContext } from '../../server/tools/types';

function makeCtx() {
  let pattern = '';
  const generator = {
    generateDrumPattern: jest.fn((style, c) => `drums(${style}/${c})`),
    generateBassline: jest.fn((key, style) => `bass(${key}/${style})`),
    generateMelody: jest.fn((scale, len) => `melody(${scale.join(',')}/${len})`),
    generateFill: jest.fn((style, bars) => `fill(${style}/${bars})`),
  };
  const theory = { generateScale: jest.fn((root, _scale) => [root, 'D', 'E', 'F', 'G', 'A', 'B']) };
  const ctx: ToolContext = {
    controller: {} as any, perfMonitor: {} as any, store: {} as any,
    generator: generator as any, theory: theory as any,
    sessionManager: {} as any, geminiService: {} as any, strudelEngine: {} as any,
    midiExportService: {} as any,
    getAudioCaptureService: async () => ({}) as any,
    history: { undoStack: [], redoStack: [], historyStack: [], maxHistory: 100 },
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } as any,
    isInitialized: () => true,
    ensureInitialized: async () => {},
    getController: () => ({}) as any,
    getCurrentPatternSafe: async () => pattern,
    writePatternSafe: async (p: string) => { pattern = p; return 'written'; },
  };
  return { ctx, generator, theory, pattern: () => pattern };
}

describe('generate_part consolidation (#149)', () => {
  it('role=drums forwards to generateDrumPattern', async () => {
    const { ctx, generator } = makeCtx();
    await execute('generate_part', { role: 'drums', style: 'techno', complexity: 0.7 }, ctx);
    expect(generator.generateDrumPattern).toHaveBeenCalledWith('techno', 0.7);
  });

  it('role=drums defaults complexity to 0.5', async () => {
    const { ctx, generator } = makeCtx();
    await execute('generate_part', { role: 'drums', style: 'house' }, ctx);
    expect(generator.generateDrumPattern).toHaveBeenCalledWith('house', 0.5);
  });

  it('role=bass forwards to generateBassline', async () => {
    const { ctx, generator } = makeCtx();
    await execute('generate_part', { role: 'bass', key: 'C', style: 'funk' }, ctx);
    expect(generator.generateBassline).toHaveBeenCalledWith('C', 'funk');
  });

  it('role=melody forwards to generateMelody (after building scale)', async () => {
    const { ctx, theory, generator } = makeCtx();
    await execute('generate_part', { role: 'melody', root: 'C', scale: 'major', length: 12 }, ctx);
    expect(theory.generateScale).toHaveBeenCalledWith('C', 'major');
    expect(generator.generateMelody).toHaveBeenCalledWith(['C', 'D', 'E', 'F', 'G', 'A', 'B'], 12);
  });

  it('role=fill forwards to generateFill', async () => {
    const { ctx, generator } = makeCtx();
    await execute('generate_part', { role: 'fill', style: 'breakbeat', bars: 2 }, ctx);
    expect(generator.generateFill).toHaveBeenCalledWith('breakbeat', 2);
  });

  it('throws on invalid role', async () => {
    const { ctx } = makeCtx();
    await expect(execute('generate_part', { role: 'pad' }, ctx)).rejects.toThrow(/Invalid role/);
  });

  describe('legacy aliases forward', () => {
    it.each([
      ['generate_drums', { style: 'techno' }, 'drums'],
      ['generate_bassline', { key: 'C', style: 'funk' }, 'bass'],
      ['generate_melody', { root: 'C', scale: 'major' }, 'melody'],
      ['generate_fill', { style: 'breakbeat' }, 'fill'],
    ])('%s alias matches generate_part(role=%s)', async (alias, params, role) => {
      const { ctx: a, pattern: pa } = makeCtx();
      const { ctx: b, pattern: pb } = makeCtx();
      await execute(alias, params, a);
      await execute('generate_part', { role, ...params }, b);
      expect(pa()).toBe(pb());
    });
  });
});
