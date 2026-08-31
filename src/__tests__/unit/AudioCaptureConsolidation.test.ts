/**
 * Tests for the audio_capture consolidation (#155).
 */

import { execute } from '../../server/tools/capture';
import type { ToolContext } from '../../server/tools/types';

function makeCtx() {
  const service = {
    isCapturing: jest.fn(() => false),
    startCapture: jest.fn(async () => undefined),
    // The response reports the mime the recorder actually produces, so
    // start and stop cannot name different formats for one recording
    // (#437).
    getMimeType: jest.fn(() => 'audio/webm;codecs=opus'),
    stopCapture: jest.fn(async () => ({
      blob: { arrayBuffer: async () => new ArrayBuffer(8) },
      duration: 3000,
      format: 'webm',
    })),
    captureForDuration: jest.fn(async () => ({
      blob: { arrayBuffer: async () => new ArrayBuffer(8) },
      duration: 5000,
      format: 'webm',
    })),
  };
  const controller = { page: {} };
  const ctx: ToolContext = {
    perfMonitor: {} as any, store: {} as any, generator: {} as any, theory: {} as any,
    sessionManager: {} as any, geminiService: {} as any, strudelEngine: {} as any,
    midiExportService: {} as any, midiImportService: {} as any,
    getAudioCaptureService: async (_sid?: string) => service as any,
    dropAudioCaptureService: jest.fn(),
    getHistory: () => ({ undoStack: [], redoStack: [], historyStack: [], maxHistory: 100 }), dropHistory: jest.fn(),
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } as any,
    isInitialized: () => true,
    ensureInitialized: async () => {},
    getController: () => controller as any,
    getCurrentPatternSafe: async () => '',
    writePatternSafe: async () => 'written',
  };
  return { ctx, service };
}

describe('audio_capture consolidation (#155)', () => {
  it('audio_capture(action=start) starts a stream', async () => {
    const { ctx, service } = makeCtx();
    const result = (await execute('audio_capture', { action: 'start', format: 'webm' }, ctx)) as any;
    expect(result.success).toBe(true);
    expect(service.startCapture).toHaveBeenCalled();
  });

  it('audio_capture(action=stop) returns base64-encoded audio', async () => {
    const { ctx, service } = makeCtx();
    service.isCapturing.mockReturnValue(true);
    const result = (await execute('audio_capture', { action: 'stop' }, ctx)) as any;
    expect(result.success).toBe(true);
    expect(typeof result.audio).toBe('string');
  });

  it('audio_capture(action=sample) captures a fixed-duration window', async () => {
    const { ctx, service } = makeCtx();
    await execute('audio_capture', { action: 'sample', duration: 3000 }, ctx);
    expect(service.captureForDuration).toHaveBeenCalledWith(expect.anything(), 3000);
  });

  it('audio_capture(action=sample) defaults duration to 5000ms', async () => {
    const { ctx, service } = makeCtx();
    await execute('audio_capture', { action: 'sample' }, ctx);
    expect(service.captureForDuration).toHaveBeenCalledWith(expect.anything(), 5000);
  });

  it('audio_capture(action=sample) rejects out-of-range duration', async () => {
    const { ctx } = makeCtx();
    // The envelope, not `{ success: false }`. capture.ts now preserves
    // the category — a duration outside the allowed range is the
    // caller's to fix, and it was reaching them as `internal` (#392).
    const result = (await execute('audio_capture', { action: 'sample', duration: 50 }, ctx)) as any;
    expect(result.ok).toBe(false);
    expect(result.errorCategory).toBe('validation');
  });

  it('throws on invalid action', async () => {
    const { ctx } = makeCtx();
    await expect(execute('audio_capture', { action: 'pause' }, ctx)).rejects.toThrow(/Invalid action/);
  });

  it('export_midi stays distinct (separate verb per audit)', async () => {
    const { ctx } = makeCtx();
    // No MIDI service is meaningfully wired in this test — just confirm the
    // case routes through and returns a structured object rather than throwing.
    const ctxWithMidi = { ...ctx, midiExportService: { exportToBase64: jest.fn(() => ({ success: false, error: 'no notes', output: '', noteCount: 0, bars: 4, bpm: 120 })) } } as any;
    const result = (await execute('export_midi', {}, ctxWithMidi)) as any;
    // This never reached the mocked service: the context has no current
    // pattern, so it stops at "No pattern to export". The old assertion
    // (`result.success === false`) passed anyway, because that branch
    // ALSO returned `{ success: false }` — a test green on a path it did
    // not mean to take. Asserting what it actually exercises (#392).
    expect(result.ok).toBe(false);
    expect(result.errorCategory).toBe('business');
    expect(result.message).toContain('No pattern to export');
  });
});
