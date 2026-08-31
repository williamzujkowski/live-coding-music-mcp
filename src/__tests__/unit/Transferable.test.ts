/**
 * What may cross the IPC boundary out of the isolated engine (#307).
 *
 * This replaced `JSON.parse(JSON.stringify(x))`, which handed a pattern
 * author a way to run arbitrary code in the child after the vm's timeout
 * had already returned: `JSON.stringify` calls `toJSON`.
 */

import { toTransferable, TransferError } from '../../services/Transferable';

describe('toTransferable', () => {
  it('carries the shapes a hap value actually has', () => {
    expect(toTransferable({ s: 'bd', gain: 0.5, n: [1, 2] })).toEqual({
      s: 'bd',
      gain: 0.5,
      n: [1, 2],
    });
    expect(toTransferable([{ value: { s: 'bd' }, start: 0, end: 0.25, isWhole: true }])).toEqual([
      { value: { s: 'bd' }, start: 0, end: 0.25, isWhole: true },
    ]);
  });

  it('never calls toJSON', () => {
    // The whole point. A real payload would be `while (true);` — this
    // records the call instead, so the test can fail rather than hang.
    const calls: string[] = [];
    const value = { s: 'bd', toJSON: () => { calls.push('toJSON'); return 'hijacked'; } };
    const result = toTransferable(value) as Record<string, unknown>;
    expect(calls).toEqual([]);
    expect(result.s).toBe('bd');
  });

  it('never calls a getter', () => {
    const calls: string[] = [];
    const value = {} as Record<string, unknown>;
    Object.defineProperty(value, 'boom', {
      enumerable: true,
      get: () => { calls.push('get'); return 1; },
    });
    expect(toTransferable(value)).toEqual({});
    expect(calls).toEqual([]);
  });

  it('drops functions and symbols rather than carrying or invoking them', () => {
    expect(toTransferable({ fn: () => 'x', sym: Symbol('s'), keep: 1 })).toEqual({
      fn: null,
      sym: null,
      keep: 1,
    });
  });

  it('does not read inherited properties', () => {
    const proto = { inherited: 'no' };
    const value = Object.create(proto) as Record<string, unknown>;
    value.own = 'yes';
    expect(toTransferable(value)).toEqual({ own: 'yes' });
  });

  it('does not call an array\'s own map', () => {
    // `map` is looked up on the value, and an array's own `map` is
    // writable — plain assignment, no exotic syntax. Calling it would
    // run pattern code in the child, which is the same hole as toJSON.
    const calls: string[] = [];
    const arr = [1, 2] as unknown[] & { map?: unknown };
    arr.map = () => { calls.push('map'); return ['hijacked']; };
    expect(toTransferable(arr)).toEqual([1, 2]);
    expect(calls).toEqual([]);
  });

  it('does not call an array index getter', () => {
    const calls: string[] = [];
    const arr: unknown[] = [];
    Object.defineProperty(arr, 0, { enumerable: true, get: () => { calls.push('get'); return 1; } });
    arr.length = 1;
    expect(toTransferable(arr)).toEqual([null]);
    expect(calls).toEqual([]);
  });

  it('refuses a circular structure instead of recursing forever', () => {
    const a: Record<string, unknown> = {};
    a.self = a;
    expect(() => toTransferable(a)).toThrow(TransferError);
  });

  it('matches JSON.stringify on the number edge cases, so the wire shape is unchanged', () => {
    expect(toTransferable({ a: NaN, b: Infinity, c: -0 })).toEqual({ a: null, b: null, c: -0 });
  });

  it('renders a bigint rather than throwing the way JSON.stringify does', () => {
    expect(toTransferable({ n: 10n })).toEqual({ n: '10' });
  });

  it('refuses a structure past the node budget', () => {
    // Wide, not deep — the depth guard must not be what catches this.
    const wide = { items: Array.from({ length: 10 }, () => ({ a: 1 })) };
    expect(toTransferable(wide)).toBeDefined();
    const huge = { items: new Array(2_000_001).fill(1) };
    expect(() => toTransferable(huge)).toThrow(TransferError);
  });
});

/**
 * A sparse array must be charged against the node budget (#408).
 *
 * The array branch skipped holes and getters with `out.push(null);
 * continue;`, and the budget is only charged inside `toTransferable` —
 * so neither cost anything. `const a = []; a.length = 5e7` is cheap to
 * build in V8's sparse representation and walked all fifty million
 * holes, pushing a null for each, straight past a two-million-node
 * bound that exists to refuse exactly that shape.
 *
 * The child's heap cap and the parent's deadline still caught it
 * eventually, so this was never a containment breach — it defeated the
 * fast, precise refusal this module is for.
 */
describe('the node budget covers holes and getters (#408)', () => {
  it('refuses a huge sparse array instead of walking it', () => {
    const sparse: unknown[] = [];
    sparse.length = 5_000_000;

    const started = Date.now();
    expect(() => toTransferable(sparse)).toThrow(/transfer limit/);
    // Refused on budget, not after materialising five million nulls.
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it('refuses an array of getters on the same grounds', () => {
    const withGetters: unknown[] = [];
    for (let i = 0; i < 10; i++) {
      Object.defineProperty(withGetters, i, {
        get: () => { throw new Error('a getter must never be invoked'); },
        enumerable: true,
        configurable: true,
      });
    }
    withGetters.length = 5_000_000;

    expect(() => toTransferable(withGetters)).toThrow(/transfer limit/);
  });

  it('still carries an ordinary array through', () => {
    expect(toTransferable([1, 'two', { three: 3 }])).toEqual([1, 'two', { three: 3 }]);
    // A small sparse array is legal and becomes nulls, as before.
    const small: unknown[] = [1];
    small.length = 3;
    expect(toTransferable(small)).toEqual([1, null, null]);
  });
});
