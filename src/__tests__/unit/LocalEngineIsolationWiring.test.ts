/**
 * Structural guard: the server must actually USE the isolated engine (#307).
 *
 * Cross-model review (codex) made the point that killed this test's
 * absence: every unit test for the isolation constructs
 * `IsolatedStrudelEngine` directly, so reverting `server.ts` to
 * `new StrudelEngine()` would leave all of them green while the server
 * went back to evaluating user patterns in its own process. The tests
 * proved the mechanism works and said nothing about whether it is
 * plugged in.
 *
 * Reading the source is the only way to assert wiring here: the tools
 * take their engine from `ToolContext`, so a test can always hand them a
 * good one no matter what the server does.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.join(__dirname, '..', '..', '..');
const SERVER = readFileSync(path.join(ROOT, 'src', 'server', 'server.ts'), 'utf8');

describe('local engine isolation wiring (#307)', () => {
  it('constructs the isolated engine, not the in-process one', () => {
    expect(SERVER).toMatch(/new IsolatedStrudelEngine\(/);
    expect(SERVER).not.toMatch(/new StrudelEngine\(/);
  });

  it('does not import StrudelEngine as a value', () => {
    // A type-only import is fine and erases; a value import would pull
    // @strudel/* into the server process, which is the thing being
    // avoided.
    const valueImport = /import\s+\{[^}]*\bStrudelEngine\b[^}]*\}\s+from\s+'[^']*StrudelEngine\.js'/;
    const typeOnly = /import\s+type\s/;
    const match = valueImport.exec(SERVER);
    if (match !== null) {
      expect(typeOnly.test(match[0])).toBe(true);
    }
  });

  it('disposes the child on every shutdown path, not only SIGINT', () => {
    // SIGTERM is what docker stop, systemd and most supervisors send.
    // Handling only SIGINT orphaned the child in precisely the
    // deployments where nobody is watching a terminal.
    expect(SERVER).toMatch(/process\.on\('SIGINT'/);
    expect(SERVER).toMatch(/process\.on\('SIGTERM'/);
    expect(SERVER).toMatch(/process\.on\('exit'/);
    expect(SERVER).toMatch(/strudelEngine\.dispose\(\)/);
  });

  it('cannot hang in shutdown, and does not swallow a second signal', () => {
    // Both awaits in shutdown talk to a browser over CDP, and a wedged
    // one never answers. Hanging there is the one path that CAN orphan
    // the engine child, because the supervisor's eventual SIGKILL gives
    // nobody a chance to dispose it.
    expect(SERVER).toMatch(/forceExit/);
    expect(SERVER).toMatch(/\.unref\(\)/);
    expect(SERVER).toMatch(/SHUTDOWN_GRACE_MS/);
    // A second Ctrl+C must do something.
    expect(SERVER).toMatch(/during shutdown/);
  });

  it('keeps the four local-engine tools on the isolated path', () => {
    const analysis = readFileSync(
      path.join(ROOT, 'src', 'server', 'tools', 'analysis.ts'),
      'utf8'
    );
    // Each must be awaited. A dropped `await` returns a Promise where a
    // result is expected, and the tool answers with `{}` rather than
    // failing — silent, and exactly the kind of thing tsc allows when a
    // value is typed `T | Promise<T>`.
    for (const call of [
      'await ctx.strudelEngine.validate(',
      'await ctx.strudelEngine.analyzePattern(',
      'await ctx.strudelEngine.queryEvents(',
      'await ctx.strudelEngine.transpile(',
    ]) {
      expect(analysis.includes(call) || readFileSync(
        path.join(ROOT, 'src', 'server', 'tools', 'ai.ts'), 'utf8'
      ).includes(call)).toBe(true);
    }
  });
});
