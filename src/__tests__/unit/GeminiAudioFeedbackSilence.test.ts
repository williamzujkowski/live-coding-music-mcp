/**
 * Silence handling for Gemini audio feedback.
 *
 * The capture helper only returned null when the recorder produced ZERO
 * chunks. A silent recording still produces chunks — MediaRecorder emits
 * frames of near-silence quite happily — so five seconds of nothing was
 * sent to Gemini, which returned a confident mood/style/energy plus three
 * suggestions for audio that was not there.
 *
 * Feedback silently decoupled from the audio is worse than no feedback:
 * the caller cannot tell from the response, and the whole point of the
 * tool is closing a loop on what was actually heard.
 */

import { execute } from '../../server/tools/ai';
import type { ToolContext } from '../../server/tools/types';

const GEMINI_FEEDBACK = {
  mood: 'hypnotic', style: 'minimal techno', energy: 'medium',
  suggestions: ['a', 'b', 'c'], confidence: 0.8,
};

function makeCtx(exportResult: Record<string, unknown>) {
  const analyzeAudio = jest.fn(async () => GEMINI_FEEDBACK);
  const ctx = {
    controller: {} as any,
    perfMonitor: {} as any, store: {} as any, generator: {} as any, theory: {} as any,
    sessionManager: {} as any,
    geminiService: {
      isAvailable: jest.fn(() => true),
      getCreativeFeedback: jest.fn(async () => ({ summary: 'ok' })),
      analyzeAudio,
    } as any,
    strudelEngine: {} as any, midiExportService: {} as any, midiImportService: {} as any,
    audioExportService: { exportAudio: jest.fn(async () => exportResult) } as any,
    getAudioCaptureService: async () => ({}) as any,
    dropAudioCaptureService: jest.fn(),
    getHistory: () => ({ undoStack: [], redoStack: [], historyStack: [], maxHistory: 100 }),
    historyEntryId: () => 1, dropHistory: jest.fn(),
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } as any,
    isInitialized: () => true,
    ensureInitialized: async () => {},
    getController: () => ({ page: {} }) as any,
    getCurrentPatternSafe: async () => 's("bd*4")',
    writePatternSafe: async () => 'written',
  } as unknown as ToolContext;
  return { ctx, analyzeAudio };
}

const AUDIBLE = {
  success: true, audio: Buffer.from('fake-wav').toString('base64'),
  bytes: 8, duration: 5000, format: 'wav', peak: 0.87, rms: 0.2, silent: false,
};
const SILENT = { ...AUDIBLE, peak: 2.03e-34, rms: 2.03e-34, silent: true };

describe('Gemini audio feedback and silence', () => {
  it('does not call Gemini when the capture was silent', async () => {
    const { ctx, analyzeAudio } = makeCtx(SILENT);

    const result = (await execute('ai_assist',
      { task: 'feedback', includeAudio: true }, ctx)) as any;

    expect(analyzeAudio).not.toHaveBeenCalled();
    expect(result.audio_analysis).toBeUndefined();
  });

  it('tells the caller why it skipped, and what to do', async () => {
    const { ctx } = makeCtx(SILENT);

    const result = (await execute('ai_assist',
      { task: 'feedback', includeAudio: true }, ctx)) as any;

    expect(result.audio_analysis_skipped).toMatch(/silent/i);
    expect(result.audio_analysis_skipped).toMatch(/play/i);
  });

  it('still analyses audible audio', async () => {
    const { ctx, analyzeAudio } = makeCtx(AUDIBLE);

    const result = (await execute('ai_assist',
      { task: 'feedback', includeAudio: true }, ctx)) as any;

    expect(analyzeAudio).toHaveBeenCalled();
    expect(result.audio_analysis).toEqual(GEMINI_FEEDBACK);
    expect(result.audio_analysis_skipped).toBeUndefined();
  });

  it('reports the measured level so the caller can judge it', async () => {
    const { ctx } = makeCtx(AUDIBLE);

    const result = (await execute('ai_assist',
      { task: 'feedback', includeAudio: true }, ctx)) as any;

    expect(result.audio_levels).toEqual({ peak: 0.87, rms: 0.2 });
  });

  /** Gemini decodes by the declared container; WAV labelled WebM fails. */
  it('sends WAV, not the old WebM container', async () => {
    const { ctx, analyzeAudio } = makeCtx(AUDIBLE);

    await execute('ai_assist', { task: 'feedback', includeAudio: true }, ctx);

    expect(analyzeAudio.mock.calls[0][0].type).toBe('audio/wav');
  });

  it('surfaces a failed capture instead of staying quiet', async () => {
    const { ctx, analyzeAudio } = makeCtx({ success: false, error: 'not connected' });

    const result = (await execute('ai_assist',
      { task: 'feedback', includeAudio: true }, ctx)) as any;

    expect(analyzeAudio).not.toHaveBeenCalled();
    expect(result.error).toMatch(/no data/i);
  });
});
