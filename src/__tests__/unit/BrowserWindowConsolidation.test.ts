/**
 * Tests for the browser_window consolidation (#156).
 */

import { execute as composeExecute } from '../../server/tools/compose';
import { execute as diagnosticsExecute } from '../../server/tools/diagnostics';
import type { ToolContext } from '../../server/tools/types';

function makeCtx() {
  const controller = {
    showBrowser: jest.fn(async () => 'shown'),
    takeScreenshot: jest.fn(async (f?: string) => `saved ${f ?? 'default.png'}`),
  };
  const ctx: ToolContext = {
    controller: controller as any,
    perfMonitor: {} as any, store: {} as any, generator: {} as any, theory: {} as any,
    sessionManager: {} as any, geminiService: {} as any, strudelEngine: {} as any,
    midiExportService: {} as any,
    getAudioCaptureService: async (_sid?: string) => ({}) as any, dropAudioCaptureService: jest.fn(),
    getHistory: () => ({ undoStack: [], redoStack: [], historyStack: [], maxHistory: 100 }), historyEntryId: () => 1, dropHistory: jest.fn(),
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } as any,
    isInitialized: () => true,
    ensureInitialized: async () => {},
    getController: () => controller as any,
    getCurrentPatternSafe: async () => '',
    writePatternSafe: async () => 'written',
  };
  return { ctx, controller };
}

describe('browser_window consolidation (#156)', () => {
  it('browser_window(action=show) calls controller.showBrowser', async () => {
    const { ctx, controller } = makeCtx();
    const result = await composeExecute('browser_window', { action: 'show' }, ctx);
    expect(controller.showBrowser).toHaveBeenCalledTimes(1);
    expect(result).toBe('shown');
  });

  it('browser_window(action=screenshot) calls controller.takeScreenshot with filename', async () => {
    const { ctx, controller } = makeCtx();
    await composeExecute('browser_window', { action: 'screenshot', filename: 'demo.png' }, ctx);
    expect(controller.takeScreenshot).toHaveBeenCalledWith('demo.png');
  });

  it('browser_window(action=screenshot) accepts no filename', async () => {
    const { ctx, controller } = makeCtx();
    await composeExecute('browser_window', { action: 'screenshot' }, ctx);
    expect(controller.takeScreenshot).toHaveBeenCalledWith(undefined);
  });

  it('throws on invalid action', async () => {
    const { ctx } = makeCtx();
    await expect(composeExecute('browser_window', { action: 'hide' }, ctx)).rejects.toThrow(/Invalid action/);
  });

  it('show_browser alias still works (deprecated)', async () => {
    const { ctx, controller } = makeCtx();
    await composeExecute('show_browser', {}, ctx);
    expect(controller.showBrowser).toHaveBeenCalledTimes(1);
  });

  it('screenshot alias still works (deprecated) via diagnostics module', async () => {
    const { ctx, controller } = makeCtx();
    await diagnosticsExecute('screenshot', { filename: 'x.png' }, ctx);
    expect(controller.takeScreenshot).toHaveBeenCalledWith('x.png');
  });
});
