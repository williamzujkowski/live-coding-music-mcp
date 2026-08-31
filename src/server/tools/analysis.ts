/**
 * analysis domain — audio analysis + pattern validation (browser + local).
 *
 * Owns (6 tools):
 *   browser-required: analyze (include[] filter), validate_pattern_runtime
 *   browser-free:     validate_pattern_local, analyze_pattern_local,
 *                     query_pattern_events, transpile_pattern
 *
 * The browser-free set runs against the local engine — since #307, a
 * forked child with a heap cap and a deadline, not this process — and
 * pairs naturally with validate_pattern_runtime (which monitors the
 * actual Strudel console). They were orphan handlers — implementations
 * present but not registered in tools/list — until #124.
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { ToolContext, ToolModule } from './types.js';
import { empty, err, ok } from './types.js';
import { InputValidator } from '../../utils/InputValidator.js';
import { IsolatedRunnerError } from '../../services/IsolatedEngineRunner.js';
import { ValidationError } from '../../utils/CategorisedError.js';

const SESSION_ID_PROP = {
  session_id: {
    type: 'string',
    description: 'Optional session ID (#108). Omit to use default session.',
  },
};

export const tools: Tool[] = [
  {
    name: 'analyze',
    description:
      'Audio analysis on the currently-playing pattern. ' +
      'include=["all"] (default) returns the full spectrum + features object, matching the pre-consolidation behaviour. ' +
      'include=["tempo"] returns only BPM with confidence. ' +
      'include=["key"] returns detected key + scale + confidence. ' +
      'include=["spectrum"] returns FFT features (bass, mid, treble, brightness, etc.). ' +
      'include=["rhythm"] returns rhythm-only analysis (complexity, density, syncopation). ' +
      'Combining values returns an object keyed by category, e.g. analyze({ include: ["tempo", "key"] }) → { tempo: {...}, key: {...} }. ' +
      'Example: analyze({ include: ["tempo"] }) to cheaply re-check BPM during a session. ' +
      'For static pattern analysis (no browser) use analyze_pattern_local; for runtime validation use validate_pattern_runtime.',
    inputSchema: {
      type: 'object',
      properties: {
        include: {
          type: 'array',
          items: { type: 'string', enum: ['all', 'spectrum', 'rhythm', 'tempo', 'key'] },
          description: 'Which analyses to return. Default ["all"] preserves pre-consolidation behaviour.',
        },
        ...SESSION_ID_PROP,
      },
    },
  },
  {
    name: 'validate_pattern_runtime',
    description: 'Validate pattern with runtime error checking (monitors Strudel console for errors)',
    inputSchema: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Pattern code to validate' },
        waitMs: { type: 'number', description: 'How long to wait for errors (default 500ms)' },
        ...SESSION_ID_PROP,
      },
      required: ['pattern'],
    },
  },
  {
    name: 'validate_pattern_local',
    description: 'Validate pattern syntax against the local StrudelEngine, which runs in a sandboxed child process (no browser required)',
    inputSchema: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Pattern code to validate' },
      },
      required: ['pattern'],
    },
  },
  {
    name: 'analyze_pattern_local',
    description: 'Static analysis (events/cycle, complexity, optional BPM) without browser playback',
    inputSchema: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Pattern code to analyze' },
      },
      required: ['pattern'],
    },
  },
  {
    name: 'query_pattern_events',
    description: 'Enumerate events the pattern would emit between two cycle indices (max 16 cycles)',
    inputSchema: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Pattern code to query' },
        start: { type: 'number', description: 'Start cycle (default 0)' },
        end: { type: 'number', description: 'End cycle (default 1)' },
      },
      required: ['pattern'],
    },
  },
  {
    name: 'transpile_pattern',
    description: 'Transpile pattern source via StrudelEngine; returns transpiled code or syntax error',
    inputSchema: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Pattern code to transpile' },
      },
      required: ['pattern'],
    },
  },
];

export const toolNames = new Set(tools.map(t => t.name));

// Tools in this module that do NOT require a browser session.
const LOCAL_ENGINE_TOOLS = new Set([
  'validate_pattern_local',
  'analyze_pattern_local',
  'query_pattern_events',
  'transpile_pattern',
]);

async function getSpectrum(controller: any): Promise<unknown> {
  const spectrum = await controller.analyzeAudio();
  return spectrum.features || spectrum;
}

async function getRhythm(controller: any): Promise<unknown> {
  return await controller.analyzeRhythm();
}

async function getTempo(controller: any): Promise<unknown> {
  try {
    const tempoAnalysis = await controller.detectTempo();
    if (!tempoAnalysis || tempoAnalysis.bpm === 0) {
      // The measurement ran and detected nothing. `bpm: 0` read as a
      // measured value — zero beats per minute — so null plus an
      // explicit flag (#288). No envelope here: getTempo is a
      // sub-result composed into analyze's object, and an envelope
      // nested inside a data payload is not the contract.
      return {
        bpm: null,
        detected: false,
        confidence: 0,
        message: 'No tempo detected. Ensure audio is playing and has a clear rhythmic pattern.',
      };
    }
    return {
      bpm: tempoAnalysis.bpm,
      confidence: Math.round(tempoAnalysis.confidence * 100) / 100,
      method: tempoAnalysis.method,
      message: `Detected ${tempoAnalysis.bpm} BPM with ${Math.round(tempoAnalysis.confidence * 100)}% confidence`,
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    // Detection threw, so there is no measurement — same reason the
    // no-detection branch above uses null rather than 0 (#288).
    return {
      bpm: null,
      detected: false,
      confidence: 0,
      error: message || 'Tempo detection failed',
    };
  }
}

async function getKey(controller: any): Promise<unknown> {
  try {
    const keyAnalysis = await controller.detectKey();
    if (!keyAnalysis || keyAnalysis.confidence < 0.1) {
      return {
        key: null,
        scale: null,
        detected: false,
        confidence: 0,
        message: 'No clear key detected. Ensure audio is playing and has tonal content.',
      };
    }
    const result: any = {
      key: keyAnalysis.key,
      scale: keyAnalysis.scale,
      confidence: Math.round(keyAnalysis.confidence * 100) / 100,
      message: `Detected ${keyAnalysis.key} ${keyAnalysis.scale} with ${Math.round(keyAnalysis.confidence * 100)}% confidence`,
    };
    if (keyAnalysis.alternatives && keyAnalysis.alternatives.length > 0) {
      result.alternatives = keyAnalysis.alternatives.map((alt: any) => ({
        key: alt.key,
        scale: alt.scale,
        confidence: Math.round(alt.confidence * 100) / 100,
      }));
    }
    return result;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      key: null,
      scale: null,
      detected: false,
      confidence: 0,
      error: message || 'Key detection failed',
    };
  }
}

async function doAnalyze(args: any, controller: any): Promise<unknown> {
  const includeRaw: unknown = args?.include;
  const include: string[] = Array.isArray(includeRaw) && includeRaw.length > 0
    ? (includeRaw as string[])
    : ['all'];

  for (const v of include) {
    if (!['all', 'spectrum', 'rhythm', 'tempo', 'key'].includes(v)) {
      throw new Error(`Invalid include value: ${v}. Must be one of: all, spectrum, rhythm, tempo, key`);
    }
  }

  // include=['all'] is the most-common path and returns the unwrapped
  // analyzeAudio result (no schema surprise vs old `analyze`).
  if (include.includes('all')) {
    return await controller.analyzeAudio();
  }

  // Otherwise return an object keyed by category, computed in parallel.
  const tasks: Record<string, Promise<unknown>> = {};
  if (include.includes('spectrum')) tasks.spectrum = getSpectrum(controller);
  if (include.includes('rhythm'))   tasks.rhythm   = getRhythm(controller);
  if (include.includes('tempo'))    tasks.tempo    = getTempo(controller);
  if (include.includes('key'))      tasks.key      = getKey(controller);

  const entries = await Promise.all(
    Object.entries(tasks).map(async ([k, p]) => [k, await p] as const),
  );
  return Object.fromEntries(entries);
}

/**
 * Turns a death of the isolated engine child into an envelope (#307).
 *
 * All four local-engine tools funnel through here, which is the point:
 * one isolation path, one place that decides what a caller is told.
 *
 * The distinction the categories carry is whether retrying could possibly
 * help. It cannot for an OOM — `new Array(5e7).fill(7)` will exhaust the
 * cap every time it is sent — so that is the caller's input to fix, not a
 * transient condition to wait out. A hang or an unexplained crash might
 * well be transient. Recording this because the vote on #307 said "one
 * retryable envelope" for all of them, and a blanket `isRetryable: true`
 * would invite an agent into a loop it cannot win.
 */
function isolationFailure(error: IsolatedRunnerError): unknown {
  // Not retryable, and for two different reasons. An OOM is the caller's
  // input: `s("[bd*99999]*99999")` exhausts the cap every time it is
  // sent. A spawn failure is the deployment: a missing or unbuilt child
  // is missing on the next attempt too. Both would put an agent in a loop
  // it cannot win, which is why the vote's "one retryable envelope for
  // everything" is not what shipped.
  if (error.kind === 'oom') return err('validation', error.message);
  if (error.kind === 'spawn') return err('internal', error.message);
  return err('transient', error.message, { isRetryable: true });
}

export async function execute(name: string, args: any, ctx: ToolContext): Promise<unknown> {
  try {
    return await run(name, args, ctx);
  } catch (error: unknown) {
    if (error instanceof IsolatedRunnerError) return isolationFailure(error);
    throw error;
  }
}

async function run(name: string, args: any, ctx: ToolContext): Promise<unknown> {
  const sid: string | undefined = args?.session_id;
  if (!LOCAL_ENGINE_TOOLS.has(name) && !sid && !ctx.isInitialized()) {
    return 'Browser not initialized. Run init first.';
  }
  const controller = LOCAL_ENGINE_TOOLS.has(name) ? null : ctx.getController(sid);

  switch (name) {
    case 'analyze':
      return await doAnalyze(args, controller!);

    case 'validate_pattern_runtime': {
      InputValidator.validateStringLength(args.pattern, 'pattern', 10000, false);
      const validation = await controller!.validatePatternRuntime(
        args.pattern,
        args.waitMs || 500,
      );
      if (validation.valid) {
        return '✅ Pattern valid - no runtime errors detected';
      }
      return `❌ Pattern has runtime errors:\n${validation.errors.join('\n')}\n` +
        (validation.warnings.length > 0 ? `\nWarnings:\n${validation.warnings.join('\n')}` : '');
    }

    case 'validate_pattern_local': {
      InputValidator.validateStringLength(args.pattern, 'pattern', 10000, false);
      const localValidation = await ctx.strudelEngine.validate(args.pattern);
      return {
        valid: localValidation.valid,
        errors: localValidation.errors,
        warnings: localValidation.warnings,
        suggestions: localValidation.suggestions,
        errorLocation: localValidation.errorLocation,
        message: localValidation.valid
          ? '✅ Pattern is valid'
          : `❌ Pattern has ${localValidation.errors.length} error(s)`,
      };
    }

    case 'analyze_pattern_local': {
      InputValidator.validateStringLength(args.pattern, 'pattern', 10000, false);
      const patternMetadata = await ctx.strudelEngine.analyzePattern(args.pattern);

      // Do not report event counts the engine never measured. When
      // evaluation failed, `eventsPerCycle: 0` is a default, not a
      // finding — and it is indistinguishable from a genuinely silent
      // pattern, so an agent was told working code produced nothing
      // (#276). Say what happened instead.
      if (!patternMetadata.evaluated) {
        // Build explicitly rather than destructuring the unwanted fields
        // out: naming them only to discard them trips no-unused-vars, and
        // listing what IS reported is clearer about the contract anyway.
        return {
          usesSound: patternMetadata.usesSound,
          usesNote: patternMetadata.usesNote,
          isStack: patternMetadata.isStack,
          functionsUsed: patternMetadata.functionsUsed,
          complexity: patternMetadata.complexity,
          ...(patternMetadata.bpm !== undefined ? { bpm: patternMetadata.bpm } : {}),
          evaluated: false,
          message:
            'Pattern could not be evaluated, so event counts are unavailable. ' +
            'The static analysis below is still valid. ' +
            (patternMetadata.evaluationError ?? ''),
        };
      }

      return {
        ...patternMetadata,
        message: `Pattern analysis: ${patternMetadata.eventsPerCycle} events/cycle, ` +
                 `complexity ${(patternMetadata.complexity * 100).toFixed(0)}%` +
                 (patternMetadata.bpm ? `, ${patternMetadata.bpm} BPM` : ''),
      };
    }

    case 'query_pattern_events': {
      InputValidator.validateStringLength(args.pattern, 'pattern', 10000, false);
      const startCycle = args.start ?? 0;
      const endCycle = args.end ?? 1;
      if (startCycle >= endCycle) {
        // Categorised explicitly rather than by whether the message
        // happens to contain "must be" — which is the only reason this
        // one landed in `validation` while the range check below landed
        // in `internal` (#453).
        return err('validation', 'Start must be less than end');
      }
      if (endCycle - startCycle > 16) {
        return err('validation', 'Maximum range is 16 cycles to prevent excessive output');
      }
      try {
        const events = await ctx.strudelEngine.queryEvents(args.pattern, startCycle, endCycle);
        // A silent pattern is a valid-empty query, not a failed one —
        // and not the same as a pattern with events, which is what a
        // plain ok() made it look like (#288).
        const wrap = events.length === 0 ? empty : ok;
        return wrap({
          count: events.length,
          range: { start: startCycle, end: endCycle },
          events: events.map((e: any) => ({
            value: e.value,
            start: e.start,
            end: e.end,
            duration: e.end - e.start,
          })),
        });
      } catch (error: unknown) {
        // The engine dying is not a syntax problem, and telling the
        // caller to go run the validator would send them to a tool that
        // will die the same way. Let it reach isolationFailure (#307).
        if (error instanceof IsolatedRunnerError) throw error;
        // A refusal that already knows it is the caller's input keeps
        // that verdict. Flattening it into this shape sent it through
        // the dispatcher as a bare message, which categorised "Pattern
        // produces roughly 2e10 events, above the 50000 cap" as
        // `internal` — found by the protocol route check, after two
        // rounds of fixing this exact class of bug (#382).
        if (error instanceof ValidationError) return err('validation', error.message);
        const message = error instanceof Error ? error.message : String(error);
        return {
          error: message,
          suggestion: 'Check pattern syntax with validate_pattern_local first',
        };
      }
    }

    case 'transpile_pattern': {
      InputValidator.validateStringLength(args.pattern, 'pattern', 10000, false);
      const transpileResult = await ctx.strudelEngine.transpile(args.pattern);
      if (transpileResult.success) {
        return {
          success: true,
          transpiledCode: transpileResult.transpiledCode,
          message: 'Pattern transpiled successfully',
        };
      }
      // A syntax error in the caller's pattern is the caller's input,
      // not an internal fault — and `Unexpected token (1:6)` matches
      // nothing the string matcher looks for (#453). The location is
      // kept in the message, since an envelope carries no extra fields.
      return err(
        'validation',
        `Transpilation failed: ${String(transpileResult.error)}`
        + (transpileResult.errorLocation !== undefined
          ? ` (at ${String(transpileResult.errorLocation)})`
          : ''),
      );
    }

    default:
      throw new Error(`analysis module does not handle tool: ${name}`);
  }
}

export const analysisModule: ToolModule = { tools, toolNames, execute };
