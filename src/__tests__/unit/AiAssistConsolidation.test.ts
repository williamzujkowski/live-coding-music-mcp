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
    perfMonitor: {} as any, store: {} as any, generator: {} as any, theory: {} as any,
    sessionManager: {} as any,
    geminiService: {
      isAvailable: jest.fn(() => false),
    } as any,
    strudelEngine: {} as any, midiExportService: {} as any, midiImportService: {} as any,
    getAudioCaptureService: async (_sid?: string) => ({}) as any, dropAudioCaptureService: jest.fn(),
    getHistory: () => ({ undoStack: [], redoStack: [], historyStack: [], maxHistory: 100 }), dropHistory: jest.fn(),
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
    // With no transport at all, the feedback handler says so — and names
    // both routes, since a logged-in CLI is as good as an API key (#252).
    expect(result.gemini_available).toBe(false);
    expect(result.error).toContain('No AI transport available');
    expect(result.error).toContain('GEMINI_API_KEY');
    expect(result.error).toMatch(/claude\/agy\/codex/);
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
});
