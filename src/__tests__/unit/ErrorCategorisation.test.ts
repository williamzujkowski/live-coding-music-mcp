/**
 * Error categorisation (#272).
 *
 * `categorizeError` buckets raw thrown errors by matching message text,
 * and the category drives `isRetryable` (`types.ts`: it defaults to
 * `category === 'transient'`). So a miscategorised error does not just
 * carry a wrong label — it tells the calling agent whether retrying is
 * worth doing.
 *
 * The dominant failure was a single word. The matcher looked for
 * 'timeout'; the codebase says 'timed out' 13 times and 'timeout' twice,
 * and `'timed out'.includes('timeout')` is false. So essentially every
 * real timeout was reported as a permanent `internal` failure with
 * `isRetryable: false` — the opposite of the truth, on the errors most
 * worth retrying.
 */

import { categorizeError, err } from '../../server/tools/types.js';

const categorise = (message: string): string => categorizeError(new Error(message));

describe('transient errors are retryable', () => {
  /** The exact strings thrown in src/, not paraphrases. */
  it.each([
    'Claude CLI timed out after 120000ms.',
    'Request timed out after 30 seconds',
    'Audio analysis timed out. The audio sample may be too long. Try a shorter recording.',
    'Script execution timed out after 1000ms',
    'Strudel editor did not become ready within 5000ms.',
  ])('categorises %p as transient', message => {
    expect(categorise(message)).toBe('transient');
  });

  /** A rate limit is the single most retryable error there is. */
  it.each([
    'Rate limit exceeded. Try again in 42 seconds',
    'Gemini rate limit reached',
  ])('categorises %p as transient', message => {
    expect(categorise(message)).toBe('transient');
  });

  it('marks transient errors retryable, which is the point', () => {
    expect(err('transient', 'Claude CLI timed out after 120000ms.').isRetryable).toBe(true);
    expect(err('internal', 'something broke').isRetryable).toBe(false);
  });
});

describe('credential problems are permission, not internal', () => {
  it.each([
    'Claude CLI is not authenticated: run login first',
    'No AI transport available. Options:\n1. Set GEMINI_API_KEY',
    'Gemini API key not configured',
    'unauthorized',
    'permission denied writing to /tmp',
  ])('categorises %p as permission', message => {
    expect(categorise(message)).toBe('permission');
  });
});

describe('setup problems are business, so the caller acts rather than retries', () => {
  it.each([
    'Browser not initialized. Run init tool first.',
    "Session 'live' not found. Create it first with session({ action: \"create\" }).",
    "Session 'live' already exists",
    'Antigravity CLI (agy) is not installed.',
    'Audio capture not connected. Play a pattern first to initialize audio.',
    'Audio capture already in progress. Stop it first.',
    // Not transient: retrying will not fix a syntax error. The caller has
    // to look at diagnostics, which is what the message tells them.
    'Playback did not start. The pattern may have a syntax error — check diagnostics.',
  ])('categorises %p as business', message => {
    expect(categorise(message)).toBe('business');
  });
});

describe('caller mistakes are validation', () => {
  it.each([
    'Invalid BPM: 9000. Must be 20-300.',
    'Invalid effect name: (a+)+Z. Must be a plain identifier.',
    'MIDI file spans too many bars (524288 > 512).',
    'Invalid search: must be a non-empty string.',
    'pattern too long (max 10000 characters, got 20000)',
    'Chord style cannot be empty',
  ])('categorises %p as validation', message => {
    expect(categorise(message)).toBe('validation');
  });
});

describe('genuinely unknown failures stay internal', () => {
  it.each([
    'ai module does not handle tool: bogus_tool',
    'Cannot read properties of undefined',
    'something entirely unexpected',
  ])('categorises %p as internal', message => {
    expect(categorise(message)).toBe('internal');
  });
});

describe('ordering', () => {
  /**
   * Transient is checked first. A timeout whose message also mentions an
   * invalid state used to be filed as a caller mistake, telling the agent
   * to fix its input rather than retry.
   */
  it('prefers transient over validation when both could match', () => {
    expect(categorise('Request timed out: invalid response from upstream')).toBe('transient');
  });

  /** A login that is 'not found' is a credential problem, not a missing session. */
  it('prefers permission over business for credential wording', () => {
    expect(categorise('Gemini credentials not found')).toBe('permission');
  });

  it('handles a thrown non-Error without crashing', () => {
    expect(categorizeError('a bare string')).toBe('internal');
    expect(categorizeError(undefined)).toBe('internal');
    expect(categorizeError({ weird: true })).toBe('internal');
  });
});
