/**
 * compose domain — high-level UX tools that aren't a thin verb on a
 * subsystem: `compose` (one-shot generate+write+play) and `show_browser`
 * (bring the Strudel window forward).
 *
 * Post-consolidation (per #110 audit):
 *   - `compose` absorbs `generate_pattern` after the alias period
 *   - `show_browser` merges with `screenshot` into `browser_window`
 * These targets live in different epics (#120). Keeping the two tools
 * together here matches today's "UX Tools" grouping; the file is small
 * enough to split later without disruption.
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { CreativeFeedback } from '../../services/GeminiService.js';
import type { ToolContext, ToolModule } from './types.js';
import { InputValidator } from '../../utils/InputValidator.js';

const SESSION_ID_PROP = {
  session_id: {
    type: 'string',
    description: 'Optional session ID (#108). Omit to use default session. compose auto-init only applies to default session — named sessions must already exist.',
  },
};

export const tools: Tool[] = [
  {
    name: 'browser_window',
    description:
      'Interact with the visible Strudel browser window. ' +
      'action=show brings the window to the foreground. ' +
      'action=screenshot captures the current editor view to disk (optional `filename`). ' +
      'Example: browser_window({ action: "screenshot", filename: "demo.png" }). ' +
      'For diagnostics (status/errors/perf) use diagnostics; for the editor itself use edit_pattern.',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['show', 'screenshot'], description: 'Window action' },
        filename: { type: 'string', description: 'action=screenshot: optional output filename' },
        ...SESSION_ID_PROP,
      },
      required: ['action'],
    },
  },
  {
    name: 'show_browser',
    description: '[DEPRECATED — use browser_window({ action: "show" }) instead] Bring browser window to foreground',
    inputSchema: { type: 'object', properties: { ...SESSION_ID_PROP } },
  },
  {
    name: 'compose',
    description: 'Generate, write, and play a complete pattern in one step. Auto-initializes default browser if needed.',
    inputSchema: {
      type: 'object',
      properties: {
        style: { type: 'string', description: 'Genre: techno, house, dnb, ambient, trap, jungle, jazz, experimental' },
        tempo: { type: 'number', description: 'BPM (default: genre-appropriate)' },
        key: { type: 'string', description: 'Musical key (default: C)' },
        auto_play: { type: 'boolean', description: 'Start playback immediately (default: true)' },
        get_feedback: { type: 'boolean', description: 'Get AI feedback on the generated pattern (default: false)' },
        ...SESSION_ID_PROP,
      },
      required: ['style'],
    },
  },
];

export const toolNames = new Set(tools.map(t => t.name));

const TEMPO_BY_STYLE: Record<string, number> = {
  techno: 130,
  house: 125,
  dnb: 174,
  'drum and bass': 174,
  ambient: 80,
  trap: 140,
  jungle: 160,
  jazz: 110,
  experimental: 120,
  dubstep: 140,
  trance: 138,
  breakbeat: 130,
  garage: 130,
  electro: 128,
  downtempo: 90,
  idm: 115,
};

function defaultTempo(style: string): number {
  return TEMPO_BY_STYLE[style.toLowerCase()] ?? 120;
}

async function doShow(ctx: ToolContext, sid?: string): Promise<unknown> {
  if (!sid && !ctx.isInitialized()) {
    return 'Browser not initialized. Run init first.';
  }
  return await ctx.getController(sid).showBrowser();
}

async function doScreenshot(args: any, ctx: ToolContext, sid?: string): Promise<unknown> {
  if (!sid && !ctx.isInitialized()) {
    return 'Browser not initialized. Run init first.';
  }
  return await ctx.getController(sid).takeScreenshot(args?.filename);
}

export async function execute(name: string, args: any, ctx: ToolContext): Promise<unknown> {
  const sid: string | undefined = args?.session_id;
  switch (name) {
    case 'browser_window': {
      const a = args?.action;
      if (a !== 'show' && a !== 'screenshot') {
        throw new Error(`Invalid action: ${a}. Must be one of: show, screenshot`);
      }
      return a === 'show' ? await doShow(ctx, sid) : await doScreenshot(args, ctx, sid);
    }

    case 'show_browser':
      return await doShow(ctx, sid);

    case 'compose': {
      InputValidator.validateStringLength(args.style, 'style', 100, false);
      if (args.key) {
        InputValidator.validateRootNote(args.key);
      }
      if (args.tempo !== undefined) {
        InputValidator.validateBPM(args.tempo);
      }

      // Auto-init only the default session. Named sessions must be
      // created via `create_session` first — ctx.getController(sid)
      // throws if missing, which the dispatcher renders as err('business').
      if (!sid) {
        await ctx.ensureInitialized();
      }
      const controller = ctx.getController(sid);

      const tempo = args.tempo || defaultTempo(args.style);
      const key = args.key || 'C';
      const pattern = ctx.generator.generateCompletePattern(args.style, key, tempo);

      await controller.writePattern(pattern);

      const shouldPlay = args.auto_play !== false;
      if (shouldPlay) {
        await controller.play();
      }

      const response: {
        success: boolean;
        pattern: string;
        metadata: { style: string; bpm: number; key: string };
        status: string;
        message: string;
        feedback?: CreativeFeedback;
      } = {
        success: true,
        pattern: pattern.substring(0, 200) + (pattern.length > 200 ? '...' : ''),
        metadata: { style: args.style, bpm: tempo, key },
        status: shouldPlay ? 'playing' : 'ready',
        message: `Created ${args.style} pattern in ${key}${shouldPlay ? ' - now playing' : ''}`,
      };

      if (args.get_feedback) {
        if (ctx.geminiService.isAvailable()) {
          try {
            const feedback = await ctx.geminiService.getCreativeFeedback(pattern);
            response.feedback = feedback;
            response.message += ` (AI feedback: ${feedback.complexity} complexity, estimated ${feedback.estimatedStyle})`;
          } catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error);
            ctx.logger.warn('Failed to get AI feedback for compose', { error: message });
            response.message += ' (AI feedback unavailable)';
          }
        } else {
          response.message += ' (AI feedback requires GEMINI_API_KEY)';
        }
      }

      return response;
    }

    default:
      throw new Error(`compose module does not handle tool: ${name}`);
  }
}

export const composeModule: ToolModule = { tools, toolNames, execute };
