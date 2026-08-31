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
import { accessSync, constants } from 'node:fs';
import { join } from 'node:path';
import type { AiTransportEntry } from './AiTransport.js';
import { AiAuthError } from './AiTransport.js';

/** Default budget for a CLI call. They are slower than an HTTP request. */
export const CLI_TIMEOUT_MS = 120_000;

/** Cap on captured output, so a runaway CLI cannot exhaust memory. */
export const CLI_MAX_BUFFER = 8 * 1024 * 1024;

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
      accessSync(join(dir, bin), constants.X_OK);
      return true;
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
    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'], shell: false });

    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let bytes = 0;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);

    const capture = (chunk: Buffer, onto: 'out' | 'err'): void => {
      bytes += chunk.length;
      if (bytes > CLI_MAX_BUFFER) {
        child.kill('SIGKILL');
        return;
      }
      if (onto === 'out') stdout += chunk.toString();
      else stderr += chunk.toString();
    };

    child.stdout.on('data', (c: Buffer) => { capture(c, 'out'); });
    child.stderr.on('data', (c: Buffer) => { capture(c, 'err'); });

    child.on('error', (err: Error) => {
      clearTimeout(timer);
      resolve({ stdout, stderr: err.message, code: null, timedOut });
    });
    child.on('close', (code: number | null) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, code, timedOut });
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
