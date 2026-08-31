/**
 * A binding cannot smuggle in a global the sandbox withholds (#408).
 *
 * `collectDeclaredNames` builds one whole-file set of declared names, so
 * a name declared anywhere makes bare references to it legal everywhere.
 * That is fine for `const kick = ...` and was a hole for anything
 * deliberately absent from `SAFE_GLOBALS`:
 *
 *     function bypass(Reflect) {}   // never called
 *     Reflect.get(...)              // now a legal identifier
 *
 * Measured through the isolated engine before the fix: with that dead
 * parameter present, `typeof Reflect` in the pattern evaluated to
 * "object" and `typeof Object` to "function" — the vm context's real
 * intrinsics, not the unused parameter. No escape came out of it (the
 * context's `Function` and `eval` are dead under
 * `codeGeneration: { strings: false }`, and `process` and `require` are
 * absent), but this is the layer whose job is to refuse the attempt.
 */

import { assertPatternIsSafe, PatternSafetyError } from '../../services/PatternSandbox';

const CONTEXT = ['s', 'note', 'stack', 'setcpm'];

describe('a binding cannot smuggle in a withheld global (#408)', () => {
  it.each([
    'Object', 'Reflect', 'Proxy', 'Function', 'eval', 'globalThis', 'process', 'require',
  ])('a parameter named %s does not make the bare name legal', name => {
    // The declaration alone is accepted — it is just a name — but the
    // reference below it must still be refused.
    expect(() => assertPatternIsSafe(`function b(${name}) {}\n${name}.x`, CONTEXT))
      .toThrow(PatternSafetyError);
    expect(() => assertPatternIsSafe(`const ${name} = 1;\n${name}`, CONTEXT))
      .toThrow(PatternSafetyError);
    expect(() => assertPatternIsSafe(`s("bd").gain(typeof ${name})`, CONTEXT))
      .toThrow(PatternSafetyError);
  });

  it('still allows ordinary local bindings', () => {
    // The rule must not cost patterns their own names.
    expect(() => assertPatternIsSafe('const kick = s("bd");\nkick.gain(0.8)', CONTEXT))
      .not.toThrow();
    expect(() => assertPatternIsSafe('const f = (x) => x;\nf(s("bd"))', CONTEXT))
      .not.toThrow();
  });

  it('still allows the globals that are deliberately safe', () => {
    expect(() => assertPatternIsSafe('s("bd").gain(Math.min(1, 0.8))', CONTEXT)).not.toThrow();
    expect(() => assertPatternIsSafe('s("bd").gain(Number("0.8"))', CONTEXT)).not.toThrow();
  });
});
