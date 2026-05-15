/**
 * capture domain — audio recording and MIDI export.
 *
 * Owns two tools: `audio_capture(action=start|stop|sample)` and
 * `export_midi` (kept separate — MIDI is symbolic, audio is waveform).
 *
 * The AudioCaptureService is lazy-instantiated module-side: we need
 * the current Playwright page for `injectRecorder()`, and that only
 * exists after `init`. The singleton survives across tool calls.
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { ToolContext, ToolModule } from './types.js';
import { InputValidator } from '../../utils/InputValidator.js';

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
    description: 'Optional session ID (#108). Routes page reference to the named session. Note: AudioCaptureService is currently server-wide — concurrent captures across sessions will conflict.',
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
      'Note: the AudioCaptureService is currently a server-wide singleton — concurrent captures across sessions will conflict.',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['start', 'stop', 'sample'], description: 'Capture action' },
        format: { type: 'string', enum: ['webm', 'opus'], description: 'action=start: audio format (default webm)' },
        maxDuration: { type: 'number', description: 'action=start: maximum capture duration ms' },
        duration: { type: 'number', description: 'action=sample: duration ms (100-60000, default 5000)' },
        ...SESSION_ID_PROP,
      },
      required: ['action'],
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
        bpm: { type: 'number', description: 'Tempo in BPM (default: 120)' },
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

    case 'export_midi':
      return await exportMidi(args?.filename, args?.duration, args?.bpm, args?.format, ctx, sid);

    default:
      throw new Error(`capture module does not handle tool: ${name}`);
  }
}

async function startAudioCapture(
  format: 'webm' | 'opus' | undefined,
  _maxDuration: number | undefined,
  ctx: ToolContext,
  sid?: string,
): Promise<unknown> {
  try {
    const service = await ctx.getAudioCaptureService(sid);
    if (service.isCapturing()) {
      return { success: false, message: 'Audio capture already in progress. Stop it first.' };
    }
    await service.startCapture(ctx.getController(sid).page!, { format });
    return {
      success: true,
      message: 'Audio capture started. Use audio_capture({ action: "stop" }) to get the recorded audio.',
      format: format || 'webm',
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, message: `Failed to start audio capture: ${message}` };
  }
}

async function stopAudioCapture(ctx: ToolContext, sid?: string): Promise<unknown> {
  try {
    const service = await ctx.getAudioCaptureService(sid);
    if (!service.isCapturing()) {
      return { success: false, message: 'No audio capture in progress. Start capture first.' };
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
    return { success: false, message: `Failed to stop audio capture: ${message}` };
  }
}

async function captureAudioSample(duration: number | undefined, ctx: ToolContext, sid?: string): Promise<unknown> {
  const durationMs = duration || 5000;
  if (durationMs < 100 || durationMs > 60000) {
    return { success: false, message: 'Duration must be between 100ms and 60000ms (1 minute)' };
  }

  try {
    const service = await ctx.getAudioCaptureService(sid);
    if (service.isCapturing()) {
      return { success: false, message: 'Audio capture already in progress. Stop it first.' };
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
    return { success: false, message: `Failed to capture audio sample: ${message}` };
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
    return { success: false, message: 'Bars must be between 1 and 128' };
  }

  const pattern = await ctx.getCurrentPatternSafe(sid);
  if (!pattern || pattern.trim().length === 0) {
    return { success: false, message: 'No pattern to export. Write a pattern first.' };
  }

  const exportOptions = { bpm: bpm || 120, bars: bars || 4 };
  const outputFormat = format || 'base64';

  if (outputFormat === 'file') {
    const result = ctx.midiExportService.exportToFile(pattern, filename, exportOptions);
    return {
      success: result.success,
      message: result.success
        ? `Exported ${result.noteCount} notes to ${result.output}`
        : result.error || 'Export failed',
      output: result.output,
      noteCount: result.noteCount,
      bars: result.bars,
      bpm: result.bpm,
      error: result.error,
    };
  }

  const result = ctx.midiExportService.exportToBase64(pattern, exportOptions);
  return {
    success: result.success,
    message: result.success
      ? `Exported ${result.noteCount} notes as base64 MIDI data`
      : result.error || 'Export failed',
    output: result.output,
    noteCount: result.noteCount,
    bars: result.bars,
    bpm: result.bpm,
    error: result.error,
  };
}

export const captureModule: ToolModule = { tools, toolNames, execute };
