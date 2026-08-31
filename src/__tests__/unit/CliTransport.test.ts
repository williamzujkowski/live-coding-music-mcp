/**
 * CLI transport tests (#252).
 *
 * `GeminiService` could only see credentials from `GEMINI_API_KEY`,
 * `~/.gemini/settings.json`, or gcloud ADC. A machine whose AI auth lives
 * in a CLI — the Antigravity CLI, say — was told "not configured" while
 * Gemini worked fine two directories away.
 *
 * These cover argument construction and failure handling without spawning
 * real binaries. Actually reaching a model is covered by
 * `npm run test:ai-transport`, which needs a logged-in CLI and so cannot
 * run in CI.
 */

import { KNOWN_CLIS, createCliTransport, cliTransports, hasCliTransport } from '../../services/ai/CliTransport.js';

describe('CLI transport argument construction', () => {
  const argsFor = (bin: string, prompt: string): string[] => {
    const spec = KNOWN_CLIS.find(s => s.bin === bin);
    if (spec === undefined) throw new Error(`no spec for ${bin}`);
    return spec.args(prompt);
  };

  /**
   * These flag shapes are not stylistic. Each was established by probing
   * the real binaries, and each has a failure mode when written the
   * obvious way instead.
   */
  it('passes the prompt to agy as --print=, not a positional', () => {
    // A bare positional gets consumed by --add-dir, which then reports
    // the prompt as its own argument and drops it.
    expect(argsFor('agy', 'hello')).toEqual(['--print=hello']);
  });

  it('puts the prompt before any flag for claude', () => {
    // --disallowedTools is variadic and swallows a trailing positional,
    // tokenizing the prompt into bogus deny rules.
    const args = argsFor('claude', 'hello');
    expect(args).toEqual(['-p', 'hello']);
    expect(args.indexOf('hello')).toBeLessThan(args.length);
  });

  it('gives codex a sandbox and skips the git check', () => {
    const args = argsFor('codex', 'hello');
    expect(args).toContain('exec');
    expect(args).toContain('--sandbox');
    expect(args).toContain('read-only');
    expect(args).toContain('--skip-git-repo-check');
    expect(args).toContain('hello');
  });

  it('marks codex as needing stdin closed', () => {
    // It reads stdin when given no prompt argument, and hung for the full
    // 90s budget before this was handled.
    expect(KNOWN_CLIS.find(s => s.bin === 'codex')?.needsClosedStdin).toBe(true);
  });

  /**
   * Prompt text reaches the process as one argv element, so quotes,
   * semicolons and backticks are inert. Nothing is ever concatenated into
   * a shell string.
   */
  it.each([
    'normal prompt',
    '; rm -rf ~',
    '$(whoami)',
    '`id`',
    "quote ' and \" quote",
    'newline\nsecond line',
  ])('keeps %p as a single argv element', prompt => {
    for (const spec of KNOWN_CLIS) {
      const args = spec.args(prompt);
      const carrying = args.filter(a => a.includes(prompt));
      expect(carrying).toHaveLength(1);
    }
  });

  it('excludes the gemini CLI, whose free tier was retired', () => {
    // It fails with IneligibleTierError before reaching a model, so
    // listing it would only produce confusing failures.
    expect(KNOWN_CLIS.map(s => s.bin)).not.toContain('gemini');
  });
});

describe('CLI transport entries', () => {
  it('ids are namespaced so they cannot collide with an API transport', () => {
    for (const t of cliTransports()) {
      expect(t.id).toMatch(/^cli:/);
    }
  });

  it('reports unavailable for a binary that does not exist', async () => {
    const t = createCliTransport({
      bin: 'definitely-not-a-real-binary-xyz', label: 'Fake', args: p => [p],
    });

    expect(await t.isAvailable()).toBe(false);
  });

  it('surfaces a spawn failure as an error rather than empty output', async () => {
    const t = createCliTransport({
      bin: 'definitely-not-a-real-binary-xyz', label: 'Fake', args: p => [p],
    }, 5000);

    await expect(t.send('hi')).rejects.toThrow();
  });

  it('kills a CLI that overruns its budget', async () => {
    const t = createCliTransport({ bin: 'sleep', label: 'Sleep', args: () => ['30'] }, 300);

    await expect(t.send('ignored')).rejects.toThrow(/timed out/i);
  }, 10_000);

  it('returns trimmed stdout on success', async () => {
    const t = createCliTransport({ bin: 'printf', label: 'Printf', args: () => ['  PONG\\n  '] });

    expect(await t.send('ignored')).toBe('PONG');
  });

  it('reports a non-zero exit with the binary name and stderr', async () => {
    const t = createCliTransport({
      bin: 'sh', label: 'Shell', args: () => ['-c', 'echo boom >&2; exit 3'],
    });

    await expect(t.send('ignored')).rejects.toThrow(/Shell exited 3.*boom/s);
  });

  it('detects installed CLIs synchronously, so gates need not be async', () => {
    expect(typeof hasCliTransport()).toBe('boolean');
  });
});
