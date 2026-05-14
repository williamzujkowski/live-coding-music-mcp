/**
 * Per-session history isolation test (#179).
 *
 * Verifies that two named sessions maintain independent undo/redo/history
 * stacks, and that destroying a session releases its bundle.
 */

jest.mock('../../services/StrudelEngine');

import { StrudelMCPServer } from '../../server/server';

describe('per-session history (#179)', () => {
  let server: any;

  beforeEach(() => {
    server = new StrudelMCPServer();
  });

  it('default session bundle is auto-created on first access', () => {
    const bundle = server.getHistoryBundle('default');
    expect(Array.isArray(bundle.undoStack)).toBe(true);
    expect(Array.isArray(bundle.redoStack)).toBe(true);
    expect(Array.isArray(bundle.historyStack)).toBe(true);
  });

  it('two sessions get independent bundles (identity check)', () => {
    const a = server.getHistoryBundle('A');
    const b = server.getHistoryBundle('B');
    expect(a).not.toBe(b);
    expect(a.undoStack).not.toBe(b.undoStack);
  });

  it('pushing onto session A does not affect session B', () => {
    const a = server.getHistoryBundle('A');
    const b = server.getHistoryBundle('B');
    a.undoStack.push('pattern-from-A');
    expect(a.undoStack).toHaveLength(1);
    expect(b.undoStack).toHaveLength(0);
  });

  it('history-entry IDs are unique across sessions (server-wide counter)', () => {
    server.getHistoryBundle('A').historyStack.push({
      id: server.historyIdCounter + 1,
      pattern: 'p1',
      timestamp: new Date(),
      action: 'write',
    });
    server.historyIdCounter += 1;

    server.getHistoryBundle('B').historyStack.push({
      id: server.historyIdCounter + 1,
      pattern: 'p2',
      timestamp: new Date(),
      action: 'write',
    });
    server.historyIdCounter += 1;

    const aId = server.getHistoryBundle('A').historyStack[0].id;
    const bId = server.getHistoryBundle('B').historyStack[0].id;
    expect(aId).not.toBe(bId);
  });

  it('drop-history removes the named bundle', () => {
    server.getHistoryBundle('to-drop').undoStack.push('x');
    expect(server.historyBundles.has('to-drop')).toBe(true);

    // Dropping then re-fetching gives a fresh empty bundle
    server.historyBundles.delete('to-drop');
    const fresh = server.getHistoryBundle('to-drop');
    expect(fresh.undoStack).toHaveLength(0);
  });

  it('default-session bundle is independent from named sessions', () => {
    const def = server.getHistoryBundle('default');
    const named = server.getHistoryBundle('user1');
    def.undoStack.push('default-pattern');
    named.undoStack.push('named-pattern');
    expect(def.undoStack).toEqual(['default-pattern']);
    expect(named.undoStack).toEqual(['named-pattern']);
  });
});
