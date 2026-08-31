/**
 * editor domain — pattern editing in the CodeMirror editor.
 *
 * Owns one consolidated mutation tool (`edit_pattern(mode)`) with
 * write/append/insert/replace/clear modes, plus `get_pattern` (kept
 * separate — hot read path).
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { ToolContext, ToolModule } from './types.js';
import { withStashField } from './types.js';
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
      'mode=replace substitutes `search` with `replace` — the first occurrence only, unless replace_all is true. ' +
      'The response reports how many occurrences matched, were replaced, and remain. ' +
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
        replace_all: { type: 'boolean', description: 'mode=replace: replace every occurrence instead of just the first (default false)' },
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

  const search: string = args.search ?? '';
  if (search.length === 0) {
    throw new Error('Invalid search: must be a non-empty string.');
  }

  const pattern = await ctx.getCurrentPatternSafe(sid);

  // Literal string operations throughout — never a RegExp built from
  // `search`. Interpolating caller text into a pattern is how #236
  // happened: `(a+)+Z` against a crafted subject blocked the event loop
  // for 25 seconds.
  const matches = pattern.split(search).length - 1;

  // Escape $ in replacement to prevent special sequence injection ($&, $1, $', etc.)
  const safeReplacement = args.replace.replace(/\$/g, '$$$$');

  const replaceAll = args.replace_all === true;
  const updated = replaceAll
    ? pattern.replaceAll(search, safeReplacement)
    : pattern.replace(search, safeReplacement);

  const replaced = replaceAll ? matches : Math.min(matches, 1);
  const remaining = matches - replaced;

  const written = await ctx.writePatternSafe(updated, sid);

  // Counts are reported under BOTH settings. Previously a caller had no
  // way to learn that other occurrences survived — and these callers are
  // LLM agents, which do not reliably re-read the pattern to check (#243).
  return withStashField({
    success: true,
    message:
      matches === 0
        ? `No occurrences of ${JSON.stringify(search)} found`
        : `Replaced ${String(replaced)} of ${String(matches)} occurrence(s)` +
          (remaining > 0 ? `; ${String(remaining)} remain. Pass replace_all: true to replace them all.` : ''),
    replaced,
    remaining,
    matches,
  }, written);
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

    case 'get_pattern':
      return await ctx.getCurrentPatternSafe(sid);

    default:
      throw new Error(`editor module does not handle tool: ${name}`);
  }
}

export const editorModule: ToolModule = { tools, toolNames, execute };
