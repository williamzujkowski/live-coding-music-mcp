/**
 * The isolated engine as the local tools see it (#307).
 *
 * Two halves: that `IsolatedStrudelEngine` really delegates over the fork
 * rather than quietly evaluating in-process, and that when the child dies
 * the four local-engine tools return an envelope instead of a stack trace
 * — through ONE mapping, which was the acceptance criterion.
 */

import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { IsolatedStrudelEngine } from '../../services/IsolatedStrudelEngine';
import { IsolatedRunnerError } from '../../services/IsolatedEngineRunner';
import { execute } from '../../server/tools/analysis';
import type { ToolContext } from '../../server/tools/types';

// A stand-in engine child: same protocol, no @strudel/* (which is ESM and
// will not load under this project's CommonJS Jest).
const CHILD_SOURCE = `
const engine = {
  transpile: (code) => ({ success: true, transpiledCode: 'return ' + code }),
  validate: (code) => ({ valid: code.length > 0, errors: [], warnings: [], suggestions: [], pid: process.pid }),
  analyzePattern: (code) => ({ eventsPerCycle: 4, evaluated: true, code, pid: process.pid }),
  queryEvents: (code, start, end) => [{ value: { s: 'bd' }, start, end, isWhole: true }],
};
process.on('message', (msg) => {
  try {
    if (!Object.hasOwn(engine, msg.method)) {
      return process.send({ id: msg.id, ok: false, error: { name: 'TypeError', message: 'Unknown engine method' } });
    }
    process.send({ id: msg.id, ok: true, result: engine[msg.method](...msg.args) });
  } catch (error) {
    process.send({ id: msg.id, ok: false, error: { name: error.name, message: error.message } });
  }
});
process.on('disconnect', () => process.exit(0));
`;

let dir: string;
let childPath: string;

beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'isolated-local-engine-'));
  childPath = path.join(dir, 'child.cjs');
  writeFileSync(childPath, CHILD_SOURCE, 'utf8');
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('IsolatedStrudelEngine', () => {
  let engine: IsolatedStrudelEngine;

  beforeEach(() => {
    engine = new IsolatedStrudelEngine({ childPath, maxOldSpaceMb: 64, timeoutMs: 3000 });
  });

  afterEach(() => {
    engine.dispose();
  });

  it('does not fork until a tool actually needs it', async () => {
    expect(engine.isStarted).toBe(false);
    await engine.validate('s("bd")');
    expect(engine.isStarted).toBe(true);
  });

  it('evaluates out of process, not in this one', async () => {
    const result = (await engine.validate('s("bd")')) as unknown as { pid: number };
    expect(result.pid).toBeGreaterThan(0);
    // If this ever fails, the "isolation" is a function call and the
    // whole fix is decorative.
    expect(result.pid).not.toBe(process.pid);
  });

  it('routes all four methods through the same child', async () => {
    const validate = (await engine.validate('s("bd")')) as unknown as { pid: number };
    const analyze = (await engine.analyzePattern('s("bd")')) as unknown as { pid: number };
    expect(analyze.pid).toBe(validate.pid);

    await expect(engine.transpile('s("bd")')).resolves.toMatchObject({ success: true });
    await expect(engine.queryEvents('s("bd")', 0, 1)).resolves.toHaveLength(1);
  });

  it('resolves concurrent cold calls against a single child', async () => {
    const [a, b] = (await Promise.all([
      engine.validate('a'),
      engine.analyzePattern('b'),
    ])) as unknown as Array<{ pid: number }>;
    expect(a.pid).toBe(b.pid);
  });

  it('does not fork a child after dispose, even mid-start', async () => {
    // Resolving the child entrypoint is asynchronous, so shutdown can
    // land while a start is in flight. Without a permanent disposed flag
    // the start completed afterwards and forked a process nobody was
    // left to kill.
    //
    // This test used to pass `childPath`, which resolves synchronously
    // and closes the very window it claimed to test — it stayed green
    // with the fix reverted. Cross-model review (agy) caught that. The
    // resolver below reproduces production's async path.
    const spawns: string[] = [];
    let releaseResolution = (): void => {};
    const gate = new Promise<void>(resolve => { releaseResolution = resolve; });

    const racing = new IsolatedStrudelEngine({
      resolveEntrypoint: async () => {
        await gate;
        return { childPath, needsTsx: false };
      },
      onSpawn: (reason) => spawns.push(reason),
    });

    const pending = racing.validate('s("bd")');
    // dispose lands while the resolution is still outstanding.
    racing.dispose();
    releaseResolution();

    await expect(pending).rejects.toThrow(/disposed/);
    expect(spawns).toEqual([]);
    expect(racing.isStarted).toBe(false);
  });

  it('stays disposed — a later call does not quietly start a new child', async () => {
    const engine2 = new IsolatedStrudelEngine({ childPath });
    await engine2.validate('s("bd")');
    engine2.dispose();
    await expect(engine2.validate('s("bd")')).rejects.toThrow(/disposed/);
    expect(engine2.isStarted).toBe(false);
  });

  it('is safe to dispose without ever having started', () => {
    const unused = new IsolatedStrudelEngine({ childPath });
    expect(() => { unused.dispose(); }).not.toThrow();
  });
});

describe('local-engine tools map a dead child to an envelope', () => {
  function ctxThatDies(kind: 'oom' | 'timeout' | 'crash' | 'spawn'): ToolContext {
    const boom = (): never => {
      throw new IsolatedRunnerError(`child died: ${kind}`, kind);
    };
    return {
      strudelEngine: {
        transpile: boom,
        validate: boom,
        analyzePattern: boom,
        queryEvents: boom,
      },
      isInitialized: () => false,
      getController: () => null as never,
    } as unknown as ToolContext;
  }

  const TOOLS = [
    ['validate_pattern_local', {}],
    ['analyze_pattern_local', {}],
    ['transpile_pattern', {}],
    ['query_pattern_events', { start: 0, end: 1 }],
  ] as const;

  it.each(TOOLS)('%s reports an out-of-heap death as the caller\'s input to fix', async (tool, extra) => {
    const result = (await execute(tool, { pattern: 's("bd")', ...extra }, ctxThatDies('oom'))) as any;
    expect(result.ok).toBe(false);
    // Retrying `new Array(5e7).fill(7)` exhausts the cap every time. An
    // agent told this is retryable will sit in a loop it cannot win.
    expect(result.errorCategory).toBe('validation');
    expect(result.isRetryable).toBe(false);
  });

  it.each(TOOLS)('%s reports a hang as transient and retryable', async (tool, extra) => {
    const result = (await execute(tool, { pattern: 's("bd")', ...extra }, ctxThatDies('timeout'))) as any;
    expect(result.ok).toBe(false);
    expect(result.errorCategory).toBe('transient');
    expect(result.isRetryable).toBe(true);
  });

  it.each(TOOLS)('%s reports an engine that never started as a deployment problem', async (tool, extra) => {
    const result = (await execute(tool, { pattern: 's("bd")', ...extra }, ctxThatDies('spawn'))) as any;
    expect(result.ok).toBe(false);
    // An unbuilt or missing child is missing on the next attempt too.
    expect(result.errorCategory).toBe('internal');
    expect(result.isRetryable).toBe(false);
  });

  it('does not tell the caller to go run the validator when the engine is what broke', async () => {
    const result = (await execute(
      'query_pattern_events',
      { pattern: 's("bd")', start: 0, end: 1 },
      ctxThatDies('crash')
    )) as any;
    // The old catch turned every throw into "check pattern syntax with
    // validate_pattern_local first" — advice that sends the caller to a
    // tool backed by the same child that just died.
    expect(result.suggestion).toBeUndefined();
    expect(result.ok).toBe(false);
  });

  it('still reports a genuine syntax failure as a syntax failure', async () => {
    const ctx = {
      strudelEngine: {
        queryEvents: () => { throw new Error('Unexpected token'); },
      },
      isInitialized: () => false,
      getController: () => null as never,
    } as unknown as ToolContext;
    const result = (await execute('query_pattern_events', { pattern: 'oops(', start: 0, end: 1 }, ctx)) as any;
    expect(result.error).toBe('Unexpected token');
    expect(result.suggestion).toContain('validate_pattern_local');
  });
});
