/**
 * MIDI Import Service (Phase 1 — literal transcription).
 *
 * Mirror of MIDIExportService: parses a `.mid` byte buffer and emits a
 * playable Strudel pattern. Phase 1 is deliberately literal — no motif
 * detection, no bar deduplication, no LLM idiomatic post-pass. Output
 * is verbose-but-correct. Tracked by #201.
 *
 * Drum tracks (MIDI channel index 9, i.e. GM ch10) emit **one s() lane
 * per distinct sample name**, not one merged string. This avoids the
 * collision drop the prototyping spike exposed: events sharing a grid
 * step in a single string can only hold one token, so hat hits that
 * land on the same step as a kick get silently overwritten.
 *
 * Round-trip is not lossless: timing is quantized, velocity is dropped,
 * voice information for two-voice melodies on one channel collapses
 * into chord tokens. Phase 2-4 issues track each of those.
 *
 * @example
 * const svc = new MIDIImportService();
 * const result = svc.convertBuffer(buffer);
 * console.log(result.pattern);
 * // setcpm(120)
 * // stack(
 * //   s("bd ~ ~ ~ ~ ~ ~ ~ bd ~ ~ ~ ~ ~ ~ ~"),
 * //   ...
 * // )
 */

import * as midiModule from '@tonejs/midi';
const Midi = (midiModule as any).Midi || (midiModule as any).default?.Midi;

/** Options accepted by `convertBuffer`. */
export interface MIDIImportOptions {
  /** Grid resolution per bar (steps). Default 16. */
  steps_per_cycle?: number;
  /** Cap on bars to emit. Default: full file. */
  bars?: number;
  /** Overrides / extends the default GM drum map (MIDI note → sample). */
  drum_map?: Record<number, string>;
}

/** Per-call summary returned alongside the pattern. */
export interface MIDIImportSummary {
  /** BPM read from the file header (rounded). */
  bpm: number;
  /** Number of bars emitted. */
  bars: number;
  /** Lane count after drum splitting and pitched grouping. */
  lanes: number;
  /** Total parsed note events (across all tracks, pre-quantize). */
  notes: number;
  /** Drum MIDI note numbers seen in input that had no mapping — emitted as rests. */
  unmapped_drums: number[];
  /** Grid resolution actually used. */
  steps_per_cycle: number;
}

/** Successful conversion result. */
export interface MIDIImportResult {
  pattern: string;
  summary: MIDIImportSummary;
}

/**
 * GM percussion map → Strudel sample names. Comprehensive enough for
 * most real-world drum tracks; the user can override or extend via
 * `drum_map`.
 *
 * Toms collapse onto {lt, mt, ht} since Strudel's default sample bank
 * exposes those three rather than the GM five. Anything not listed
 * falls back to `~` and is surfaced in `summary.unmapped_drums`.
 */
export const GM_DRUM_MAP: Record<number, string> = {
  35: 'bd', 36: 'bd',                     // bass drum
  37: 'rim',                              // side stick
  38: 'sd', 40: 'sd',                     // snare
  39: 'cp',                               // hand clap
  41: 'lt', 43: 'lt',                     // low/floor toms
  42: 'hh', 44: 'hh',                     // closed / pedal hat
  45: 'mt', 47: 'mt',                     // mid toms
  46: 'oh',                               // open hat
  48: 'ht', 50: 'ht',                     // high toms
  49: 'cr', 52: 'cr', 55: 'cr', 57: 'cr', // crashes
  51: 'rd', 53: 'rd', 59: 'rd',           // rides
  54: 'tb',                               // tambourine
  56: 'cb',                               // cowbell
};

/** Maximum tracks emitted before we bail out (protects against pathological input). */
export const MAX_TRACKS = 64;
/** Maximum total note count after parse — protects memory in the renderer. */
export const MAX_NOTES = 50_000;

/** Convert MIDI note number to Strudel pitch notation (e.g. 60 → "c4"). */
function midiToNoteName(midi: number): string {
  const names = ['c', 'c#', 'd', 'd#', 'e', 'f', 'f#', 'g', 'g#', 'a', 'a#', 'b'];
  const octave = Math.floor(midi / 12) - 1;
  return `${names[midi % 12]}${octave}`;
}

/**
 * Build the per-step token array for a single drum sample within a track.
 * Returns a length-`totalSteps` string array, each slot either the sample
 * name or `~` (rest). The caller renders one s() lane per result.
 */
function buildDrumLane(
  notes: { time: number }[],
  sample: string,
  stepSeconds: number,
  totalSteps: number,
): string[] {
  const slots = new Array<string>(totalSteps).fill('~');
  for (const n of notes) {
    const step = Math.round(n.time / stepSeconds);
    if (step < 0 || step >= totalSteps) continue;
    slots[step] = sample;
  }
  return slots;
}

/**
 * Build the per-step token array for a pitched track. Simultaneous notes
 * at the same step merge into `[a,b,c]` chord tokens (Strudel's parallel
 * notation within a single step).
 */
function buildPitchLane(
  notes: { time: number; midi: number }[],
  stepSeconds: number,
  totalSteps: number,
): string[] {
  const slots = new Array<string[] | null>(totalSteps).fill(null);
  for (const n of notes) {
    const step = Math.round(n.time / stepSeconds);
    if (step < 0 || step >= totalSteps) continue;
    const name = midiToNoteName(n.midi);
    if (slots[step] === null) {
      slots[step] = [name];
    } else {
      slots[step]!.push(name);
    }
  }
  return slots.map((s) => {
    if (s === null) return '~';
    if (s.length === 1) return s[0];
    return `[${s.join(',')}]`;
  });
}

/** Render a per-step token array as a Strudel mini-notation string, split into bars. */
function renderBars(slots: string[], stepsPerCycle: number, bars: number): string {
  const barStrings: string[] = [];
  for (let b = 0; b < bars; b++) {
    const slice = slots.slice(b * stepsPerCycle, (b + 1) * stepsPerCycle);
    barStrings.push(slice.join(' '));
  }
  if (barStrings.length === 1) {
    return barStrings[0];
  }
  // Wrap each bar in [...] so each cycle plays the whole bar; alternate per outer cycle.
  return `<${barStrings.map((s) => `[${s}]`).join(' ')}>`;
}

export class MIDIImportService {
  /**
   * Convert a `.mid` byte buffer to a Strudel pattern string.
   *
   * @throws Error on parse failure or input that exceeds the configured caps.
   */
  convertBuffer(buffer: Buffer | Uint8Array, options: MIDIImportOptions = {}): MIDIImportResult {
    const stepsPerCycle = options.steps_per_cycle ?? 16;
    if (!Number.isInteger(stepsPerCycle) || stepsPerCycle < 1 || stepsPerCycle > 64) {
      throw new Error(`Invalid steps_per_cycle: ${stepsPerCycle}. Must be an integer in [1, 64].`);
    }

    let midi: any;
    try {
      midi = new Midi(buffer);
    } catch (e: any) {
      throw new Error(`Failed to parse MIDI buffer: ${e?.message ?? e}`);
    }

    if (midi.tracks.length > MAX_TRACKS) {
      throw new Error(`MIDI file has too many tracks (${midi.tracks.length} > ${MAX_TRACKS}).`);
    }

    // Count total notes pre-render so we can fail fast on pathological inputs.
    let totalNotes = 0;
    let lastEnd = 0;
    for (const t of midi.tracks) {
      for (const n of t.notes) {
        totalNotes++;
        if (totalNotes > MAX_NOTES) {
          throw new Error(`MIDI file has too many notes (>${MAX_NOTES}).`);
        }
        if (n.time + n.duration > lastEnd) lastEnd = n.time + n.duration;
      }
    }

    const bpm = Math.round(midi.header.tempos[0]?.bpm ?? 120);
    const secondsPerBeat = 60 / bpm;
    const secondsPerBar = secondsPerBeat * 4;
    const stepSeconds = secondsPerBar / stepsPerCycle;

    const fileBars = Math.max(1, Math.ceil(lastEnd / secondsPerBar) || 1);
    const bars = options.bars && options.bars > 0 ? Math.min(options.bars, fileBars) : fileBars;
    const totalSteps = bars * stepsPerCycle;

    const drumMap: Record<number, string> = { ...GM_DRUM_MAP, ...(options.drum_map ?? {}) };
    const unmappedSet = new Set<number>();

    const lanes: string[] = [];

    for (const track of midi.tracks) {
      if (track.notes.length === 0) continue;
      const isDrum = track.channel === 9;

      if (isDrum) {
        // Group by mapped sample; emit one s() lane per sample.
        const bySample = new Map<string, { midi: number; time: number }[]>();
        for (const n of track.notes) {
          const sample = drumMap[n.midi];
          if (!sample) {
            unmappedSet.add(n.midi);
            continue;
          }
          if (!bySample.has(sample)) bySample.set(sample, []);
          bySample.get(sample)!.push({ midi: n.midi, time: n.time });
        }
        // Sort sample names deterministically so output is stable.
        const samples = Array.from(bySample.keys()).sort();
        for (const sample of samples) {
          const slots = buildDrumLane(bySample.get(sample)!, sample, stepSeconds, totalSteps);
          const body = renderBars(slots, stepsPerCycle, bars);
          lanes.push(`  s("${body}")`);
        }
      } else {
        const slots = buildPitchLane(
          track.notes.map((n: any) => ({ time: n.time, midi: n.midi })),
          stepSeconds,
          totalSteps,
        );
        const body = renderBars(slots, stepsPerCycle, bars);
        lanes.push(`  note("${body}").s("piano")`);
      }
    }

    const out = lanes.length === 0
      ? `setcpm(${bpm})\n\n// (no playable notes after parse)\nsilence`
      : `setcpm(${bpm})\n\nstack(\n${lanes.join(',\n')}\n)`;

    return {
      pattern: out,
      summary: {
        bpm,
        bars,
        lanes: lanes.length,
        notes: totalNotes,
        unmapped_drums: Array.from(unmappedSet).sort((a, b) => a - b),
        steps_per_cycle: stepsPerCycle,
      },
    };
  }
}
