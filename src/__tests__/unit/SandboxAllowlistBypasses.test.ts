/**
 * Two ways the local pattern sandbox could be escaped, and the
 * regression tests that keep them shut.
 *
 * Reachable through `validate_pattern_local`, `analyze_pattern_local`
 * and `query_pattern_events` — none of which needs `init`, a browser,
 * or a session. The threat model is an LLM agent, possibly
 * prompt-injected, supplying the pattern text.
 *
 * 1. Destructuring reads a property with no MemberExpression node, so
 *    the BANNED_PROPERTIES check never saw it, and collectDeclaredNames
 *    then added the bound name to the allowed set. Two holes lining up.
 *
 * 2. The context was built by spreading @strudel/core, which exports its
 *    own transpile-and-evaluate under several names. Every context key
 *    is automatically an allowed identifier, so a pattern could call one
 *    directly — no banned syntax, no member access, no destructuring.
 *    An AST allowlist cannot defend a context function that is itself an
 *    evaluator.
 *
 * Note on writing tests here: the Strudel transpiler rewrites
 * DOUBLE-quoted string literals into mini() calls, so a payload must use
 * single quotes to survive as code. A test that uses double quotes
 * passes for the wrong reason.
 */

import { assertPatternIsSafe, PatternSafetyError } from '../../services/PatternSandbox';

// StrudelEngine cannot be imported here: it pulls in @strudel/core as
// ESM, which this repo's Jest setup cannot load. The engine-level half
// of these checks lives in scripts/verify-sandbox.ts (npm run
// test:sandbox), which runs the real engine under tsx.

describe('the AST allowlist covers destructuring (#SANDBOX)', () => {
  const allowed = ['note', 's', 'stack'];
  const reject = (code: string) => expect(() => assertPatternIsSafe(code, allowed))
    .toThrow(PatternSafetyError);

  it.each([
    ['member access', 'note.constructor'],
    ['shorthand destructure', 'const { constructor } = note; note(\'c3\')'],
    ['renamed destructure', 'const { constructor: C } = note; note(\'c3\')'],
    ['param destructure', 'const f = ({ constructor: C }) => C; f(note); note(\'c3\')'],
    ['for-of destructure', 'for (const { constructor: C } of [note]) { C; } note(\'c3\')'],
    ['nested via __proto__', 'const { __proto__: { constructor: C } } = note; note(\'c3\')'],
    ['assignment pattern', 'let C; ({ constructor: C } = note); note(\'c3\')'],
    ['prototype destructure', 'const { prototype: P } = note; note(\'c3\')'],
    ['__proto__ destructure', 'const { __proto__: P } = note; note(\'c3\')'],
  ])('rejects %s', (_label, code) => reject(code));

  it('rejects a computed object key', () => {
    reject('const o = { [\'constructor\']: 1 }; note(\'c3\')');
  });

  it('rejects a non-literal computed key outright', () => {
    reject('const k = \'x\'; const o = { [k]: 1 }; note(\'c3\')');
  });

  it('rejects a computed destructuring key', () => {
    reject('const k = \'constructor\'; const { [k]: C } = note; note(\'c3\')');
  });

  it('still allows ordinary destructuring', () => {
    expect(() => assertPatternIsSafe(
      'const { fast } = note; note(\'c3\')', ['note', 'fast'])).not.toThrow();
  });

  it('still allows array destructuring', () => {
    expect(() => assertPatternIsSafe(
      'const [a, b] = [1, 2]; note(\'c3\')', ['note'])).not.toThrow();
  });
});
