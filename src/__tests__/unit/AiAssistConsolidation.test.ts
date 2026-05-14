/**
 * Tests for the ai_assist consolidation (#159).
 *
 * Final merger of #120. Routing test only — the underlying feedback/
 * suggest/jam handlers have their own coverage elsewhere.
 */

import { execute } from '../../server/tools/ai';
import type { ToolContext } from '../../server/tools/types';

function makeCtx() {
  const ctx: ToolContext = {
    controller: { page: null } as any,
    perfMonitor: {} as any, store: {} as any, generator: {} as any, theory: {} as any,
    sessionManager: {} as any,
    geminiService: {
      isAvailable: jest.fn(() => false),
    } as any,
    strudelEngine: {} as any, midiExportService: {} as any,
    getAudioCaptureService: async (_sid?: string) => ({}) as any, dropAudioCaptureService: jest.fn(),
    getHistory: () => ({ undoStack: [], redoStack: [], historyStack: [], maxHistory: 100 }), historyEntryId: () => 1, dropHistory: jest.fn(),
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } as any,
    isInitialized: () => false,
    ensureInitialized: async () => {},
    getController: () => ({}) as any,
    getCurrentPatternSafe: async () => '',
    writePatternSafe: async () => 'written',
  };
  return { ctx };
}

describe('ai_assist consolidation (#159)', () => {
  it('ai_assist(task=feedback) routes to feedback handler', async () => {
    const { ctx } = makeCtx();
    const result = (await execute('ai_assist', { task: 'feedback' }, ctx)) as any;
    // Without GEMINI_API_KEY, the feedback handler returns gemini_available: false
    expect(result.gemini_available).toBe(false);
    expect(result.error).toContain('Gemini API not configured');
  });

  it('ai_assist(task=suggest) routes to suggest handler', async () => {
    const { ctx } = makeCtx();
    const result = (await execute('ai_assist', { task: 'suggest' }, ctx)) as any;
    // Without init, suggest returns "Browser not initialized..."
    expect(result.error).toContain('not initialized');
  });

  it('ai_assist(task=jam) routes to jam handler', async () => {
    const { ctx } = makeCtx();
    const result = (await execute('ai_assist', { task: 'jam', layer: 'drums' }, ctx)) as any;
    // Without a pattern, jam returns "No pattern to jam with..."
    expect(result.success).toBe(false);
    expect(result.message).toContain('No pattern');
  });

  it('throws on invalid task', async () => {
    const { ctx } = makeCtx();
    await expect(execute('ai_assist', { task: 'critique' }, ctx)).rejects.toThrow(/Invalid task/);
  });

  describe('legacy aliases forward (deprecation window)', () => {
    it('get_pattern_feedback alias matches ai_assist(task=feedback)', async () => {
      const { ctx: a } = makeCtx();
      const { ctx: b } = makeCtx();
      const alias = await execute('get_pattern_feedback', {}, a);
      const direct = await execute('ai_assist', { task: 'feedback' }, b);
      expect(alias).toEqual(direct);
    });

    it('suggest_pattern_from_audio alias forwards', async () => {
      const { ctx } = makeCtx();
      const result = (await execute('suggest_pattern_from_audio', {}, ctx)) as any;
      expect(result.error).toContain('not initialized');
    });

    it('jam_with alias forwards', async () => {
      const { ctx } = makeCtx();
      const result = (await execute('jam_with', { layer: 'drums' }, ctx)) as any;
      expect(result.success).toBe(false);
    });
  });
});
