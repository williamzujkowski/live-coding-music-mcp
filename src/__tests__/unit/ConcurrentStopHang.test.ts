/**
 * Two concurrent stops must not hang a request forever (#437).
 *
 * The page-side `stopCapture` overwrote `recorder.onstop` and resolved
 * from it. `isCapturing` is cleared INSIDE `onstop`, which has not run
 * when a second stop arrives — so both calls got past the guard, the
 * second overwrote the first's `onstop` and called `stop()` on an
 * inactive recorder. The second threw InvalidStateError; the first
 * call's resolver became unreachable, and `page.evaluate` has no
 * timeout, so that MCP request never returned.
 *
 * `server.ts` says in its own words that "The MCP SDK does not serialize
 * tool calls", and this repo was bitten by the same race shape in #265.
 *
 * The behavioural tests below run a TRANSCRIPTION of the page-side
 * logic, not the shipped code — that code only exists inside a
 * `page.evaluate` closure, and a browser adds nothing here but minutes.
 * A transcription can drift from its subject, which is how #397's
 * parser bug hid, so the last test in this file reads the shipped source
 * and asserts the guard and the timeout are actually in it. The
 * behavioural tests say what the control flow should do; that one ties
 * the claim to the code that ships.
 */

/** The stop logic under test, in the shape the page holds it. */
function makeCapture(options: { stopFires: boolean }) {
  const capture: Record<string, any> = {
    stopping: null,
    isCapturing: true,
    startTime: Date.now(),
    chunks: ['chunk-a', 'chunk-b'],
    recorder: {
      stopCalls: 0,
      onstop: null as null | (() => void),
      state: 'recording',
      stop(): void {
        this.stopCalls++;
        if (this.state !== 'recording') throw new Error('InvalidStateError');
        this.state = 'inactive';
        if (options.stopFires) setTimeout(() => this.onstop?.(), 5);
      },
    },
    async stopCapture(): Promise<any> {
      if (!this.recorder || !this.isCapturing) {
        return { success: false, error: 'No capture in progress.' };
      }
      if (this.stopping) return await this.stopping;

      this.stopping = new Promise(resolve => {
        const recorder = this.recorder;
        const startTime = this.startTime;
        recorder.onstop = (): void => {
          this.isCapturing = false;
          if (this.chunks.length === 0) {
            resolve({ success: false, error: 'No audio data captured.' });
            return;
          }
          const collected = this.chunks;
          this.chunks = [];
          resolve({ success: true, blob: collected, duration: Date.now() - startTime });
        };
        setTimeout(() => {
          if (!this.isCapturing && this.chunks.length === 0) return;
          this.isCapturing = false;
          const collected = this.chunks;
          this.chunks = [];
          resolve(collected.length === 0
            ? { success: false, error: 'Recorder did not stop, and nothing was captured.' }
            : { success: true, blob: collected, warning: 'Recorder did not stop cleanly; returned what was captured.' });
        }, 60);
        recorder.stop();
      });

      try {
        return await this.stopping;
      } finally {
        this.stopping = null;
      }
    },
  };
  return capture;
}

describe('a concurrent stop does not hang (#437)', () => {
  it('two stops both return, and the recorder is stopped once', async () => {
    const capture = makeCapture({ stopFires: true });

    const [first, second] = await Promise.all([
      capture.stopCapture(),
      capture.stopCapture(),
    ]);

    expect(first.success).toBe(true);
    expect(second).toBe(first);          // the same in-flight result
    expect(capture.recorder.stopCalls).toBe(1);  // no InvalidStateError
  });

  it('returns what was captured when the recorder never stops', async () => {
    // `page.evaluate` has no timeout: without this the request waits
    // forever on a resolver that will never be called.
    const capture = makeCapture({ stopFires: false });

    const result = await capture.stopCapture();

    expect(result.success).toBe(true);
    expect(result.warning).toMatch(/did not stop cleanly/);
    expect(result.blob).toEqual(['chunk-a', 'chunk-b']);
  });

  it('a stop after the capture ended still reports plainly', async () => {
    const capture = makeCapture({ stopFires: true });
    await capture.stopCapture();

    await expect(capture.stopCapture()).resolves.toEqual({
      success: false,
      error: 'No capture in progress.',
    });
  });

  /**
   * Ties the transcription above to the code that ships.
   *
   * Without this, these tests assert a copy — green while the real
   * injected object regressed. Same idea as the source assertion in
   * `GeneratedTempo.test.ts`.
   */
  it('the shipped injected code has the guard and the bound', () => {
    const source = require('node:fs').readFileSync(
      require('node:path').join(__dirname, '..', '..', 'services', 'AudioCaptureService.ts'),
      'utf8'
    ) as string;

    // A second stop awaits the first rather than installing its own
    // resolver.
    expect(source).toMatch(/if \(capture\.stopping\) \{\s*\n\s*return await capture\.stopping;/);
    expect(source).toMatch(/capture\.stopping = new Promise/);
    // And the in-flight promise is cleared, or the next stop deadlocks.
    expect(source).toMatch(/finally \{\s*\n\s*capture\.stopping = null;/);
    // The bounded wait, because page.evaluate has none.
    expect(source).toMatch(/Recorder did not stop cleanly/);
  });
});
