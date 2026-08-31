/**
 * Browser init retries transient strudel.cc failures (#315).
 *
 * Split out of #309 on the explicit recommendation of every voter in
 * that decision. The constraint they were most insistent about: retry
 * logic must not turn an upstream outage into a retry storm, and after
 * the budget is spent the caller must still see the truth.
 */

import { ErrorRecovery } from '../../utils/ErrorRecovery';
import { categorizeError } from '../../server/tools/types';

describe('retry policy (#315)', () => {
  it('succeeds on a later attempt without surfacing the failure', async () => {
    const r = new ErrorRecovery();
    let attempts = 0;
    const result = await r.executeWithRetry(
      async () => { if (++attempts < 3) throw new Error('page.goto: Timeout 15000ms exceeded.'); return 'ready'; },
      'Browser Init',
      { maxRetries: 2, retryDelay: 1, exponentialBackoff: true, jitter: true });

    expect(result).toBe('ready');
    expect(attempts).toBe(3);
  });

  it('is bounded — it does not retry forever', async () => {
    const r = new ErrorRecovery();
    let attempts = 0;
    await expect(r.executeWithRetry(
      async () => { attempts++; throw new Error('page.goto: Timeout 15000ms exceeded.'); },
      'Browser Init',
      { maxRetries: 2, retryDelay: 1, exponentialBackoff: true, jitter: true }))
      .rejects.toThrow();
    // maxRetries: 2 means three attempts total, not three retries.
    expect(attempts).toBe(3);
  });

  it('recovered attempts stay visible in diagnostics', async () => {
    // A retry nobody can see is indistinguishable from slowness. #286
    // made the recovered counter survive success precisely for this.
    const r = new ErrorRecovery();
    let attempts = 0;
    await r.executeWithRetry(
      async () => { if (++attempts < 2) throw new Error('net::ERR_CONNECTION_RESET'); return 'ready'; },
      'Browser Init',
      { maxRetries: 2, retryDelay: 1, exponentialBackoff: true, jitter: true });

    expect(r.getErrorStats()['Browser Init'].recovered).toBe(1);
  });
});

describe('the final error keeps its category (#315)', () => {
  const wrap = async (message: string): Promise<Error> => {
    const r = new ErrorRecovery();
    try {
      await r.executeWithRetry(async () => { throw new Error(message); }, 'Browser Init',
        { maxRetries: 1, retryDelay: 1, exponentialBackoff: true, jitter: true });
    } catch (e) {
      return e as Error;
    }
    throw new Error('expected a rejection');
  };

  it.each([
    'page.goto: Timeout 15000ms exceeded.',
    'strudelMirror did not become ready within 30000ms',
    'net::ERR_CONNECTION_REFUSED at https://strudel.cc/',
    'net::ERR_TIMED_OUT',
    'net::ERR_NAME_NOT_RESOLVED',
  ])('%s stays transient through the wrapper', async message => {
    // The wrapper rewrites the message as "Browser Init failed after N
    // attempts: <original>". If that loses the category, an agent is
    // told a retryable outage is a permanent server fault.
    expect(categorizeError(new Error(message))).toBe('transient');
    expect(categorizeError(await wrap(message))).toBe('transient');
  });

  it('a genuine bug is still internal, not laundered into transient', async () => {
    expect(categorizeError(await wrap('Cannot read properties of undefined'))).toBe('internal');
  });
});

describe("Chromium's net::ERR_* names (#315)", () => {
  // These share no substring with the POSIX names the categoriser knew:
  // 'ERR_CONNECTION_REFUSED' does not contain 'econnrefused', and
  // 'ERR_TIMED_OUT' does not contain 'timed out' — the underscore. So
  // every navigation failure Playwright surfaced landed in `internal`.
  it.each([
    'net::ERR_CONNECTION_REFUSED',
    'net::ERR_CONNECTION_RESET',
    'net::ERR_TIMED_OUT',
    'net::ERR_NAME_NOT_RESOLVED',
    'net::ERR_INTERNET_DISCONNECTED',
    'net::ERR_ADDRESS_UNREACHABLE',
  ])('%s is transient', message => {
    expect(categorizeError(new Error(message))).toBe('transient');
  });
});

describe('jitter (#315)', () => {
  it('spreads the delay instead of retrying in lockstep', async () => {
    // Sessions hitting the same upstream hiccup must not all wait the
    // same interval and hammer it together.
    const delays: number[] = [];
    const r = new ErrorRecovery();
    const original = (r as unknown as { sleep(ms: number): Promise<void> }).sleep;
    (r as unknown as { sleep(ms: number): Promise<void> }).sleep = async (ms: number) => {
      delays.push(ms);
    };

    for (let i = 0; i < 12; i++) {
      await r.executeWithRetry(async () => { throw new Error('x'); }, `op-${String(i)}`,
        { maxRetries: 1, retryDelay: 1000, exponentialBackoff: false, jitter: true })
        .catch(() => undefined);
    }
    (r as unknown as { sleep: unknown }).sleep = original;

    expect(new Set(delays).size).toBeGreaterThan(1);
    // Bounded to [50%, 100%] of the base — never longer than asked for.
    for (const d of delays) {
      expect(d).toBeGreaterThanOrEqual(500);
      expect(d).toBeLessThanOrEqual(1000);
    }
  });

  it('is off by default, so existing callers are unchanged', async () => {
    const delays: number[] = [];
    const r = new ErrorRecovery();
    (r as unknown as { sleep(ms: number): Promise<void> }).sleep = async (ms: number) => {
      delays.push(ms);
    };
    await r.executeWithRetry(async () => { throw new Error('x'); }, 'op',
      { maxRetries: 2, retryDelay: 100, exponentialBackoff: true })
      .catch(() => undefined);

    expect(delays).toEqual([100, 200]);
  });
});
