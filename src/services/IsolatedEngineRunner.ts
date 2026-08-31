/**
 * A persistent forked child that evaluates untrusted pattern code, with a
 * heap cap and a wall-clock deadline (#307).
 *
 * ## Why a child process and not a worker thread
 *
 * `worker_threads` + `resourceLimits.maxOldGenerationSizeMb` reads like it
 * was designed for exactly this. It is not. Measured on Node 22 with a
 * 64 MB cap and an `new Array(n).fill(7)` payload, a worker that blows its
 * old-generation cap inside an allocating builtin aborts the **whole
 * process**: the parent dumped core and never ran another line.
 *
 * The same payload against a fork with `--max-old-space-size=64`:
 *
 *     small alloc  : {"code":0,"msg":{"ok":true,"len":1000}}
 *     over the cap : {"code":null,"sig":"SIGABRT"}
 *     way over cap : {"code":null,"sig":"SIGABRT"}
 *     PARENT ALIVE after all three
 *
 * The child dies, the parent survives, the next call works. That is the
 * containment this needs, so: child process.
 *
 * ## Why the child is persistent
 *
 * A cold fork costs ~30 ms, which is a lot on a sub-10 ms interactive
 * path. Forked once and reused over IPC, the warm round-trip measures a
 * median of 0 ms and a p95 of 1 ms — under the IPC noise floor. The spawn
 * cost is paid at first use and after a kill, which is exactly when you
 * want to pay it.
 *
 * ## What this does NOT bound
 *
 * `--max-old-space-size` bounds V8's old space. It does not bound external
 * or native memory (typed-array backing stores, buffers). A pattern that
 * allocates its way out through those is still not contained by the cap;
 * it is contained by the deadline, which is a weaker guarantee. Stated
 * here rather than implied away.
 */

import { fork, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';

/** How the child died, when it died. */
export type RunnerFailureKind = 'oom' | 'timeout' | 'crash' | 'spawn';

/**
 * Raised when the isolated evaluation did not produce an answer: the child
 * ran out of heap, ran past its deadline, died some other way, or could
 * not be started. A rejected *evaluation* (bad syntax, unsafe pattern)
 * is NOT this — that comes back as a normal error from the engine.
 */
export class IsolatedRunnerError extends Error {
  constructor(
    message: string,
    readonly kind: RunnerFailureKind
  ) {
    super(message);
    this.name = 'IsolatedRunnerError';
  }
}

export interface RunnerOptions {
  /** Absolute path to the child entrypoint. */
  childPath: string;
  /** V8 old-space cap for the child, in MB. */
  maxOldSpaceMb: number;
  /** Wall-clock deadline for a single call, in ms. */
  timeoutMs: number;
  /** Extra `execArgv` for the child (e.g. a TypeScript loader in dev). */
  extraExecArgv?: string[];
  /** Called whenever a child is started, with the reason. Diagnostics only. */
  onSpawn?: (reason: string) => void;
}

/** Keep the tail of the child's stderr for diagnostics, not the whole V8 dump. */
const STDERR_TAIL_LIMIT = 2000;

interface Pending {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

export class IsolatedEngineRunner {
  private child: ChildProcess | null = null;
  private nextId = 1;
  private stderrTail = '';
  private disposed = false;
  /**
   * Whether the current child has ever answered anything. A child that
   * dies without having answered once did not fail at evaluating a
   * pattern — it failed at starting. Those want opposite advice, so they
   * must not share a failure kind.
   */
  private answeredSinceSpawn = false;
  /**
   * Calls run one at a time. Not for thread-safety — for attribution: if
   * the child dies, exactly one call is in flight, so there is no question
   * about which payload killed it and no way to fail an innocent caller.
   */
  private tail: Promise<unknown> = Promise.resolve();

  constructor(private readonly options: RunnerOptions) {}

  /** True when a child is currently running. Diagnostics and tests. */
  get isRunning(): boolean {
    return this.child !== null && this.child.connected;
  }

  /**
   * Runs one method in the child and resolves with its return value.
   *
   * @param method - Method name the child knows
   * @param args - Arguments, structured-cloneable
   * @returns Whatever the child's method returned
   * @throws {IsolatedRunnerError} When the child died, hung, or would not start
   * @throws {Error} When the child's method itself threw
   */
  async call<T>(method: string, args: readonly unknown[]): Promise<T> {
    // Chain onto the tail whether or not the previous call succeeded; a
    // failed call must not wedge the queue.
    const run = this.tail.then(
      () => this.invoke<T>(method, args),
      () => this.invoke<T>(method, args)
    );
    this.tail = run.catch(() => undefined);
    return run;
  }

  /** Stops the child and refuses further calls. */
  dispose(): void {
    this.disposed = true;
    this.killChild();
  }

  private invoke<T>(method: string, args: readonly unknown[]): Promise<T> {
    if (this.disposed) {
      return Promise.reject(
        new IsolatedRunnerError('Isolated engine runner has been disposed.', 'crash')
      );
    }

    let child: ChildProcess;
    try {
      child = this.ensureChild();
    } catch (error: unknown) {
      const detail = error instanceof Error ? error.message : String(error);
      return Promise.reject(
        new IsolatedRunnerError(
          `Could not start the isolated pattern engine: ${detail}. This is a build or ` +
            'install problem, not something to retry — run `npm run build`.',
          'spawn'
        )
      );
    }

    const id = this.nextId++;
    this.stderrTail = '';

    return new Promise<T>((resolve, reject) => {
      let settled = false;
      const pending: Pending = {
        resolve: (value) => {
          if (settled) return;
          settled = true;
          cleanup();
          resolve(value as T);
        },
        reject: (error) => {
          if (settled) return;
          settled = true;
          cleanup();
          reject(error);
        },
      };

      const onMessage = (raw: unknown): void => {
        const message = raw as { id?: number; ok?: boolean; result?: unknown; error?: { message?: string; name?: string } } | null;
        if (!message || message.id !== id) return;
        this.answeredSinceSpawn = true;
        if (message.ok) {
          pending.resolve(message.result);
          return;
        }
        // The child's own error, faithfully re-raised. Not an
        // IsolatedRunnerError: the isolation worked, the pattern was bad.
        const rebuilt = new Error(message.error?.message ?? 'Pattern evaluation failed');
        if (message.error?.name) rebuilt.name = message.error.name;
        pending.reject(rebuilt);
      };

      const onExit = (code: number | null, signal: NodeJS.Signals | null): void => {
        this.child = null;
        pending.reject(this.describeDeath(method, code, signal));
      };

      const onError = (error: Error): void => {
        pending.reject(
          new IsolatedRunnerError(`Isolated pattern engine failed: ${error.message}`, 'crash')
        );
      };

      const timer = setTimeout(() => {
        this.killChild();
        pending.reject(
          new IsolatedRunnerError(
            `Pattern evaluation exceeded the ${String(this.options.timeoutMs)}ms deadline and was ` +
              'stopped. The engine has been restarted; simplify the pattern and try again.',
            'timeout'
          )
        );
      }, this.options.timeoutMs);

      const cleanup = (): void => {
        clearTimeout(timer);
        child.off('message', onMessage);
        child.off('exit', onExit);
        child.off('error', onError);
      };

      child.on('message', onMessage);
      child.on('exit', onExit);
      child.on('error', onError);

      try {
        child.send({ id, method, args });
      } catch (error: unknown) {
        const detail = error instanceof Error ? error.message : String(error);
        pending.reject(
          new IsolatedRunnerError(`Could not reach the isolated pattern engine: ${detail}`, 'crash')
        );
      }
    });
  }

  /**
   * Turns an exit code and signal into something a caller can act on.
   *
   * V8 aborts on heap exhaustion, so SIGABRT (and the 134 that a shell
   * reports for it) means "out of heap" in practice. Anything else is an
   * honest "it died and we do not know why", with the stderr tail
   * attached rather than guessed at.
   */
  private describeDeath(
    method: string,
    code: number | null,
    signal: NodeJS.Signals | null
  ): IsolatedRunnerError {
    const outOfHeap =
      signal === 'SIGABRT' || code === 134 || /heap out of memory/i.test(this.stderrTail);
    if (outOfHeap) {
      return new IsolatedRunnerError(
        `Pattern evaluation exceeded the ${String(this.options.maxOldSpaceMb)}MB memory cap for ` +
          `${method} and was stopped. The engine has been restarted. Reduce what the pattern ` +
          'allocates — a smaller cycle range, or fewer generated events.',
        'oom'
      );
    }
    const how = signal !== null ? `signal ${signal}` : `exit code ${String(code)}`;
    const tail = this.stderrTail.trim();

    // A child that never answered anything did not fail at evaluating
    // this pattern; it failed at starting — a broken build, a bad import,
    // a mismatched Node. Retrying that is a loop with no exit, so it gets
    // its own kind and its own (non-retryable) advice.
    if (!this.answeredSinceSpawn) {
      return new IsolatedRunnerError(
        `The isolated pattern engine could not start (${how}). This is a build or install ` +
          `problem, not something to retry — run \`npm run build\` and check that ` +
          `${this.options.childPath} exists.${tail ? ` Last output: ${tail}` : ''}`,
        'spawn'
      );
    }

    return new IsolatedRunnerError(
      `The isolated pattern engine died during ${method} (${how}). The engine has been ` +
        `restarted.${tail ? ` Last output: ${tail}` : ''}`,
      'crash'
    );
  }

  private ensureChild(): ChildProcess {
    if (this.child !== null && this.child.connected) return this.child;

    // fork() to a path that does not exist succeeds, then the child exits
    // 1 a moment later — which arrives as a death, not as a spawn
    // failure. Checking first turns a confusing "the engine died" into an
    // accurate "the engine was never there".
    if (!existsSync(this.options.childPath)) {
      throw new Error(`child entrypoint not found at ${this.options.childPath}`);
    }

    const reason = this.child === null ? 'first use or after a kill' : 'disconnected child';
    // stdout is IGNORED on purpose. This process speaks MCP over its own
    // stdout; anything the child printed there would land in the middle of
    // a JSON-RPC frame and corrupt the session. stderr is piped rather
    // than inherited for the same reason in reverse — a V8 OOM dump is
    // hundreds of lines, and it is more useful in an error message than on
    // the operator's terminal.
    const child = fork(this.options.childPath, [], {
      execArgv: [
        `--max-old-space-size=${String(this.options.maxOldSpaceMb)}`,
        ...(this.options.extraExecArgv ?? []),
      ],
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
      env: { ...process.env, LCM_ISOLATED_ENGINE_CHILD: '1' },
    });

    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', (chunk: string) => {
      this.stderrTail = (this.stderrTail + chunk).slice(-STDERR_TAIL_LIMIT);
    });
    // A dead child is not an event anyone needs to hear about twice; the
    // in-flight call's own listener reports it. This one only clears the
    // handle so the next call forks a fresh one.
    child.on('exit', () => {
      if (this.child === child) this.child = null;
    });
    // Without this, an unhandled 'error' on the child would take the
    // parent down — the exact failure this class exists to prevent.
    child.on('error', () => {
      if (this.child === child) this.child = null;
    });

    this.child = child;
    this.answeredSinceSpawn = false;
    this.options.onSpawn?.(reason);
    return child;
  }

  private killChild(): void {
    const child = this.child;
    this.child = null;
    if (child === null) return;
    try {
      child.kill('SIGKILL');
    } catch {
      // Already gone. Nothing to do, and nothing worth reporting.
    }
  }
}
