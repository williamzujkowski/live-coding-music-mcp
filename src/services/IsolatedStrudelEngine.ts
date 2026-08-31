/**
 * `LocalPatternEngine` backed by a forked child with a heap cap and a
 * deadline (#307).
 *
 * Before this, `validate_pattern_local`, `analyze_pattern_local`,
 * `query_pattern_events` and `transpile_pattern` each evaluated user code
 * in the MCP server's own process. The AST allowlist in `PatternSandbox`
 * stops the code doing anything *interesting*, but it cannot stop it doing
 * something *large*: `new Array(5e7).fill(7)` is allowlist-clean and kills
 * the server, taking every session's browser state with it.
 *
 * One runner sits under all four tools rather than three isolation paths,
 * which was the point of the fix. It is lazy — a session that never touches
 * a local-engine tool never forks anything.
 */

import { IsolatedEngineRunner, IsolatedRunnerError } from './IsolatedEngineRunner.js';
import type { LocalPatternEngine } from './LocalPatternEngine.js';
import type {
  LocalValidationResult,
  PatternEvent,
  PatternMetadata,
  TranspileResult,
} from './StrudelEngine.js';

/**
 * V8 old-space cap for the child. Comfortably above what a legitimate
 * pattern needs (the engine already refuses to materialize more than
 * 50,000 events) and far below what would trouble the host.
 */
export const DEFAULT_ENGINE_HEAP_MB = 256;

/** Wall-clock deadline for one evaluation. Covers hangs the heap cap cannot. */
export const DEFAULT_ENGINE_TIMEOUT_MS = 5000;

/** Where the child lives, and whether it needs a TypeScript loader. */
export interface ChildEntrypointSpec {
  childPath: string;
  needsTsx: boolean;
}

export interface IsolatedStrudelEngineOptions {
  /** Override the child entrypoint. Tests use this; production resolves it. */
  childPath?: string;
  /**
   * Override how the entrypoint is located. Production resolves it with a
   * dynamic import, which is ASYNCHRONOUS — and that asynchrony is the
   * window in which `dispose()` can race a start. Passing `childPath`
   * closes the window entirely, so a test that used it could not
   * reproduce the race it claimed to cover. This seam exists so one can.
   */
  resolveEntrypoint?: () => Promise<ChildEntrypointSpec>;
  /** Extra `execArgv` for the child, e.g. a TypeScript loader. */
  extraExecArgv?: string[];
  maxOldSpaceMb?: number;
  timeoutMs?: number;
  onSpawn?: (reason: string) => void;
}

export class IsolatedStrudelEngine implements LocalPatternEngine {
  private runner: IsolatedEngineRunner | null = null;
  private starting: Promise<IsolatedEngineRunner> | null = null;
  /**
   * Permanent, not a flag that a later start can clear. Resolving the
   * child entrypoint is asynchronous, so `dispose()` can land while a
   * start is in flight — and without this the start finished afterwards,
   * assigned a fresh runner and forked a child AFTER shutdown. A process
   * spawned by a disposed engine has nobody left to kill it.
   */
  private disposed = false;

  constructor(private readonly options: IsolatedStrudelEngineOptions = {}) {}

  /** True once a child has been forked. Diagnostics and tests. */
  get isStarted(): boolean {
    return this.runner !== null;
  }

  async transpile(code: string): Promise<TranspileResult> {
    return this.call<TranspileResult>('transpile', [code]);
  }

  async validate(code: string): Promise<LocalValidationResult> {
    return this.call<LocalValidationResult>('validate', [code]);
  }

  async analyzePattern(code: string): Promise<PatternMetadata> {
    return this.call<PatternMetadata>('analyzePattern', [code]);
  }

  async queryEvents(code: string, start: number, end: number): Promise<PatternEvent[]> {
    return this.call<PatternEvent[]>('queryEvents', [code, start, end]);
  }

  /**
   * Stops the child permanently. Safe to call when none was ever started,
   * and safe to call while one is starting.
   */
  dispose(): void {
    this.disposed = true;
    this.runner?.dispose();
    this.runner = null;
    this.starting = null;
  }

  private async call<T>(method: string, args: readonly unknown[]): Promise<T> {
    const runner = await this.getRunner();
    return runner.call<T>(method, args);
  }

  private async getRunner(): Promise<IsolatedEngineRunner> {
    if (this.disposed) {
      throw new IsolatedRunnerError('Isolated pattern engine has been disposed.', 'crash');
    }
    if (this.runner !== null) return this.runner;
    // Single-flight: four concurrent tool calls on a cold engine must
    // resolve the entrypoint once, not four times.
    this.starting ??= this.startRunner();
    try {
      const runner = await this.starting;
      // Re-checked AFTER the await, not just before it. dispose() may
      // have run during the entrypoint resolution, and a runner handed
      // back at that point would fork a child nobody owns.
      if (this.disposed) {
        runner.dispose();
        throw new IsolatedRunnerError('Isolated pattern engine has been disposed.', 'crash');
      }
      return runner;
    } finally {
      this.starting = null;
    }
  }

  private async startRunner(): Promise<IsolatedEngineRunner> {
    let childPath = this.options.childPath;
    let extraExecArgv = this.options.extraExecArgv ?? [];

    if (childPath === undefined) {
      // Dynamic, and only on the production path: the module it loads uses
      // `import.meta`, which cannot be parsed by this project's Jest.
      // See engineChildPath.ts for why that is not negotiable.
      try {
        const resolve =
          this.options.resolveEntrypoint ??
          (async (): Promise<ChildEntrypointSpec> => {
            const { resolveChildEntrypoint } = await import('./engineChildPath.js');
            return resolveChildEntrypoint();
          });
        const entrypoint = await resolve();
        childPath = entrypoint.childPath;
        if (entrypoint.needsTsx) extraExecArgv = ['--import', 'tsx', ...extraExecArgv];
      } catch (error: unknown) {
        if (error instanceof IsolatedRunnerError) throw error;
        const detail = error instanceof Error ? error.message : String(error);
        throw new IsolatedRunnerError(
          `Could not locate the isolated pattern engine child: ${detail}`,
          'spawn'
        );
      }
    }

    const runner = new IsolatedEngineRunner({
      childPath,
      extraExecArgv,
      maxOldSpaceMb: this.options.maxOldSpaceMb ?? DEFAULT_ENGINE_HEAP_MB,
      timeoutMs: this.options.timeoutMs ?? DEFAULT_ENGINE_TIMEOUT_MS,
      onSpawn: this.options.onSpawn,
    });
    // Assigned only if we are still alive. Storing it first would leave
    // dispose() with nothing to find and this method with a live handle.
    if (this.disposed) {
      runner.dispose();
      throw new IsolatedRunnerError('Isolated pattern engine has been disposed.', 'crash');
    }
    this.runner = runner;
    return runner;
  }
}
