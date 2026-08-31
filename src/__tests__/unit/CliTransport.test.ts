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

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
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

  /**
   * Findings from a cross-model review of this file, each verified against
   * the real behaviour before being fixed.
   */
  describe('review findings', () => {
    /**
     * These CLIs are agentic and spawn their own tool subprocesses.
     * Killing only the direct child orphans those, and an orphan holding
     * the inherited stdout fd stops 'close' ever firing — measured, a
     * child SIGKILLed at 500ms did not emit 'close' until 30,002ms. So
     * the timeout has to settle on 'exit' and kill the process group.
     */
    it('bounds a CLI that leaves a long-lived grandchild behind', async () => {
      const t = createCliTransport({
        bin: 'sh',
        label: 'Orphan',
        // Child exits immediately; grandchild holds stdout for 30s.
        args: () => ['-c', 'sleep 30 & exit 0'],
      }, 1500);

      const started = Date.now();
      await t.send('ignored').catch(() => { /* timeout or empty is fine */ });

      // Without the fix this waited on the grandchild, not the timeout.
      expect(Date.now() - started).toBeLessThan(5000);
    }, 20_000);

    /** A directory is mode 755, so X_OK alone passes for it. */
    it('does not treat a directory on PATH as an installed binary', async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fakepath-'));
      fs.mkdirSync(path.join(dir, 'pretend-cli'));
      const originalPath = process.env.PATH;
      process.env.PATH = dir;

      try {
        const t = createCliTransport({ bin: 'pretend-cli', label: 'Pretend', args: p => [p] });
        expect(await t.isAvailable()).toBe(false);
      } finally {
        process.env.PATH = originalPath;
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });

    /** Model output is full of curly quotes; chunk-wise toString mangles them. */
    it('decodes multi-byte characters that span a chunk boundary', async () => {
      const t = createCliTransport({
        bin: 'printf', label: 'Printf', args: () => ['%s', 'caf\u00e9 \u2014 na\u00efve \u201cquoted\u201d'],
      });

      expect(await t.send('ignored')).toBe('café — naïve “quoted”');
    });

    /** A bare `exited null` with empty stderr reads like an external kill. */
    it('says why it killed a CLI that overran the output cap', async () => {
      const t = createCliTransport({
        bin: 'sh', label: 'Flood',
        args: () => ['-c', 'yes ' + 'x'.repeat(200) + ' | head -c 20000000'],
      }, 30_000);

      await expect(t.send('ignored')).rejects.toThrow(/exceeded .* bytes/);
    }, 40_000);

    /** A different vendor's agent should not inherit our provider keys. */
    it('does not pass the parent environment through to the CLI', async () => {
      process.env.STRUDEL_SECRET_PROBE = 'leaked';
      try {
        const t = createCliTransport({
          bin: 'sh', label: 'Env', args: () => ['-c', 'echo "[${STRUDEL_SECRET_PROBE:-absent}]"'],
        });

        expect(await t.send('ignored')).toBe('[absent]');
      } finally {
        delete process.env.STRUDEL_SECRET_PROBE;
      }
    });

    it('still forwards what a CLI needs to find its own config', async () => {
      const t = createCliTransport({
        bin: 'sh', label: 'Env', args: () => ['-c', 'test -n "$HOME" && test -n "$PATH" && echo both'],
      });

      expect(await t.send('ignored')).toBe('both');
    });
  });
});
