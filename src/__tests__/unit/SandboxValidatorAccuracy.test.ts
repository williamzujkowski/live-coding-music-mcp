/**
 * Cross-model review of PatternSandbox and InputValidator (#491).
 *
 * Ten findings; these are the ones that reproduced. The headline claim
 * — an object-shorthand `({Reflect}).Reflect` smuggling `Reflect` past
 * the identifier check and reaching `process` — did NOT reproduce, and
 * a test for that is included so it stays refuted.
 */
import { InputValidator } from '../../utils/InputValidator';
import { assertPatternIsSafe } from '../../services/PatternSandbox';

describe('PatternSandbox numeric guard covers bigint', () => {
  // The globals a pattern is allowed to name, as the engine supplies them.
  const allowed = ['note', 's', 'stack', 'setcpm', 'Array', 'Number'];

  it('refuses a huge bigint literal, not just a huge number', () => {
    // This tested `typeof value === 'number'` only, so any `n` suffix
    // walked past it. Contained by the isolated child's heap cap when
    // it got through, but a fast-fail that a one-character suffix
    // sidesteps is not the fast-fail it claims to be.
    expect(() => assertPatternIsSafe('Array(Number(50000000n)).fill(7)', allowed)).toThrow(/above the/);
  });

  it('still refuses the huge plain number', () => {
    expect(() => assertPatternIsSafe('Array(50000000).fill(7)', allowed)).toThrow(/above the/);
  });

  it('leaves ordinary musical numbers alone', () => {
    expect(() => assertPatternIsSafe('s("bd*4").gain(0.8).lpf(800)', allowed)).not.toThrow();
    expect(() => assertPatternIsSafe('setcpm(130/4)', allowed)).not.toThrow();
  });

  it('still rejects an unknown identifier smuggled through shorthand', () => {
    // The review claimed object-literal shorthand treats `Reflect`
    // solely as a property key, bypassing the identifier check and
    // reaching the host `Function` constructor. Measured, it does not:
    // the identifier check sees it. Kept as a test so the claim stays
    // answered rather than re-litigated.
    expect(() => assertPatternIsSafe(
      'const r=({Reflect}).Reflect; r.get(note,"constructor")', allowed))
      .toThrow(/Reflect/);
  });
});

describe('validateStringLength validates its own bound', () => {
  it('refuses a NaN maxLength instead of accepting everything', () => {
    // Every comparison with NaN is false, so `str.length > NaN` never
    // fired and a million-character string was accepted by the function
    // whose whole purpose is preventing resource exhaustion.
    expect(() => InputValidator.validateStringLength('x'.repeat(1_000_000), 'pattern', NaN))
      .toThrow(/misconfigured/);
  });

  it.each([[Infinity], [-1]])('refuses maxLength %p', (max) => {
    expect(() => InputValidator.validateStringLength('x', 'pattern', max))
      .toThrow(/misconfigured/);
  });

  it('says what it actually counts', () => {
    // One emoji is two UTF-16 code units. The bound is deliberately in
    // code units — that is what a resource limit should bound — so the
    // message says so rather than calling them characters.
    expect(() => InputValidator.validateStringLength('🎵', 'pattern', 1))
      .toThrow(/UTF-16 code units, got 2/);
  });

  it('still enforces an ordinary bound', () => {
    expect(() => InputValidator.validateStringLength('x'.repeat(1001), 'pattern')).toThrow();
    expect(() => InputValidator.validateStringLength('x'.repeat(1000), 'pattern')).not.toThrow();
  });

  it('still allows an empty string by default, and refuses one on request', () => {
    // The docstring claimed the default varied by field name. It never
    // did: the default is `true`, and callers needing an identifier
    // pass `false`.
    expect(() => InputValidator.validateStringLength('', 'name')).not.toThrow();
    expect(() => InputValidator.validateStringLength('', 'name', 1000, false)).toThrow(/empty/);
  });
});
