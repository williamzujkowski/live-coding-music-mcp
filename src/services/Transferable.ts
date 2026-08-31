/**
 * Copies a value into something Node's IPC can carry (#307).
 *
 * Its own module because it has to be testable: `engineChild.ts` imports
 * `@strudel/*`, which is ESM and will not load under this project's
 * CommonJS Jest, so nothing in that file can be reached by a unit test.
 * This has no dependencies at all.
 */

import { ValidationError } from '../utils/CategorisedError.js';

/** Bounds on what may cross the IPC boundary. Both are far above any real result. */
const MAX_TRANSFER_DEPTH = 32;
const MAX_TRANSFER_NODES = 2_000_000;

/**
 * A result that cannot cross the IPC boundary: too many values, or
 * nested too deep.
 *
 * Extends `ValidationError` because that is what it is — the caller
 * asked for more than can be returned, and the fix is a narrower query.
 * It reaches the parent as a reconstructed error, so the category also
 * travels as an explicit field; see `engineChild`.
 */
export class TransferError extends ValidationError {}

/**
 * Copies a result into something Node's IPC can carry.
 *
 * The obvious implementation is `JSON.parse(JSON.stringify(value))`, and
 * it was, until cross-model review (codex) pointed out what that hands to
 * a pattern author: **`JSON.stringify` calls `toJSON` on any value that
 * defines one**. A hap value is pattern-controlled, so
 * `pure({toJSON: () => { while (true); }})` runs an infinite loop here —
 * outside the vm's timeout, which has already returned. The parent's
 * deadline still fires and still kills the child, so the server survives;
 * what does not survive is the child if the PARENT is killed first, since
 * a blocked event loop can never process `disconnect`. That is an orphan
 * process with no owner.
 *
 * So: walk it by hand. Never invoke `toJSON`, never invoke a getter on a
 * prototype, drop what cannot cross, and bound both depth and node count
 * so a pathological structure fails loudly instead of silently eating the
 * heap the cap is there to protect.
 */
export function toTransferable(value: unknown, depth = 0, budget = { nodes: 0 }): unknown {
  if (++budget.nodes > MAX_TRANSFER_NODES) {
    throw new TransferError(
      `Result exceeds the ${String(MAX_TRANSFER_NODES)}-value transfer limit. ` +
        'Narrow the query or simplify the pattern.'
    );
  }
  if (depth > MAX_TRANSFER_DEPTH) {
    throw new TransferError(
      `Result nests deeper than ${String(MAX_TRANSFER_DEPTH)} levels and cannot be returned.`
    );
  }

  if (value === null || value === undefined) return null;

  switch (typeof value) {
    case 'string':
    case 'boolean':
      return value;
    case 'number':
      // NaN and Infinity are not JSON; null is what JSON.stringify
      // produced for them too, so this keeps the wire shape unchanged.
      return Number.isFinite(value) ? value : null;
    case 'bigint':
      return value.toString();
    // Functions and symbols have no representation on the other side, and
    // a pattern that produced one was not going to be read anyway.
    case 'function':
    case 'symbol':
      return null;
    default:
      break;
  }

  if (Array.isArray(value)) {
    // Index loop, not `.map`. `map` is looked up on the value, and an
    // array's own `map` property is writable: `const a = []; a.map = ...`
    // is an ordinary assignment, so calling it would run pattern-supplied
    // code in the child — the same class of hole as `toJSON`, one method
    // over. Descriptors for the same reason as below.
    const out: unknown[] = [];
    for (let i = 0; i < value.length; i++) {
      const descriptor = Object.getOwnPropertyDescriptor(value, i);
      if (descriptor === undefined) {
        out.push(null);
        continue;
      }
      if (descriptor.get !== undefined) {
        out.push(null);
        continue;
      }
      out.push(toTransferable(descriptor.value, depth + 1, budget));
    }
    return out;
  }

  // Own enumerable properties only. Inherited accessors are pattern-
  // controlled code too, and nothing legitimate arrives on a prototype.
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value as Record<string, unknown>)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    // A getter is a function call. Skip it rather than run it.
    if (descriptor === undefined || descriptor.get !== undefined) continue;
    out[key] = toTransferable(descriptor.value, depth + 1, budget);
  }
  return out;
}
