/**
 * playback domain — transport controls.
 *
 * Owns one consolidated tool (`playback(action)`) plus three deprecated
 * aliases (play, pause, stop) per #120 / #152.
 *
 * Aliases forward to `playback` and will be removed in a future release
 * per the deprecation policy.
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { ToolContext, ToolModule } from './types.js';

const SESSION_ID_PROP = {
  session_id: {
    type: 'string',
    description: 'Optional session ID (#108). Omit to use default session.',
  },
};

export const tools: Tool[] = [
  {
    name: 'playback',
    description:
      'Control transport on the current session. ' +
      'action=play starts the editor pattern. ' +
      'action=pause stops without resetting clock. ' +
      'action=stop ends playback. ' +
      'Example: playback({ action: "play" }). ' +
      'For pattern editing use edit_pattern; for tempo use set_tempo.',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['play', 'pause', 'stop'],
          description: 'Transport action',
        },
        ...SESSION_ID_PROP,
      },
      required: ['action'],
    },
  },
  {
    name: 'play',
    description: '[DEPRECATED — use playback({ action: "play" }) instead] Start playing pattern',
    inputSchema: { type: 'object', properties: { ...SESSION_ID_PROP } },
  },
  {
    name: 'pause',
    description: '[DEPRECATED — use playback({ action: "pause" }) instead] Pause playback',
    inputSchema: { type: 'object', properties: { ...SESSION_ID_PROP } },
  },
  {
    name: 'stop',
    description: '[DEPRECATED — use playback({ action: "stop" }) instead] Stop playback',
    inputSchema: { type: 'object', properties: { ...SESSION_ID_PROP } },
  },
];

export const toolNames = new Set(tools.map(t => t.name));

export async function execute(name: string, args: any, ctx: ToolContext): Promise<unknown> {
  const sid: string | undefined = args?.session_id;
  if (!sid && !ctx.isInitialized()) {
    return 'Browser not initialized. Run init first.';
  }
  const controller = ctx.getController(sid);

  const action = name === 'playback' ? args?.action : name;
  switch (action) {
    case 'play':
      return await controller.play();
    case 'pause':
    case 'stop':
      return await controller.stop();
    default:
      throw new Error(`Invalid action: ${action}. Must be one of: play, pause, stop`);
  }
}

export const playbackModule: ToolModule = { tools, toolNames, execute };
