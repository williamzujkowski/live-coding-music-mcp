/**
 * Safe lookup in a plain-object table keyed by caller-supplied text.
 *
 * `TABLE[key] || fallback` returns an inherited value when `key` is
 * 'constructor', '__proto__', 'toString' and friends — those are
 * neither falsy nor nullish, so neither `||` nor `??` fires, and the
 * inherited value flows on as if it were data.
 *
 * That bug has been found eight separate times in this codebase, one at
 * a time, with symptoms ranging from a TypeError that failed a whole
 * MIDI export (#308) to `s("bd*4").slow(NaN).lpf(NaN)` written into the
 * editor and reported as success (#308) to wrong musical intervals
 * (#318). Finding the ninth by hand is not a plan.
 *
 * @param table - A plain object literal used as a lookup table
 * @param key - Caller-supplied key
 * @param fallback - Value to use when the key is not an own property
 * @returns The table's own value for `key`, or `fallback`
 * @example
 * lookup(FILLS, style, FILLS.techno);
 * @nist si-10 "Information input validation"
 */
export function lookup<T>(
  table: Record<string, T>,
  key: string | undefined | null,
  fallback: T,
): T {
  if (typeof key !== 'string') return fallback;
  return Object.hasOwn(table, key) ? table[key] : fallback;
}

/**
 * As `lookup`, but with no fallback — returns undefined for a key the
 * table does not own, so the caller can distinguish "absent" from a
 * legitimately falsy value.
 *
 * @param table - A plain object literal used as a lookup table
 * @param key - Caller-supplied key
 * @returns The table's own value for `key`, or undefined
 */
export function lookupOrUndefined<T>(
  table: Record<string, T>,
  key: string | undefined | null,
): T | undefined {
  if (typeof key !== 'string') return undefined;
  return Object.hasOwn(table, key) ? table[key] : undefined;
}
