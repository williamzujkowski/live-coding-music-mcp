/**
 * diagnostics.errorStats must not hide the retries it exists to report (#286).
 *
 * `executeWithRetry` called `clearErrorHistory` the moment an attempt
 * succeeded, so the case an operator most wants to see — "writes are
 * flaky but recovering on retry 2" — was erased by the recovery
 * itself. Measured before this change:
 *
 *   fails 3, fallback rescues  -> {"Pattern Write":{count:3,...}}
 *   fails 1, retry 2 succeeds  -> {}
 *
 * Only the rarer case survived, and `{}` was indistinguishable from a
 * system with no trouble at all.
 */

import { ErrorRecovery } from '../../utils/ErrorRecovery';

describe('recovered failures survive the recovery (#286)', () => {
  it('a retry that succeeds still reports the failure it recovered from', async () => {
    const r = new ErrorRecovery();
    let attempts = 0;
    const result = await r.handlePatternWrite(
      async () => { if (++attempts < 2) throw new Error('flaky'); return 'ok'; }, 'p');

    expect(result).toBe('ok');
    const stats = r.getErrorStats()['Pattern Write'];
    expect(stats.recovered).toBe(1);
    expect(stats.lastRecovery).toBeInstanceOf(Date);
    // Nothing is outstanding — it recovered.
    expect(stats.count).toBe(0);
  });

  it('a fallback that rescues reports the failures as recovered, not outstanding', async () => {
    const r = new ErrorRecovery();
    const seen: string[] = [];
    const result = await r.handlePatternWrite(
      async (p: string) => { seen.push(p); if (seen.length <= 3) throw new Error('boom'); return 'ok'; },
      's("bd*4").gain(2)');

    expect(result).toBe('ok');
    const stats = r.getErrorStats()['Pattern Write'];
    // A failure belongs in exactly one bucket. Copying rather than
    // moving reported the same three as both outstanding and rescued.
    expect(stats.recovered).toBe(3);
    expect(stats.count).toBe(0);
  });

  it('an operation that never recovers reports outstanding failures', async () => {
    const r = new ErrorRecovery();
    await expect(r.handlePatternWrite(
      async () => { throw new Error('always'); }, 'p')).rejects.toThrow();

    const stats = r.getErrorStats()['Pattern Write'];
    expect(stats.count).toBeGreaterThan(0);
    expect(stats.lastError).toBeInstanceOf(Date);
    expect(stats.recovered).toBe(0);
  });

  it('a clean run reports explicit zeros, not an absent row', async () => {
    const r = new ErrorRecovery();
    await r.handlePatternWrite(async () => 'ok', 'p');

    // `{}` meant both "healthy" and "nothing instrumented" — an
    // operator could not tell which.
    const stats = r.getErrorStats();
    expect(stats).toHaveProperty('Pattern Write');
    expect(stats['Pattern Write']).toEqual({
      count: 0, lastError: null, recovered: 0, lastRecovery: null,
    });
  });

  it('reports instrumented operations even before anything runs', () => {
    // 'Browser Init', not 'Pattern Write': the seeded row names the
    // operation that actually runs. `handlePatternWrite` is reached only
    // from `writePatternWithValidation`, which nothing in `src/server`
    // calls, so its row was permanently zero for dead code while the
    // live retry path had no row at all (#445).
    expect(new ErrorRecovery().getErrorStats()).toHaveProperty('Browser Init');
  });

  it('the three outcomes are mutually distinguishable', async () => {
    const outcome = async (fn: (p: string) => Promise<string>) => {
      const r = new ErrorRecovery();
      try { await r.handlePatternWrite(fn, 's("bd*4").gain(2)'); } catch { /* expected */ }
      // Recorded on demand under the operation's own name; only the
      // seeding list changed (#445).
      const s = r.getErrorStats()['Pattern Write'];
      return `${s.count}/${s.recovered}`;
    };
    let n = 0;
    const clean = await outcome(async () => 'ok');
    const rescued = await outcome(async () => { if (++n < 2) throw new Error('x'); return 'ok'; });
    const broken = await outcome(async () => { throw new Error('x'); });

    expect(new Set([clean, rescued, broken]).size).toBe(3);
    expect(clean).toBe('0/0');
    expect(rescued).toBe('0/1');
  });

});
