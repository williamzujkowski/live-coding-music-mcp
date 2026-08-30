/**
 * Sandbox containment tests (#229).
 *
 * `StrudelEngine` used `new Function(...)` to run caller-supplied pattern
 * code directly in the server process. `validate_pattern_local` reaches it
 * with no browser and no init, so an MCP client — or anything that got a
 * string into one, such as a prompt-injected agent — had arbitrary code
 * execution as the user running the server.
 *
 * Each escape vector below is pinned so it can't silently come back.
 *
 * These exercise PatternSandbox directly. The end-to-end check against a
 * real StrudelEngine lives in `npm run test:sandbox` — the engine imports
 * @strudel/core as ESM, which this Jest setup cannot load, so every
 * StrudelEngine.test.ts case runs against a canned mock instead.
 */

import {
  assertPatternIsSafe,
  runPatternCode,
  PatternSafetyError,
  EXECUTION_TIMEOUT_MS,
} from '../../services/PatternSandbox.js';

// The identifiers a real Strudel context would provide.
const STRUDEL_GLOBALS = ['s', 'n', 'note', 'stack', 'seq', 'mini', 'm', 'sound'];

const expectRejected = (code: string): void => {
  expect(() => assertPatternIsSafe(code, STRUDEL_GLOBALS)).toThrow(PatternSafetyError);
};

describe('PatternSandbox.assertPatternIsSafe', () => {
  describe('escape vectors are rejected', () => {
    it('rejects dynamic import — the original proof of concept', () => {
      expectRejected(`import('fs').then(fs=>fs.writeFileSync('/tmp/pwned','x')); s('bd')`);
    });

    /**
     * The load-bearing one. node:vm is not a security boundary: the
     * sandbox holds real host functions, and
     * `hostFn.constructor.constructor('return process')()` compiles in the
     * MAIN realm, reaching `process` straight through the context wall.
     * Verified to work against a vm context with codeGeneration disabled,
     * which is why `.constructor` must die at the syntax level.
     */
    it('rejects reaching the Function constructor through a host function', () => {
      expectRejected(`mini.constructor.constructor('return process')(); s('bd')`);
    });

    it('rejects the same escape via computed access', () => {
      expectRejected(`mini['constructor']['constructor']('return process')(); s('bd')`);
    });

    it('rejects obfuscated computed access that builds the key at runtime', () => {
      expectRejected(`const k='cons'+'tructor'; mini[k][k]('return process')(); s('bd')`);
    });

    it.each([
      ['process', `process.env.HOME; s('bd')`],
      ['require', `require('child_process').execSync('id'); s('bd')`],
      ['globalThis', `globalThis.process.exit(1); s('bd')`],
      ['eval', `eval('1+1'); s('bd')`],
      ['Function', `Function('return process')(); s('bd')`],
      ['module', `module.exports = 1; s('bd')`],
      ['Reflect', `Reflect.get({}, 'x'); s('bd')`],
    ])('rejects the %s global', (_name, code) => {
      expectRejected(code);
    });

    it.each(['__proto__', 'prototype'])('rejects the %s property', prop => {
      expectRejected(`s('bd').${prop}`);
    });

    it('names the offending identifier so the caller can fix it', () => {
      expect(() => assertPatternIsSafe(`process.exit(1)`, STRUDEL_GLOBALS))
        .toThrow(/unknown identifier 'process'/);
    });
  });

  describe('legitimate patterns are allowed', () => {
    it.each([
      's("bd hh sd hh")',
      'note("c3 e3 g3").s("sawtooth").lpf(800)',
      'stack(s("bd*4"), s("~ sd")).slow(2)',
      'n("0 2 4").fast(2)',
      'const x = 4; s("bd*4").fast(x)',
      's("bd").every(4, x => x.fast(2))',
      'seq(s("bd"), s("sd")).cpm(120)',
      'note("c a f e").sometimesBy(0.3, x => x.speed(2))',
      's("bd*4").gain(0.8).room(0.3)',
      'Math.random() > 0.5 ? s("bd") : s("sd")',
      's("bd").pan([0, 1][0])',
    ])('allows %s', code => {
      expect(() => assertPatternIsSafe(code, STRUDEL_GLOBALS)).not.toThrow();
    });

    it('allows names the pattern declares itself', () => {
      expect(() =>
        assertPatternIsSafe('function build(a){ return s(a); } build("bd")', STRUDEL_GLOBALS),
      ).not.toThrow();
    });

    it('allows destructured bindings', () => {
      expect(() =>
        assertPatternIsSafe('const [a, b] = ["bd", "sd"]; stack(s(a), s(b))', STRUDEL_GLOBALS),
      ).not.toThrow();
    });

    it('does not mistake object keys or property names for globals', () => {
      expect(() =>
        assertPatternIsSafe('s("bd").set({ process: 1 }).gain(0.5)', STRUDEL_GLOBALS),
      ).not.toThrow();
    });
  });

  it('refuses unparseable input rather than passing it through', () => {
    expectRejected('s("bd"');
  });
});

describe('PatternSandbox.runPatternCode', () => {
  it('evaluates ordinary code against the provided context', () => {
    expect(runPatternCode('return double(21);', { double: (n: number) => n * 2 })).toBe(42);
  });

  it('does not expose process to the sandbox', () => {
    expect(runPatternCode('return typeof process;', {})).toBe('undefined');
  });

  it('disables code generation from strings', () => {
    expect(() => runPatternCode('return eval("1+1");', {})).toThrow(/[Cc]ode generation/);
  });

  it('terminates a runaway pattern instead of hanging the server', () => {
    expect(() => runPatternCode('while(true){}', {}, 200)).toThrow(/timed out/i);
  });

  it('has a bounded default timeout', () => {
    expect(EXECUTION_TIMEOUT_MS).toBeGreaterThan(0);
    expect(EXECUTION_TIMEOUT_MS).toBeLessThanOrEqual(5000);
  });
});
