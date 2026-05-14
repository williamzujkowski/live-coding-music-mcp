/**
 * playback domain — transport controls (play, pause, stop).
 *
 * Owns (3 tools): play, pause, stop. Post-consolidation target
 * (#110 audit, #120 epic): single `playback` tool with action enum.
 *
 * Each tool accepts an optional `session_id` (#108). Omitting it
 * targets the default/legacy session; an explicit id routes through
 * SessionManager and errors if the session doesn't exist.
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
    name: 'play',
    description: 'Start playing pattern',
    inputSchema: { type: 'object', properties: { ...SESSION_ID_PROP } },
  },
  {
    name: 'pause',
    description: 'Pause playback',
    inputSchema: { type: 'object', properties: { ...SESSION_ID_PROP } },
  },
  {
    name: 'stop',
    description: 'Stop playback',
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
  switch (name) {
    case 'play':
      return await controller.play();

    case 'pause':
    case 'stop':
      return await controller.stop();

    default:
      throw new Error(`playback module does not handle tool: ${name}`);
  }
}

export const playbackModule: ToolModule = { tools, toolNames, execute };
