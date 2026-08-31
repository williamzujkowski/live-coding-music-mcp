/**
 * Containment tests for the isolated evaluation runner (#307).
 *
 * The property under test is blunt: a pattern that allocates more than the
 * cap must kill the child and NOT the server. Every assertion here that
 * runs after the OOM case is itself evidence — if containment failed, this
 * process would have aborted and none of them would report at all.
 *
 * The child used here is a hand-written script rather than the real
 * `engineChild`, because the real one imports `@strudel/*`, which is ESM
 * and cannot load under this project's CommonJS Jest. That is not a
 * weaker test: the containment lives entirely in the runner, and the
 * payload is the exact `new Array(5e7).fill(7)` from the issue.
 * `npm run test:sandbox` runs the same payload through the real engine.
 */

import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { IsolatedEngineRunner, IsolatedRunnerError } from '../../services/IsolatedEngineRunner';

// .cjs, and outside the package, so Node reads it as CommonJS regardless
// of this package's "type": "module".
const CHILD_SOURCE = `
process.on('message', (msg) => {
  const reply = (payload) => process.send({ id: msg.id, ...payload });
  try {
    switch (msg.method) {
      case 'echo':
        return reply({ ok: true, result: msg.args[0] });
      case 'oom': {
        // The exact payload from #307: allowlist-clean, and fatal.
        const big = new Array(5e7).fill(7);
        return reply({ ok: true, result: big.length });
      }
      case 'hang':
        return; // never answers
      case 'boom':
        throw new Error('pattern exploded');
      case 'circular': {
        const a = {}; a.self = a;
        return reply({ ok: true, result: JSON.parse(JSON.stringify(a)) });
      }
      case 'slow':
        return setTimeout(() => reply({ ok: true, result: 'late' }), msg.args[0]);
      case 'pid':
        return reply({ ok: true, result: process.pid });
      default:
        return reply({ ok: false, error: { name: 'TypeError', message: 'Unknown engine method: ' + msg.method } });
    }
  } catch (error) {
    reply({ ok: false, error: { name: error.name, message: error.message } });
  }
});
process.on('disconnect', () => process.exit(0));
`;

let dir: string;
let childPath: string;
let runner: IsolatedEngineRunner;

beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'isolated-engine-'));
  childPath = path.join(dir, 'child.cjs');
  writeFileSync(childPath, CHILD_SOURCE, 'utf8');
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => {
  runner = new IsolatedEngineRunner({ childPath, maxOldSpaceMb: 64, timeoutMs: 2000 });
});

afterEach(() => {
  runner.dispose();
});

describe('IsolatedEngineRunner — containment (#307)', () => {
  it('round-trips a call through the child', async () => {
    await expect(runner.call('echo', ['hello'])).resolves.toBe('hello');
  });

  it('forks lazily — nothing is running until the first call', async () => {
    expect(runner.isRunning).toBe(false);
    await runner.call('echo', [1]);
    expect(runner.isRunning).toBe(true);
  });

  it('survives new Array(5e7).fill(7) under a 64MB cap, and keeps working', async () => {
    const before = process.pid;

    const error = await runner.call('oom', []).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(IsolatedRunnerError);
    // Asserting the MECHANISM, not just the survival. Dropping
    // --max-old-space-size makes the payload succeed on the default heap
    // until the deadline kills it instead — survival still holds, so a
    // test that only checked survival passed a build with no heap cap at
    // all. It has to be the cap that stopped this.
    expect((error as IsolatedRunnerError).kind).toBe('oom');

    // And the point of the whole exercise: this line runs at all.
    expect(process.pid).toBe(before);
    await expect(runner.call('echo', ['still here'])).resolves.toBe('still here');
  }, 30000);

  it('reports the OOM as the caller\'s problem, not a transient one', async () => {
    const error = await runner.call('oom', []).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(IsolatedRunnerError);
    expect((error as IsolatedRunnerError).kind).toBe('oom');
    expect((error as IsolatedRunnerError).message).toContain('64MB');
  }, 30000);

  it('respawns a fresh child after a kill rather than reusing the corpse', async () => {
    const first = await runner.call<number>('pid', []);
    await runner.call('oom', []).catch(() => undefined);
    const second = await runner.call<number>('pid', []);
    expect(second).not.toBe(first);
  }, 30000);

  it('kills a child that runs past the deadline', async () => {
    const error = await runner.call('hang', []).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(IsolatedRunnerError);
    expect((error as IsolatedRunnerError).kind).toBe('timeout');
    await expect(runner.call('echo', ['recovered'])).resolves.toBe('recovered');
  }, 15000);

  it('re-raises an error the child threw as an ordinary error', async () => {
    // Isolation worked; the pattern was bad. Those must not look alike.
    const error = await runner.call('boom', []).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(IsolatedRunnerError);
    expect((error as Error).message).toBe('pattern exploded');
  });

  it('reports an unknown method instead of resolving something off the prototype', async () => {
    const error = await runner.call('constructor', []).catch((e: unknown) => e);
    expect((error as Error).message).toContain('Unknown engine method');
  });

  it('serializes calls so a death is attributable to one payload', async () => {
    const order: string[] = [];
    const slow = runner.call('slow', [150]).then(() => order.push('slow'));
    const fast = runner.call('echo', ['x']).then(() => order.push('fast'));
    await Promise.all([slow, fast]);
    expect(order).toEqual(['slow', 'fast']);
  });

  it('keeps serving after a failed call rather than wedging the queue', async () => {
    await runner.call('boom', []).catch(() => undefined);
    await expect(runner.call('echo', ['after'])).resolves.toBe('after');
  });

  it('calls a native abort a crash, not an out-of-heap', async () => {
    // Every SIGABRT was filed as an OOM, which then reported a native
    // assertion to the caller as "your pattern allocated too much" —
    // wrong, and it sends them to fix the wrong thing.
    const aborting = path.join(dir, 'aborts.cjs');
    writeFileSync(
      aborting,
      `process.on('message', (m) => {
         if (m.method === 'abort') { console.error('assertion failed: not a memory problem'); return process.abort(); }
         process.send({ id: m.id, ok: true, result: 'ok' });
       });`,
      'utf8'
    );
    const runner2 = new IsolatedEngineRunner({ childPath: aborting, maxOldSpaceMb: 64, timeoutMs: 4000 });
    await runner2.call('warm', []); // answer once, so this is not a start failure
    const error = await runner2.call('abort', []).catch((e: unknown) => e);
    expect((error as IsolatedRunnerError).kind).toBe('crash');
    expect((error as IsolatedRunnerError).message).toContain('assertion failed');
    runner2.dispose();
  }, 15000);

  it('refuses calls once disposed', async () => {
    await runner.call('echo', ['warm']);
    runner.dispose();
    await expect(runner.call('echo', ['cold'])).rejects.toThrow(/disposed/);
  });

  it('calls a missing child entrypoint a start failure, not a death', async () => {
    // fork() to a nonexistent path SUCCEEDS and the child exits 1 a
    // moment later, so this arrived as kind 'crash' — which the tool
    // layer reports as retryable. An unbuilt install is not retryable,
    // and an agent told otherwise loops forever against a deployment
    // problem no amount of retrying will fix.
    const broken = new IsolatedEngineRunner({
      childPath: path.join(dir, 'does-not-exist.cjs'),
      maxOldSpaceMb: 64,
      timeoutMs: 2000,
    });
    const error = await broken.call('echo', ['x']).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(IsolatedRunnerError);
    expect((error as IsolatedRunnerError).kind).toBe('spawn');
    expect((error as IsolatedRunnerError).message).toContain('npm run build');
    broken.dispose();
  }, 15000);

  it('calls a child that dies before answering a start failure too', async () => {
    // The path exists, so the existsSync guard does not fire; the child
    // dies on its own during startup. Same advice applies: this is a
    // build problem, not a pattern problem.
    const dying = path.join(dir, 'dies-on-start.cjs');
    writeFileSync(dying, "throw new Error('broken import');", 'utf8');
    const broken = new IsolatedEngineRunner({ childPath: dying, maxOldSpaceMb: 64, timeoutMs: 4000 });
    const error = await broken.call('echo', ['x']).catch((e: unknown) => e);
    expect((error as IsolatedRunnerError).kind).toBe('spawn');
    broken.dispose();
  }, 15000);

  it('still calls a mid-evaluation death a crash, not a start failure', async () => {
    // The distinction has to cut both ways or it is just a rename: a
    // child that answered once and then died failed at the work.
    const suicidal = path.join(dir, 'dies-later.cjs');
    writeFileSync(
      suicidal,
      `process.on('message', (m) => {
         if (m.method === 'die') return process.exit(3);
         process.send({ id: m.id, ok: true, result: 'alive' });
       });`,
      'utf8'
    );
    const runner2 = new IsolatedEngineRunner({ childPath: suicidal, maxOldSpaceMb: 64, timeoutMs: 4000 });
    await expect(runner2.call('echo', [])).resolves.toBe('alive');
    const error = await runner2.call('die', []).catch((e: unknown) => e);
    expect((error as IsolatedRunnerError).kind).toBe('crash');
    runner2.dispose();
  }, 15000);
});
