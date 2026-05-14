/**
 * storage domain — pattern persistence.
 *
 * Owns one consolidated tool (`pattern_store`) plus three deprecated
 * aliases (`save`, `load`, `list`) per the #120 / #143 consolidation.
 *
 * The consolidation also resolves the `list` / `list_sessions` naming
 * collision from #110 — `pattern_store(action='list')` is unambiguous
 * versus `session(action='list')` after the #158 session consolidation.
 *
 * Aliases forward to `pattern_store` and will be removed in a future
 * release per the deprecation policy in #120.
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { ToolContext, ToolModule } from './types.js';
import { InputValidator } from '../../utils/InputValidator.js';

const SESSION_ID_PROP = {
  session_id: {
    type: 'string',
    description: 'Optional session ID (#108). Sources/targets the named session\'s current pattern; the on-disk catalog is shared across sessions.',
  },
};

export const tools: Tool[] = [
  {
    name: 'pattern_store',
    description:
      'Persist patterns to disk and read them back. ' +
      'Use action=save to write the current session pattern under a name; ' +
      'action=load to restore a named pattern into the current session; ' +
      'action=list to enumerate the on-disk catalog (optionally filtered by tag). ' +
      'Example: pattern_store({ action: "save", name: "my-jam", tags: ["techno"] }). ' +
      'For session lifecycle (create/destroy/list active sessions) use the session tool — pattern_store deals with on-disk patterns, not runtime sessions.',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['save', 'load', 'list'],
          description: 'Which on-disk operation to perform',
        },
        name: { type: 'string', description: 'Pattern name (required for save/load)' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Tags to attach (save only)' },
        tag: { type: 'string', description: 'Filter by tag (list only)' },
        ...SESSION_ID_PROP,
      },
      required: ['action'],
    },
  },
  {
    name: 'save',
    description: '[DEPRECATED — use pattern_store({ action: "save" }) instead] Save pattern with metadata',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Pattern name' },
        tags: { type: 'array', items: { type: 'string' } },
        ...SESSION_ID_PROP,
      },
      required: ['name'],
    },
  },
  {
    name: 'load',
    description: '[DEPRECATED — use pattern_store({ action: "load" }) instead] Load saved pattern',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Pattern name' },
        ...SESSION_ID_PROP,
      },
      required: ['name'],
    },
  },
  {
    name: 'list',
    description: '[DEPRECATED — use pattern_store({ action: "list" }) instead] List saved patterns',
    inputSchema: {
      type: 'object',
      properties: {
        tag: { type: 'string', description: 'Filter by tag' },
      },
    },
  },
];

export const toolNames = new Set(tools.map(t => t.name));

async function doSave(args: any, ctx: ToolContext, sid?: string): Promise<unknown> {
  InputValidator.validateStringLength(args.name, 'name', 255, false);
  const toSave = await ctx.getCurrentPatternSafe(sid);
  if (!toSave) {
    return 'No pattern to save';
  }
  await ctx.store.save(args.name, toSave, args.tags || []);
  return `Pattern saved as "${args.name}"`;
}

async function doLoad(args: any, ctx: ToolContext, sid?: string): Promise<unknown> {
  InputValidator.validateStringLength(args.name, 'name', 255, false);
  const saved = await ctx.store.load(args.name);
  if (saved) {
    await ctx.writePatternSafe(saved.content, sid);
    return `Loaded pattern "${args.name}"`;
  }
  return `Pattern "${args.name}" not found`;
}

async function doList(args: any, ctx: ToolContext): Promise<unknown> {
  if (args?.tag) {
    InputValidator.validateStringLength(args.tag, 'tag', 100, false);
  }
  const patterns = await ctx.store.list(args?.tag);
  return patterns.map(p =>
    `• ${p.name} [${p.tags.join(', ')}] - ${p.timestamp}`
  ).join('\n') || 'No patterns found';
}

export async function execute(name: string, args: any, ctx: ToolContext): Promise<unknown> {
  const sid: string | undefined = args?.session_id;
  switch (name) {
    case 'pattern_store': {
      const action = args?.action;
      if (!action || !['save', 'load', 'list'].includes(action)) {
        throw new Error(`Invalid action: ${action}. Must be one of: save, load, list`);
      }
      switch (action) {
        case 'save': return await doSave(args, ctx, sid);
        case 'load': return await doLoad(args, ctx, sid);
        case 'list': return await doList(args, ctx);
      }
      // Unreachable due to enum check above, but TypeScript wants it.
      return undefined;
    }

    // Aliases — forward to consolidated handler. Kept for ≥1 release per
    // #120 migration rules; removed afterwards.
    case 'save': return await doSave(args, ctx, sid);
    case 'load': return await doLoad(args, ctx, sid);
    case 'list': return await doList(args, ctx);

    default:
      throw new Error(`storage module does not handle tool: ${name}`);
  }
}

export const storageModule: ToolModule = { tools, toolNames, execute };
