/**
 * ai domain — AI-powered feedback, pattern suggestion, and jamming.
 *
 * Owns one consolidated tool (`ai_assist(task=feedback|suggest|jam)`) —
 * all three tasks share Gemini's rate limiting and auth.
 *
 * The `jam` task carries six private helpers that analyze the current
 * pattern (tempo/key/style detection, layer detection, merge logic)
 * and that are used only here. They live in this module.
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { ToolContext, ToolModule } from './types.js';
import { empty, err, withStashField } from './types.js';
import type { ErrEnvelope } from './types.js';
import { AiRateLimitError } from '../../services/ai/AiTransport.js';
import type { CreativeFeedback, AudioFeedback } from '../../services/GeminiService.js';
import type { AudioMeasurements } from '../../services/ai/AudioMeasurements.js';
import { Logger } from '../../utils/Logger.js';
import { lookup } from '../../utils/TableLookup.js';
import { declaredBpm } from '../../utils/Tempo.js';


const logger = new Logger();

const SESSION_ID_PROP = {
  session_id: {
    type: 'string',
    description: 'Optional session ID (#108). Omit to use default session.',
  },
};

export const tools: Tool[] = [
  {
    name: 'ai_assist',
    description:
      'Gemini-backed pattern assistance. ' +
      'task=feedback returns creative critique on the current pattern (optionally with audio analysis). ' +
      'task=suggest analyzes the currently playing audio and suggests a complementary Strudel pattern as text (not auto-executed). ' +
      'task=jam generates a fresh layer (drums/bass/melody/pad/texture) and merges it into the current pattern, then auto-plays. ' +
      'All three share Gemini auth + rate limiting. ' +
      'Example: ai_assist({ task: "jam", layer: "bass" }). ' +
      'Requires GEMINI_API_KEY env var. For non-AI pattern generation use generate_part; for full compositions use compose.',
    inputSchema: {
      type: 'object',
      properties: {
        task: { type: 'string', enum: ['feedback', 'suggest', 'jam'], description: 'Which AI task' },
        // feedback args
        includeAudio: { type: 'boolean', description: 'task=feedback: include audio analysis (default false)' },
        style: { type: 'string', description: 'task=feedback/suggest: style hint' },
        // suggest args
        role: {
          type: 'string',
          enum: ['complement', 'bassline', 'melody', 'percussion'],
          description: 'task=suggest: role the suggested pattern fills (default complement)',
        },
        // jam args
        layer: {
          type: 'string',
          enum: ['drums', 'bass', 'melody', 'pad', 'texture'],
          description: 'task=jam: layer type to generate',
        },
        style_hint: { type: 'string', description: 'task=jam: style guidance' },
        auto_play: { type: 'boolean', description: 'task=jam: start playback after merge (default true)' },
        ...SESSION_ID_PROP,
      },
      required: ['task'],
    },
  },
];

export const toolNames = new Set(tools.map(t => t.name));

export async function execute(name: string, args: any, ctx: ToolContext): Promise<unknown> {
  const sid: string | undefined = args?.session_id;
  switch (name) {
    case 'ai_assist': {
      const t = args?.task;
      switch (t) {
        case 'feedback': return await getPatternFeedback(args?.includeAudio || false, args?.style, ctx, sid);
        case 'suggest':  return await suggestPatternFromAudio(args?.style, args?.role || 'complement', ctx, sid);
        case 'jam':      return await jamWith(args.layer, args.style_hint, args.auto_play, ctx, sid);
        default:
          throw new Error(`Invalid task: ${t}. Must be one of: feedback, suggest, jam`);
      }
    }

    default:
      throw new Error(`ai module does not handle tool: ${name}`);
  }
}

// ---------------------------------------------------------------------------
// get_pattern_feedback
// ---------------------------------------------------------------------------

async function getPatternFeedback(
  includeAudio: boolean,
  style: string | undefined,
  ctx: ToolContext,
  sid?: string,
// Returns an envelope for a rate limit rather than a FeedbackResult:
// that is the one failure here a caller can act on by waiting, and the
// envelope is how retryability is expressed (#392).
): Promise<FeedbackResult | ErrEnvelope> {
  if (!ctx.geminiService.isAvailable()) {
    return {
      gemini_available: false,
      error: 'Gemini API not configured. Set GEMINI_API_KEY environment variable to enable AI feedback.',
    };
  }

  const pattern = await ctx.getCurrentPatternSafe(sid);
  if (!pattern || pattern.trim().length === 0) {
    return { gemini_available: true, error: 'No pattern to analyze. Write a pattern first.' };
  }

  const result: FeedbackResult = { gemini_available: true };

  try {
    result.pattern_analysis = await ctx.geminiService.getCreativeFeedback(pattern);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('Pattern feedback failed', { error: message });
    // By type, not by phrase. `AiRateLimitError` is what the limiter
    // throws; matching the words meant a reworded message would fall
    // through to "Pattern analysis failed" and lose the one thing a
    // caller can act on — that waiting works (#380, #392).
    if (error instanceof AiRateLimitError) {
      return err('transient', message, { isRetryable: true });
    }
    result.error = `Pattern analysis failed: ${message}`;
  }

  if (includeAudio && (sid || ctx.isInitialized())) {
    try {
      const sample = await captureAudioSampleForFeedback(ctx, sid);
      if (sample === null) {
        logger.warn('Audio capture returned no data');
        if (!result.error) result.error = 'Audio capture returned no data.';
      } else if (sample.silent) {
        // Sending silence to Gemini does not fail — it returns a confident
        // mood/style/energy for audio that is not there. Feedback silently
        // decoupled from the audio is worse than no feedback, so refuse.
        result.audio_analysis_skipped =
          'Captured audio was silent, so no feedback was requested. ' +
          'Is a pattern playing? Call playback({ action: "play" }) first.';
        logger.warn('Skipping Gemini audio analysis: capture was silent', {
          peak: sample.peak,
        });
      } else {
        // Measurements, not the waveform. Every installed CLI answers
        // "CANNOT DECODE AUDIO", and agy will confabulate detailed
        // analysis of audio it never examined rather than admit it.
        result.audio_analysis = await ctx.geminiService.analyzeAudioMeasurements(
          sample.measurements,
          pattern,
          { style, duration: FEEDBACK_SAMPLE_MS / 1000 },
        );
        result.audio_levels = { peak: sample.peak, rms: sample.rms };
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('Audio analysis failed', { error: message });
      if (!result.error) result.error = `Audio analysis failed: ${message}`;
    }
  } else if (includeAudio && !ctx.isInitialized()) {
    if (!result.error) {
      result.error = 'Audio analysis requires browser initialization. Run init first or set includeAudio to false.';
    }
  }

  return result;
}

/** What `ai_assist({ task: "feedback" })` returns. */
interface FeedbackResult {
  pattern_analysis?: CreativeFeedback;
  audio_analysis?: AudioFeedback;
  /** Set when audio feedback was deliberately not requested (e.g. silence). */
  audio_analysis_skipped?: string;
  /** Measured level of the analysed sample, so the caller can judge it. */
  audio_levels?: { peak?: number; rms?: number };
  error?: string;
  gemini_available: boolean;
}

/** Seconds of audio sent to Gemini for feedback. */
const FEEDBACK_SAMPLE_MS = 5000;

/** A captured sample plus the level measurements taken while decoding it. */
interface AudioSample {
  /** What was measured locally — this is what the model actually sees. */
  measurements: AudioMeasurements;
  peak?: number;
  rms?: number;
  /** True when the capture recorded nothing audible. */
  silent: boolean;
}

/**
 * Captures a brief audio sample for Gemini analysis. Different from the
 * `capture_audio_sample` tool — this one connects directly to the
 * analyzer's AudioContext and records 5 seconds without disturbing
 * the full AudioCaptureService lifecycle.
 */
async function captureAudioSampleForFeedback(
  ctx: ToolContext,
  sid?: string,
): Promise<AudioSample | null> {
  const page = ctx.getController(sid).page;
  if (!page) {
    logger.warn('Cannot capture audio: controller page not available');
    return null;
  }

  // Ensures the recorder is injected for this session before exporting.
  await ctx.getAudioCaptureService(sid);

  const result = await ctx.audioExportService.exportAudio(page, {
    duration: FEEDBACK_SAMPLE_MS,
    format: 'wav',
    output: 'base64',
  });

  if (!result.success || result.audio === undefined) {
    logger.warn('Audio capture returned no data', { error: result.error });
    return null;
  }

  // The bytes are deliberately discarded. No model in play can decode
  // audio, so what gets sent is the measurement set, not the waveform.
  return {
    measurements: {
      durationMs: result.duration,
      peak: result.peak,
      rms: result.rms,
      sampleRate: result.sampleRate,
      channels: result.channels,
    },
    peak: result.peak,
    rms: result.rms,
    silent: result.silent === true,
  };
}

// ---------------------------------------------------------------------------
// suggest_pattern_from_audio
// ---------------------------------------------------------------------------

async function suggestPatternFromAudio(
  style: string | undefined,
  role: string,
  ctx: ToolContext,
  sid?: string,
): Promise<unknown> {
  if (!sid && !ctx.isInitialized()) {
    return { error: 'Browser not initialized. Run init and play a pattern first.' };
  }
  if (!ctx.geminiService.isAvailable()) {
    return { error: 'Gemini API not configured. Set GEMINI_API_KEY to enable AI features.' };
  }
  const controller = ctx.getController(sid);

  let bpm = 0, key = 'C', scale = 'major';
  try {
    const tempoResult = await controller.detectTempo();
    if (tempoResult && tempoResult.bpm > 0) bpm = tempoResult.bpm;
  } catch { /* best effort */ }

  try {
    const keyResult = await controller.detectKey();
    if (keyResult && keyResult.confidence > 0.1) {
      key = keyResult.key;
      scale = keyResult.scale;
    }
  } catch { /* best effort */ }

  const roleDesc: Record<string, string> = {
    complement: 'a complementary layer that fills sonic gaps',
    bassline: 'a bassline that grooves with the rhythm',
    melody: 'a melodic line that harmonizes with the key',
    percussion: 'a percussion layer that adds rhythmic interest',
  };
  const roleText = lookup(roleDesc, role, roleDesc['complement']);
  const styleText = style ? ` in a ${style} style` : '';
  const tempoText = bpm > 0 ? `Detected tempo: ${bpm} BPM. ` : '';
  const keyText = `Detected key: ${key} ${scale}. `;

  const prompt = `You are a Strudel.cc live coding expert. Generate ${roleText}${styleText} for an existing pattern.

${tempoText}${keyText}

Generate ONLY valid Strudel.cc pattern code. Use functions like s(), note(), n(), .speed(), .gain(), .lpf(), .delay(), .room(), .pan(). Respond with ONLY the pattern code, no explanation.

Example patterns:
- Bass: note("c2 eb2 g2 bb2").s("sawtooth").lpf(800).gain(0.6)
- Melody: note("c4 e4 g4 c5").s("triangle").delay(0.3).room(0.4)
- Drums: s("bd*4, ~ sd ~ sd, hh*8").gain(0.7)
- Ambient: note("c3 e3 g3").s("sine").room(0.8).delay(0.5).gain(0.3)`;

  try {
    const geminiResponse = await ctx.geminiService.suggestVariations(prompt, style);
    if (!geminiResponse || geminiResponse.length === 0) {
      // The model answered; it just had nothing to offer. Returning a
      // bare `error` key made `isFailureShaped` convert this into an
      // err() envelope, so a working call was reported as a failure —
      // the same bug as #274, pointing the other way (#288).
      return empty({
        suggestions: [],
        message: 'Gemini returned no pattern suggestions.',
      });
    }
    const suggestedPattern = geminiResponse[0].code;
    const validation = await ctx.strudelEngine.validate(suggestedPattern);
    return {
      suggested_pattern: suggestedPattern,
      analysis: { bpm, key, scale },
      role,
      style: style || 'auto',
      valid: validation.valid,
      validation_errors: validation.valid ? [] : validation.errors,
      usage: 'Use edit_pattern({ mode: "write" }) to load this pattern, then playback({ action: "play" }) to hear it.',
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('Audio-to-pattern suggestion failed', { error: message });
    return { error: `Pattern suggestion failed: ${message}` };
  }
}

// ---------------------------------------------------------------------------
// jam_with
// ---------------------------------------------------------------------------

async function jamWith(
  layer: 'drums' | 'bass' | 'melody' | 'pad' | 'texture',
  styleHint: string | undefined,
  autoPlay: boolean = true,
  ctx: ToolContext,
  sid?: string,
): Promise<{
  success: boolean;
  message: string;
  layer: string;
  detected: { tempo: number; key: string; existingLayers: string[] };
  newLayer: string;
  pattern?: string;
  error?: string;
}> {
  const validLayers = ['drums', 'bass', 'melody', 'pad', 'texture'];
  if (!validLayers.includes(layer)) {
    return {
      success: false,
      message: `Invalid layer type: ${layer}. Must be one of: ${validLayers.join(', ')}`,
      layer,
      detected: { tempo: 120, key: 'C', existingLayers: [] },
      newLayer: '',
    };
  }

  const currentPattern = await ctx.getCurrentPatternSafe(sid);
  if (!currentPattern || currentPattern.trim().length === 0) {
    return {
      success: false,
      message: 'No pattern to jam with. Write a pattern first.',
      layer,
      detected: { tempo: 120, key: 'C', existingLayers: [] },
      newLayer: '',
    };
  }

  const tempo = detectTempoFromPattern(currentPattern);
  const key = detectKeyFromPattern(currentPattern);
  const existingLayers = detectExistingLayers(currentPattern);
  const detectedStyle = detectStyleFromPattern(currentPattern, styleHint);

  if (existingLayers.includes(layer) && layer !== 'texture') {
    logger.warn(`Pattern already contains ${layer} layer, adding anyway`);
  }

  let newLayer: string;
  try {
    newLayer = generateComplementaryLayer(layer, key, detectedStyle, existingLayers, ctx);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      message: `Failed to generate ${layer} layer: ${message}`,
      layer,
      detected: { tempo, key, existingLayers },
      newLayer: '',
      error: message,
    };
  }

  const mergedPattern = mergeLayerIntoPattern(currentPattern, newLayer, layer);

  try {
    const written = await ctx.writePatternSafe(mergedPattern, sid);
    if (autoPlay && (sid || ctx.isInitialized())) {
      await ctx.getController(sid).play();
    }
    return withStashField({
      success: true,
      message: `Added ${layer} layer${styleHint ? ` (${styleHint} style)` : ''} to jam with your pattern`,
      layer,
      detected: { tempo, key, existingLayers },
      newLayer,
      pattern: mergedPattern.substring(0, 300) + (mergedPattern.length > 300 ? '...' : ''),
    }, written);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      message: `Failed to write merged pattern: ${message}`,
      layer,
      detected: { tempo, key, existingLayers },
      newLayer,
      error: message,
    };
  }
}

/**
 * The tempo a pattern's author meant, for generating a layer to sit on
 * top of it.
 *
 * Uses the canonical parser rather than a regex of its own. The regex it
 * had required a bare `setcpm(<n>)`, so it matched nothing the generator
 * writes — every generated pattern is `setcpm(130/4)` — and fell through
 * to guessing from words in the text, which is how `jam_with` came to
 * read a tempo off a comment (#397).
 *
 * `declaredBpm`, not `impliedBpm`: this reads patterns written by someone
 * else, and only the number they wrote is knowable. Working out what one
 * will actually sound like takes an assumption about beats per cycle
 * that holds for what this project generates and not for an arbitrary
 * hand-written pattern.
 */
function detectTempoFromPattern(pattern: string): number {
  const declared = declaredBpm(pattern);
  if (declared !== undefined) return Math.round(declared);

  // No tempo call at all. Guessing from genre words is a poor answer,
  // but it beats silently assuming 120 for a dnb pattern — and a real
  // parse always wins over it now, which is the part that was broken.
  if (pattern.toLowerCase().includes('dnb')) return 174;
  if (pattern.toLowerCase().includes('techno')) return 130;
  if (pattern.toLowerCase().includes('house')) return 125;
  return 120;
}

function detectKeyFromPattern(pattern: string): string {
  const noteMatches = pattern.match(/note\s*\(\s*["']([^"']+)["']\s*\)/gi) || [];
  const nMatches = pattern.match(/\.n\s*\(\s*["']([^"']+)["']\s*\)/gi) || [];
  const allNotes: string[] = [];

  for (const match of noteMatches) {
    const notesInMatch = match.match(/[a-g][#b]?\d?/gi) || [];
    allNotes.push(...notesInMatch.map(n => n.toLowerCase().replace(/\d/g, '')));
  }
  for (const match of nMatches) {
    const notesInMatch = match.match(/[a-g][#b]?\d?/gi) || [];
    allNotes.push(...notesInMatch.map(n => n.toLowerCase().replace(/\d/g, '')));
  }
  const chordMatches = pattern.match(/chord\s*\(\s*["']<([^>]+)>/gi) || [];
  for (const match of chordMatches) {
    const rootMatch = match.match(/[a-g][#b]?/i);
    if (rootMatch) allNotes.push(rootMatch[0].toLowerCase());
  }

  if (allNotes.length === 0) return 'C';

  // Object.create(null): the keys come from pattern text, and both
    // reading and writing 'constructor'/'__proto__' on a plain literal
    // misbehave (#318).
    const noteCounts: Record<string, number> = Object.create(null) as Record<string, number>;
  for (const note of allNotes) {
    const normalizedNote = note.charAt(0).toUpperCase() + note.slice(1);
    noteCounts[normalizedNote] = lookup(noteCounts, normalizedNote, 0) + 1;
  }

  let mostCommonNote = 'C';
  let maxCount = 0;
  for (const [note, count] of Object.entries(noteCounts)) {
    if (count > maxCount) { maxCount = count; mostCommonNote = note; }
  }
  return mostCommonNote;
}

function detectExistingLayers(pattern: string): string[] {
  const layers: string[] = [];
  const lowerPattern = pattern.toLowerCase();

  if (lowerPattern.includes('bd') || lowerPattern.includes('cp') ||
      lowerPattern.includes('hh') || lowerPattern.includes('sd') ||
      lowerPattern.includes('sn') || lowerPattern.includes('oh') ||
      lowerPattern.includes('breaks') || lowerPattern.includes('drum')) {
    layers.push('drums');
  }
  if (pattern.match(/note\s*\([^)]*[12]\s*["']/i) || lowerPattern.includes('bass')) {
    layers.push('bass');
  }
  if (pattern.match(/note\s*\([^)]*[34567]\s*["']/i) ||
      lowerPattern.includes('melody') || lowerPattern.includes('lead')) {
    layers.push('melody');
  }
  if (lowerPattern.includes('chord(') || lowerPattern.includes('pad') ||
      lowerPattern.includes('strings') || lowerPattern.includes('.voicing')) {
    layers.push('pad');
  }
  return layers;
}

function detectStyleFromPattern(pattern: string, styleHint?: string): string {
  if (styleHint) return styleHint.toLowerCase();
  const lowerPattern = pattern.toLowerCase();
  const tempo = detectTempoFromPattern(pattern);
  if (tempo >= 160 && lowerPattern.includes('breaks')) return 'jungle';
  if (tempo >= 165 && tempo <= 180) return 'dnb';
  if (tempo >= 125 && tempo <= 135 && lowerPattern.includes('bd*4')) {
    return lowerPattern.includes('cp') ? 'techno' : 'house';
  }
  if (tempo <= 100 && lowerPattern.includes('room')) return 'ambient';
  if (lowerPattern.includes('trap')) return 'trap';
  return 'techno';
}

function generateComplementaryLayer(
  layer: string, key: string, style: string, existingLayers: string[], ctx: ToolContext,
): string {
  // No `tempo` parameter: it was declared, passed, and never read. The
  // merged layer goes inside the host pattern's own stack and inherits
  // its tempo call (see `mergeLayerIntoPattern`), so there is nothing
  // here for a tempo to change. A cross-model reviewer read the dead
  // parameter as evidence that this function retimes the layer, and
  // concluded jam_with would desync by 4x; it cannot. Dead arguments
  // are not free.
  switch (layer) {
    case 'drums':
      if (existingLayers.includes('drums')) {
        const percOptions: Record<string, string> = {
          'techno': 's("~ hh ~ hh, ~ ~ oh ~").gain(0.4).hpf(5000)',
          'house': 's("[~ hh]*4, ~ ~ oh ~").gain(0.35).room(0.2)',
          'dnb': 's("hh*16").gain(perlin.range(0.2, 0.4)).hpf(6000)',
          'ambient': 's("~ ~ ~ hh:8").room(0.8).gain(0.2).slow(2)',
          'trap': 's("hh*16").gain(perlin.range(0.15, 0.35)).hpf(5000)',
          'jungle': 's("hh*32").gain(perlin.range(0.2, 0.4)).hpf(4000)',
          'jazz': 's("~ ride ~ ride, ~ ~ ~ hh").gain(0.3).room(0.3)',
        };
        return lookup(percOptions, style, percOptions['techno']);
      }
      return ctx.generator.generateDrumPattern(style, 0.6);

    case 'bass':
      return ctx.generator.generateBassline(key, style);

    case 'melody': {
      let scaleName: 'minor' | 'major' | 'dorian' | 'pentatonic' = 'minor';
      let octaveRange: [number, number] = [4, 5];
      if (style === 'jazz') { scaleName = 'dorian'; octaveRange = [3, 5]; }
      if (style === 'ambient') { scaleName = 'major'; octaveRange = [4, 6]; }
      if (existingLayers.includes('bass')) octaveRange = [4, 6];
      const scale = ctx.theory.generateScale(key, scaleName);
      const effects: Record<string, string> = {
        'techno': '.delay(0.25).room(0.2)', 'house': '.room(0.3).gain(0.6)',
        'dnb': '.delay(0.125).room(0.2).gain(0.5)', 'ambient': '.room(0.7).delay(0.5).gain(0.4)',
        'trap': '.gain(0.5).room(0.15)', 'jungle': '.delay(0.125).room(0.25).gain(0.55)',
        'jazz': '.room(0.4).gain(0.5)',
      };
      return ctx.generator.generateMelody(scale, 8, octaveRange) + lookup(effects, style, '.room(0.3).gain(0.5)');
    }

    case 'pad': {
      const safeKey = key.toLowerCase();
      const fourth = ctx.theory.getNote(key, 5).toLowerCase();
      const fifth = ctx.theory.getNote(key, 7).toLowerCase();
      const padPatterns: Record<string, string> = {
        'techno': `chord("<${safeKey}m7 ${fourth}m7>/4").dict('ireal').voicing().s("sawtooth").attack(0.5).release(2).lpf(2000).gain(0.2).room(0.4)`,
        'house': `chord("<${safeKey}m9 ${fourth}7 ${fifth}m7>/2").dict('ireal').voicing().s("gm_epiano1").gain(0.3).room(0.4)`,
        'dnb': `chord("<${safeKey}m9 ${fourth}m9>/8").dict('ireal').voicing().s("gm_strings").attack(1).release(2).gain(0.2).room(0.5).lpf(3500)`,
        'ambient': `chord("<${safeKey}maj7 ${fourth}maj7 ${fifth}m7>/8").dict('ireal').voicing().s("sawtooth").attack(3).release(5).lpf(sine.range(400, 1200).slow(16)).gain(0.15).room(0.9)`,
        'trap': `chord("<${safeKey}m7>/4").dict('ireal').voicing().s("sawtooth").attack(0.1).release(0.5).lpf(1500).gain(0.25).room(0.3)`,
        'jungle': `chord("<${safeKey}m9 ${fourth}m9>/8").dict('ireal').voicing().s("gm_epiano1").gain(0.25).room(0.4).delay(0.25)`,
        'jazz': `chord("<${safeKey}m9 ${fourth}m9 ${fifth}7>/4").dict('ireal').voicing().s("gm_epiano1").gain(0.3).room(0.5)`,
      };
      return lookup(padPatterns, style, padPatterns['techno']);
    }

    case 'texture': {
      const texturePatterns: Record<string, string> = {
        'techno': `s("hh:8*16").gain(perlin.range(0.02, 0.06)).hpf(8000).room(0.6).pan(perlin.range(0.2, 0.8).slow(8))`,
        'house': `s("~ noise:2 ~ noise:2").gain(0.04).hpf(6000).room(0.4)`,
        'dnb': `s("~ ~ ~ noise:4").gain(perlin.range(0.02, 0.05)).hpf(7000).room(0.5).pan(perlin.range(0.3, 0.7))`,
        'ambient': `s("pad:1").n(perlin.range(0, 8).floor()).gain(0.08).room(0.95).lpf(sine.range(500, 2000).slow(32)).slow(4)`,
        'trap': `s("~ ~ noise:3 ~").gain(0.03).hpf(10000).room(0.3)`,
        'jungle': `s("breaks125:8").fit().chop(32).gain(0.05).hpf(5000).room(0.4).pan(perlin.range(0.2, 0.8))`,
        'jazz': `s("brush:1").struct("~ 1 ~ 1 ~ 1 ~ ~").gain(0.1).room(0.5)`,
      };
      return lookup(texturePatterns, style, texturePatterns['techno']);
    }

    default:
      throw new Error(`Unknown layer type: ${layer}`);
  }
}

function mergeLayerIntoPattern(currentPattern: string, newLayer: string, layerType: string): string {
  const trimmedPattern = currentPattern.trim();
  const trimmedLayer = newLayer.trim();
  const stackMatch = trimmedPattern.match(/^([\s\S]*?)stack\s*\(\s*([\s\S]*?)\s*\)([\s\S]*)$/);

  if (stackMatch) {
    const prefix = stackMatch[1];
    const stackContents = stackMatch[2].trimEnd().replace(/,\s*$/, '');
    const suffix = stackMatch[3];
    return `${prefix}stack(
  ${stackContents},

  // Jam ${layerType} layer
  ${trimmedLayer}
)${suffix}`;
  }

  const tempoMatch = trimmedPattern.match(/^(\s*(?:setcp[ms]|setbpm)\s*\([^)]+\)\s*\n?)/);
  const tempoPrefix = tempoMatch ? tempoMatch[1] : '';
  const patternBody = tempoMatch ? trimmedPattern.slice(tempoMatch[0].length) : trimmedPattern;

  return `${tempoPrefix}stack(
  // Original pattern
  ${patternBody},

  // Jam ${layerType} layer
  ${trimmedLayer}
)`;
}

export const aiModule: ToolModule = { tools, toolNames, execute };
