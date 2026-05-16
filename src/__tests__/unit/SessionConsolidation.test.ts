/**
 * Tests for the session consolidation (#158).
 */

import { execute } from '../../server/tools/session';
import type { ToolContext } from '../../server/tools/types';

function makeCtx() {
  const created = new Set<string>();
  let defaultId = 'default';
  const sm = {
    createSession: jest.fn(async (id: string) => { created.add(id); }),
    destroySession: jest.fn(async (id: string) => { created.delete(id); }),
    getSessionCount: jest.fn(() => created.size),
    getMaxSessions: jest.fn(() => 5),
    getSessionsInfo: jest.fn(() =>
      Array.from(created).map(id => ({
        id,
        created: new Date('2026-05-14T00:00:00Z'),
        lastActivity: new Date('2026-05-14T00:00:05Z'),
        isPlaying: false,
      })),
    ),
    getDefaultSessionId: jest.fn(() => defaultId),
    setDefaultSession: jest.fn((id: string) => { defaultId = id; }),
  };
  const ctx: ToolContext = {
    controller: {} as any, perfMonitor: {} as any, store: {} as any,
    generator: {} as any, theory: {} as any,
    sessionManager: sm as any,
    geminiService: {} as any, strudelEngine: {} as any,
    midiExportService: {} as any, midiImportService: {} as any,
    getAudioCaptureService: async (_sid?: string) => ({}) as any, dropAudioCaptureService: jest.fn(),
    getHistory: () => ({ undoStack: [], redoStack: [], historyStack: [], maxHistory: 100 }),
    historyEntryId: () => 1,
    dropHistory: jest.fn(),
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } as any,
    isInitialized: () => true,
    ensureInitialized: async () => {},
    getController: () => ({}) as any,
    getCurrentPatternSafe: async () => '',
    writePatternSafe: async () => 'written',
  };
  return { ctx, sm };
}

describe('session consolidation (#158)', () => {
  it('session(action=create) creates a named session', async () => {
    const { ctx, sm } = makeCtx();
    const result = (await execute('session', { action: 'create', session_id: 'A' }, ctx)) as any;
    expect(result.success).toBe(true);
    expect(sm.createSession).toHaveBeenCalledWith('A');
  });

  it('session(action=destroy) closes a session', async () => {
    const { ctx, sm } = makeCtx();
    await execute('session', { action: 'create', session_id: 'B' }, ctx);
    const result = (await execute('session', { action: 'destroy', session_id: 'B' }, ctx)) as any;
    expect(result.success).toBe(true);
    expect(sm.destroySession).toHaveBeenCalledWith('B');
  });

  it('session(action=list) returns session metadata', async () => {
    const { ctx } = makeCtx();
    await execute('session', { action: 'create', session_id: 'C' }, ctx);
    const result = (await execute('session', { action: 'list' }, ctx)) as any;
    expect(result.count).toBe(1);
    expect(result.sessions[0].id).toBe('C');
  });

  it('session(action=switch) sets default session', async () => {
    const { ctx, sm } = makeCtx();
    const result = (await execute('session', { action: 'switch', session_id: 'D' }, ctx)) as any;
    expect(result.success).toBe(true);
    expect(sm.setDefaultSession).toHaveBeenCalledWith('D');
  });

  it('throws on invalid action', async () => {
    const { ctx } = makeCtx();
    await expect(execute('session', { action: 'rename', session_id: 'X' }, ctx))
      .rejects.toThrow(/Invalid action/);
  });
});
