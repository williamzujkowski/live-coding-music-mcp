/**
 * A rate limit is recognised by its type, not by its wording (#380).
 *
 * `checkRateLimit` threw a plain `Error` whose message happened to begin
 * "Rate limit exceeded", and three re-throw sites plus `categorizeError`
 * all recognised it by matching that phrase. `AiRateLimitError` existed
 * the whole time and was thrown by nobody — ts-prune found it as the one
 * genuinely dead export in the repo.
 *
 * The failure that chain invites is silent: reword the message and the
 * single most retryable error there is becomes `internal`, which is not
 * retryable. That is the same shape as the `'timed out'` vs `'timeout'`
 * mismatch already recorded in `categorizeError`.
 */

import { categorizeError, err } from '../../server/tools/types';
import { AiRateLimitError, AiAuthError } from '../../services/ai/AiTransport';

describe('rate limits are categorised by type (#380)', () => {
  it('categorises the typed error as transient whatever it says', () => {
    // Deliberately worded with none of the phrases the string matcher
    // looks for. This is the regression the type prevents.
    const reworded = new AiRateLimitError('Too many requests. Try again in 42 seconds.');
    expect(categorizeError(reworded)).toBe('transient');
  });

  it('still categorises a provider that only gives prose', () => {
    // The string match stays as the backstop for errors we did not
    // construct — a provider that says it in its own words.
    expect(categorizeError(new Error('429: rate limit reached for this key'))).toBe('transient');
  });

  it('does not sweep every AI error into transient', () => {
    // AiAuthError is not retryable: the key is wrong until someone
    // changes it.
    expect(categorizeError(new AiAuthError('claude is not authenticated'))).not.toBe('transient');
  });

  it('reaches the caller as retryable, which is the point of all this', () => {
    // The envelope is what an agent actually sees. Categorising
    // correctly and then not marking it retryable would fix nothing.
    const envelope = err(categorizeError(new AiRateLimitError('Too many requests.')), 'x');
    expect(envelope.isRetryable).toBe(true);
  });
});
