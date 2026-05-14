/**
 * Tests for the effect consolidation (#153).
 */

import { execute } from '../../server/tools/transform';
import type { ToolContext } from '../../server/tools/types';

function makeCtx() {
  let pattern = 's("bd")';
  const ctx: ToolContext = {
    controller: {} as any, perfMonitor: {} as any, store: {} as any, generator: {} as any,
    theory: {} as any, sessionManager: {} as any, geminiService: {} as any,
    strudelEngine: {} as any, midiExportService: {} as any,
    getAudioCaptureService: async () => ({}) as any,
    history: { undoStack: [], redoStack: [], historyStack: [], maxHistory: 100 },
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
    const result = await execute('effect', { action: 'remove', effect: 'reverb' }, ctx);
    expect(result).toContain('No reverb effect found');
  });

  it('throws on invalid action', async () => {
    const { ctx } = makeCtx();
    await expect(execute('effect', { action: 'toggle', effect: 'lpf' }, ctx)).rejects.toThrow(/Invalid action/);
  });

  it('add_effect alias forwards', async () => {
    const { ctx, pattern } = makeCtx();
    await execute('add_effect', { effect: 'room', params: '0.5' }, ctx);
    expect(pattern()).toContain('.room(0.5)');
  });

  it('remove_effect alias forwards', async () => {
    const { ctx } = makeCtx();
    await execute('add_effect', { effect: 'delay', params: '0.3' }, ctx);
    const result = await execute('remove_effect', { effect: 'delay' }, ctx);
    expect(result).toBe('Removed delay effect');
  });
});
