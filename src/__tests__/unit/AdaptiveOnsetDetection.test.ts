/**
 * Onset detection judges a local outlier, not a fixed threshold (#322).
 *
 * `ONSET_THRESHOLD = 0.3` was unreachable. Flux is normalized by bin
 * count AND by 255, so 0.3 demands an average jump of +76/255 across
 * every bin. A realistic kick transient measures 0.057 — five times
 * under — so only a silence-to-full-scale transition ever fired.
 *
 * Picking a smaller constant would just be a different guess: what
 * counts as a transient depends on the material, and a dense mix has a
 * higher flux floor than a sparse one. So this asks whether a value is
 * an outlier against recent history.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { AudioAnalyzer } from '../../AudioAnalyzer';

/** Feed a flux sequence, return which samples fired. */
function detect(sequence: number[]): boolean[] {
  const analyzer = new AudioAnalyzer();
  analyzer.resetOnsetDetection();
  return sequence.map(f => analyzer.isOnset(f));
}

const count = (sequence: number[]) => detect(sequence).filter(Boolean).length;

describe('realistic transients are detected (#322)', () => {
  it('a kick at 0.057 over a 0.01 floor fires', () => {
    // The measured value for a realistic kick (low bins 30->240, mids
    // 90->120). The old fixed threshold never fired on it.
    const sequence = [
      ...new Array(8).fill(0.01),
      0.057, 0.01, 0.01, 0.01,
      0.057, 0.01, 0.01, 0.01,
      0.057,
    ];
    expect(count(sequence)).toBe(3);
  });

  it('fires on the transient, not the samples around it', () => {
    const sequence = [...new Array(8).fill(0.01), 0.057, 0.01, 0.01];
    expect(detect(sequence).slice(8)).toEqual([true, false, false]);
  });

  it('adapts to a dense mix with a higher floor', () => {
    // 0.35 over a 0.08 background. A fixed threshold tuned for the
    // sparse case would fire on the background here.
    const sequence = [
      ...new Array(8).fill(0.08),
      0.35, 0.08, 0.08, 0.08,
      0.35,
    ];
    expect(count(sequence)).toBe(2);
  });
});

describe('nothing fires when nothing happens (#322)', () => {
  it('silence produces no onsets', () => {
    expect(count(new Array(16).fill(0.0005))).toBe(0);
  });

  it('exact zero produces no onsets', () => {
    expect(count(new Array(16).fill(0))).toBe(0);
  });

  it('a steady dense signal produces no onsets', () => {
    // Loud but unchanging is not a beat. A detector that fires here
    // would report a tempo from a drone.
    expect(count(new Array(16).fill(0.08))).toBe(0);
  });

  it('a slow ramp is not a series of onsets', () => {
    const ramp = Array.from({ length: 20 }, (_, i) => 0.01 + i * 0.002);
    expect(count(ramp)).toBeLessThan(3);
  });
});

describe('the detector has state that must be reset (#322)', () => {
  it('resetOnsetDetection clears the window', () => {
    const analyzer = new AudioAnalyzer();
    for (const f of new Array(16).fill(0.08)) analyzer.isOnset(f);
    analyzer.resetOnsetDetection();
    // With a fresh window the fallback threshold applies, so a small
    // value does not fire on the first sample of a new capture.
    expect(analyzer.isOnset(0.05)).toBe(false);
  });

  it('a new capture does not inherit the previous mix\'s floor', () => {
    const analyzer = new AudioAnalyzer();
    for (const f of new Array(16).fill(0.3)) analyzer.isOnset(f);
    analyzer.resetOnsetDetection();
    for (const f of new Array(8).fill(0.01)) analyzer.isOnset(f);
    // A quiet transient after a loud passage still registers.
    expect(analyzer.isOnset(0.057)).toBe(true);
  });
});

describe('early samples fall back rather than firing wildly (#322)', () => {
  it('does not fire on the very first sample', () => {
    expect(detect([0.057])[0]).toBe(false);
  });

  it('a full-scale first sample still fires', () => {
    // The fixed threshold remains as a floor for the warm-up window.
    expect(detect([0.9])[0]).toBe(true);
  });
});

describe('the adaptive detector is actually wired in (#322)', () => {
  /**
   * The tests above drive `isOnset` directly, so they would all pass
   * with the call sites still using the bare `flux > ONSET_THRESHOLD`.
   * That is exactly how a fix gets silently reverted, so this checks
   * the wiring rather than the logic.
   */
  it('no call site compares flux to the fixed threshold directly', () => {
    const source = readFileSync(
      join(__dirname, '..', '..', 'AudioAnalyzer.ts'), 'utf-8');
    const offenders = source.split('\n')
      .map((line, i) => ({ line: line.trim(), n: i + 1 }))
      .filter(({ line }) => /flux\s*>\s*this\.ONSET_THRESHOLD/.test(line))
      // The fallback inside isOnset itself is the one legitimate use.
      .filter(({ line }) => !line.includes('return flux > this.ONSET_THRESHOLD'));

    expect(offenders.map(o => `AudioAnalyzer.ts:${String(o.n)}  ${o.line}`)).toEqual([]);
  });

  it('every onset decision goes through isOnset', () => {
    const source = readFileSync(
      join(__dirname, '..', '..', 'AudioAnalyzer.ts'), 'utf-8');
    expect((source.match(/if \(this\.isOnset\(flux\)\)/g) ?? []).length)
      .toBeGreaterThanOrEqual(4);
  });
});
