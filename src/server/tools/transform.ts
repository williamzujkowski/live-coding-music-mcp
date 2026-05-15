/**
 * transform domain — mutate the current pattern.
 *
 * Owns (4 tools):
 * - `transform` (op enum: transpose/reverse/stretch/quantize/humanize/
 *    swing/scale/vary)
 * - `effect` (action enum: add/remove)
 * - `shape` (dimension enum: mood/energy/refine)
 * - `set_tempo` — high-traffic standalone verb
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { ToolContext, ToolModule } from './types.js';
import { InputValidator } from '../../utils/InputValidator.js';

interface EnergyConfig {
  tempoAdjust: number;
  roomAmount: number;
  densityAdjust: string;
  description: string;
}

const ENERGY_LEVELS: Record<number, EnergyConfig> = {
  0: { tempoAdjust: -20, roomAmount: 0.5, densityAdjust: '.slow(4)', description: 'minimal/ambient' },
  1: { tempoAdjust: -15, roomAmount: 0.4, densityAdjust: '.slow(3)', description: 'very sparse' },
  2: { tempoAdjust: -10, roomAmount: 0.3, densityAdjust: '.slow(2)', description: 'sparse' },
  3: { tempoAdjust: -5, roomAmount: 0.2, densityAdjust: '.slow(1.5)', description: 'light' },
  4: { tempoAdjust: 0, roomAmount: 0.15, densityAdjust: '', description: 'relaxed' },
  5: { tempoAdjust: 0, roomAmount: 0.1, densityAdjust: '', description: 'normal' },
  6: { tempoAdjust: 5, roomAmount: 0.08, densityAdjust: '', description: 'moderate' },
  7: { tempoAdjust: 10, roomAmount: 0.05, densityAdjust: '.fast(1.25)', description: 'driving' },
  8: { tempoAdjust: 15, roomAmount: 0.03, densityAdjust: '.fast(1.5)', description: 'intense' },
  9: { tempoAdjust: 18, roomAmount: 0.02, densityAdjust: '.fast(1.75)', description: 'very intense' },
  10: { tempoAdjust: 20, roomAmount: 0.01, densityAdjust: '.fast(2)', description: 'maximum' },
};

interface MoodProfile {
  preferMinor: boolean;
  tempoMod: number;
  cutoffMod: number;
  roomMod: number;
  gainMod: number;
  noteShift: number;
  delayMod?: number;
}

const MOOD_PROFILES: Record<string, MoodProfile> = {
  dark: { preferMinor: true, tempoMod: -0.1, cutoffMod: -200, roomMod: 0.2, gainMod: -0.1, noteShift: -12 },
  euphoric: { preferMinor: false, tempoMod: 0.1, cutoffMod: 400, roomMod: 0.1, gainMod: 0.1, noteShift: 12 },
  melancholic: { preferMinor: true, tempoMod: -0.15, cutoffMod: -100, roomMod: 0.3, gainMod: -0.05, noteShift: 0 },
  aggressive: { preferMinor: false, tempoMod: 0.15, cutoffMod: 600, roomMod: -0.1, gainMod: 0.15, noteShift: 0 },
  dreamy: { preferMinor: false, tempoMod: -0.2, cutoffMod: -300, roomMod: 0.4, delayMod: 0.3, gainMod: -0.1, noteShift: 0 },
  peaceful: { preferMinor: false, tempoMod: -0.25, cutoffMod: -200, roomMod: 0.25, gainMod: -0.15, noteShift: 0 },
  energetic: { preferMinor: false, tempoMod: 0.2, cutoffMod: 300, roomMod: 0, gainMod: 0.1, noteShift: 0 },
};

function transposePattern(pattern: string, semitones: number): string {
  return pattern.replace(/([a-g][#b]?)(\d)/gi, (_match, note: string, octave: string) => {
    const noteMap: Record<string, number> = {
      'c': 0, 'c#': 1, 'd': 2, 'd#': 3, 'e': 4, 'f': 5,
      'f#': 6, 'g': 7, 'g#': 8, 'a': 9, 'a#': 10, 'b': 11,
    };
    const currentNote = note.toLowerCase();
    const noteValue = noteMap[currentNote] || 0;
    const newNoteValue = (noteValue + semitones + 12) % 12;
    const noteNames = ['c', 'c#', 'd', 'd#', 'e', 'f', 'f#', 'g', 'g#', 'a', 'a#', 'b'];
    const newOctave = parseInt(octave) + Math.floor((noteValue + semitones) / 12);
    return noteNames[newNoteValue] + newOctave;
  });
}

const SESSION_ID_PROP = {
  session_id: {
    type: 'string',
    description: 'Optional session ID (#108). Omit to use default session.',
  },
};

export const tools: Tool[] = [
  {
    name: 'transform',
    description:
      'Apply a single transform op to the current session pattern. ' +
      'op=transpose shifts notes by `semitones`. ' +
      'op=reverse appends `.rev` to the pattern. ' +
      'op=stretch slows by `factor` (>1 slower, <1 faster). ' +
      'op=quantize snaps to the `grid` (e.g. "1/16"). ' +
      'op=humanize adds rand-nudge timing of `amount` (0-1). ' +
      'op=swing applies `.swing(amount)`. ' +
      'op=scale applies a `root`/`scale` filter to notes. ' +
      'op=vary returns a variation of `type` (subtle/moderate/extreme/glitch/evolving). ' +
      'Example: transform({ op: "transpose", semitones: 7 }). ' +
      'For effects (add/remove) use effect; for mood/energy/refine use shape; for tempo use set_tempo.',
    inputSchema: {
      type: 'object',
      properties: {
        op: {
          type: 'string',
          enum: ['transpose', 'reverse', 'stretch', 'quantize', 'humanize', 'swing', 'scale', 'vary'],
          description: 'Which transform to apply',
        },
        semitones: { type: 'number', description: 'op=transpose: integer semitones to shift' },
        factor: { type: 'number', description: 'op=stretch: stretch factor' },
        grid: { type: 'string', description: 'op=quantize: grid size (e.g. "1/16")' },
        amount: { type: 'number', description: 'op=humanize/swing: amount 0-1' },
        root: { type: 'string', description: 'op=scale: root note (e.g. "C")' },
        scale: { type: 'string', description: 'op=scale: scale name (e.g. "minor")' },
        type: { type: 'string', description: 'op=vary: variation type (subtle/moderate/extreme/glitch/evolving)' },
        ...SESSION_ID_PROP,
      },
      required: ['op'],
    },
  },
  {
    name: 'effect',
    description:
      'Add or remove a Strudel effect on the current session pattern. ' +
      'action=add appends `.<effect>(<params>)`. ' +
      'action=remove strips the last `.<effect>(...)` call from the pattern. ' +
      'Example: effect({ action: "add", effect: "lpf", params: "1000" }). ' +
      'For higher-level effect bundles (mood/energy/refine) use shape; for raw transforms use transform.',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['add', 'remove'], description: 'add or remove the effect' },
        effect: { type: 'string', description: 'Effect name (e.g. lpf, room, delay)' },
        params: { type: 'string', description: 'Effect parameters (action=add only)' },
        ...SESSION_ID_PROP,
      },
      required: ['action', 'effect'],
    },
  },
  {
    name: 'set_tempo',
    description: 'Set BPM',
    inputSchema: {
      type: 'object',
      properties: { bpm: { type: 'number', description: 'Tempo in BPM' }, ...SESSION_ID_PROP },
      required: ['bpm'],
    },
  },
  {
    name: 'shape',
    description:
      'Shape the current pattern along one of three high-level dimensions. ' +
      'dimension=mood applies a mood profile (dark/euphoric/melancholic/aggressive/dreamy/peaceful/energetic) with optional intensity 0-1. ' +
      'dimension=energy applies an energy level (integer 0-10). ' +
      'dimension=refine applies a directional refinement: faster/slower/louder/quieter/brighter/darker/"more reverb"/drier. ' +
      'All three auto-play by default. ' +
      'Example: shape({ dimension: "mood", target_mood: "dark", intensity: 0.8 }). ' +
      'For raw transform ops use transform; for explicit effects use effect.',
    inputSchema: {
      type: 'object',
      properties: {
        dimension: { type: 'string', enum: ['mood', 'energy', 'refine'], description: 'Which dimension to shape along' },
        target_mood: {
          type: 'string',
          enum: ['dark', 'euphoric', 'melancholic', 'aggressive', 'dreamy', 'peaceful', 'energetic'],
          description: 'dimension=mood: target mood',
        },
        intensity: { type: 'number', minimum: 0, maximum: 1, description: 'dimension=mood: intensity 0-1 (default 0.5)' },
        level: { type: 'number', description: 'dimension=energy: integer level 0-10' },
        direction: { type: 'string', description: 'dimension=refine: faster, slower, louder, quieter, brighter, darker, "more reverb", drier' },
        auto_play: { type: 'boolean', description: 'Start playback after shape (default true)' },
        ...SESSION_ID_PROP,
      },
      required: ['dimension'],
    },
  },
];

export const toolNames = new Set(tools.map(t => t.name));

// ---- per-op helpers (shared by transform({op}) and the deprecated aliases)

async function opTranspose(args: any, ctx: ToolContext, sid?: string): Promise<unknown> {
  if (typeof args.semitones !== 'number' || !Number.isInteger(args.semitones)) {
    throw new Error('Semitones must be an integer');
  }
  const p = await ctx.getCurrentPatternSafe(sid);
  await ctx.writePatternSafe(transposePattern(p, args.semitones), sid);
  return `Transposed ${args.semitones} semitones`;
}

async function opReverse(ctx: ToolContext, sid?: string): Promise<unknown> {
  const p = await ctx.getCurrentPatternSafe(sid);
  await ctx.writePatternSafe(p + '.rev', sid);
  return 'Pattern reversed';
}

async function opStretch(args: any, ctx: ToolContext, sid?: string): Promise<unknown> {
  InputValidator.validateGain(args.factor);
  const p = await ctx.getCurrentPatternSafe(sid);
  await ctx.writePatternSafe(p + `.slow(${args.factor})`, sid);
  return `Stretched by factor of ${args.factor}`;
}

async function opQuantize(args: any, ctx: ToolContext, sid?: string): Promise<unknown> {
  InputValidator.validateStringLength(args.grid, 'grid', 50, false);
  const p = await ctx.getCurrentPatternSafe(sid);
  await ctx.writePatternSafe(p + `.struct("${args.grid}")`, sid);
  return `Quantized to ${args.grid} grid`;
}

async function opHumanize(args: any, ctx: ToolContext, sid?: string): Promise<unknown> {
  if (args.amount !== undefined) InputValidator.validateNormalizedValue(args.amount, 'amount');
  const p = await ctx.getCurrentPatternSafe(sid);
  const amt = args.amount || 0.01;
  await ctx.writePatternSafe(p + `.nudge(rand.range(-${amt}, ${amt}))`, sid);
  return 'Added human timing';
}

async function opVary(args: any, ctx: ToolContext, sid?: string): Promise<unknown> {
  const p = await ctx.getCurrentPatternSafe(sid);
  const varied = ctx.generator.generateVariation(p, args.type || 'subtle');
  await ctx.writePatternSafe(varied, sid);
  return `Added ${args.type || 'subtle'} variation`;
}

async function opSwing(args: any, ctx: ToolContext, sid?: string): Promise<unknown> {
  InputValidator.validateNormalizedValue(args.amount, 'amount');
  const p = await ctx.getCurrentPatternSafe(sid);
  await ctx.writePatternSafe(p + `.swing(${args.amount})`, sid);
  return `Added swing: ${args.amount}`;
}

async function opScale(args: any, ctx: ToolContext, sid?: string): Promise<unknown> {
  InputValidator.validateStringLength(args.scale, 'scale', 50, false);
  InputValidator.validateRootNote(args.root);
  const p = await ctx.getCurrentPatternSafe(sid);
  await ctx.writePatternSafe(p + `.scale("${args.root}:${args.scale}")`, sid);
  return `Applied ${args.root} ${args.scale} scale`;
}

async function opEffectAdd(args: any, ctx: ToolContext, sid?: string): Promise<unknown> {
  InputValidator.validateStringLength(args.effect, 'effect', 100, false);
  if (args.params) InputValidator.validateStringLength(args.params, 'params', 1000, true);
  const p = await ctx.getCurrentPatternSafe(sid);
  const withEffect = args.params
    ? p + `.${args.effect}(${args.params})`
    : p + `.${args.effect}()`;
  await ctx.writePatternSafe(withEffect, sid);
  return `Added ${args.effect} effect`;
}

async function opEffectRemove(args: any, ctx: ToolContext, sid?: string): Promise<unknown> {
  InputValidator.validateStringLength(args.effect, 'effect', 100, false);
  const p = await ctx.getCurrentPatternSafe(sid);
  const regex = new RegExp(`\\.${args.effect}\\([^)]*\\)`, 'g');
  const stripped = p.replace(regex, '');
  if (stripped === p) return `No ${args.effect} effect found to remove`;
  await ctx.writePatternSafe(stripped, sid);
  return `Removed ${args.effect} effect`;
}

export async function execute(name: string, args: any, ctx: ToolContext): Promise<unknown> {
  const sid: string | undefined = args?.session_id;
  if (!sid && !ctx.isInitialized()) {
    return 'Browser not initialized. Run init first.';
  }
  switch (name) {
    case 'transform': {
      const op = args?.op;
      switch (op) {
        case 'transpose': return await opTranspose(args, ctx, sid);
        case 'reverse':   return await opReverse(ctx, sid);
        case 'stretch':   return await opStretch(args, ctx, sid);
        case 'quantize':  return await opQuantize(args, ctx, sid);
        case 'humanize':  return await opHumanize(args, ctx, sid);
        case 'swing':     return await opSwing(args, ctx, sid);
        case 'scale':     return await opScale(args, ctx, sid);
        case 'vary':      return await opVary(args, ctx, sid);
        default:
          throw new Error(`Invalid op: ${op}. Must be one of: transpose, reverse, stretch, quantize, humanize, swing, scale, vary`);
      }
    }

    case 'effect': {
      const a = args?.action;
      if (a !== 'add' && a !== 'remove') {
        throw new Error(`Invalid action: ${a}. Must be one of: add, remove`);
      }
      return a === 'add'
        ? await opEffectAdd(args, ctx, sid)
        : await opEffectRemove(args, ctx, sid);
    }

    case 'set_tempo': {
      InputValidator.validateBPM(args.bpm);
      const p = await ctx.getCurrentPatternSafe(sid);
      await ctx.writePatternSafe(`setcpm(${args.bpm})\n${p}`, sid);
      return `Set tempo to ${args.bpm} BPM`;
    }

    case 'shape': {
      const dim = args?.dimension;
      switch (dim) {
        case 'mood':   return await shiftMood(args, ctx, sid);
        case 'energy': return await setEnergyLevel(args.level, ctx, sid);
        case 'refine': return await refinePattern(args.direction, ctx, sid);
        default:
          throw new Error(`Invalid dimension: ${dim}. Must be one of: mood, energy, refine`);
      }
    }

    default:
      throw new Error(`transform module does not handle tool: ${name}`);
  }
}

async function shiftMood(args: any, ctx: ToolContext, sid?: string): Promise<unknown> {
  const mood = args.target_mood?.toLowerCase()?.trim();
  const profile = MOOD_PROFILES[mood];
  if (!profile) {
    return {
      success: false,
      error: `Unknown mood: ${args.target_mood}. Valid moods: ${Object.keys(MOOD_PROFILES).join(', ')}.`,
    };
  }

  const pattern = await ctx.getCurrentPatternSafe(sid);
  if (!pattern || pattern.trim().length === 0) {
    return { success: false, error: 'No pattern to transform. Write a pattern first.' };
  }

  const intensity = args.intensity ?? 0.5;
  if (intensity < 0 || intensity > 1) {
    return { success: false, error: 'Intensity must be between 0 and 1.' };
  }

  const applied: string[] = [];
  let result = pattern;

  if (profile.tempoMod !== 0) {
    const adjust = 1 + (profile.tempoMod * intensity);
    if (adjust > 1) {
      result += `.fast(${adjust.toFixed(2)})`;
      applied.push(`tempo +${Math.round(profile.tempoMod * 100 * intensity)}%`);
    } else {
      result += `.slow(${(1 / adjust).toFixed(2)})`;
      applied.push(`tempo ${Math.round(profile.tempoMod * 100 * intensity)}%`);
    }
  }

  if (profile.cutoffMod !== 0) {
    const base = 1000;
    const cutoff = Math.max(200, base + (profile.cutoffMod * intensity));
    result += `.lpf(${Math.round(cutoff)})`;
    applied.push(`cutoff ${profile.cutoffMod > 0 ? '+' : ''}${Math.round(profile.cutoffMod * intensity)}Hz`);
  }

  if (profile.roomMod !== 0) {
    const room = Math.max(0, Math.min(1, profile.roomMod * intensity));
    result += `.room(${room.toFixed(2)})`;
    applied.push(`reverb ${room.toFixed(2)}`);
  }

  if (profile.delayMod && profile.delayMod > 0) {
    const d = profile.delayMod * intensity;
    result += `.delay(${d.toFixed(2)})`;
    applied.push(`delay ${d.toFixed(2)}`);
  }

  if (profile.gainMod !== 0) {
    const g = 1 + (profile.gainMod * intensity);
    result += `.gain(${g.toFixed(2)})`;
    applied.push(`gain ${profile.gainMod > 0 ? '+' : ''}${Math.round(profile.gainMod * 100 * intensity)}%`);
  }

  await ctx.writePatternSafe(result, sid);

  if (args.auto_play !== false && (sid || ctx.isInitialized())) {
    await ctx.getController(sid).play();
  }

  return { success: true, target_mood: mood, intensity, applied_effects: applied };
}

async function setEnergyLevel(level: number, ctx: ToolContext, sid?: string): Promise<unknown> {
  if (level < 0 || level > 10 || !Number.isInteger(level)) {
    return { success: false, error: 'Energy level must be an integer from 0 to 10.' };
  }

  const pattern = await ctx.getCurrentPatternSafe(sid);
  if (!pattern || pattern.trim().length === 0) {
    return { success: false, error: 'No pattern to adjust. Write a pattern first.' };
  }

  const config = ENERGY_LEVELS[level];
  let result = pattern;
  if (config.densityAdjust) result += config.densityAdjust;
  result += `.room(${config.roomAmount})`;

  await ctx.writePatternSafe(result, sid);
  if (sid || ctx.isInitialized()) await ctx.getController(sid).play();

  return { success: true, level, description: config.description };
}

async function refinePattern(direction: string, ctx: ToolContext, sid?: string): Promise<unknown> {
  const pattern = await ctx.getCurrentPatternSafe(sid);
  if (!pattern || pattern.trim().length === 0) {
    return { success: false, error: 'No pattern to refine. Write a pattern first.' };
  }

  const dir = direction.toLowerCase().trim();
  let modification = '';
  switch (dir) {
    case 'faster':      modification = '.fast(1.1)'; break;
    case 'slower':      modification = '.slow(1.1)'; break;
    case 'louder':      modification = '.gain(1.1)'; break;
    case 'quieter':     modification = '.gain(0.9)'; break;
    case 'brighter':    modification = '.lpf(2000)'; break;
    case 'darker':      modification = '.lpf(800)';  break;
    case 'more reverb': modification = '.room(0.5)'; break;
    case 'drier':       modification = '.room(0.1)'; break;
    default:
      return {
        success: false,
        error: `Unknown refinement direction: ${direction}. Supported: faster, slower, louder, quieter, brighter, darker, "more reverb", drier.`,
      };
  }

  await ctx.writePatternSafe(pattern + modification, sid);
  if (sid || ctx.isInitialized()) await ctx.getController(sid).play();

  return { success: true, direction: dir, applied: modification };
}

export const transformModule: ToolModule = { tools, toolNames, execute };
