/**
 * analysis domain — audio analysis + pattern validation (browser + local).
 *
 * Owns (10 tools):
 *   browser-required: analyze, analyze_spectrum, analyze_rhythm,
 *                     detect_tempo, detect_key, validate_pattern_runtime
 *   browser-free:     validate_pattern_local, analyze_pattern_local,
 *                     query_pattern_events, transpile_pattern
 *
 * The browser-free set runs against the in-process StrudelEngine and
 * pairs naturally with validate_pattern_runtime (which monitors the
 * actual Strudel console). They were orphan handlers — implementations
 * present but not registered in tools/list — until #124.
 *
 * Post-consolidation (per #110 audit): a single `analyze` tool with
 * an `include[]` filter absorbs the 4 audio detection tools.
 * Local-engine tools stay distinct — different subsystem.
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { ToolContext, ToolModule } from './types.js';
import { InputValidator } from '../../utils/InputValidator.js';

export const tools: Tool[] = [
  {
    name: 'analyze',
    description: 'Complete audio analysis',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'analyze_spectrum',
    description: 'FFT spectrum analysis',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'analyze_rhythm',
    description: 'Rhythm analysis',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'detect_tempo',
    description: 'BPM detection',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'detect_key',
    description: 'Key detection',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'validate_pattern_runtime',
    description: 'Validate pattern with runtime error checking (monitors Strudel console for errors)',
    inputSchema: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Pattern code to validate' },
        waitMs: { type: 'number', description: 'How long to wait for errors (default 500ms)' },
      },
      required: ['pattern'],
    },
  },
  {
    name: 'validate_pattern_local',
    description: 'Validate pattern syntax against the in-process StrudelEngine (no browser required)',
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

export async function execute(name: string, args: any, ctx: ToolContext): Promise<unknown> {
  if (!LOCAL_ENGINE_TOOLS.has(name) && !ctx.isInitialized()) {
    return 'Browser not initialized. Run init first.';
  }

  switch (name) {
    case 'analyze':
      return await ctx.controller.analyzeAudio();

    case 'analyze_spectrum': {
      const spectrum = await ctx.controller.analyzeAudio();
      return spectrum.features || spectrum;
    }

    case 'analyze_rhythm':
      return await ctx.controller.analyzeRhythm();

    case 'detect_tempo': {
      try {
        const tempoAnalysis = await ctx.controller.detectTempo();
        if (!tempoAnalysis || tempoAnalysis.bpm === 0) {
          return {
            bpm: 0,
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
        return { bpm: 0, confidence: 0, error: message || 'Tempo detection failed' };
      }
    }

    case 'detect_key': {
      try {
        const keyAnalysis = await ctx.controller.detectKey();
        if (!keyAnalysis || keyAnalysis.confidence < 0.1) {
          return {
            key: 'Unknown',
            scale: 'unknown',
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
        return { key: 'Unknown', scale: 'unknown', confidence: 0, error: message || 'Key detection failed' };
      }
    }

    case 'validate_pattern_runtime': {
      InputValidator.validateStringLength(args.pattern, 'pattern', 10000, false);
      const validation = await ctx.controller.validatePatternRuntime(
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
      const localValidation = ctx.strudelEngine.validate(args.pattern);
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
      const patternMetadata = ctx.strudelEngine.analyzePattern(args.pattern);
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
        return { error: 'Start must be less than end' };
      }
      if (endCycle - startCycle > 16) {
        return { error: 'Maximum range is 16 cycles to prevent excessive output' };
      }
      try {
        const events = ctx.strudelEngine.queryEvents(args.pattern, startCycle, endCycle);
        return {
          count: events.length,
          range: { start: startCycle, end: endCycle },
          events: events.map((e: any) => ({
            value: e.value,
            start: e.start,
            end: e.end,
            duration: e.end - e.start,
          })),
        };
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          error: message,
          suggestion: 'Check pattern syntax with validate_pattern_local first',
        };
      }
    }

    case 'transpile_pattern': {
      InputValidator.validateStringLength(args.pattern, 'pattern', 10000, false);
      const transpileResult = ctx.strudelEngine.transpile(args.pattern);
      if (transpileResult.success) {
        return {
          success: true,
          transpiledCode: transpileResult.transpiledCode,
          message: 'Pattern transpiled successfully',
        };
      }
      return {
        success: false,
        error: transpileResult.error,
        errorLocation: transpileResult.errorLocation,
        message: 'Transpilation failed',
      };
    }

    default:
      throw new Error(`analysis module does not handle tool: ${name}`);
  }
}

export const analysisModule: ToolModule = { tools, toolNames, execute };
