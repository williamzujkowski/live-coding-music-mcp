/**
 * Tests for the playback consolidation (#152).
 */

import { execute } from '../../server/tools/playback';
import type { ToolContext } from '../../server/tools/types';

function makeCtx(initialized = true) {
  const controller = { play: jest.fn(async () => undefined), stop: jest.fn(async () => undefined) };
  const ctx: ToolContext = {
    controller: controller as any,
    perfMonitor: {} as any, store: {} as any, generator: {} as any, theory: {} as any,
    sessionManager: {} as any, geminiService: {} as any, strudelEngine: {} as any,
    midiExportService: {} as any, midiImportService: {} as any,
    getAudioCaptureService: async (_sid?: string) => ({}) as any, dropAudioCaptureService: jest.fn(),
    getHistory: () => ({ undoStack: [], redoStack: [], historyStack: [], maxHistory: 100 }), historyEntryId: () => 1, dropHistory: jest.fn(),
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } as any,
    isInitialized: () => initialized,
    ensureInitialized: async () => {},
    getController: () => controller as any,
    getCurrentPatternSafe: async () => '',
    writePatternSafe: async () => 'written',
  };
  return { ctx, controller };
}

describe('playback consolidation (#152)', () => {
  it('playback(action=play) calls controller.play', async () => {
    const { ctx, controller } = makeCtx();
    await execute('playback', { action: 'play' }, ctx);
    expect(controller.play).toHaveBeenCalledTimes(1);
  });

  it('playback(action=pause) calls controller.stop (pause and stop share the same controller method)', async () => {
    const { ctx, controller } = makeCtx();
    await execute('playback', { action: 'pause' }, ctx);
    expect(controller.stop).toHaveBeenCalledTimes(1);
  });

  it('playback(action=stop) calls controller.stop', async () => {
    const { ctx, controller } = makeCtx();
    await execute('playback', { action: 'stop' }, ctx);
    expect(controller.stop).toHaveBeenCalledTimes(1);
  });

  it('throws on invalid action', async () => {
    const { ctx } = makeCtx();
    await expect(execute('playback', { action: 'rewind' }, ctx)).rejects.toThrow(/Invalid action/);
  });

  it('refuses without init on default session', async () => {
    const { ctx } = makeCtx(false);
    const result = await execute('playback', { action: 'play' }, ctx);
    expect(result).toContain('not initialized');
  });
});
