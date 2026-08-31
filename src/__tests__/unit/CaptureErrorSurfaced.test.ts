/**
 * A recorder error must reach the caller (#437 item 5).
 *
 * `capture.error` was set by `recorder.onerror` and nothing in the
 * codebase ever read it. Two consequences, both measured against the
 * page-side control flow:
 *
 *   - An error BEFORE stop clears `isCapturing`, so `stopCapture` fell
 *     into the "No capture in progress" branch — losing the real cause
 *     and the chunks, and telling the caller there had been no capture.
 *   - An error AFTER the stop handler is installed still delivers
 *     `dataavailable` and `stop`, so the handler returned success:true
 *     over a truncated recording and the tool reported a normal one.
 *
 * The second is the "failure reported as success" family this repo has
 * fixed five times over (#277, #288, #293, #335, #426).
 *
 * As in `ConcurrentStopHang.test.ts`, the behavioural tests below run a
 * transcription of the page-side logic — that code only exists inside a
 * `page.evaluate` closure — and the last test reads the shipped source
 * so the transcription cannot drift from it unnoticed.
 */

function makeCapture(): Record<string, any> {
  const capture: Record<string, any> = {
    stopping: null,
    capTimer: null,
    isCapturing: true,
    error: null,
    startTime: Date.now(),
    chunks: ['chunk-a'],
    recorder: {
      onstop: null as null | (() => void),
      stop(): void { setTimeout(() => this.onstop?.(), 5); },
    },
    async stopCapture(): Promise<any> {
      if (!this.recorder || !this.isCapturing) {
        if (this.error !== null) {
          const failure = this.error;
          const orphaned = this.chunks.length;
          this.error = null;
          this.chunks = [];
          return {
            success: false,
            error: `${failure}. ${String(orphaned)} chunk(s) were recorded before it and have been discarded.`,
          };
        }
        return { success: false, error: 'No capture in progress.' };
      }
      if (this.stopping) return await this.stopping;

      this.stopping = new Promise(resolve => {
        this.recorder.onstop = (): void => {
          this.isCapturing = false;
          if (this.error !== null) {
            const failure = this.error;
            this.error = null;
            this.chunks = [];
            resolve({ success: false, error: `${failure} during stop; the recording is incomplete.` });
            return;
          }
          const collected = this.chunks;
          this.chunks = [];
          resolve({ success: true, blob: collected });
        };
        this.recorder.stop();
      });

      try { return await this.stopping; } finally { this.stopping = null; }
    },
  };
  return capture;
}

describe('a recorder error reaches the caller (#437)', () => {
  it('reports the error instead of "No capture in progress"', async () => {
    const capture = makeCapture();
    // What `recorder.onerror` does.
    capture.error = 'MediaRecorder error occurred';
    capture.isCapturing = false;

    const result = await capture.stopCapture();

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/MediaRecorder error occurred/);
    // And says what became of the audio, rather than leaving it a mystery.
    expect(result.error).toMatch(/1 chunk\(s\)/);
  });

  it('does not report success over a recording an error truncated', async () => {
    const capture = makeCapture();
    // The error lands after the stop handler is installed, so
    // `dataavailable` and `stop` still fire.
    const stopped = capture.stopCapture();
    capture.error = 'MediaRecorder error occurred';

    const result = await stopped;

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/incomplete/);
  });

  it('still returns a clean recording when nothing went wrong', async () => {
    // The failure path must not start firing on healthy captures.
    const capture = makeCapture();

    const result = await capture.stopCapture();

    expect(result.success).toBe(true);
    expect(result.blob).toEqual(['chunk-a']);
  });

  it('the shipped source reads the error at both seams', () => {
    // Ties the transcription above to the code that ships; without it
    // these tests assert a copy.
    const source = require('node:fs').readFileSync(
      require('node:path').join(__dirname, '..', '..', 'services', 'AudioCaptureService.ts'),
      'utf8'
    ) as string;

    // The refused-stop branch.
    expect(source).toMatch(/chunk\(s\) were recorded before it and have been discarded/);
    // The during-stop branch.
    expect(source).toMatch(/during stop; the recording is incomplete/);
    // And a fresh start does not inherit the last capture's error.
    expect(source).toMatch(/A previous capture's error is not this one's\./);
  });
});
