/**
 * storage domain — pattern persistence.
 *
 * Owns one consolidated tool (`pattern_store`) with save/load/list actions.
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { ToolContext, ToolModule } from './types.js';
import { InputValidator } from '../../utils/InputValidator.js';
import { ok, err } from './types.js';
import { readFile } from 'fs/promises';
import path from 'path';

/** Hard cap on .mid input size — protects @tonejs/midi from pathological allocations. */
const MAX_MIDI_BYTES = 1_000_000; // 1 MB

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
    name: 'import_midi',
    description:
      'Convert a .mid file into a playable Strudel pattern (Phase 1: literal transcription, #201). ' +
      'Use source="base64" with data=<base64 string> for inline bytes, or source="path" with data=<basename> ' +
      'to read from the patterns/midi/ directory (path traversal blocked). ' +
      'Drum tracks (MIDI channel 10) emit one s() lane per sample so simultaneous kicks/hats do not collide. ' +
      'Pitched tracks emit note("...").s("piano") with simultaneous notes merged into [a,b,c] chord tokens. ' +
      'Phase 2+ (structural compression, voice separation, LLM idiomatic pass) tracked in separate issues. ' +
      'Example: import_midi({ source: "path", data: "drumloop.mid", steps_per_cycle: 16 }). ' +
      'For the reverse direction (Strudel → MIDI) use the analyze tool with task="export_midi".',
    inputSchema: {
      type: 'object',
      properties: {
        source: {
          type: 'string',
          enum: ['base64', 'path'],
          description: 'How to interpret `data` — raw base64 bytes or a filename under patterns/midi/',
        },
        data: {
          type: 'string',
          description:
            'For source=base64: base64-encoded .mid bytes (≤1MB decoded). ' +
            'For source=path: basename of a .mid file under ./patterns/midi/ (path-traversal blocked).',
        },
        steps_per_cycle: {
          type: 'number',
          description: 'Grid resolution per bar (integer 1-64). Default 16.',
        },
        bars: {
          type: 'number',
          description: 'Cap on bars to emit. Default: full file.',
        },
        drum_map: {
          type: 'object',
          description:
            'Optional override / extension to the default GM percussion map. ' +
            'Keys are MIDI note numbers (as strings, since JSON object keys), values are Strudel sample names. ' +
            'Example: { "60": "cp", "61": "rim" }. Unmapped drums fall back to rests and are surfaced in the result summary.',
          additionalProperties: { type: 'string' },
        },
      },
      required: ['source', 'data'],
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

/**
 * Resolve `args.data` to a Buffer based on `args.source`. Enforces the
 * 1 MB cap and, for path sources, blocks path traversal by clamping to
 * `./patterns/midi/` via `path.basename` (mirrors PatternStore).
 */
async function loadMidiBuffer(args: any): Promise<Buffer> {
  const source = args?.source;
  const data = args?.data;
  if (typeof data !== 'string' || data.length === 0) {
    throw new Error('Invalid data: must be a non-empty string');
  }
  if (source === 'base64') {
    // Decoded length ≤ raw length × 3/4; reject before allocating.
    if (data.length > MAX_MIDI_BYTES * 2) {
      throw new Error(`MIDI base64 input too large (>${MAX_MIDI_BYTES} bytes decoded).`);
    }
    const buf = Buffer.from(data, 'base64');
    if (buf.length === 0) {
      throw new Error('Invalid data: base64 decoded to zero bytes');
    }
    if (buf.length > MAX_MIDI_BYTES) {
      throw new Error(`MIDI input too large (${buf.length} > ${MAX_MIDI_BYTES} bytes).`);
    }
    return buf;
  }
  if (source === 'path') {
    InputValidator.validateStringLength(data, 'data', 255, false);
    const safeName = path.basename(data);
    if (safeName !== data) {
      throw new Error('Invalid filename: path traversal detected');
    }
    const fullPath = path.resolve('./patterns/midi', safeName);
    const expectedRoot = path.resolve('./patterns/midi');
    if (!fullPath.startsWith(expectedRoot + path.sep)) {
      throw new Error('Invalid filename: must resolve under patterns/midi/');
    }
    const buf = await readFile(fullPath);
    if (buf.length > MAX_MIDI_BYTES) {
      throw new Error(`MIDI input too large (${buf.length} > ${MAX_MIDI_BYTES} bytes).`);
    }
    return buf;
  }
  throw new Error(`Invalid source: ${source}. Must be "base64" or "path".`);
}

async function doImportMidi(args: any, ctx: ToolContext): Promise<unknown> {
  let buffer: Buffer;
  try {
    buffer = await loadMidiBuffer(args);
  } catch (e: any) {
    return err('validation', e?.message ?? 'Failed to load MIDI input');
  }

  // Normalize drum_map keys: JSON object keys are strings, the service wants number keys.
  let drumMapNormalized: Record<number, string> | undefined;
  if (args?.drum_map && typeof args.drum_map === 'object') {
    drumMapNormalized = {};
    for (const [k, v] of Object.entries(args.drum_map)) {
      const n = Number(k);
      if (!Number.isInteger(n) || n < 0 || n > 127 || typeof v !== 'string' || v.length === 0) {
        return err('validation', `Invalid drum_map entry: ${k} -> ${String(v)}`);
      }
      drumMapNormalized[n] = v;
    }
  }

  try {
    const result = ctx.midiImportService.convertBuffer(buffer, {
      steps_per_cycle: args?.steps_per_cycle,
      bars: args?.bars,
      drum_map: drumMapNormalized,
    });
    return ok(result);
  } catch (e: any) {
    const msg = e?.message ?? String(e);
    if (/parse|invalid|must be/i.test(msg)) {
      return err('validation', msg);
    }
    return err('internal', msg);
  }
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

    case 'import_midi':
      return await doImportMidi(args, ctx);

    default:
      throw new Error(`storage module does not handle tool: ${name}`);
  }
}

export const storageModule: ToolModule = { tools, toolNames, execute };
