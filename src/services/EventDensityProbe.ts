/**
 * Decides whether a pattern query is safe to materialize (#360).
 *
 * ## What was wrong with the old guard
 *
 * `queryEvents` sampled the first 1e-4 of the requested range, extrapolated,
 * and refused if the projection exceeded the cap. Measured, that guard has
 * two independent holes:
 *
 *   s("bd*200000")        -> refused correctly
 *   s("~ bd*200000")      -> OUT OF HEAP. One leading rest, and the probe
 *                            sees nothing, projects nothing, refuses nothing.
 *   s("[bd*99999]*99999") -> OUT OF HEAP. 1e-4 of a 10^10-event cycle is
 *                            still 10^6 events; the probe dies before it
 *                            can refuse.
 *
 * The second is the cheaper attack: it needs no density in the probe
 * window at all, just ordinary musical notation.
 *
 * ## What this does instead
 *
 * Probes at several offsets spread across the range — so a rest at the
 * start cannot hide anything — with the span grown geometrically from
 * very small, so a dense pattern is caught while the sample is still
 * tiny.
 *
 * ## The rule that makes it safe to extrapolate
 *
 * Measured, and it is the part that is easy to get wrong:
 *
 *   s("bd").slow(64)              at span 1e-12 -> 1 hap
 *   stack(s("bd*4"), s("hh*8"))   at span 1e-12 -> 2 haps
 *
 * Naively projecting the first gives 10^12 events and refuses one of the
 * most ordinary patterns there is. Events legitimately begin at t=0, and
 * a window narrower than the true inter-onset interval ALWAYS
 * over-projects. So a projection is only taken once the sample looks
 * like a sample: at least `minDistinctOnsets` DISTINCT onset times
 * inside the window. Distinct times, not hap count — a stack of N layers
 * all starting together is one moment observed N times, and says nothing
 * about density.
 *
 * (The old `PROBE_FRACTION = 1e-4` avoided this by arithmetic accident:
 * one stray hap projects to 10^4, which happens to sit under the 50,000
 * cap. Any smaller constant would have begun refusing real patterns.)
 *
 * ## Residual
 *
 * Sampling cannot be sound against arbitrary non-uniform density. A
 * pattern dense only inside a gap between every probe window, at every
 * ladder step, reaches the sparse path and can still exhaust the heap.
 * Since #307 that is a contained failure — an error envelope and a
 * respawned child — rather than a dead server. Stated rather than
 * implied away.
 */

/** A hap, reduced to the only field this needs. */
export interface ProbeHap {
  whole?: { begin: { valueOf: () => number } };
}

export type ProbeVerdict =
  | {
      kind: 'refuse';
      /** Extrapolated event count over the full requested range. */
      projected: number;
      /** Onsets the decision rested on. */
      sampleCount: number;
      /** Fraction of the range that sample covered. */
      spanFraction: number;
    }
  | {
      /** Nothing found was dense enough to refuse. */
      kind: 'proceed';
      /** How many queries the probe spent. Diagnostics and benchmarks. */
      queries: number;
      /**
       * Onsets seen across all probe windows.
       *
       * Not diagnostics: the caller uses it to catch a query that
       * silently produced nothing. Strudel answers a large enough
       * `.fast()` with an internal "Maximum call stack size exceeded"
       * and an EMPTY array, which is indistinguishable from a genuinely
       * silent pattern unless you already know events were in there.
       */
      observedOnsets: number;
    };

export interface DensityProbeOptions {
  /** The cap the caller enforces exactly, after materializing. */
  maxEvents: number;
  /** How many windows to spread across the range. */
  offsets?: number;
  /** Onsets a window should hold before its density is trusted. */
  sampleTarget?: number;
  /** Distinct onset times required before a window may be extrapolated from. */
  minDistinctOnsets?: number;
  /** Span sizes to try, as fractions of the range, smallest first. */
  ladder?: readonly number[];
}

/**
 * Windows spread across the range. This is the guard's resolution: a
 * dense region narrower than 1/OFFSETS of the requested range, sitting
 * between two windows, is not seen.
 *
 * Six was tried and rejected — it misses density confined to the last
 * EIGHTH, which is an ordinary thing for a pattern to do. Coverage is
 * worth more here than the ~15ms it costs, because this runs on
 * query_pattern_events, a diagnostic, and not on the write path.
 */
export const DEFAULT_OFFSETS = 8;
export const DEFAULT_MIN_DISTINCT_ONSETS = 16;

/**
 * Onsets a window should hold before its density is believed.
 *
 * Small samples are unreliable in both directions and the error is not
 * academic: measured, a 1e-3 window at t=0 of `s("bd*40000")` holds 80
 * onsets where the cycle average is 40, so extrapolating from it
 * projects 80,000 against a 50,000 cap and refuses a pattern that is
 * comfortably legal. Growing the window until it holds a real sample
 * costs a few thousand haps and removes the guesswork; it is a much
 * better answer than a fudge factor on the threshold.
 */
export const DEFAULT_SAMPLE_TARGET = 2000;

/**
 * How far above the cap a SMALL sample must project before it is
 * believed without growing the window.
 *
 * This is the escape hatch for the pathological case: at 10^10 events
 * per cycle there is no growing the window — the next step up would
 * materialize more than the heap holds. A sample projecting ten times
 * the cap is not a borderline call, and waiting for a bigger one is how
 * the old guard died.
 */
export const OBVIOUSLY_HUGE_MULTIPLE = 10;

/**
 * Three rungs, not five. Every rung costs a query at every offset, and a
 * `queryArc` call has ~1.8 ms of fixed overhead regardless of how little
 * it returns — so the ladder's length, not its contents, is what the
 * ordinary sparse pattern pays for.
 *
 * The first rung has to be tiny or the probe is the thing that runs out
 * of heap: 1e-4 of a 10^10-event cycle is a million events, which is how
 * the guard this replaced died. From there, three orders of magnitude a
 * step reaches a usable sample for anything the cap cares about.
 */
export const DEFAULT_LADDER: readonly number[] = [1e-8, 1e-6, 1e-4, 1e-2];

/**
 * Fractional part of the golden ratio, used to offset each window within
 * its own slice.
 *
 * Evenly spaced windows are not enough, and the failure is not subtle.
 * `query_pattern_events` accepts up to 16 cycles; with 8 windows across
 * 16 cycles every window starts on a whole cycle — the SAME PHASE, eight
 * times. So a pattern with a leading rest hides from all of them:
 *
 *   s("~ bd*200000") over 0..1   -> refused
 *   s("~ bd*200000") over 0..4   -> OUT OF HEAP
 *   s("~ bd*200000") over 0..16  -> OUT OF HEAP
 *
 * Musical patterns repeat per cycle, so any window placement that is
 * commensurate with the cycle samples one phase repeatedly and calls it
 * coverage. An irrational step decorrelates the phases while keeping one
 * window per slice, which pure golden-ratio placement would not — that
 * leaves whole slices empty.
 */
const GOLDEN_FRACTION = 0.618033988749895;

/**
 * Hard ceiling on a probe window, in cycles, whatever the range.
 *
 * Ladder rungs are fractions of the requested range, and the range may be
 * 16 cycles — so the top rung would be 0.16 cycles wide, and a window
 * that starts in a rest and grows across the boundary into a dense region
 * materializes in proportion to how far it reaches. Capping the absolute
 * width bounds that exposure by 16x on the widest ranges without
 * changing any verdict: density is per cycle, so a smaller window
 * measures it just as well.
 */
const MAX_PROBE_CYCLES = 0.01;

/**
 * Decides whether querying `[start, end)` is safe.
 *
 * @param queryArc - The pattern's own query function
 * @param start - Range start, in cycles
 * @param end - Range end, in cycles
 * @param options - Cap and probe shape
 * @returns A refusal with its evidence, or permission to proceed
 */
export function probeEventDensity(
  queryArc: (begin: number, end: number) => ProbeHap[],
  start: number,
  end: number,
  options: DensityProbeOptions
): ProbeVerdict {
  const span = end - start;
  const offsets = options.offsets ?? DEFAULT_OFFSETS;
  const minDistinct = options.minDistinctOnsets ?? DEFAULT_MIN_DISTINCT_ONSETS;
  const sampleTarget = options.sampleTarget ?? DEFAULT_SAMPLE_TARGET;
  const ladder = options.ladder ?? DEFAULT_LADDER;
  const cap = options.maxEvents;

  let queries = 0;
  let observedOnsets = 0;
  /** Onsets and window width accumulated across every offset's chosen sample. */
  let sampledOnsets = 0;
  let sampledSpan = 0;
  if (span <= 0 || offsets < 1) return { kind: 'proceed', queries, observedOnsets };

  const step = span / offsets;

  for (let i = 0; i < offsets; i++) {
    // Where in this slice the window sits. Irrational in the cycle, so
    // eight windows sample eight different phases rather than the same
    // one eight times — see GOLDEN_FRACTION.
    const phase = (i * GOLDEN_FRACTION) % 1;

    for (let rung = 0; rung < ladder.length; rung++) {
      const fraction = ladder[rung];
      const probeSpan = Math.min(span * fraction, MAX_PROBE_CYCLES);
      if (probeSpan <= 0) continue;

      // Slid within its own slice, and never so far that the window runs
      // past the slice's end — which would put the last one past `end`.
      const windowStart = start + i * step + phase * (step - probeSpan);

      // Whether there is anywhere left to grow. The largest sample this
      // offset can produce still has to be USED — discarding it because
      // it fell short of the target is how a pattern at 120,000 events
      // per cycle walked straight past the guard.
      const canGrow = rung + 1 < ladder.length;

      const windowEnd = windowStart + probeSpan;
      const haps = queryArc(windowStart, windowEnd);
      queries++;

      // Onsets only. A note held across the window began somewhere else
      // and is not evidence of density here.
      const onsets: number[] = [];
      for (const hap of haps) {
        const begin = hap.whole?.begin.valueOf();
        if (begin === undefined) continue;
        if (begin >= windowStart && begin < windowEnd) onsets.push(begin);
      }

      observedOnsets = Math.max(observedOnsets, onsets.length);

      // Counted, not projected. Every one of these onsets is inside the
      // requested range, so seeing cap-many in a single window proves the
      // range holds at least that many — no extrapolation, and no
      // distinctness gate to pass.
      //
      // This is the hole cross-model review (agy) found: a pattern with
      // thousands of layers starting together clears the sample target
      // while failing the distinctness gate, and fell out of the ladder
      // without a verdict. Simultaneous events say nothing about DENSITY,
      // but they are still events, and there can be too many of them.
      if (onsets.length >= cap) {
        return {
          kind: 'refuse',
          projected: onsets.length,
          sampleCount: onsets.length,
          spanFraction: probeSpan / span,
        };
      }

      // From the actual window width, not the nominal rung: the two
      // differ once MAX_PROBE_CYCLES bites, and using the rung would
      // under-project by the same factor.
      const projected = Math.round((onsets.length * span) / probeSpan);
      const distinct = new Set(onsets).size;
      // Enough separate moments for the count to describe a rate rather
      // than a chord. See minDistinctOnsets.
      const believable = distinct >= minDistinct;

      // Obviously huge: refuse on a small sample rather than grow the
      // window into the heap. Only this shortcut acts on one window;
      // everything nearer the cap is decided in aggregate below.
      if (believable && projected > cap * OBVIOUSLY_HUGE_MULTIPLE) {
        return {
          kind: 'refuse',
          projected,
          sampleCount: onsets.length,
          spanFraction: fraction,
        };
      }

      // A sample big enough to trust — or the biggest this offset will
      // ever produce. Either way, record it and move to the next offset.
      if (onsets.length >= sampleTarget || !canGrow) {
        if (believable || !canGrow) {
          sampledOnsets += onsets.length;
          sampledSpan += probeSpan;
        }
        break;
      }
    }
  }

  // Averaged across every window, not taken from the densest one.
  //
  // The max is right for the obvious cases and wrong for the borderline:
  // measured, a window at t=0 of `s("bd*40000")` sees twice the cycle's
  // average density, so projecting from it gives 80,000 against a 50,000
  // cap and refuses a pattern holding 40,001 events. Averaging over
  // windows spread across the range is what makes the near-cap verdict
  // trustworthy; the shortcut above still handles anything wildly over.
  if (sampledSpan > 0) {
    const projected = Math.round((sampledOnsets * span) / sampledSpan);
    if (projected > cap) {
      return {
        kind: 'refuse',
        projected,
        sampleCount: sampledOnsets,
        spanFraction: sampledSpan / span,
      };
    }
  }

  return { kind: 'proceed', queries, observedOnsets };
}
