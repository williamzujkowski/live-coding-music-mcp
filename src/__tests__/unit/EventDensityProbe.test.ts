/**
 * The guard that decides whether a query is safe to materialize (#360).
 *
 * Driven with a synthetic `queryArc` so every case is exact: @strudel/*
 * is ESM and cannot load under this project's CommonJS Jest, and the
 * behaviour under test is arithmetic, not Strudel. The real engine is
 * covered end to end by `npm run test:sandbox`.
 */

import {
  probeEventDensity,
  OBVIOUSLY_HUGE_MULTIPLE,
  type ProbeHap,
} from '../../services/EventDensityProbe';

const CAP = 50_000;

/** A pattern with `perCycle` evenly spaced onsets, optionally only after `from`. */
function evenlySpaced(perCycle: number, from = 0): (b: number, e: number) => ProbeHap[] {
  return (begin: number, end: number) => {
    const haps: ProbeHap[] = [];
    const spacing = 1 / perCycle;
    const first = Math.ceil(Math.max(begin, from) / spacing);
    for (let k = first; k * spacing < end; k++) {
      const t = k * spacing;
      if (t < from) continue;
      haps.push({ whole: { begin: { valueOf: () => t } } });
      if (haps.length > 1_000_000) break;
    }
    return haps;
  };
}

describe('probeEventDensity (#360)', () => {
  it('refuses a pattern far denser than the cap, on a tiny sample', () => {
    const verdict = probeEventDensity(evenlySpaced(1e10), 0, 1, { maxEvents: CAP });
    expect(verdict.kind).toBe('refuse');
    if (verdict.kind !== 'refuse') return;
    expect(verdict.projected).toBeGreaterThan(CAP * OBVIOUSLY_HUGE_MULTIPLE);
    // The whole point of the shortcut: at 10^10 per cycle there is no
    // growing the window, so the decision has to come from a sample
    // small enough to survive taking.
    expect(verdict.sampleCount).toBeLessThan(5000);
  });

  it('refuses a pattern that is dense only after a leading rest', () => {
    // The hole that made this issue worse than it was filed: one `~` and
    // the old head-anchored probe saw nothing at any span.
    const verdict = probeEventDensity(evenlySpaced(1e10, 0.5), 0, 1, { maxEvents: CAP });
    expect(verdict.kind).toBe('refuse');
  });

  it('refuses when the density is confined to the last eighth', () => {
    const verdict = probeEventDensity(evenlySpaced(1e10, 0.875), 0, 1, { maxEvents: CAP });
    expect(verdict.kind).toBe('refuse');
  });

  it('does not extrapolate from a single event at the range start', () => {
    // `s("bd").slow(64)` measures exactly this: one hap at t=0. Naively
    // projecting from a 1e-9 window gives 10^9 events and refuses one of
    // the most ordinary patterns there is.
    const oneEvent: (b: number, e: number) => ProbeHap[] = (begin, end) =>
      begin <= 0 && end > 0 ? [{ whole: { begin: { valueOf: () => 0 } } }] : [];
    expect(probeEventDensity(oneEvent, 0, 1, { maxEvents: CAP }).kind).toBe('proceed');
  });

  it('does not extrapolate from many layers that all start together', () => {
    // A stack of N layers at t=0 is ONE moment observed N times. Counting
    // haps rather than distinct onset times would project N/1e-9 and
    // refuse a 40-layer stack.
    const stacked: (b: number, e: number) => ProbeHap[] = (begin, end) =>
      begin <= 0 && end > 0
        ? Array.from({ length: 200 }, () => ({ whole: { begin: { valueOf: () => 0 } } }))
        : [];
    expect(probeEventDensity(stacked, 0, 1, { maxEvents: CAP }).kind).toBe('proceed');
  });

  it('ignores a note held across the window but beginning outside it', () => {
    // Sustained haps overlap every probe. They are not evidence of
    // density here, and counting them would refuse anything long.
    const sustained: (b: number, e: number) => ProbeHap[] = () =>
      Array.from({ length: 500 }, () => ({ whole: { begin: { valueOf: () => -10 } } }));
    expect(probeEventDensity(sustained, 0, 1, { maxEvents: CAP }).kind).toBe('proceed');
  });

  it('lets a pattern near the cap through for the exact check to judge', () => {
    // 40,000 events is under the cap. Refusing at the cap turns the
    // probe's sampling error into a false refusal, and the caller counts
    // the real haps for free a moment later.
    expect(probeEventDensity(evenlySpaced(40_000), 0, 1, { maxEvents: CAP }).kind).toBe('proceed');
  });

  it('still refuses a pattern a few times over the cap', () => {
    expect(probeEventDensity(evenlySpaced(400_000), 0, 1, { maxEvents: CAP }).kind).toBe('refuse');
  });

  it('refuses a pattern only modestly over the cap, from a grown sample', () => {
    // Not caught by the obviously-huge shortcut (120,000 is under ten
    // times the cap), so this only works if the largest sample an offset
    // can take is actually USED. Discarding it for falling short of the
    // sample target let this walk straight past the guard.
    const verdict = probeEventDensity(evenlySpaced(120_000), 0, 1, { maxEvents: CAP });
    expect(verdict.kind).toBe('refuse');
    if (verdict.kind !== 'refuse') return;
    expect(verdict.projected).toBeGreaterThan(CAP);
    expect(verdict.spanFraction).toBe(1e-2);
  });

  it('grows the window rather than trusting a small sample near the cap', () => {
    // The measured failure this replaced a fudge factor with: a 1e-3
    // window at t=0 of s("bd*40000") holds 80 onsets against a cycle
    // average of 40, projecting 80,000 against a 50,000 cap. Refusing on
    // that sample is a false refusal; growing the window is not.
    const calls: number[] = [];
    const counted = (begin: number, end: number): ProbeHap[] => {
      calls.push(end - begin);
      return evenlySpaced(40_000)(begin, end);
    };
    expect(probeEventDensity(counted, 0, 1, { maxEvents: CAP }).kind).toBe('proceed');
    // It had to look at a window big enough to hold a real sample.
    expect(Math.max(...calls)).toBeGreaterThanOrEqual(1e-2);
  });

  it('spends few queries and stops as soon as it has an answer', () => {
    const calls: Array<[number, number]> = [];
    const counted = (begin: number, end: number): ProbeHap[] => {
      calls.push([begin, end]);
      return evenlySpaced(1e10)(begin, end);
    };
    probeEventDensity(counted, 0, 1, { maxEvents: CAP });
    // 8 offsets at the smallest span, then the first offset of the next.
    expect(calls.length).toBeLessThanOrEqual(9);
  });

  it('bounds the work on a sparse pattern', () => {
    const verdict = probeEventDensity(evenlySpaced(4), 0, 1, { maxEvents: CAP });
    expect(verdict.kind).toBe('proceed');
    if (verdict.kind !== 'proceed') return;
    // 3 ladder steps x 8 offsets. If this grows, the sparse path — which
    // is every ordinary pattern — got slower, and that cost is paid on
    // every query_pattern_events call.
    expect(verdict.queries).toBeLessThanOrEqual(24);
  });

  it('never probes outside the requested range', () => {
    const calls: Array<[number, number]> = [];
    probeEventDensity(
      (begin, end) => { calls.push([begin, end]); return []; },
      4,
      8,
      { maxEvents: CAP }
    );
    for (const [begin, end] of calls) {
      expect(begin).toBeGreaterThanOrEqual(4);
      expect(end).toBeLessThanOrEqual(8);
    }
  });

  it('proceeds on a degenerate range instead of dividing by zero', () => {
    expect(probeEventDensity(evenlySpaced(1e10), 3, 3, { maxEvents: CAP }).kind).toBe('proceed');
  });
});
