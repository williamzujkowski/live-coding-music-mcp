/**
 * A fast-fail on allocation-shaped literals (#307, partial).
 *
 * READ THIS BEFORE TRUSTING IT: this is not a security control, and the
 * tests below say so explicitly. `Array(50000000).fill(7)` reached
 * 1908 MB in 5791 ms before the vm's 1000 ms timeout fired, because V8
 * cannot interrupt inside an allocating builtin — a wall-clock budget
 * is not a memory budget.
 *
 * A determined payload evades a literal bound by computing the number,
 * and the last test in this file proves that rather than leaving it
 * implied. The real containment is process isolation with a hard heap
 * cap, settled by measurement on #307.
 *
 * What this buys: the accidental case fails in microseconds instead of
 * allocating hundreds of megabytes first.
 */

import { assertPatternIsSafe, PatternSafetyError } from '../../services/PatternSandbox';

const ALLOWED = ['s', 'note', 'stack', 'n'];
const check = (code: string) => assertPatternIsSafe(code, ALLOWED);

describe('allocation-shaped literals are refused (#307)', () => {
  it.each([
    'const a = Array(5000000).fill(7); s("bd*4")',
    's("bd").fast(20000000)',
    'const x = 1e9; s("bd*4")',
    's("bd").slow(999999999)',
  ])('refuses %s', code => {
    expect(() => check(code)).toThrow(PatternSafetyError);
  });

  it('names the number and says why', () => {
    expect(() => check('const a = Array(5000000).fill(7); s("bd")'))
      .toThrow(/5000000.*above the 1000000 limit/s);
  });

  it('refuses a large negative literal too', () => {
    expect(() => check('s("bd").nudge(-5000000)')).toThrow(PatternSafetyError);
  });
});

describe('musical numbers are untouched', () => {
  it.each([
    's("bd*4")',
    's("bd").fast(2)',
    'note("c3").gain(0.7).lpf(800)',
    'stack(s("bd*16"), s("hh*32"))',
    'n("0 2 4").scale("C:minor")',
    's("bd").every(4, x => x.fast(2))',
    'note("c3").attack(0.01).release(0.4)',
    's("bd").fast(999999)',
  ])('allows %s', code => {
    expect(() => check(code)).not.toThrow();
  });

  it('the bound is far above anything a pattern needs', () => {
    // A pattern asking for a million of anything is not describing
    // music. If this ever needs raising, that is the question to ask.
    expect(() => check('s("bd").fast(1000000)')).not.toThrow();
  });
});

describe('what this does NOT buy (#307 remains open)', () => {
  it('a computed number evades it, by design', () => {
    // Deliberately not constant-folded: chasing arithmetic through an
    // AST walk is an arms race the walk loses. This test exists so the
    // limitation is recorded, not discovered later by someone who
    // assumed the bound was a control.
    expect(() => check('const a = Array(1e4 * 5e3).fill(7); s("bd")')).not.toThrow();
  });

  it('so does a number assembled from small parts', () => {
    expect(() => check('let n = 1000; for (const i of [1,2,3]) { n = n * 1000; } s("bd")'))
      .not.toThrow();
  });
});
