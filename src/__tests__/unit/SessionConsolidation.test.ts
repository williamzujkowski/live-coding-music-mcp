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
    midiExportService: {} as any,
    getAudioCaptureService: async () => ({}) as any,
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

  describe('legacy aliases forward', () => {
    it('create_session alias matches session(action=create)', async () => {
      const { ctx, sm } = makeCtx();
      await execute('create_session', { session_id: 'A' }, ctx);
      expect(sm.createSession).toHaveBeenCalledWith('A');
    });

    it('destroy_session alias forwards', async () => {
      const { ctx, sm } = makeCtx();
      await execute('destroy_session', { session_id: 'B' }, ctx);
      expect(sm.destroySession).toHaveBeenCalledWith('B');
    });

    it('list_sessions alias forwards', async () => {
      const { ctx } = makeCtx();
      const result = (await execute('list_sessions', {}, ctx)) as any;
      expect(typeof result.count).toBe('number');
    });

    it('switch_session alias forwards', async () => {
      const { ctx, sm } = makeCtx();
      await execute('switch_session', { session_id: 'E' }, ctx);
      expect(sm.setDefaultSession).toHaveBeenCalledWith('E');
    });
  });
});
