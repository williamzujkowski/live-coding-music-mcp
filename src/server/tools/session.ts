/**
 * session domain — multi-session lifecycle management.
 *
 * Owns one consolidated tool (`session(action)`) plus four deprecated
 * aliases (create_session, destroy_session, list_sessions, switch_session)
 * per #120 / #158. `init` stays separate — it's the global bootstrap,
 * not a session operation.
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { ToolContext, ToolModule } from './types.js';
import { InputValidator } from '../../utils/InputValidator.js';

export const tools: Tool[] = [
  {
    name: 'session',
    description:
      'Manage isolated Strudel browser sessions (multi-session, #108). ' +
      'action=create starts a new named session (sessions share one browser but isolated contexts). ' +
      'action=destroy closes a named session and releases its resources. ' +
      'action=list returns metadata for all active sessions (id, created, last_activity, is_playing, is_default). ' +
      'action=switch changes the default session that subsequent tool calls route to when no session_id is passed. ' +
      'Example: session({ action: "create", session_id: "live-set-1" }). ' +
      'For the on-disk pattern catalog use pattern_store(action=list) — session(action=list) lists *runtime* sessions, not saved patterns.',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['create', 'destroy', 'list', 'switch'], description: 'Session lifecycle action' },
        session_id: { type: 'string', description: 'Session identifier (required for create/destroy/switch)' },
      },
      required: ['action'],
    },
  },
  {
    name: 'create_session',
    description: '[DEPRECATED — use session({ action: "create" }) instead] Create a new isolated Strudel browser session.',
    inputSchema: {
      type: 'object',
      properties: { session_id: { type: 'string', description: 'Unique identifier for the session' } },
      required: ['session_id'],
    },
  },
  {
    name: 'destroy_session',
    description: '[DEPRECATED — use session({ action: "destroy" }) instead] Close and destroy a Strudel session.',
    inputSchema: {
      type: 'object',
      properties: { session_id: { type: 'string', description: 'Session identifier to destroy' } },
      required: ['session_id'],
    },
  },
  {
    name: 'list_sessions',
    description: '[DEPRECATED — use session({ action: "list" }) instead] List all active Strudel sessions.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'switch_session',
    description: '[DEPRECATED — use session({ action: "switch" }) instead] Change the default session.',
    inputSchema: {
      type: 'object',
      properties: { session_id: { type: 'string', description: 'Session identifier to set as default' } },
      required: ['session_id'],
    },
  },
];

export const toolNames = new Set(tools.map(t => t.name));

async function doCreate(args: any, ctx: ToolContext): Promise<unknown> {
  const sm = ctx.sessionManager;
  InputValidator.validateStringLength(args.session_id, 'session_id', 100, false);
  try {
    await sm.createSession(args.session_id);
    return {
      success: true,
      session_id: args.session_id,
      message: `Session '${args.session_id}' created successfully`,
      total_sessions: sm.getSessionCount(),
      max_sessions: sm.getMaxSessions(),
    };
  } catch (error: unknown) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

async function doDestroy(args: any, ctx: ToolContext): Promise<unknown> {
  const sm = ctx.sessionManager;
  InputValidator.validateStringLength(args.session_id, 'session_id', 100, false);
  try {
    await sm.destroySession(args.session_id);
    return {
      success: true,
      session_id: args.session_id,
      message: `Session '${args.session_id}' destroyed`,
      remaining_sessions: sm.getSessionCount(),
    };
  } catch (error: unknown) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function doList(ctx: ToolContext): unknown {
  const sm = ctx.sessionManager;
  const info = sm.getSessionsInfo();
  return {
    count: info.length,
    max_sessions: sm.getMaxSessions(),
    default_session: sm.getDefaultSessionId(),
    sessions: info.map(s => ({
      id: s.id,
      created: s.created.toISOString(),
      last_activity: s.lastActivity.toISOString(),
      is_playing: s.isPlaying,
      is_default: s.id === sm.getDefaultSessionId(),
    })),
  };
}

function doSwitch(args: any, ctx: ToolContext): unknown {
  const sm = ctx.sessionManager;
  InputValidator.validateStringLength(args.session_id, 'session_id', 100, false);
  try {
    sm.setDefaultSession(args.session_id);
    return {
      success: true,
      default_session: args.session_id,
      message: `Default session switched to '${args.session_id}'`,
    };
  } catch (error: unknown) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function execute(name: string, args: any, ctx: ToolContext): Promise<unknown> {
  switch (name) {
    case 'session': {
      const a = args?.action;
      switch (a) {
        case 'create':  return await doCreate(args, ctx);
        case 'destroy': return await doDestroy(args, ctx);
        case 'list':    return doList(ctx);
        case 'switch':  return doSwitch(args, ctx);
        default:
          throw new Error(`Invalid action: ${a}. Must be one of: create, destroy, list, switch`);
      }
    }

    // Deprecated aliases.
    case 'create_session':  return await doCreate(args, ctx);
    case 'destroy_session': return await doDestroy(args, ctx);
    case 'list_sessions':   return doList(ctx);
    case 'switch_session':  return doSwitch(args, ctx);

    default:
      throw new Error(`session module does not handle tool: ${name}`);
  }
}

export const sessionModule: ToolModule = { tools, toolNames, execute };
