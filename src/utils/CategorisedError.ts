/**
 * Errors that carry their own category (#382).
 *
 * `categorizeError` decides retryability by matching phrases in the
 * message — `invalid`, `must be`, `not found`, `timed out`. Anything it
 * does not recognise falls through to `internal`, which is not
 * retryable and reads to an agent as "the server is broken".
 *
 * An audit of every `throw new Error(...)` in `src/` put 47 messages in
 * that bucket, and at least eleven of them were plainly the caller's
 * input:
 *
 *   Steps cannot exceed 256, got 512
 *   Hits (9) cannot exceed steps (8)
 *   Number of sounds must match number of patterns
 *   MIDI input too large (900000 > 512000 bytes)
 *
 * None contains a phrase the matcher looks for, and the difference
 * decides whether an agent edits its argument or gives up.
 *
 * Growing the matcher is the treadmill this replaces: "cannot exceed"
 * would be the fourth phrase patched in after the fact, after the
 * `'timed out'` vs `'timeout'` fix and the rate-limit class of #380.
 * A thrower that knows what kind of failure it has should say so.
 */

/** The caller passed something that cannot be accepted. Not retryable; change the argument. */
export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

/**
 * The request is well-formed but the system is not in a state to serve
 * it, and the message names the action that would fix that — create a
 * session, destroy one, run init.
 */
export class BusinessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BusinessError';
  }
}

/**
 * A failure that may not recur: the model returned something
 * unparseable, a network hiccup, a service that was briefly unwell.
 *
 * The distinction that matters to a caller is whether trying again could
 * help. `No JSON found in response` means the model produced prose where
 * a JSON block was asked for — the next attempt often does not, and the
 * message contains no word the phrase matcher recognises, so it landed
 * in `internal` and told the caller not to bother.
 */
export class TransientError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TransientError';
  }
}
