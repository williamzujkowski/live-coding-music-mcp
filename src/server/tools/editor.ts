/**
 * editor domain — pattern editing in the CodeMirror editor.
 *
 * Owns one consolidated mutation tool (`edit_pattern(mode)`) plus
 * `get_pattern` (kept separate, hot read path) and five deprecated
 * aliases (write/append/insert/replace/clear) per #120 / #148.
 *
 * Aliases forward to `edit_pattern` and will be removed in a future
 * release per the deprecation policy.
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { ToolContext, ToolModule } from './types.js';
import { InputValidator } from '../../utils/InputValidator.js';

const SESSION_ID_PROP = {
  session_id: {
    type: 'string',
    description: 'Optional session ID (#108). Omit to use default session.',
  },
};

export const tools: Tool[] = [
  {
    name: 'edit_pattern',
    description:
      'Mutate the current session pattern. ' +
      'mode=write replaces the editor contents (default; mirrors the old write tool exactly, including optional pattern validation and auto_play). ' +
      'mode=append concatenates `code` after the current pattern with a newline. ' +
      'mode=insert places `code` at the given line `position`. ' +
      'mode=replace runs a single string-replace from `search` to `replace`. ' +
      'mode=clear empties the editor. ' +
      'Example: edit_pattern({ mode: "write", pattern: "s(\\"bd\\")", auto_play: true }). ' +
      'For reading the editor without mutating it use get_pattern; for the on-disk pattern catalog use pattern_store.',
    inputSchema: {
      type: 'object',
      properties: {
        mode: {
          type: 'string',
          enum: ['write', 'append', 'insert', 'replace', 'clear'],
          description: 'Which edit operation to perform (default: write)',
        },
        pattern: { type: 'string', description: 'Pattern code (mode=write)' },
        code: { type: 'string', description: 'Code to append/insert (mode=append/insert)' },
        position: { type: 'number', description: 'Line number (mode=insert)' },
        search: { type: 'string', description: 'Text to replace (mode=replace)' },
        replace: { type: 'string', description: 'Replacement text (mode=replace)' },
        auto_play: { type: 'boolean', description: 'Start playback after write (mode=write only, default: false)' },
        validate: { type: 'boolean', description: 'Validate pattern before write (mode=write only, default: true)' },
        ...SESSION_ID_PROP,
      },
    },
  },
  {
    name: 'get_pattern',
    description: 'Get current pattern code',
    inputSchema: { type: 'object', properties: { ...SESSION_ID_PROP } },
  },
  {
    name: 'write',
    description: '[DEPRECATED — use edit_pattern({ mode: "write" }) instead] Write pattern to editor with optional auto-play and validation',
    inputSchema: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Pattern code' },
        auto_play: { type: 'boolean', description: 'Start playback immediately after writing (default: false)' },
        validate: { type: 'boolean', description: 'Validate pattern before writing (default: true)' },
        ...SESSION_ID_PROP,
      },
      required: ['pattern'],
    },
  },
  {
    name: 'append',
    description: '[DEPRECATED — use edit_pattern({ mode: "append" }) instead] Append code to current pattern',
    inputSchema: {
      type: 'object',
      properties: { code: { type: 'string', description: 'Code to append' }, ...SESSION_ID_PROP },
      required: ['code'],
    },
  },
  {
    name: 'insert',
    description: '[DEPRECATED — use edit_pattern({ mode: "insert" }) instead] Insert code at specific line',
    inputSchema: {
      type: 'object',
      properties: {
        position: { type: 'number', description: 'Line number' },
        code: { type: 'string', description: 'Code to insert' },
        ...SESSION_ID_PROP,
      },
      required: ['position', 'code'],
    },
  },
  {
    name: 'replace',
    description: '[DEPRECATED — use edit_pattern({ mode: "replace" }) instead] Replace pattern section',
    inputSchema: {
      type: 'object',
      properties: {
        search: { type: 'string', description: 'Text to replace' },
        replace: { type: 'string', description: 'Replacement text' },
        ...SESSION_ID_PROP,
      },
      required: ['search', 'replace'],
    },
  },
  {
    name: 'clear',
    description: '[DEPRECATED — use edit_pattern({ mode: "clear" }) instead] Clear the editor',
    inputSchema: { type: 'object', properties: { ...SESSION_ID_PROP } },
  },
];

export const toolNames = new Set(tools.map(t => t.name));

async function doWrite(args: any, ctx: ToolContext, sid?: string): Promise<unknown> {
  InputValidator.validateStringLength(args.pattern, 'pattern', 10000, true);

  const controller = ctx.getController(sid);

  // Validate pattern if requested (default: true) — issue #40
  if (args.validate !== false && typeof controller.validatePattern === 'function') {
    try {
      const validation = await controller.validatePattern(args.pattern);
      if (validation && !validation.valid) {
        return {
          success: false,
          errors: validation.errors,
          warnings: validation.warnings,
          suggestions: validation.suggestions,
          message: `Pattern validation failed: ${validation.errors.join('; ')}`,
        };
      }
    } catch {
      ctx.logger.warn('Pattern validation threw error, continuing with write');
    }
  }

  const writeResult = await ctx.writePatternSafe(args.pattern, sid);

  // Auto-play if requested — issue #38
  if (args.auto_play) {
    await controller.play();
    return `${writeResult}. Playing.`;
  }
  return writeResult;
}

async function doAppend(args: any, ctx: ToolContext, sid?: string): Promise<unknown> {
  InputValidator.validateStringLength(args.code, 'code', 10000, true);
  const current = await ctx.getCurrentPatternSafe(sid);
  return await ctx.writePatternSafe(current + '\n' + args.code, sid);
}

async function doInsert(args: any, ctx: ToolContext, sid?: string): Promise<unknown> {
  InputValidator.validatePositiveInteger(args.position, 'position');
  InputValidator.validateStringLength(args.code, 'code', 10000, true);
  const lines = (await ctx.getCurrentPatternSafe(sid)).split('\n');
  lines.splice(args.position, 0, args.code);
  return await ctx.writePatternSafe(lines.join('\n'), sid);
}

async function doReplace(args: any, ctx: ToolContext, sid?: string): Promise<unknown> {
  InputValidator.validateStringLength(args.search, 'search', 1000, true);
  InputValidator.validateStringLength(args.replace, 'replace', 10000, true);
  const pattern = await ctx.getCurrentPatternSafe(sid);
  // Escape $ in replacement to prevent special sequence injection ($&, $1, $', etc.)
  const safeReplacement = args.replace.replace(/\$/g, '$$$$');
  const replaced = pattern.replace(args.search, safeReplacement);
  return await ctx.writePatternSafe(replaced, sid);
}

async function doClear(ctx: ToolContext, sid?: string): Promise<unknown> {
  return await ctx.writePatternSafe('', sid);
}

export async function execute(name: string, args: any, ctx: ToolContext): Promise<unknown> {
  const sid: string | undefined = args?.session_id;
  if (!sid && !ctx.isInitialized()) {
    return 'Browser not initialized. Run init first.';
  }
  switch (name) {
    case 'edit_pattern': {
      const mode = args?.mode ?? 'write';
      switch (mode) {
        case 'write':   return await doWrite(args, ctx, sid);
        case 'append':  return await doAppend(args, ctx, sid);
        case 'insert':  return await doInsert(args, ctx, sid);
        case 'replace': return await doReplace(args, ctx, sid);
        case 'clear':   return await doClear(ctx, sid);
        default:
          throw new Error(`Invalid mode: ${mode}. Must be one of: write, append, insert, replace, clear`);
      }
    }

    // Deprecated aliases — forward to consolidated handler.
    case 'write':   return await doWrite(args, ctx, sid);
    case 'append':  return await doAppend(args, ctx, sid);
    case 'insert':  return await doInsert(args, ctx, sid);
    case 'replace': return await doReplace(args, ctx, sid);
    case 'clear':   return await doClear(ctx, sid);

    case 'get_pattern':
      return await ctx.getCurrentPatternSafe(sid);

    default:
      throw new Error(`editor module does not handle tool: ${name}`);
  }
}

export const editorModule: ToolModule = { tools, toolNames, execute };
