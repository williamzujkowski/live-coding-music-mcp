/**
 * generate domain — pattern and music-theory generation (no browser needed).
 *
 * Owns (9 tools):
 *   generate_pattern, generate_drums, generate_bassline, generate_melody,
 *   generate_fill, generate_scale, generate_chord_progression,
 *   generate_euclidean, generate_polyrhythm
 *
 * `compose` stays in server.ts for now — it orchestrates init + generate
 * + play + optional AI feedback and pairs with ai.ts when that extraction
 * happens. Per the #110 audit, compose eventually absorbs generate_pattern
 * and the four generate_* drums/bass/melody/fill tools collapse into
 * `generate_part(role)`, while scale+chord_prog become `music_theory`.
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
    name: 'generate_pattern',
    description: 'Generate complete pattern from style with optional auto-play',
    inputSchema: {
      type: 'object',
      properties: {
        style: { type: 'string', description: 'Music style (techno/house/dnb/ambient/etc)' },
        key: { type: 'string', description: 'Musical key' },
        bpm: { type: 'number', description: 'Tempo in BPM' },
        auto_play: { type: 'boolean', description: 'Start playback immediately (default: false)' },
        ...SESSION_ID_PROP,
      },
      required: ['style'],
    },
  },
  {
    name: 'generate_part',
    description:
      'Generate a single instrumental layer and append it to the current session pattern. ' +
      'role=drums takes `style` (e.g. "techno"/"house") and optional `complexity` 0-1. ' +
      'role=bass takes `key` (e.g. "C") + `style`. ' +
      'role=melody takes `root`/`scale` (e.g. C/minor) and optional `length` (notes). ' +
      'role=fill takes `style` and optional `bars`. ' +
      'Example: generate_part({ role: "drums", style: "techno", complexity: 0.7 }). ' +
      'For full compositions use compose; for rhythmic patterns use generate_rhythm; for music-theory queries use music_theory.',
    inputSchema: {
      type: 'object',
      properties: {
        role: { type: 'string', enum: ['drums', 'bass', 'melody', 'fill'], description: 'Which part to generate' },
        style: { type: 'string', description: 'role=drums/bass/fill: musical style' },
        complexity: { type: 'number', description: 'role=drums: complexity 0-1 (default 0.5)' },
        key: { type: 'string', description: 'role=bass: musical key' },
        root: { type: 'string', description: 'role=melody: root note' },
        scale: { type: 'string', description: 'role=melody: scale name' },
        length: { type: 'number', description: 'role=melody: number of notes (default 8)' },
        bars: { type: 'number', description: 'role=fill: number of bars (default 1)' },
        ...SESSION_ID_PROP,
      },
      required: ['role'],
    },
  },
  {
    name: 'generate_drums',
    description: '[DEPRECATED — use generate_part({ role: "drums" }) instead] Generate drum pattern',
    inputSchema: {
      type: 'object',
      properties: {
        style: { type: 'string', description: 'Drum style' },
        complexity: { type: 'number', description: 'Complexity (0-1)' },
        ...SESSION_ID_PROP,
      },
      required: ['style'],
    },
  },
  {
    name: 'generate_bassline',
    description: '[DEPRECATED — use generate_part({ role: "bass" }) instead] Generate bassline',
    inputSchema: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'Musical key' },
        style: { type: 'string', description: 'Bass style' },
        ...SESSION_ID_PROP,
      },
      required: ['key', 'style'],
    },
  },
  {
    name: 'generate_melody',
    description: '[DEPRECATED — use generate_part({ role: "melody" }) instead] Generate melody from scale',
    inputSchema: {
      type: 'object',
      properties: {
        scale: { type: 'string', description: 'Scale name' },
        root: { type: 'string', description: 'Root note' },
        length: { type: 'number', description: 'Number of notes' },
        ...SESSION_ID_PROP,
      },
      required: ['scale', 'root'],
    },
  },
  {
    name: 'music_theory',
    description:
      'Music-theory queries. ' +
      'query=scale returns the notes of a scale (e.g. "C major scale: C, D, E, F, G, A, B"). ' +
      'query=chord_progression returns a chord progression for the key/style AND writes the resulting chord pattern into the current session (matches the pre-consolidation behaviour of generate_chord_progression). ' +
      'Example: music_theory({ query: "scale", root: "C", scale: "major" }). ' +
      'For pattern generation (drums/bass/melody) use generate_part; for rhythmic patterns use generate_rhythm.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', enum: ['scale', 'chord_progression'], description: 'Which theory query' },
        root: { type: 'string', description: 'Root note (query=scale; also used as key for chord_progression)' },
        scale: { type: 'string', description: 'Scale type (query=scale)' },
        key: { type: 'string', description: 'Key (query=chord_progression)' },
        style: { type: 'string', description: 'Style (query=chord_progression: pop/jazz/blues/etc)' },
        ...SESSION_ID_PROP,
      },
      required: ['query'],
    },
  },
  {
    name: 'generate_scale',
    description: '[DEPRECATED — use music_theory({ query: "scale" }) instead] Generate scale notes',
    inputSchema: {
      type: 'object',
      properties: {
        root: { type: 'string', description: 'Root note' },
        scale: { type: 'string', description: 'Scale type' },
      },
      required: ['root', 'scale'],
    },
  },
  {
    name: 'generate_chord_progression',
    description: '[DEPRECATED — use music_theory({ query: "chord_progression" }) instead] Generate chord progression',
    inputSchema: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'Key' },
        style: { type: 'string', description: 'Style (pop/jazz/blues/etc)' },
        ...SESSION_ID_PROP,
      },
      required: ['key', 'style'],
    },
  },
  {
    name: 'generate_rhythm',
    description:
      'Generate a rhythmic pattern and append it to the current session. ' +
      'type=euclidean produces a Euclidean rhythm with `hits` evenly distributed across `steps` (optional `sound` param, default "bd"). ' +
      'type=polyrhythm overlays multiple sound layers with given pattern numbers. ' +
      'Example: generate_rhythm({ type: "euclidean", hits: 3, steps: 8, sound: "hh" }). ' +
      'For complete patterns (drums/bass/melody) use generate_part; for whole compositions use compose.',
    inputSchema: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['euclidean', 'polyrhythm'], description: 'Rhythm type' },
        hits: { type: 'number', description: 'type=euclidean: hits count' },
        steps: { type: 'number', description: 'type=euclidean: total steps' },
        sound: { type: 'string', description: 'type=euclidean: sound to use (default bd)' },
        sounds: { type: 'array', items: { type: 'string' }, description: 'type=polyrhythm: sounds per layer' },
        patterns: { type: 'array', items: { type: 'number' }, description: 'type=polyrhythm: pattern numbers per layer' },
        ...SESSION_ID_PROP,
      },
      required: ['type'],
    },
  },
  {
    name: 'generate_euclidean',
    description: '[DEPRECATED — use generate_rhythm({ type: "euclidean" }) instead] Generate Euclidean rhythm',
    inputSchema: {
      type: 'object',
      properties: {
        hits: { type: 'number', description: 'Number of hits' },
        steps: { type: 'number', description: 'Total steps' },
        sound: { type: 'string', description: 'Sound to use' },
        ...SESSION_ID_PROP,
      },
      required: ['hits', 'steps'],
    },
  },
  {
    name: 'generate_polyrhythm',
    description: '[DEPRECATED — use generate_rhythm({ type: "polyrhythm" }) instead] Generate polyrhythm',
    inputSchema: {
      type: 'object',
      properties: {
        sounds: { type: 'array', items: { type: 'string' }, description: 'Sounds to use' },
        patterns: { type: 'array', items: { type: 'number' }, description: 'Pattern numbers' },
        ...SESSION_ID_PROP,
      },
      required: ['sounds', 'patterns'],
    },
  },
  {
    name: 'generate_fill',
    description: '[DEPRECATED — use generate_part({ role: "fill" }) instead] Generate drum fill',
    inputSchema: {
      type: 'object',
      properties: {
        style: { type: 'string', description: 'Fill style' },
        bars: { type: 'number', description: 'Number of bars' },
        ...SESSION_ID_PROP,
      },
      required: ['style'],
    },
  },
];

export const toolNames = new Set(tools.map(t => t.name));

async function appendOrSet(generated: string, ctx: ToolContext, sessionId?: string): Promise<void> {
  const current = await ctx.getCurrentPatternSafe(sessionId);
  const combined = current ? current + '\n' + generated : generated;
  await ctx.writePatternSafe(combined, sessionId);
}

function doScale(args: any, ctx: ToolContext): string {
  InputValidator.validateRootNote(args.root);
  InputValidator.validateScaleName(args.scale);
  const notes = ctx.theory.generateScale(args.root, args.scale);
  return `${args.root} ${args.scale} scale: ${notes.join(', ')}`;
}

async function doChordProgression(args: any, ctx: ToolContext, sid?: string): Promise<string> {
  InputValidator.validateRootNote(args.key);
  InputValidator.validateChordStyle(args.style);
  const progression = ctx.theory.generateChordProgression(args.key, args.style);
  const chordPattern = ctx.generator.generateChords(progression);
  await appendOrSet(chordPattern, ctx, sid);
  return `Generated ${args.style} progression in ${args.key}: ${progression}`;
}

async function doEuclidean(args: any, ctx: ToolContext, sid?: string): Promise<string> {
  InputValidator.validateEuclidean(args.hits, args.steps);
  if (args.sound) InputValidator.validateStringLength(args.sound, 'sound', 100, false);
  const euclidean = ctx.generator.generateEuclideanPattern(args.hits, args.steps, args.sound || 'bd');
  await appendOrSet(euclidean, ctx, sid);
  return `Generated Euclidean rhythm (${args.hits}/${args.steps})`;
}

async function doPolyrhythm(args: any, ctx: ToolContext, sid?: string): Promise<string> {
  args.sounds.forEach((s: string) => InputValidator.validateStringLength(s, 'sound', 100, false));
  args.patterns.forEach((p: number) => InputValidator.validatePositiveInteger(p, 'pattern'));
  const poly = ctx.generator.generatePolyrhythm(args.sounds, args.patterns);
  await appendOrSet(poly, ctx, sid);
  return 'Generated polyrhythm';
}

async function doDrums(args: any, ctx: ToolContext, sid?: string): Promise<string> {
  InputValidator.validateStringLength(args.style, 'style', 100, false);
  if (args.complexity !== undefined) InputValidator.validateNormalizedValue(args.complexity, 'complexity');
  const drums = ctx.generator.generateDrumPattern(args.style, args.complexity || 0.5);
  await appendOrSet(drums, ctx, sid);
  return `Generated ${args.style} drums`;
}

async function doBassline(args: any, ctx: ToolContext, sid?: string): Promise<string> {
  InputValidator.validateRootNote(args.key);
  InputValidator.validateStringLength(args.style, 'style', 100, false);
  const bass = ctx.generator.generateBassline(args.key, args.style);
  await appendOrSet(bass, ctx, sid);
  return `Generated ${args.style} bassline in ${args.key}`;
}

async function doMelody(args: any, ctx: ToolContext, sid?: string): Promise<string> {
  InputValidator.validateRootNote(args.root);
  InputValidator.validateScaleName(args.scale);
  if (args.length !== undefined) InputValidator.validatePositiveInteger(args.length, 'length');
  const scale = ctx.theory.generateScale(args.root, args.scale);
  const melody = ctx.generator.generateMelody(scale, args.length || 8);
  await appendOrSet(melody, ctx, sid);
  return `Generated melody in ${args.root} ${args.scale}`;
}

async function doFill(args: any, ctx: ToolContext, sid?: string): Promise<string> {
  InputValidator.validateStringLength(args.style, 'style', 100, false);
  if (args.bars !== undefined) InputValidator.validatePositiveInteger(args.bars, 'bars');
  const fill = ctx.generator.generateFill(args.style, args.bars || 1);
  await appendOrSet(fill, ctx, sid);
  return `Generated ${args.bars || 1} bar fill`;
}

export async function execute(name: string, args: any, ctx: ToolContext): Promise<unknown> {
  const sid: string | undefined = args?.session_id;
  switch (name) {
    case 'generate_pattern': {
      InputValidator.validateStringLength(args.style, 'style', 100, false);
      if (args.key) InputValidator.validateRootNote(args.key);
      if (args.bpm !== undefined) InputValidator.validateBPM(args.bpm);

      const generated = ctx.generator.generateCompletePattern(
        args.style,
        args.key || 'C',
        args.bpm || 120,
      );
      await ctx.writePatternSafe(generated, sid);

      if (args.auto_play && (sid || ctx.isInitialized())) {
        await ctx.getController(sid).play();
        return `Generated ${args.style} pattern. Playing.`;
      }
      return `Generated ${args.style} pattern`;
    }

    case 'generate_part': {
      const role = args?.role;
      switch (role) {
        case 'drums':  return await doDrums(args, ctx, sid);
        case 'bass':   return await doBassline(args, ctx, sid);
        case 'melody': return await doMelody(args, ctx, sid);
        case 'fill':   return await doFill(args, ctx, sid);
        default:
          throw new Error(`Invalid role: ${role}. Must be one of: drums, bass, melody, fill`);
      }
    }
    case 'generate_drums':    return await doDrums(args, ctx, sid);
    case 'generate_bassline': return await doBassline(args, ctx, sid);
    case 'generate_melody':   return await doMelody(args, ctx, sid);

    case 'music_theory': {
      const q = args?.query;
      if (q !== 'scale' && q !== 'chord_progression') {
        throw new Error(`Invalid query: ${q}. Must be one of: scale, chord_progression`);
      }
      return q === 'scale' ? doScale(args, ctx) : await doChordProgression(args, ctx, sid);
    }
    case 'generate_scale':              return doScale(args, ctx);
    case 'generate_chord_progression':  return await doChordProgression(args, ctx, sid);

    case 'generate_rhythm': {
      const t = args?.type;
      if (t !== 'euclidean' && t !== 'polyrhythm') {
        throw new Error(`Invalid type: ${t}. Must be one of: euclidean, polyrhythm`);
      }
      return t === 'euclidean'
        ? await doEuclidean(args, ctx, sid)
        : await doPolyrhythm(args, ctx, sid);
    }
    case 'generate_euclidean':   return await doEuclidean(args, ctx, sid);
    case 'generate_polyrhythm':  return await doPolyrhythm(args, ctx, sid);

    case 'generate_fill': return await doFill(args, ctx, sid);

    default:
      throw new Error(`generate module does not handle tool: ${name}`);
  }
}

export const generateModule: ToolModule = { tools, toolNames, execute };
