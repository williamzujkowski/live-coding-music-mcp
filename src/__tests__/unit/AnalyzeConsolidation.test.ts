/**
 * Tests for the analyze consolidation (#146).
 *
 * analyze(include[]) replaces analyze_spectrum / analyze_rhythm /
 * detect_tempo / detect_key. include=['all'] (default) preserves
 * pre-consolidation behaviour. Other include sets return an object
 * keyed by category.
 */

import { execute } from '../../server/tools/analysis';
import type { ToolContext } from '../../server/tools/types';

function makeCtx(initialized = true) {
  const controller = {
    analyzeAudio: jest.fn(async () => ({
      features: { bass: 50, mid: 40, treble: 30, brightness: 'balanced' },
      timestamp: 1234,
    })),
    analyzeRhythm: jest.fn(async () => ({ complexity: 0.6, density: 4, syncopation: 0.2 })),
    detectTempo: jest.fn(async () => ({ bpm: 128, confidence: 0.93, method: 'onset' })),
    detectKey: jest.fn(async () => ({
      key: 'C', scale: 'major', confidence: 0.81,
      alternatives: [{ key: 'A', scale: 'minor', confidence: 0.72 }],
    })),
    validatePatternRuntime: jest.fn(),
  };
  const ctx: ToolContext = {
    controller: controller as any,
    perfMonitor: {} as any,
    store: {} as any,
    generator: {} as any,
    theory: {} as any,
    sessionManager: {} as any,
    geminiService: {} as any,
    strudelEngine: {
      validate: jest.fn(),
      analyzePattern: jest.fn(),
      queryEvents: jest.fn(),
      transpile: jest.fn(),
    } as any,
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

describe('analyze consolidation (#146)', () => {
  describe('analyze(include)', () => {
    it('default include=["all"] returns full analyzeAudio result', async () => {
      const { ctx, controller } = makeCtx();
      const result = await execute('analyze', {}, ctx);
      expect(result).toEqual({
        features: { bass: 50, mid: 40, treble: 30, brightness: 'balanced' },
        timestamp: 1234,
      });
      expect(controller.analyzeAudio).toHaveBeenCalledTimes(1);
      // Detection helpers should NOT be called for include=all
      expect(controller.detectTempo).not.toHaveBeenCalled();
      expect(controller.detectKey).not.toHaveBeenCalled();
    });

    it('explicit include=["all"] matches default', async () => {
      const { ctx } = makeCtx();
      const a = await execute('analyze', {}, ctx);
      const b = await execute('analyze', { include: ['all'] }, ctx);
      expect(a).toEqual(b);
    });

    it('include=["spectrum"] returns just features', async () => {
      const { ctx, controller } = makeCtx();
      const result = (await execute('analyze', { include: ['spectrum'] }, ctx)) as any;
      expect(result.spectrum).toEqual({ bass: 50, mid: 40, treble: 30, brightness: 'balanced' });
      expect(controller.analyzeAudio).toHaveBeenCalledTimes(1);
      expect(controller.detectTempo).not.toHaveBeenCalled();
    });

    it('include=["tempo"] returns just tempo result', async () => {
      const { ctx, controller } = makeCtx();
      const result = (await execute('analyze', { include: ['tempo'] }, ctx)) as any;
      expect(result.tempo.bpm).toBe(128);
      expect(result.tempo.confidence).toBe(0.93);
      expect(controller.detectKey).not.toHaveBeenCalled();
      expect(controller.analyzeAudio).not.toHaveBeenCalled();
    });

    it('include=["key"] returns just key result', async () => {
      const { ctx, controller } = makeCtx();
      const result = (await execute('analyze', { include: ['key'] }, ctx)) as any;
      expect(result.key.key).toBe('C');
      expect(result.key.scale).toBe('major');
      expect(result.key.alternatives).toHaveLength(1);
      expect(controller.detectTempo).not.toHaveBeenCalled();
    });

    it('include=["rhythm"] returns just rhythm result', async () => {
      const { ctx } = makeCtx();
      const result = (await execute('analyze', { include: ['rhythm'] }, ctx)) as any;
      expect(result.rhythm.complexity).toBe(0.6);
    });

    it('include=["tempo","key"] returns both keyed', async () => {
      const { ctx, controller } = makeCtx();
      const result = (await execute('analyze', { include: ['tempo', 'key'] }, ctx)) as any;
      expect(result.tempo.bpm).toBe(128);
      expect(result.key.key).toBe('C');
      expect(controller.detectTempo).toHaveBeenCalledTimes(1);
      expect(controller.detectKey).toHaveBeenCalledTimes(1);
    });

    it('throws on invalid include value', async () => {
      const { ctx } = makeCtx();
      await expect(execute('analyze', { include: ['bogus'] }, ctx)).rejects.toThrow(/Invalid include/);
    });

    it('refuses when default session not initialized', async () => {
      const { ctx } = makeCtx(false);
      const result = await execute('analyze', { include: ['tempo'] }, ctx);
      expect(result).toContain('not initialized');
    });

    it('tempo returns 0 BPM with friendly message when detector returns 0', async () => {
      const { ctx, controller } = makeCtx();
      (controller.detectTempo as jest.Mock).mockResolvedValueOnce({ bpm: 0, confidence: 0 });
      const result = (await execute('analyze', { include: ['tempo'] }, ctx)) as any;
      expect(result.tempo.bpm).toBe(0);
      expect(result.tempo.message).toContain('No tempo detected');
    });

    it('key returns "Unknown" with friendly message when confidence below threshold', async () => {
      const { ctx, controller } = makeCtx();
      (controller.detectKey as jest.Mock).mockResolvedValueOnce({ key: 'X', scale: 'major', confidence: 0.05 });
      const result = (await execute('analyze', { include: ['key'] }, ctx)) as any;
      expect(result.key.key).toBe('Unknown');
    });
  });
});
