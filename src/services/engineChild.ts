/**
 * Child entrypoint for the isolated local pattern engine (#307).
 *
 * Forked by `IsolatedEngineRunner` with `--max-old-space-size`. Owns one
 * `StrudelEngine`, answers RPC over IPC, and is expected to die from time
 * to time — that is the design, not a fault. Nothing here should try to
 * survive a bad pattern; the parent handles death and respawns.
 *
 * This file is deliberately the only place that imports `StrudelEngine`
 * into the isolated process, so the parent never loads `@strudel/*` at all.
 */

import { StrudelEngine } from './StrudelEngine.js';
import { ISOLATED_METHODS } from './LocalPatternEngine.js';
import { toTransferable } from './Transferable.js';
import { BusinessError, ValidationError } from '../utils/CategorisedError.js';

const engine = new StrudelEngine();

/**
 * Object-literal method shorthand, and `Object.hasOwn` on the way in.
 * A plain `HANDLERS[method]` would happily resolve `constructor` or
 * `toString` off the prototype chain and call it with attacker-chosen
 * arguments — the same class of bug this repo has now found nine times.
 */
const HANDLERS = {
  transpile(code: string) {
    return engine.transpile(code);
  },
  validate(code: string) {
    return engine.validate(code);
  },
  analyzePattern(code: string) {
    return engine.analyzePattern(code);
  },
  queryEvents(code: string, start: number, end: number) {
    return engine.queryEvents(code, start, end);
  },
};

/** The category an error carries, when it is one of ours. */
function categoryOf(error: unknown): 'validation' | 'business' | undefined {
  if (error instanceof ValidationError) return 'validation';
  if (error instanceof BusinessError) return 'business';
  return undefined;
}

interface Request {
  id: number;
  method: string;
  args: unknown[];
}

process.on('message', (raw: unknown) => {
  const request = raw as Request | null;
  if (!request || typeof request.id !== 'number') return;

  const send = (payload: Record<string, unknown>): void => {
    process.send?.({ id: request.id, ...payload });
  };

  if (!ISOLATED_METHODS.includes(request.method as never) || !Object.hasOwn(HANDLERS, request.method)) {
    send({ ok: false, error: { name: 'TypeError', message: `Unknown engine method: ${String(request.method)}` } });
    return;
  }

  try {
    const handler = HANDLERS[request.method as keyof typeof HANDLERS] as (...args: unknown[]) => unknown;
    const result = handler(...(request.args ?? []));
    send({ ok: true, result: toTransferable(result) });
  } catch (error: unknown) {
    send({
      ok: false,
      error: {
        name: error instanceof Error ? error.name : 'Error',
        message: error instanceof Error ? error.message : String(error),
        // The class cannot cross IPC — the parent rebuilds a plain Error
        // from this payload — so the verdict travels as a field. Without
        // it, "Result exceeds the 2000000-value transfer limit. Narrow
        // the query" arrived uncategorised and was reported as an
        // internal failure not worth retrying (#382).
        category: categoryOf(error),
      },
    });
  }
});

// If the parent goes away, so do we. A forked engine outliving its server
// is a leaked process, not a feature.
process.on('disconnect', () => {
  process.exit(0);
});
