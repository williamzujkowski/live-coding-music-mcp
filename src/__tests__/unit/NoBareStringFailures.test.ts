/**
 * Structural guard: a tool module must not report a failure as a bare
 * string (#293).
 *
 * The dispatcher recognises three things — an Envelope, a
 * failure-shaped object (`success:false` or a bare `error` key), and a
 * legacy string prefixed `Error: ` or `Browser not initialized`.
 * Anything else becomes `ok(result)`. So a return like
 *
 *     return `Pattern "${name}" not found`;
 *
 * reaches MCP clients as `{ ok: true, data: 'Pattern "x" not found' }`,
 * and an agent branching on `ok` — which is what the contract tells it
 * to do — records a success.
 *
 * Two of these survived the #287 sweep because that sweep grepped for
 * `return 'No `, `return 'Failed`, `return 'Cannot ` — leading prose
 * only, which structurally cannot match a template literal starting
 * with an interpolation. This check scans the whole string instead, and
 * every exemption has to be written down.
 */

import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

const TOOLS_DIR = join(__dirname, '../../server/tools');

/**
 * Words that make a returned string read as a failure. Deliberately
 * broad — a false positive costs one line in ALLOWED, a false negative
 * costs a silent wrong answer to an agent.
 */
const FAILURE_WORDS = [
  'not found', 'no pattern', 'failed', 'cannot', 'unable', 'invalid',
  'must be', 'not initialized', 'refus', 'too large', 'too many',
  'no session', 'does not', "doesn't", 'missing', 'unknown', 'not supported',
  'not available', 'denied', 'expired', 'no such',
];

/**
 * Returns that look like failures but are correctly handled elsewhere.
 * Each needs a reason, because an unexplained exemption is how the two
 * bugs in #293 stayed hidden.
 */
const ALLOWED: { match: string; why: string }[] = [
  {
    match: 'Browser not initialized. Run init first.',
    why: "server.ts normalises the 'Browser not initialized' prefix into err('business').",
  },
];

function isAllowed(line: string): boolean {
  return ALLOWED.some(a => line.includes(a.match));
}

/** A `return` of a string literal or template — not wrapped in a helper. */
const RAW_STRING_RETURN = /^\s*return\s+(await\s+)?[`'"]/;

describe('no tool module reports a failure as a bare string (#293)', () => {
  const files = readdirSync(TOOLS_DIR).filter(f => f.endsWith('.ts'));

  it('scans every tool module', () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it.each(files)('%s', file => {
    const offenders = readFileSync(join(TOOLS_DIR, file), 'utf8')
      .split('\n')
      .map((line, i) => ({ line, n: i + 1 }))
      .filter(({ line }) => RAW_STRING_RETURN.test(line))
      .filter(({ line }) => {
        const lower = line.toLowerCase();
        return FAILURE_WORDS.some(w => lower.includes(w));
      })
      .filter(({ line }) => !isAllowed(line))
      .map(({ line, n }) => `${file}:${n}  ${line.trim()}`);

    // Any hit is either a real false success or a new exemption that
    // someone has to justify in ALLOWED.
    expect(offenders).toEqual([]);
  });

  it('every exemption still corresponds to real dispatcher handling', () => {
    const server = readFileSync(join(__dirname, '../../server/server.ts'), 'utf8');
    for (const { match } of ALLOWED) {
      // The prefix the dispatcher tests for must still be in server.ts,
      // or the exemption is stale and the string is silently a success.
      expect(server).toContain(match.split('.')[0]);
    }
  });
});

/**
 * Behavioural counterpart: drive the real executors and check the
 * envelope, not just the source text.
 */
describe('the three #293 defects, through the real tools', () => {
  function ctx(overrides: Record<string, unknown> = {}) {
    return {
      store: { load: jest.fn(async () => null), save: jest.fn(async () => {}) },
      getHistory: () => ({ undoStack: [], redoStack: [], historyStack: [], maxHistory: 100 }),
      logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
      isInitialized: () => true,
      getController: () => ({
        getCurrentPattern: jest.fn(async () => 'x'),
        writePattern: jest.fn(async () => 'w'),
      }),
      getCurrentPatternSafe: async () => 's("bd")',
      writePatternSafe: async () => 'written',
      ...overrides,
    } as any;
  }

  it('pattern_store action=load on a missing name is a failure', async () => {
    const { execute } = await import('../../server/tools/storage');
    const r: any = await execute('pattern_store', { action: 'load', name: 'nope' }, ctx());
    expect(r.ok).toBe(false);
    expect(r.errorCategory).toBe('business');
    expect(r.message).toContain('not found');
    // The message has to point somewhere, not just say no.
    expect(r.message).toContain('action: "list"');
  });

  it('history action=restore on a missing id is a failure', async () => {
    const { execute } = await import('../../server/tools/history');
    const r: any = await execute('history', { action: 'restore', id: 999 }, ctx());
    expect(r.ok).toBe(false);
    expect(r.errorCategory).toBe('business');
    expect(r.message).toContain('#999 not found');
  });

  it('a whitespace-only pattern is not saved and not reported as saved', async () => {
    const { execute } = await import('../../server/tools/storage');
    const store = { load: jest.fn(), save: jest.fn(async () => {}) };
    const r: any = await execute(
      'pattern_store', { action: 'save', name: 'ws' },
      ctx({ store, getCurrentPatternSafe: async () => '   \n\t ' }));
    expect(r.ok).toBe(false);
    expect(store.save).not.toHaveBeenCalled();
  });

  it('a real pattern still saves', async () => {
    const { execute } = await import('../../server/tools/storage');
    const store = { load: jest.fn(), save: jest.fn(async () => {}) };
    const r: any = await execute(
      'pattern_store', { action: 'save', name: 'ok' }, ctx({ store }));
    expect(store.save).toHaveBeenCalled();
    expect(String(r)).toContain('saved');
  });

  it('a real load still loads', async () => {
    const { execute } = await import('../../server/tools/storage');
    const store = { load: jest.fn(async () => ({ content: 's("hh")', tags: [] })), save: jest.fn() };
    const r: any = await execute(
      'pattern_store', { action: 'load', name: 'good' }, ctx({ store }));
    expect(String(r)).toContain('Loaded pattern');
  });
});
