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

export const tools: Tool[] = [
  {
    name: 'show_browser',
    description: 'Bring browser window to foreground for visual feedback',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'compose',
    description: 'Generate, write, and play a complete pattern in one step. Auto-initializes browser if needed.',
    inputSchema: {
      type: 'object',
      properties: {
        style: { type: 'string', description: 'Genre: techno, house, dnb, ambient, trap, jungle, jazz, experimental' },
        tempo: { type: 'number', description: 'BPM (default: genre-appropriate)' },
        key: { type: 'string', description: 'Musical key (default: C)' },
        auto_play: { type: 'boolean', description: 'Start playback immediately (default: true)' },
        get_feedback: { type: 'boolean', description: 'Get AI feedback on the generated pattern (default: false)' },
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

export async function execute(name: string, args: any, ctx: ToolContext): Promise<unknown> {
  switch (name) {
    case 'show_browser': {
      if (!ctx.isInitialized()) {
        return 'Browser not initialized. Run init first.';
      }
      return await ctx.controller.showBrowser();
    }

    case 'compose': {
      InputValidator.validateStringLength(args.style, 'style', 100, false);
      if (args.key) {
        InputValidator.validateRootNote(args.key);
      }
      if (args.tempo !== undefined) {
        InputValidator.validateBPM(args.tempo);
      }

      await ctx.ensureInitialized();

      const tempo = args.tempo || defaultTempo(args.style);
      const key = args.key || 'C';
      const pattern = ctx.generator.generateCompletePattern(args.style, key, tempo);

      await ctx.controller.writePattern(pattern);

      const shouldPlay = args.auto_play !== false;
      if (shouldPlay) {
        await ctx.controller.play();
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
