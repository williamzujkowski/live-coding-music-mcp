/**
 * music domain — remote music generation that returns an audio payload.
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import {
  MINIMAX_MUSIC_AUDIO_FORMATS,
  MINIMAX_MUSIC_MODELS,
  MINIMAX_MUSIC_OUTPUT_FORMATS,
  MiniMaxMusicService,
} from '../../services/MiniMaxMusicService.js';
import type { ToolContext, ToolModule } from './types.js';

export const tools: Tool[] = [
  {
    name: 'generate_music',
    description:
      'Generate music with the MiniMax music API and return the generated audio as a URL or hexadecimal payload.',
    inputSchema: {
      type: 'object',
      properties: {
        model: {
          type: 'string',
          enum: [...MINIMAX_MUSIC_MODELS],
          description: 'Music generation model.',
        },
        prompt: {
          type: 'string',
          description: 'Natural-language description of the music to generate.',
        },
        lyrics: { type: 'string', description: 'Lyrics for the generated song.' },
        stream: { type: 'boolean', description: 'Return streamed hexadecimal audio chunks.' },
        output_format: {
          type: 'string',
          enum: [...MINIMAX_MUSIC_OUTPUT_FORMATS],
          description: 'Completed response format. Streaming supports hexadecimal output only.',
        },
        audio_setting: {
          type: 'object',
          description: 'Optional audio settings. The format can be mp3, wav, or pcm.',
          properties: {
            format: {
              type: 'string',
              enum: [...MINIMAX_MUSIC_AUDIO_FORMATS],
              description: 'Audio encoding.',
            },
            sample_rate: { type: 'integer', description: 'Audio sample rate.' },
            bitrate: { type: 'integer', description: 'Audio bitrate.' },
            channel: { type: 'integer', description: 'Audio channel count.' },
          },
          additionalProperties: true,
        },
        lyrics_optimizer: {
          type: 'boolean',
          description: 'Optimize supplied lyrics before generation.',
        },
        is_instrumental: {
          type: 'boolean',
          description: 'Generate an instrumental track without vocals.',
        },
        region: {
          type: 'string',
          enum: ['global_en', 'cn_zh'],
          description: 'API region. Defaults to global_en; cn_zh supports aigc_watermark.',
        },
        aigc_watermark: { type: 'boolean', description: 'China-region watermark option.' },
      },
      required: ['model'],
    },
  },
];

export const toolNames = new Set(tools.map((tool) => tool.name));

export async function execute(name: string, args: any, ctx: ToolContext): Promise<unknown> {
  if (name !== 'generate_music') {
    throw new Error(`music module does not handle tool: ${name}`);
  }

  const service = ctx.miniMaxMusicService ?? new MiniMaxMusicService();
  return await service.generateMusic({
    model: args?.model,
    prompt: args?.prompt,
    lyrics: args?.lyrics,
    stream: args?.stream,
    output_format: args?.output_format,
    audio_setting: args?.audio_setting,
    lyrics_optimizer: args?.lyrics_optimizer,
    is_instrumental: args?.is_instrumental,
    region: args?.region,
    aigc_watermark: args?.aigc_watermark,
  });
}

export const musicModule: ToolModule = { tools, toolNames, execute };
