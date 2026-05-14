/**
 * Tests for the diagnostics consolidation (#144).
 *
 * Verifies the diagnostics(level) tool covers status/full/perf/memory/
 * errors, defaults to 'full' for backwards compat, and that the four
 * legacy aliases still forward correctly during the deprecation window.
 */

import { execute } from '../../server/tools/diagnostics';
import type { ToolContext } from '../../server/tools/types';

function makeCtx(initialized = true) {
  const controller = {
    getStatus: jest.fn(() => ({ playing: true, patternLength: 42 })),
    getDiagnostics: jest.fn(async () => ({ cache: 'fresh', errors: 0 })),
    getConsoleErrors: jest.fn(() => ['err1', 'err2']),
    getConsoleWarnings: jest.fn(() => ['warn1']),
    takeScreenshot: jest.fn(async (filename?: string) => `saved to ${filename ?? 'default.png'}`),
  };
  const perfMonitor = {
    getReport: jest.fn(() => 'perf report'),
    getBottlenecks: jest.fn(() => [{ name: 'slow', ms: 200 }]),
    getMemoryUsage: jest.fn(() => ({ rss: 100000 })),
  };
  const ctx: ToolContext = {
    controller: controller as any,
    perfMonitor: perfMonitor as any,
    store: {} as any,
    generator: {} as any,
    theory: {} as any,
    sessionManager: {} as any,
    geminiService: {} as any,
    strudelEngine: {} as any,
    midiExportService: {} as any,
    getAudioCaptureService: async (_sid?: string) => ({}) as any, dropAudioCaptureService: jest.fn(),
    getHistory: () => ({ undoStack: [], redoStack: [], historyStack: [], maxHistory: 100 }), historyEntryId: () => 1, dropHistory: jest.fn(),
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } as any,
    isInitialized: () => initialized,
    ensureInitialized: async () => {},
    getController: () => controller as any,
    getCurrentPatternSafe: async () => 'pattern',
    writePatternSafe: async () => 'written',
  };
  return { ctx, controller, perfMonitor };
}

describe('diagnostics consolidation (#144)', () => {
  describe('diagnostics(level)', () => {
    it('level=status returns quick status (no browser call beyond getStatus)', async () => {
      const { ctx, controller } = makeCtx();
      const result = await execute('diagnostics', { level: 'status' }, ctx);
      expect(result).toEqual({ playing: true, patternLength: 42 });
      expect(controller.getStatus).toHaveBeenCalledTimes(1);
      expect(controller.getDiagnostics).not.toHaveBeenCalled();
    });

    it('level=full returns detailed browser diagnostics', async () => {
      const { ctx, controller } = makeCtx();
      const result = await execute('diagnostics', { level: 'full' }, ctx);
      expect(result).toEqual({ cache: 'fresh', errors: 0 });
      expect(controller.getDiagnostics).toHaveBeenCalledTimes(1);
    });

    it('level=full when browser not initialized returns gentle stub', async () => {
      const { ctx } = makeCtx(false);
      const result = await execute('diagnostics', { level: 'full' }, ctx);
      expect(result).toMatchObject({ initialized: false });
    });

    it('level=perf returns timing report', async () => {
      const { ctx, perfMonitor } = makeCtx();
      const result = await execute('diagnostics', { level: 'perf' }, ctx);
      expect(typeof result).toBe('string');
      expect(result as string).toContain('perf report');
      expect(result as string).toContain('Bottlenecks');
      expect(perfMonitor.getReport).toHaveBeenCalled();
    });

    it('level=memory returns memory snapshot', async () => {
      const { ctx } = makeCtx();
      const result = await execute('diagnostics', { level: 'memory' }, ctx);
      expect(result as string).toContain('rss');
    });

    it('level=memory gracefully reports when unavailable', async () => {
      const { ctx, perfMonitor } = makeCtx();
      (perfMonitor.getMemoryUsage as jest.Mock).mockReturnValueOnce(null);
      const result = await execute('diagnostics', { level: 'memory' }, ctx);
      expect(result).toBe('Memory usage not available');
    });

    it('level=errors lists console errors and warnings', async () => {
      const { ctx } = makeCtx();
      const result = await execute('diagnostics', { level: 'errors' }, ctx);
      const text = result as string;
      expect(text).toContain('Errors (2)');
      expect(text).toContain('err1');
      expect(text).toContain('Warnings (1)');
      expect(text).toContain('warn1');
    });

    it('level=errors returns clean message when nothing captured', async () => {
      const { ctx, controller } = makeCtx();
      (controller.getConsoleErrors as jest.Mock).mockReturnValueOnce([]);
      (controller.getConsoleWarnings as jest.Mock).mockReturnValueOnce([]);
      const result = await execute('diagnostics', { level: 'errors' }, ctx);
      expect(result).toBe('No errors or warnings captured.');
    });

    it('default level is "full" (no schema surprise)', async () => {
      const { ctx, controller } = makeCtx();
      const noLevel = await execute('diagnostics', {}, ctx);
      const fullLevel = await execute('diagnostics', { level: 'full' }, ctx);
      expect(noLevel).toEqual(fullLevel);
      expect(controller.getDiagnostics).toHaveBeenCalledTimes(2);
    });

    it('throws on invalid level', async () => {
      const { ctx } = makeCtx();
      await expect(execute('diagnostics', { level: 'bogus' }, ctx)).rejects.toThrow(/Invalid level/);
    });
  });

  describe('legacy aliases forward (deprecation window)', () => {
    it('status alias matches diagnostics(level=status)', async () => {
      const { ctx } = makeCtx();
      const alias = await execute('status', {}, ctx);
      const direct = await execute('diagnostics', { level: 'status' }, ctx);
      expect(alias).toEqual(direct);
    });

    it('show_errors alias matches diagnostics(level=errors)', async () => {
      const { ctx } = makeCtx();
      const alias = await execute('show_errors', {}, ctx);
      const direct = await execute('diagnostics', { level: 'errors' }, ctx);
      expect(alias).toEqual(direct);
    });

    it('performance_report alias matches diagnostics(level=perf)', async () => {
      const { ctx } = makeCtx();
      const alias = await execute('performance_report', {}, ctx);
      const direct = await execute('diagnostics', { level: 'perf' }, ctx);
      expect(alias).toEqual(direct);
    });

    it('memory_usage alias matches diagnostics(level=memory)', async () => {
      const { ctx } = makeCtx();
      const alias = await execute('memory_usage', {}, ctx);
      const direct = await execute('diagnostics', { level: 'memory' }, ctx);
      expect(alias).toEqual(direct);
    });
  });

  describe('screenshot stays distinct (Phase 3 / #156 absorbs it elsewhere)', () => {
    it('screenshot routes via the controller', async () => {
      const { ctx, controller } = makeCtx();
      await execute('screenshot', { filename: 'shot.png' }, ctx);
      expect(controller.takeScreenshot).toHaveBeenCalledWith('shot.png');
    });

    it('screenshot refuses when not initialized', async () => {
      const { ctx } = makeCtx(false);
      const result = await execute('screenshot', {}, ctx);
      expect(result).toContain('not initialized');
    });
  });
});
