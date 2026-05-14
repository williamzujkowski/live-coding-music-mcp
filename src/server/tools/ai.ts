/**
 * ai domain — AI-powered feedback, pattern suggestion, and jamming.
 *
 * Owns (3 tools): get_pattern_feedback, suggest_pattern_from_audio,
 * jam_with.
 *
 * Per the #110 audit, these collapse into a single `ai_assist(task=...)`
 * tool — they all share Gemini's rate limiting and auth, so the merge
 * is natural. Deferred until external contracts stabilize.
 *
 * `jam_with` carries six private helpers that analyze the current
 * pattern (tempo/key/style detection, layer detection, merge logic)
 * and that are used only by this tool. They live here.
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { ToolContext, ToolModule } from './types.js';
import type { CreativeFeedback, AudioFeedback } from '../../services/GeminiService.js';
import { Logger } from '../../utils/Logger.js';

const logger = new Logger();

const SESSION_ID_PROP = {
  session_id: {
    type: 'string',
    description: 'Optional session ID (#108). Omit to use default session.',
  },
};

export const tools: Tool[] = [
  {
    name: 'get_pattern_feedback',
    description: 'Get AI-powered creative feedback on the current pattern using Google Gemini. Analyzes pattern structure and optionally audio.',
    inputSchema: {
      type: 'object',
      properties: {
        includeAudio: { type: 'boolean', description: 'Include audio analysis (plays pattern briefly). Default: false' },
        style: { type: 'string', description: 'Optional style hint for context (e.g., "techno", "ambient")' },
        ...SESSION_ID_PROP,
      },
    },
  },
  {
    name: 'suggest_pattern_from_audio',
    description: 'Analyze the currently playing audio and suggest a complementary Strudel pattern using Gemini AI. Extracts tempo, key, and spectral features locally, then uses AI to generate a matching pattern. Returns pattern text (not auto-executed).',
    inputSchema: {
      type: 'object',
      properties: {
        style: { type: 'string', description: 'Optional style hint (e.g., "ambient", "techno", "jazz")' },
        role: {
          type: 'string',
          enum: ['complement', 'bassline', 'melody', 'percussion'],
          description: 'What role the suggested pattern should fill. Default: complement',
        },
        ...SESSION_ID_PROP,
      },
    },
  },
  {
    name: 'jam_with',
    description: 'AI generates a complementary layer to jam with your pattern. Analyzes current pattern to detect tempo, key, and existing layers, then generates a matching layer that fits musically.',
    inputSchema: {
      type: 'object',
      properties: {
        layer: {
          type: 'string',
          enum: ['drums', 'bass', 'melody', 'pad', 'texture'],
          description: 'Type of layer to add: drums, bass, melody, pad, or texture',
        },
        style_hint: { type: 'string', description: 'Optional style guidance (e.g., "funky", "minimal", "atmospheric")' },
        auto_play: { type: 'boolean', description: 'Start playback after adding layer (default: true)' },
        ...SESSION_ID_PROP,
      },
      required: ['layer'],
    },
  },
];

export const toolNames = new Set(tools.map(t => t.name));

export async function execute(name: string, args: any, ctx: ToolContext): Promise<unknown> {
  const sid: string | undefined = args?.session_id;
  switch (name) {
    case 'get_pattern_feedback':
      return await getPatternFeedback(args?.includeAudio || false, args?.style, ctx, sid);

    case 'suggest_pattern_from_audio':
      return await suggestPatternFromAudio(args?.style, args?.role || 'complement', ctx, sid);

    case 'jam_with':
      return await jamWith(args.layer, args.style_hint, args.auto_play, ctx, sid);

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
): Promise<{
  pattern_analysis?: CreativeFeedback;
  audio_analysis?: AudioFeedback;
  error?: string;
  gemini_available: boolean;
}> {
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

  const result: {
    pattern_analysis?: CreativeFeedback;
    audio_analysis?: AudioFeedback;
    error?: string;
    gemini_available: boolean;
  } = { gemini_available: true };

  try {
    result.pattern_analysis = await ctx.geminiService.getCreativeFeedback(pattern);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('Pattern feedback failed', { error: message });
    if (message?.includes('rate limit') || message?.includes('Rate limit')) {
      return { gemini_available: true, error: message };
    }
    result.error = `Pattern analysis failed: ${message}`;
  }

  if (includeAudio && (sid || ctx.isInitialized())) {
    try {
      const audioBlob = await captureAudioSampleForFeedback(ctx, sid);
      if (audioBlob) {
        result.audio_analysis = await ctx.geminiService.analyzeAudio(audioBlob, { style, duration: 5 });
      } else {
        logger.warn('Audio capture returned no data');
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

/**
 * Captures a brief audio sample for Gemini analysis. Different from the
 * `capture_audio_sample` tool — this one connects directly to the
 * analyzer's AudioContext and records 5 seconds without disturbing
 * the full AudioCaptureService lifecycle.
 */
async function captureAudioSampleForFeedback(ctx: ToolContext, sid?: string): Promise<Blob | null> {
  const page = ctx.getController(sid).page;
  if (!page) {
    logger.warn('Cannot capture audio: controller page not available');
    return null;
  }

  try {
    const audioData = await page.evaluate(/* istanbul ignore next */ async () => {
      return new Promise<string | null>((resolve) => {
        const analyzer = (window as any).strudelAudioAnalyzer;
        if (!analyzer || !analyzer.analyser) {
          resolve(null);
          return;
        }
        try {
          const audioCtx = analyzer.analyser.context as AudioContext;
          const destination = audioCtx.createMediaStreamDestination();
          analyzer.analyser.connect(destination);
          const mediaRecorder = new MediaRecorder(destination.stream, { mimeType: 'audio/webm;codecs=opus' });
          const chunks: Blob[] = [];
          mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
          mediaRecorder.onstop = async () => {
            try { analyzer.analyser.disconnect(destination); } catch { /* already disconnected */ }
            if (chunks.length === 0) { resolve(null); return; }
            const blob = new Blob(chunks, { type: 'audio/webm' });
            const reader = new FileReader();
            reader.onloadend = () => {
              const base64 = reader.result as string;
              resolve(base64.split(',')[1] || null);
            };
            reader.onerror = () => resolve(null);
            reader.readAsDataURL(blob);
          };
          mediaRecorder.start();
          setTimeout(() => { if (mediaRecorder.state === 'recording') mediaRecorder.stop(); }, 5000);
        } catch {
          resolve(null);
        }
      });
    });

    if (!audioData) return null;

    const binaryString = atob(audioData);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) bytes[i] = binaryString.charCodeAt(i);
    return new Blob([bytes], { type: 'audio/webm' });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('Audio capture failed', { error: message });
    return null;
  }
}

// ---------------------------------------------------------------------------
// suggest_pattern_from_audio
// ---------------------------------------------------------------------------

async function suggestPatternFromAudio(
  style: string | undefined,
  role: string,
  ctx: ToolContext,
  sid?: string,
): Promise<Record<string, unknown>> {
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
  const roleText = roleDesc[role] || roleDesc['complement'];
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
      return { error: 'Gemini returned no pattern suggestions.' };
    }
    const suggestedPattern = geminiResponse[0].code;
    const validation = ctx.strudelEngine.validate(suggestedPattern);
    return {
      suggested_pattern: suggestedPattern,
      analysis: { bpm, key, scale },
      role,
      style: style || 'auto',
      valid: validation.valid,
      validation_errors: validation.valid ? [] : validation.errors,
      usage: 'Use write tool to load this pattern, then play to hear it.',
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
    newLayer = generateComplementaryLayer(layer, key, tempo, detectedStyle, existingLayers, ctx);
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
    await ctx.writePatternSafe(mergedPattern, sid);
    if (autoPlay && (sid || ctx.isInitialized())) {
      await ctx.getController(sid).play();
    }
    return {
      success: true,
      message: `Added ${layer} layer${styleHint ? ` (${styleHint} style)` : ''} to jam with your pattern`,
      layer,
      detected: { tempo, key, existingLayers },
      newLayer,
      pattern: mergedPattern.substring(0, 300) + (mergedPattern.length > 300 ? '...' : ''),
    };
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

function detectTempoFromPattern(pattern: string): number {
  const cpmMatch = pattern.match(/setcpm\s*\(\s*(\d+(?:\.\d+)?)\s*\)/i);
  if (cpmMatch) return Math.round(parseFloat(cpmMatch[1]));
  const bpmMatch = pattern.match(/setbpm\s*\(\s*(\d+(?:\.\d+)?)\s*\)/i);
  if (bpmMatch) return Math.round(parseFloat(bpmMatch[1]));
  const cpsMatch = pattern.match(/setcps\s*\(\s*(\d+(?:\.\d+)?)\s*(?:\/\s*60)?\s*\)/i);
  if (cpsMatch) {
    const cps = parseFloat(cpsMatch[1]);
    if (pattern.includes(`setcps(${cpsMatch[1]}/60`)) return Math.round(cps);
    return Math.round(cps * 60);
  }
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

  const noteCounts: Record<string, number> = {};
  for (const note of allNotes) {
    const normalizedNote = note.charAt(0).toUpperCase() + note.slice(1);
    noteCounts[normalizedNote] = (noteCounts[normalizedNote] || 0) + 1;
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
  layer: string, key: string, tempo: number, style: string, existingLayers: string[], ctx: ToolContext,
): string {
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
        return percOptions[style] || percOptions['techno'];
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
      return ctx.generator.generateMelody(scale, 8, octaveRange) + (effects[style] || '.room(0.3).gain(0.5)');
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
      return padPatterns[style] || padPatterns['techno'];
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
      return texturePatterns[style] || texturePatterns['techno'];
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
