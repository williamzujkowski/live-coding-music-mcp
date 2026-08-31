/**
 * capture domain — audio recording and MIDI export.
 *
 * Owns three tools: `audio_capture(action=start|stop|sample)`,
 * `export_audio` (records a window and writes a file), and `export_midi`
 * (kept separate — MIDI is symbolic, audio is waveform).
 *
 * AudioCaptureService instances are lazy-created per session: we need the
 * session's Playwright page for `injectRecorder()`, and that only exists
 * after `init`. The server holds them in a Map keyed by session id (#180),
 * so each instance survives across tool calls and sessions do not share
 * a recorder.
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { ToolContext, ToolModule } from './types.js';
import { categorizeError, err } from './types.js';
import { InputValidator } from '../../utils/InputValidator.js';
import { declaredBpm } from '../../utils/Tempo.js';


// AudioCaptureService lifecycle lives on the server; we fetch a shared
// instance via ctx.getAudioCaptureService() so tests can mock the class
// at module boundary without the extractor caching a stale instance.

function blobToBase64(arrayBuffer: ArrayBuffer): string {
  const bytes = new Uint8Array(arrayBuffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

const SESSION_ID_PROP = {
  session_id: {
    type: 'string',
    description: 'Optional session ID (#108). Routes the capture to the named session, which has its own recorder — concurrent captures across sessions are safe (#180).',
  },
};

export const tools: Tool[] = [
  {
    name: 'audio_capture',
    description:
      'Record audio output from the live Strudel session. ' +
      'action=start begins streaming capture (optional `format` webm/opus, default webm). ' +
      'action=stop ends the stream and returns base64-encoded audio. ' +
      'action=sample captures a fixed-`duration` window in one call (100-60000ms, default 5000ms). ' +
      'Example: audio_capture({ action: "sample", duration: 3000 }). ' +
      'Audio must be playing for capture to record meaningful data. ' +
      'For MIDI export use export_midi; for runtime diagnostics use diagnostics. ' +
      'Each session has its own recorder, so captures in different sessions do not interfere (#180).',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['start', 'stop', 'sample'], description: 'Capture action' },
        format: { type: 'string', enum: ['webm', 'opus'], description: 'action=start: audio format (default webm)' },
        maxDuration: {
          type: 'number',
          description:
            'action=start: stop the recorder automatically after this many ms. '
            + 'Defaults to 600000 (ten minutes); the recording so far is kept and '
            + 'returned by a later stop.',
        },
        duration: { type: 'number', description: 'action=sample: duration ms (100-60000, default 5000)' },
        ...SESSION_ID_PROP,
      },
      required: ['action'],
    },
  },
  {
    name: 'export_audio',
    description:
      'Record a window of live Strudel audio and write it to a file. ' +
      'Returns a path plus what was actually recorded, not a wall of base64 — ' +
      'prefer this over audio_capture when you want the audio to exist somewhere. ' +
      'format=wav (default) decodes to 16-bit PCM a DAW will open; format=webm writes the raw Opus recording. ' +
      'Reports silent captures instead of writing a silent file and claiming success. ' +
      'Audio must already be playing: call playback({ action: "play" }) first. ' +
      'Example: export_audio({ duration: 4000, filename: "take-01" }).',
    inputSchema: {
      type: 'object',
      properties: {
        duration: { type: 'number', description: 'Window to record in ms (100-30000, default 5000)' },
        format: { type: 'string', enum: ['wav', 'webm'], description: 'Output format (default wav)' },
        filename: { type: 'string', description: 'Output filename; reduced to a basename and confined to the export directory' },
        output: { type: 'string', enum: ['file', 'base64'], description: 'file (default) writes to disk and returns a path; base64 returns bytes inline' },
        ...SESSION_ID_PROP,
      },
    },
  },
  {
    name: 'export_midi',
    description: 'Export current pattern to MIDI file. Parses note(), n(), and chord() functions.',
    inputSchema: {
      type: 'object',
      properties: {
        filename: { type: 'string', description: 'Output filename (optional, default: pattern.mid)' },
        duration: { type: 'number', description: 'Export duration in bars (default: 4)' },
        bpm: { type: 'number', description: "Tempo in BPM (default: the pattern's own tempo, or 120 if it declares none)" },
        format: { type: 'string', enum: ['file', 'base64'], description: 'Output format: file or base64 (default: base64)' },
        ...SESSION_ID_PROP,
      },
    },
  },
];

export const toolNames = new Set(tools.map(t => t.name));

export async function execute(name: string, args: any, ctx: ToolContext): Promise<unknown> {
  const sid: string | undefined = args?.session_id;
  // No outer init check: each capture handler has try/catch that
  // produces a structured { success: false, message } from any error,
  // including AudioCaptureService's "Browser not initialized" throw.
  switch (name) {
    case 'audio_capture': {
      const a = args?.action;
      switch (a) {
        case 'start':  return await startAudioCapture(args?.format, args?.maxDuration, ctx, sid);
        case 'stop':   return await stopAudioCapture(ctx, sid);
        case 'sample': return await captureAudioSample(args?.duration, ctx, sid);
        default:
          throw new Error(`Invalid action: ${a}. Must be one of: start, stop, sample`);
      }
    }

    case 'export_audio':
      return await exportAudio(args, ctx, sid);

    case 'export_midi':
      return await exportMidi(args?.filename, args?.duration, args?.bpm, args?.format, ctx, sid);

    default:
      throw new Error(`capture module does not handle tool: ${name}`);
  }
}

async function startAudioCapture(
  format: 'webm' | 'opus' | undefined,
  maxDuration: number | undefined,
  ctx: ToolContext,
  sid?: string,
): Promise<unknown> {
  try {
    const service = await ctx.getAudioCaptureService(sid);
    if (service.isCapturing()) {
      return err('business', 'Audio capture already in progress. Stop it first.');
    }
    if (maxDuration !== undefined) {
      InputValidator.validatePositiveInteger(maxDuration, 'maxDuration');
    }
    await service.startCapture(ctx.getController(sid).page!, { format, maxDuration });
    return {
      success: true,
      message: 'Audio capture started. Use audio_capture({ action: "stop" }) to get the recorded audio.',
      // The mime the recorder actually produces, which is what `stop`
      // reports. Echoing the requested `format` here meant start said
      // "opus" and the matching stop said "audio/webm;codecs=opus" for
      // one recording (#437). MediaRecorder gives a webm container with
      // an Opus stream either way.
      format: service.getMimeType(),
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return err(categorizeError(error), `Failed to start audio capture: ${message}`);
  }
}

async function stopAudioCapture(ctx: ToolContext, sid?: string): Promise<unknown> {
  try {
    const service = await ctx.getAudioCaptureService(sid);
    if (!service.isCapturing()) {
      return err('business', 'No audio capture in progress. Start capture first.');
    }
    const result = await service.stopCapture(ctx.getController(sid).page!);
    const buf = await result.blob.arrayBuffer();
    return {
      success: true,
      message: `Captured ${result.duration}ms of audio`,
      audio: blobToBase64(buf),
      duration: result.duration,
      format: result.format,
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return err(categorizeError(error), `Failed to stop audio capture: ${message}`);
  }
}

async function captureAudioSample(duration: number | undefined, ctx: ToolContext, sid?: string): Promise<unknown> {
  const durationMs = duration || 5000;
  if (durationMs < 100 || durationMs > 60000) {
    // Validation, not business: the caller passed a number outside the
    // allowed range, and no amount of setup changes that. My codemod
    // guessed `business` from the absence of a nearby catch, which is
    // the same guessing-by-shape this work exists to remove.
    return err('validation', 'Duration must be between 100ms and 60000ms (1 minute)');
  }

  try {
    const service = await ctx.getAudioCaptureService(sid);
    if (service.isCapturing()) {
      return err('business', 'Audio capture already in progress. Stop it first.');
    }
    const result = await service.captureForDuration(ctx.getController(sid).page!, durationMs);
    const buf = await result.blob.arrayBuffer();
    return {
      success: true,
      message: `Captured ${result.duration}ms audio sample`,
      audio: blobToBase64(buf),
      duration: result.duration,
      format: result.format,
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return err(categorizeError(error), `Failed to capture audio sample: ${message}`);
  }
}

async function exportAudio(args: any, ctx: ToolContext, sid?: string): Promise<unknown> {
  try {
    const service = ctx.audioExportService;
    // Ensures the recorder is injected for this session; export needs the
    // same GainNode interception audio_capture uses.
    await ctx.getAudioCaptureService(sid);

    const result = await service.exportAudio(ctx.getController(sid).page!, {
      duration: args?.duration,
      format: args?.format,
      filename: args?.filename,
      output: args?.output,
    });

    if (!result.success) {
      return { success: false, message: result.error ?? 'Audio export failed.' };
    }

    return {
      ...result,
      message: result.path
        ? `Exported ${String(result.bytes)} bytes of ${result.format} to ${result.path}`
        : `Captured ${String(result.bytes)} bytes of ${result.format}`,
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return err(categorizeError(error), `Audio export failed: ${message}`);
  }
}

async function exportMidi(
  filename: string | undefined,
  bars: number | undefined,
  bpm: number | undefined,
  format: 'file' | 'base64' | undefined,
  ctx: ToolContext,
  sid?: string,
): Promise<unknown> {
  if (bpm !== undefined) InputValidator.validateBPM(bpm);
  if (bars !== undefined && (bars < 1 || bars > 128)) {
    return err('validation', 'Bars must be between 1 and 128');
  }

  const pattern = await ctx.getCurrentPatternSafe(sid);
  if (!pattern || pattern.trim().length === 0) {
    return err('business', 'No pattern to export. Write a pattern first.');
  }

  // The pattern's own tempo, unless the caller asked for a different
  // one. This used to be a flat `bpm || 120`, so exporting a 174 BPM
  // pattern wrote a 120 BPM file and a round trip silently rewrote the
  // tempo — the same guarantee #336 protects for the bar (#399).
  const exportOptions = { bpm: bpm ?? declaredBpm(pattern) ?? 120, bars: bars ?? 4 };
  const outputFormat = format || 'base64';

  if (outputFormat === 'file') {
    const result = ctx.midiExportService.exportToFile(pattern, filename, exportOptions);
    return {
      success: result.success,
      // The warning has to reach the caller or computing it in the
      // service is pointless: this handler builds its own response and
      // used to drop it, so an export that skipped most of a pattern
      // still reported "Exported 2 notes" and nothing else (#335).
      message: result.success
        ? `Exported ${result.noteCount} notes to ${result.output}`
          + (result.warning ? ` — ${result.warning}` : '')
        : result.error || 'Export failed',
      output: result.output,
      noteCount: result.noteCount,
      bars: result.bars,
      bpm: result.bpm,
      ...(result.warning ? { warning: result.warning } : {}),
      ...(result.unrepresented ? { unrepresented: result.unrepresented } : {}),
      ...(result.partiallyExported ? { partiallyExported: result.partiallyExported } : {}),
      error: result.error,
    };
  }

  const result = ctx.midiExportService.exportToBase64(pattern, exportOptions);
  return {
    success: result.success,
    message: result.success
      ? `Exported ${result.noteCount} notes as base64 MIDI data`
        + (result.warning ? ` — ${result.warning}` : '')
      : result.error || 'Export failed',
    output: result.output,
    noteCount: result.noteCount,
    bars: result.bars,
    bpm: result.bpm,
    ...(result.warning ? { warning: result.warning } : {}),
    ...(result.unrepresented ? { unrepresented: result.unrepresented } : {}),
    ...(result.partiallyExported ? { partiallyExported: result.partiallyExported } : {}),
    error: result.error,
  };
}

export const captureModule: ToolModule = { tools, toolNames, execute };
