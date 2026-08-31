/**
 * Two reporting defects found by a correctness sweep (#343).
 */

import { describeMeasurements, SILENCE_THRESHOLD } from '../../services/ai/AudioMeasurements';
import { findBrowserOnlyCall, explainBrowserOnly } from '../../services/BrowserOnlyFunctions';

describe('a silent capture is described as silent (#343)', () => {
  it('says nothing was recorded', () => {
    // It said "Infinity dB of headroom" — arithmetically true and
    // useless. buildMeasurementPrompt then wraps this in "treat them as
    // ground truth" and asks the model for mood, style and energy.
    const text = describeMeasurements({ durationMs: 5000, peak: 0, rms: 0 });
    expect(text).toContain('SILENT');
    expect(text).not.toContain('Infinity dB of headroom');
  });

  it('tells the model not to infer anything from it', () => {
    const text = describeMeasurements({ durationMs: 5000, peak: 0, rms: 0 });
    expect(text).toMatch(/Do not infer/i);
  });

  it('names the likely causes', () => {
    const text = describeMeasurements({ durationMs: 5000, peak: 0, rms: 0 });
    expect(text).toMatch(/capture failed|not playing/i);
  });

  it('catches near-silence, not just exact zero', () => {
    // Dithering, a DC offset or one stray sample leaves a capture
    // technically non-zero while containing no audio.
    const text = describeMeasurements({ durationMs: 5000, peak: 2e-5, rms: 1e-5 });
    expect(text).toContain('SILENT');
  });

  it('does not cry silence over real audio', () => {
    const text = describeMeasurements({ durationMs: 5000, peak: 0.7, rms: 0.2 });
    expect(text).not.toContain('SILENT');
    expect(text).toContain('3.1 dB of headroom');
  });

  it('still reports clipping', () => {
    expect(describeMeasurements({ durationMs: 5000, peak: 1.2, rms: 0.6 }))
      .toContain('CLIPPING');
  });

  it('the threshold is small enough not to swallow quiet music', () => {
    // -80 dBFS is far below anything audible in a mix.
    expect(SILENCE_THRESHOLD).toBeLessThan(1e-3);
    expect(describeMeasurements({ durationMs: 5000, peak: 0.01, rms: 0.005 }))
      .not.toContain('SILENT');
  });
});

describe('browser-only detection (#343)', () => {
  it.each(['panic', 'getcpm'])('%s is recognised as browser-only', name => {
    // Siblings of hush and setcpm, and just as absent locally. Without
    // them these produced the "reads as a typo" message #232 removed.
    expect(explainBrowserOnly(name)).toBeTruthy();
    expect(explainBrowserOnly(name)).toContain('real Strudel function');
  });

  it.each([
    's("bd*4") // load samples("x") first',
    '/* samples("x") */ s("bd*4")',
    's("bd*4")\n// remember to hush() afterwards',
  ])('a mention in a comment is not a call: %s', code => {
    // Consulted on the ERROR path, so this misattributed genuine syntax
    // errors: an unterminated string with samples("x") in a trailing
    // comment was reported as a network-loading problem.
    expect(findBrowserOnlyCall(code)).toBeNull();
  });

  it.each([
    ['samples("x"); s("bd*4")', 'samples'],
    ['hush()', 'hush'],
    ['s("bd*4").hush()', 'hush'],
  ])('a real call is still found: %s', (code, expected) => {
    expect(findBrowserOnlyCall(code)).toBe(expected);
  });

  it('a mention inside a string is still not a call', () => {
    expect(findBrowserOnlyCall('s("hush(1) bd")')).toBeNull();
  });

  it('a prototype key does not resolve to an explanation', () => {
    expect(explainBrowserOnly('constructor')).toBeNull();
    expect(explainBrowserOnly('toString')).toBeNull();
  });
});
