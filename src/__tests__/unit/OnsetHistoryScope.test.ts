/**
 * A tempo reading must describe the performance it is measuring (#366).
 *
 * `_onsetHistory` was bounded by COUNT and nothing else, so 100 onsets
 * could span ten seconds of one pattern or five minutes across four.
 * Measured against real playback: playing dnb at 174 and then house at
 * 125, the first house reading came back **174** — the previous
 * pattern's onsets outnumbered the new ones. Every wrong first reading
 * in that run was the pattern before it.
 */

import { AudioAnalyzer } from '../../AudioAnalyzer';
import { StrudelController } from '../../StrudelController';

/** Reaches the private history without pretending it is public API. */
function historyOf(analyzer: AudioAnalyzer): { t: number; strength: number }[] {
  return (analyzer as unknown as { _onsetHistory: { t: number; strength: number }[] })._onsetHistory;
}

function merge(analyzer: AudioAnalyzer, onsets: { t: number; strength: number }[]): void {
  (analyzer as unknown as { mergeOnsetHistory: (o: unknown[]) => void }).mergeOnsetHistory(onsets);
}

const beat = (t: number) => ({ t, strength: 0.06 });

describe('onset history scope (#366)', () => {
  it('drops everything across a silence, rather than mixing two performances', () => {
    const analyzer = new AudioAnalyzer();
    merge(analyzer, [beat(1000), beat(1345), beat(1690)]);
    // Two seconds later: the transport stopped and something else started.
    merge(analyzer, [beat(4000), beat(4480)]);
    expect(historyOf(analyzer).map(o => o.t)).toEqual([4000, 4480]);
  });

  it('keeps a continuous series across consecutive buffers', () => {
    // A 5s poll cadence with audio running throughout must NOT be
    // treated as a break, or nothing accumulates and the autocorrelation
    // never has enough onsets.
    const analyzer = new AudioAnalyzer();
    merge(analyzer, [beat(1000), beat(1345)]);
    merge(analyzer, [beat(1690), beat(2035)]);
    expect(historyOf(analyzer)).toHaveLength(4);
  });

  it('bounds the history by age, not only by count', () => {
    // 100 onsets can span ten seconds or five minutes. Age is what
    // matters to a tempo.
    const analyzer = new AudioAnalyzer();
    merge(analyzer, [beat(0), beat(345), beat(690)]);
    merge(analyzer, [beat(1000), beat(1345)]);
    merge(analyzer, [beat(2000), beat(20_000)]);
    const kept = historyOf(analyzer).map(o => o.t);
    expect(kept).toContain(20_000);
    expect(kept).not.toContain(0);
  });

  it('still bounds the history by count', () => {
    const analyzer = new AudioAnalyzer();
    // Dense but recent: age keeps them all, so the count bound must act.
    merge(analyzer, Array.from({ length: 400 }, (_, i) => beat(i * 20)));
    expect(historyOf(analyzer).length).toBeLessThanOrEqual(100);
  });

  it('resetTempoHistory forgets everything', () => {
    const analyzer = new AudioAnalyzer();
    merge(analyzer, [beat(1000), beat(1345)]);
    analyzer.resetTempoHistory();
    expect(historyOf(analyzer)).toEqual([]);
  });

  it('is reset when the pattern changes and when playback stops', () => {
    // The unit above proves the mechanism; this proves it is WIRED.
    // Without these two calls the mechanism is decorative — the same
    // gap that made #307's isolation tests pass against an unplugged
    // fix.
    const source = readFileSyncSafe('src/StrudelController.ts');
    expect(source).toMatch(/resetTempoHistory\(\)/);
    const writeAt = source.indexOf('async writePattern(');
    const stopAt = source.indexOf('async stop()');
    const resets = [...source.matchAll(/resetTempoHistory\(\)/g)].map(m => m.index ?? -1);
    expect(resets.some(at => at > writeAt && at < stopAt)).toBe(true);
    expect(resets.some(at => at > stopAt)).toBe(true);
  });
});

function readFileSyncSafe(relative: string): string {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const fs = require('node:fs') as typeof import('node:fs');
  const path = require('node:path') as typeof import('node:path');
  return fs.readFileSync(path.join(__dirname, '..', '..', '..', relative), 'utf8');
}

describe('StrudelController is constructible for the wiring check', () => {
  it('exists', () => {
    expect(typeof StrudelController).toBe('function');
  });
});
