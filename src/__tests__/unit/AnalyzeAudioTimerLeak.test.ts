/**
 * `analyzeAudio` must disarm its timeout when the API answers first (#404).
 *
 * `Promise.race` settles on the winner and leaves the loser running. The
 * timeout was armed for `timeoutMs * 2` — 60 seconds by default — and
 * nothing cleared it, so every call left a live handle holding its
 * rejection closure. In a long-lived server they accumulate; in Jest
 * they were what force-exited a worker on every parallel run (#362),
 * unattributed for months because `--detectOpenHandles` implies
 * `--runInBand` and the warning only fires with two or more workers.
 *
 * This watches `setTimeout`/`clearTimeout` rather than counting live
 * handles: unrelated timers come and go during a run, and a count that
 * moves on its own cannot prove anything. Every timer armed at the audio
 * deadline must be cleared by the time the call returns.
 */

import { GeminiService } from '../../services/GeminiService';

jest.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: jest.fn(),
}));
jest.mock('google-auth-library', () => ({
  GoogleAuth: jest.fn(),
}));

/** Default 30s request timeout, doubled for audio (GeminiService.ts:467). */
const AUDIO_DEADLINE_MS = 60_000;

describe('analyzeAudio disarms its timeout (#404)', () => {
  it('clears every audio-deadline timer it arms', async () => {
    const armed: unknown[] = [];
    const cleared = new Set<unknown>();
    const realSet = global.setTimeout;
    const realClear = global.clearTimeout;

    const setSpy = jest.spyOn(global, 'setTimeout').mockImplementation(((
      fn: () => void, ms?: number, ...rest: unknown[]
    ) => {
      const handle = (realSet as unknown as (...a: unknown[]) => unknown)(fn, ms, ...rest);
      if (ms === AUDIO_DEADLINE_MS) armed.push(handle);
      return handle;
    }) as unknown as typeof setTimeout);

    const clearSpy = jest.spyOn(global, 'clearTimeout').mockImplementation(((
      handle: unknown,
    ) => {
      cleared.add(handle);
      (realClear as unknown as (h: unknown) => void)(handle);
    }) as unknown as typeof clearTimeout);

    try {
      const service = new GeminiService('test-key');
      // Answer at once, so the deadline is the loser of every race.
      (service as unknown as { callGeminiAPI: () => Promise<string> }).callGeminiAPI =
        async () => '{"overall": "fine", "suggestions": []}';

      for (let i = 0; i < 3; i++) {
        // A distinct blob each call, or the cache answers and no timer is
        // armed at all — the assertion would hold without exercising it.
        await service.analyzeAudio(
          {
            type: 'audio/wav',
            arrayBuffer: async () => new ArrayBuffer(8 + i),
          } as unknown as Blob,
          `context-${String(i)}`,
        );
      }

      // Armed at all, or the test proves nothing.
      expect(armed).toHaveLength(3);
      expect(armed.filter(h => !cleared.has(h))).toEqual([]);
    } finally {
      setSpy.mockRestore();
      clearSpy.mockRestore();
      for (const handle of armed) realClear(handle as NodeJS.Timeout);
    }
  });
});
