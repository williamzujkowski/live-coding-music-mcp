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
    // Aggregate across every window, not one of them: 8 windows of 1e-2.
    expect(verdict.spanFraction).toBeCloseTo(0.08, 6);
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

  it('grows past a NON-EMPTY sample that is still too small to trust', () => {
    // The stronger version of the test above, which cross-model review
    // pointed out was weaker than it read: at 40,000 events per cycle the
    // middle rungs are simply EMPTY, so that test only shows the probe
    // walking past nothing. Here the 1e-4 window holds 12 onsets — real,
    // and still too few to extrapolate from — so growth has to be driven
    // by the sample being small rather than absent.
    const widths: number[] = [];
    const counted = (begin: number, end: number): ProbeHap[] => {
      widths.push(end - begin);
      return evenlySpaced(120_000)(begin, end);
    };
    const verdict = probeEventDensity(counted, 0, 1, { maxEvents: CAP });
    expect(verdict.kind).toBe('refuse');
    // The 1e-4 rung was sampled and was not empty, and it grew anyway.
    expect(widths.some(w => Math.abs(w - 1e-4) < 1e-9)).toBe(true);
    expect(evenlySpaced(120_000)(0, 1e-4).length).toBeGreaterThan(0);
    expect(Math.max(...widths)).toBeGreaterThanOrEqual(1e-2);
  });

  it('refuses clustered events by counting them, with no density to project', () => {
    // Eight chords of ten thousand layers hold 80,000 events and describe
    // no density at all — every sample fails the distinctness gate, so
    // the projection has nothing to work with. Counting still works, and
    // without it this returned `proceed` and materialized the lot.
    // Every window sees ten thousand onsets at ONE instant: a large
    // count with no spread, which is exactly the shape the distinctness
    // gate refuses to extrapolate from.
    const chordPerSlice: (b: number, e: number) => ProbeHap[] = (begin) =>
      Array.from({ length: 10_000 }, () => ({ whole: { begin: { valueOf: () => begin } } }));
    const verdict = probeEventDensity(chordPerSlice, 0, 1, { maxEvents: CAP });
    expect(verdict.kind).toBe('refuse');
    if (verdict.kind !== 'refuse') return;
    expect(verdict.projected).toBeGreaterThan(CAP);
  });

  it('spends few queries and stops as soon as it has an answer', () => {
    const calls: Array<[number, number]> = [];
    const counted = (begin: number, end: number): ProbeHap[] => {
      calls.push([begin, end]);
      return evenlySpaced(1e10)(begin, end);
    };
    probeEventDensity(counted, 0, 1, { maxEvents: CAP });
    // Exactly one. A pattern this dense is refusable from the first
    // window at the first rung, and `<= 9` was vacuous — it passed
    // whatever the offset loop did (found by cross-model review).
    expect(calls.length).toBe(1);
  });

  it('bounds the work on a sparse pattern', () => {
    const verdict = probeEventDensity(evenlySpaced(4), 0, 1, { maxEvents: CAP });
    expect(verdict.kind).toBe('proceed');
    if (verdict.kind !== 'proceed') return;
    // 4 ladder steps x 8 offsets. If this grows, the sparse path — which
    // is every ordinary pattern — got slower, and that cost is paid on
    // every query_pattern_events call.
    expect(verdict.queries).toBeLessThanOrEqual(32);
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

  it('refuses on counted events when they all start together', () => {
    // Thousands of layers at the same instant clear the sample target
    // but fail the distinctness gate — they describe a chord, not a
    // rate. They are still events, and cap-many of them inside the range
    // is proof enough without any extrapolation.
    const chord: (b: number, e: number) => ProbeHap[] = (begin, end) =>
      begin <= 0 && end > 0
        ? Array.from({ length: CAP + 1 }, () => ({ whole: { begin: { valueOf: () => 0 } } }))
        : [];
    const verdict = probeEventDensity(chord, 0, 1, { maxEvents: CAP });
    expect(verdict.kind).toBe('refuse');
    if (verdict.kind !== 'refuse') return;
    expect(verdict.projected).toBe(CAP + 1);
  });

  it('proceeds on a degenerate range instead of dividing by zero', () => {
    expect(probeEventDensity(evenlySpaced(1e10), 3, 3, { maxEvents: CAP }).kind).toBe('proceed');
  });
});

/**
 * A window full of events counts, distinct or not (#460).
 *
 * The distinctness gate exists to stop a rate being extrapolated from a
 * handful of stacked events — `s("bd").slow(64)` returns one hap at any
 * span, and projecting from it refused ordinary patterns (rule 1). It
 * was never meant to discard a window that is FULL.
 *
 * Discarding it let through exactly what the probe exists to refuse.
 * Measured before the fix, 150,000 onset instants x 250 simultaneous
 * layers — 37,500,000 events in one cycle:
 *
 *   {"kind":"proceed","observedOnsets":3750,"windowsWithOnsets":8}
 *
 * All eight windows saw the density and none was allowed to say so:
 * each cleared `sampleTarget` (so the ladder stopped) but failed
 * `minDistinct` (so it went unrecorded), and `countedFloor` stayed under
 * the cap because eight small windows hold few events in absolute terms.
 */
describe('a full window is believed even when its onsets are not distinct (#460)', () => {
  /** N onset instants per cycle, each carrying L simultaneous layers. */
  const layered = (instants: number, layers: number) =>
    (begin: number, end: number): Array<{ whole: { begin: number } }> => {
      const out: Array<{ whole: { begin: number } }> = [];
      for (let cycle = Math.floor(begin); cycle < Math.ceil(end); cycle++) {
        for (let i = 0; i < instants; i++) {
          const t = cycle + i / instants;
          if (t < begin || t >= end) continue;
          for (let l = 0; l < layers; l++) out.push({ whole: { begin: t } });
        }
      }
      return out;
    };

  it('refuses 37.5 million events in a cycle', () => {
    const verdict = probeEventDensity(layered(150000, 250), 0, 1, { maxEvents: 50000 });

    expect(verdict.kind).toBe('refuse');
    // And the projection is the truth, not a guess: 150000 * 250.
    if (verdict.kind === 'refuse') {
      expect(verdict.projected).toBe(37500000);
    }
  });

  it('still allows layers that merely start together', () => {
    // Rule 1, which this must not undo: simultaneity is not density.
    // 200 layers is far below the sample target, so the window is not
    // full and the distinctness gate still governs.
    expect(probeEventDensity(layered(1, 200), 0, 1, { maxEvents: 50000 }).kind)
      .toBe('proceed');
  });

  it('still allows a pattern just under the cap', () => {
    // Rule 3: the near-cap verdict is an average, not a maximum.
    expect(probeEventDensity(layered(40000, 1), 0, 1, { maxEvents: 50000 }).kind)
      .toBe('proceed');
  });

  it('still allows an ordinary pattern', () => {
    expect(probeEventDensity(layered(4, 1), 0, 4, { maxEvents: 50000 }).kind)
      .toBe('proceed');
  });
});
