/**
 * CliTransport — reaches a model through a locally authenticated CLI.
 *
 * Fixes the case where a machine has working AI credentials that
 * `GeminiService` cannot see (#252). Its auth ladder only understands
 * `GEMINI_API_KEY`, `~/.gemini/settings.json`, and gcloud ADC — but the
 * Antigravity CLI (`agy`) keeps credentials elsewhere entirely, so
 * `ai_assist` reported "Gemini API not configured" while Gemini worked
 * fine two directories away.
 *
 * Each CLI is invoked in print/non-interactive mode. The flags are not
 * guessable and were established by probing the installed binaries:
 *
 *   agy    --print='PROMPT'          (must be the `=` form; a bare
 *                                     positional gets eaten by --add-dir)
 *   claude -p 'PROMPT'               (fastest, ~3s)
 *   codex  exec --sandbox read-only --skip-git-repo-check 'PROMPT'
 *                                    (reads stdin when given no prompt
 *                                     argument, so stdin must be closed
 *                                     or it hangs forever)
 *
 * @module services/ai/CliTransport
 * @nist si-10 "Information input validation"
 */

import { spawn } from 'node:child_process';
import { accessSync, constants, statSync } from 'node:fs';
import { join } from 'node:path';
import type { AiTransportEntry } from './AiTransport.js';
import { AiAuthError } from './AiTransport.js';

/** Default budget for a CLI call. They are slower than an HTTP request. */
export const CLI_TIMEOUT_MS = 120_000;

/** Cap on captured output, so a runaway CLI cannot exhaust memory. */
export const CLI_MAX_BUFFER = 8 * 1024 * 1024;

/** Time allowed for buffered output to drain after the child exits. */
export const DRAIN_GRACE_MS = 50;

/**
 * Environment handed to the CLI.
 *
 * These are agentic CLIs with filesystem and tool access, and the prompt
 * carries pattern text that may have come from a stored file or an
 * imported MIDI. Passing the full parent environment would hand any
 * provider credential in it to a different vendor's agent, so the child
 * gets only what it needs to find its own config.
 */
function childEnv(): NodeJS.ProcessEnv {
  const keep = ['PATH', 'HOME', 'USER', 'LOGNAME', 'SHELL', 'LANG', 'LC_ALL', 'TERM', 'TMPDIR', 'XDG_CONFIG_HOME', 'XDG_CACHE_HOME'];
  const env: NodeJS.ProcessEnv = {};
  for (const key of keep) {
    const value = process.env[key];
    if (value !== undefined) env[key] = value;
  }
  return env;
}

/** How to drive one CLI non-interactively. */
export interface CliSpec {
  /** Binary name, looked up on PATH. */
  bin: string;
  /** Human-readable label. */
  label: string;
  /** Builds the argument vector for a prompt. */
  args(prompt: string): string[];
  /** True when this CLI reads stdin if given no prompt argument. */
  needsClosedStdin?: boolean;
}

/**
 * The CLIs this server knows how to drive, in preference order.
 *
 * Order is by measured latency and output cleanliness: claude ~3s with
 * the tidiest output, codex ~5s, agy ~2.4s bare but slower with files.
 * `gemini` is deliberately absent — its free tier was retired and it
 * fails with `IneligibleTierError` before reaching a model, so listing it
 * would only produce confusing failures.
 */
export const KNOWN_CLIS: CliSpec[] = [
  {
    bin: 'claude',
    label: 'Claude CLI',
    // The prompt must precede any variadic flag: --disallowedTools and
    // friends will swallow a trailing positional and tokenize it into
    // bogus deny rules.
    args: prompt => ['-p', prompt],
  },
  {
    bin: 'agy',
    label: 'Antigravity CLI',
    // `--print=` rather than `--print `: the space form lets a following
    // flag be taken as the prompt.
    args: prompt => [`--print=${prompt}`],
  },
  {
    bin: 'codex',
    label: 'Codex CLI',
    args: prompt => ['exec', '--sandbox', 'read-only', '--skip-git-repo-check', prompt],
    needsClosedStdin: true,
  },
];

/** Resolves a binary on PATH by scanning it — no shell, no subprocess. */
function isOnPath(bin: string): boolean {
  for (const dir of (process.env.PATH ?? '').split(':')) {
    if (dir === '') continue;
    try {
      const candidate = join(dir, bin);
      accessSync(candidate, constants.X_OK);
      // Directories are mode 755, so X_OK alone passes for them. Without
      // this check a directory named `claude` on PATH makes the gate
      // promise AI is configured, and spawn then fails.
      if (statSync(candidate).isFile()) return true;
    } catch {
      // not here; keep looking
    }
  }
  return false;
}

/**
 * Runs a CLI with stdin closed and its output captured.
 *
 * `spawn` rather than `execFile` because execFile ignores the `stdio`
 * option: codex reads stdin when it gets no prompt argument, so without
 * an explicitly closed stdin it blocks until the timeout kills it —
 * measured, it hung for the full 90s budget.
 */
function runCli(
  bin: string,
  args: string[],
  timeoutMs: number,
): Promise<{ stdout: string; stderr: string; code: number | null; timedOut: boolean }> {
  return new Promise(resolve => {
    // 'ignore' on stdin is the whole point; never a shell, so prompt text
    // cannot be reinterpreted as shell syntax.
    // detached: the CLI is agentic and spawns its own tool subprocesses.
    // Killing only the direct child orphans those, and an orphan holding
    // the inherited stdout fd keeps 'close' from ever firing — measured,
    // a child SIGKILLed at 500ms did not emit 'close' until 30,002ms.
    // Its own process group lets us kill the whole tree.
    const child = spawn(bin, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
      detached: true,
      env: childEnv(),
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let bytes = 0;
    let settled = false;

    // Decode as a stream: a multi-byte character split across a chunk
    // boundary becomes U+FFFD if each chunk is toString()'d alone, and
    // model output is full of curly quotes and accents.
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');

    const killTree = (signal: NodeJS.Signals): void => {
      try {
        if (child.pid !== undefined) process.kill(-child.pid, signal);
      } catch {
        // group already gone
      }
      try { child.kill(signal); } catch { /* already dead */ }
    };

    const timer = setTimeout(() => {
      timedOut = true;
      killTree('SIGKILL');
    }, timeoutMs);

    let overflowed = false;
    const capture = (chunk: string, onto: 'out' | 'err'): void => {
      bytes += chunk.length;
      if (bytes > CLI_MAX_BUFFER) {
        // Say why, rather than surfacing a bare `exited null` with empty
        // stderr that reads like an external kill.
        overflowed = true;
        killTree('SIGKILL');
        return;
      }
      if (onto === 'out') stdout += chunk;
      else stderr += chunk;
    };

    const settle = (code: number | null, errMessage?: string): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        stdout,
        stderr: overflowed
          ? `output exceeded ${String(CLI_MAX_BUFFER)} bytes and was terminated`
          : errMessage ?? stderr,
        code,
        timedOut,
      });
    };

    child.stdout.on('data', (c: string) => { capture(c, 'out'); });
    child.stderr.on('data', (c: string) => { capture(c, 'err'); });

    child.on('error', (err: Error) => { settle(null, err.message); });

    // Settle on 'exit', not 'close'. 'close' waits for every inherited
    // stdio pipe to close, which an orphaned grandchild can hold open
    // indefinitely — that is the hang above. A short grace lets buffered
    // output drain first, so nothing is truncated in the normal case.
    child.on('exit', (code: number | null) => {
      setTimeout(() => { settle(code); }, DRAIN_GRACE_MS);
    });
  });
}

/**
 * Builds a transport entry for one CLI.
 *
 * The prompt is passed as an argument-vector element, never interpolated
 * into a shell string, so prompt content cannot become shell syntax.
 *
 * @param spec - How to drive the CLI
 * @param timeoutMs - Budget for a single invocation
 * @returns A transport entry usable by the AI service
 * @nist si-10 "Information input validation"
 */
export function createCliTransport(spec: CliSpec, timeoutMs = CLI_TIMEOUT_MS): AiTransportEntry {
  return {
    id: `cli:${spec.bin}`,
    label: spec.label,

    isAvailable: () => Promise.resolve(isOnPath(spec.bin)),

    send: async (prompt: string): Promise<string> => {
      const { stdout, stderr, code, timedOut } = await runCli(
        spec.bin, spec.args(prompt), timeoutMs,
      );

      if (timedOut) {
        throw new Error(`${spec.label} timed out after ${String(timeoutMs)}ms.`);
      }

      const detail = stderr.trim().slice(0, 400);

      if (code !== 0) {
        if (/ENOENT|not found/i.test(detail)) {
          throw new AiAuthError(`${spec.label} (${spec.bin}) is not installed.`);
        }
        if (/auth|login|credential|unauthor|tier|eligib/i.test(detail)) {
          throw new AiAuthError(`${spec.label} is not authenticated: ${detail}`);
        }
        throw new Error(`${spec.label} exited ${String(code)}: ${detail}`);
      }

      return stdout.trim();
    },
  };
}

/**
 * Whether any known CLI is installed — synchronously.
 *
 * A PATH scan, not a subprocess, so availability gates stay synchronous
 * and callers (and their ~80 existing mocks) do not have to become async.
 */
export function hasCliTransport(): boolean {
  return KNOWN_CLIS.some(spec => isOnPath(spec.bin));
}

/** Transport entries for every CLI this server knows how to drive. */
export function cliTransports(timeoutMs = CLI_TIMEOUT_MS): AiTransportEntry[] {
  return KNOWN_CLIS.map(spec => createCliTransport(spec, timeoutMs));
}
