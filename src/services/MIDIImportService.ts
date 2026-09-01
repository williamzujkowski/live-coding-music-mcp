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
 * Two further losses, reported in `summary.discarded` rather than left
 * silent (#336): only the FIRST tempo is read, so a file with tempo
 * changes imports at its opening tempo; and the grid is fixed at 4/4,
 * so any other meter is laid onto 4/4 bars that will not line up.
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
import { BEATS_PER_BAR, BEATS_PER_CYCLE } from '../utils/Tempo.js';
import { ValidationError } from '../utils/CategorisedError.js';

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
  /**
   * Note events parsed, when that differs from the number rendered.
   *
   * Set at runtime by #463 and never declared here, so no TypeScript
   * consumer could see it (#475). Absent when the two agree.
   */
  notesParsed?: number;
  /**
   * Things the import silently discarded.
   *
   * The file header lists quantized timing, dropped velocity and
   * collapsed voices as known Phase 1 losses. These two were not
   * listed and not reported: a 3/4 file was laid onto a 4/4 grid, and
   * a file with a 120->200 tempo change imported as 120 with no
   * warning. A loss nobody is told about is indistinguishable from
   * correct output (#336).
   */
  discarded?: string[];
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

/**
 * Cap on bars rendered from a file (~8 minutes at 4/4, 120bpm).
 *
 * Without this, `bars` came straight from the file's own timing and fed
 * `new Array(bars * stepsPerCycle)`. A single note at a huge tick offset
 * with a tiny ppq made that astronomically large: a 36-byte file rendered
 * a 17.8MB pattern in 174MB of heap, and a 37-byte one aborted V8
 * outright with a FATAL ERROR the tool's try/catch cannot intercept —
 * killing the server and every open browser session with it (#235).
 * The 1MB input cap in storage.ts does not help: the amplification is
 * time-based, not size-based.
 */
export const MAX_BARS = 512;

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
  notes: { beats: number }[],
  sample: string,
  stepsPerBeat: number,
  totalSteps: number,
): string[] {
  const slots = new Array<string>(totalSteps).fill('~');
  for (const n of notes) {
    const step = Math.round(n.beats * stepsPerBeat);
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
  notes: { beats: number; midi: number }[],
  stepsPerBeat: number,
  totalSteps: number,
): string[] {
  const slots = new Array<string[] | null>(totalSteps).fill(null);
  for (const n of notes) {
    const step = Math.round(n.beats * stepsPerBeat);
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
      // Describe the file, not the exception. Interpolating the library's
      // error produced "Cannot read properties of undefined (reading
      // 'forEach')" for a truncated header — which reads as a server
      // crash, and a caller cannot act on a TypeError from a parser's
      // internals (#280). The underlying text is kept at the end for
      // anyone debugging, after the part that says what to do.
      const detail = String(e?.message ?? e);
      // Don't assert the chunk name. @tonejs/midi reports the header as
      // 'MHdr' while the actual bytes are 'MThd', so naming one while
      // quoting the other read as a contradiction to whoever was
      // debugging (#297). Say what to check instead.
      throw new Error(
        'Invalid MIDI file: could not be parsed. It may be truncated, or not a ' +
        `MIDI file at all. Check the file opens in another MIDI tool. (${detail})`
      );
    }

    if (midi.tracks.length > MAX_TRACKS) {
      throw new Error(`MIDI file has too many tracks (${midi.tracks.length} > ${MAX_TRACKS}).`);
    }

    // Ticks per quarter note. Everything positional below is derived
    // from ticks so it stays independent of the file's tempo map (#478).
    const ppq: number = midi.header.ppq;
    if (!Number.isFinite(ppq) || ppq <= 0) {
      throw new ValidationError(`MIDI file declares an unusable PPQ: ${String(ppq)}.`);
    }

    // Count total notes pre-render so we can fail fast on pathological inputs.
    let totalNotes = 0;
    let lastEndBeats = 0;
    for (const t of midi.tracks) {
      for (const n of t.notes) {
        totalNotes++;
        if (totalNotes > MAX_NOTES) {
          throw new Error(`MIDI file has too many notes (>${MAX_NOTES}).`);
        }
        const endBeats = (n.ticks + n.durationTicks) / ppq;
        if (endBeats > lastEndBeats) lastEndBeats = endBeats;
      }
    }

    const discarded: string[] = [];

    // The file's tempo, not a rounded one.
    //
    // The grid below is derived from this while note times come from
    // @tonejs/midi at the file's TRUE tempo, so rounding here made the
    // two disagree and the error accumulated. Measured on a 100.4 BPM
    // file with a note on beat 1 of each of 16 bars:
    //
    //   bar  0  first onset at step 0
    //   bar 13  first onset at step 15     <- a full step early
    //
    // The downbeat had walked backwards past the bar line (#433).
    //
    // `exactBpm` drives the grid and the emitted `setcpm`, so the
    // pattern plays at the tempo the file states; `bpm` stays rounded
    // for the summary a human reads.
    // Rounded to three decimals, once, and used for BOTH the grid and
    // the emitted `setcpm` so the two cannot disagree.
    //
    // A MIDI tempo is stored as microseconds per quarter note, so
    // @tonejs/midi hands back 100.40009437608872 for a 100.4 BPM file —
    // 17 digits of float noise to write into a pattern. Three decimals
    // is a relative error near 1e-6: about 40 microseconds of drift
    // across sixteen bars, against the 0.15 SECONDS that rounding to an
    // integer produced.
    const exactBpm = Math.round((midi.header.tempos[0]?.bpm ?? 120) * 1000) / 1000;
    const bpm = Math.round(exactBpm);
    if (midi.header.tempos.length > 1) {
      const others = midi.header.tempos
        .slice(1, 4)
        .map((t: any) => Math.round(t.bpm))
        .join(', ');
      discarded.push(
        `${String(midi.header.tempos.length - 1)} tempo change(s) — imported at the ` +
        `first tempo (${String(bpm)} BPM); later tempos (${others}) were dropped`
      );
    }

    // The grid below is BEATS_PER_BAR wide, so any other meter is laid
    // onto a 4/4 grid.
    const signature = midi.header.timeSignatures?.[0]?.timeSignature;
    if (Array.isArray(signature) && (signature[0] !== 4 || signature[1] !== 4)) {
      discarded.push(
        `time signature ${String(signature[0])}/${String(signature[1])} — ` +
        'the grid is 4/4, so bar lines will not line up'
      );
    }
    // Positions come from TICKS, not from seconds.
    //
    // The seconds chain that used to live here — secondsPerBeat,
    // secondsPerBar, stepSeconds — is gone with the last reader of it;
    // `eslint` is what noticed, since `tsc` does not flag an unused
    // local. Export still reads BEATS_PER_BAR, so a round trip cannot
    // rescale time by disagreeing about the bar (#336, #397).
    //
    // `@tonejs/midi` resolves `note.time` against the file's whole tempo
    // MAP, while the pattern emits ONE `setcpm`. So a tempo change was
    // baked into the spacing of a pattern that declares a constant
    // tempo. Measured on eight even quarter notes over two bars with
    // 120 BPM at tick 0 and 60 BPM at tick 1920:
    //
    //   <[c4 ~ ~ ~ c#4 ~ ~ ~ d4 ~ ~ ~ d#4 ~ ~ ~]
    //    [e4 ~ ~ ~ ~ ~ ~ ~ f4 ~ ~ ~ ~ ~ ~ ~]
    //    [f#4 ~ ~ ~ ~ ~ ~ ~ g4 ~ ~ ~ ~ ~ ~ ~]>
    //
    // Three bars from a two-bar file, the last four notes at half
    // speed — while `discarded` said the later tempo "was dropped".
    // It was not dropped; it was applied to the positions and denied in
    // the summary, which is worse than dropping it (#478).
    //
    // Ticks are tempo-independent by definition, so this is now true.
    const stepsPerBeat = stepsPerCycle / BEATS_PER_BAR;

    if (options.bars !== undefined) {
      if (!Number.isInteger(options.bars) || options.bars < 1 || options.bars > MAX_BARS) {
        throw new Error(`Invalid bars: ${options.bars}. Must be an integer in [1, ${MAX_BARS}].`);
      }
    }

    const fileBars = Math.max(1, Math.ceil(lastEndBeats / BEATS_PER_BAR) || 1);
    if (fileBars > MAX_BARS && options.bars === undefined) {
      throw new Error(
        `MIDI file spans too many bars (${fileBars} > ${MAX_BARS}). ` +
        `Pass bars=<n> to import a prefix.`
      );
    }
    // A CAP, which is what the option is documented as. It used to be
    // taken literally in both directions, so a one-bar file imported
    // with `bars: 2` emitted two bars — the second one entirely rests —
    // and reported `bars: 2`. A cap that lengthens its input is not a
    // cap, and the extra bar is silence the file does not contain
    // (#475).
    const bars = Math.min(options.bars ?? fileBars, fileBars, MAX_BARS);
    const totalSteps = bars * stepsPerCycle;

    // Belt and braces before the per-step allocations below: stepsPerCycle
    // and bars are both bounded above, so this should be unreachable.
    if (!Number.isSafeInteger(totalSteps) || totalSteps < 1 || totalSteps > MAX_BARS * 64) {
      throw new Error(`Refusing to render ${totalSteps} steps.`);
    }

    // Caller-supplied sample names are INTERPOLATED into the pattern
    // string, so they have to be names.
    //
    // `drum_map: { 36: 'x"y' }` produced
    //
    //   s("x"y ~ ~ ~ ...")
    //
    // which is not valid Strudel and not valid anything — the quote
    // closes the string and the rest of the bar becomes syntax. The
    // same class as the scale-name injection: a value that reaches
    // generated code without ever being checked as an identifier
    // (#475).
    //
    // Strudel sample names are word characters, with `:n` selecting a
    // variant within a bank. Nothing else can appear here.
    const SAMPLE_NAME = /^[a-z0-9_]+(?::\d+)?$/i;
    for (const [note, sample] of Object.entries(options.drum_map ?? {})) {
      if (typeof sample !== 'string' || !SAMPLE_NAME.test(sample)) {
        throw new ValidationError(
          `Invalid drum_map sample name for note ${note}: ${JSON.stringify(sample)}. `
          + 'Sample names are letters, digits and underscores, optionally followed '
          + 'by ":" and a variant number.');
      }
    }

    const drumMap: Record<number, string> = { ...GM_DRUM_MAP, ...(options.drum_map ?? {}) };
    const unmappedSet = new Set<number>();

    const lanes: string[] = [];
    let renderedNotes = 0;

    for (const track of midi.tracks) {
      if (track.notes.length === 0) continue;
      const isDrum = track.channel === 9;

      if (isDrum) {
        // Group by mapped sample; emit one s() lane per sample.
        const bySample = new Map<string, { midi: number; beats: number }[]>();
        for (const n of track.notes) {
          const sample = drumMap[n.midi];
          if (!sample) {
            unmappedSet.add(n.midi);
            continue;
          }
          if (!bySample.has(sample)) bySample.set(sample, []);
          bySample.get(sample)!.push({ midi: n.midi, beats: n.ticks / ppq });
        }
        // Sort sample names deterministically so output is stable.
        const samples = Array.from(bySample.keys()).sort();
        for (const sample of samples) {
          const slots = buildDrumLane(bySample.get(sample)!, sample, stepsPerBeat, totalSteps);
          // Counted from the SLOTS, before rendering (#478).
          renderedNotes += slots.filter(slot => slot !== '~').length;
          const body = renderBars(slots, stepsPerCycle, bars);
          lanes.push(`  s("${body}")`);
        }
      } else {
        const slots = buildPitchLane(
          track.notes.map((n: any) => ({ beats: n.ticks / ppq, midi: n.midi })),
          stepsPerBeat,
          totalSteps,
        );
        // A chord slot holds several notes and the pattern really does
        // contain all of them, so `[c4,e4]` counts as two. `slots` here
        // holds RENDERED tokens, so count the names inside the token —
        // reading `.length` off it counts characters.
        renderedNotes += slots.reduce<number>((n, slot) =>
          n + (slot === '~' ? 0 : slot.replace(/[[\]]/g, '').split(',').length), 0);
        const body = renderBars(slots, stepsPerCycle, bars);
        lanes.push(`  note("${body}").s("piano")`);
      }
    }

    // One cycle plays one bar (see `renderBars`), and every meter is laid
    // onto 4/4 — so the bar is four beats and `setcpm(bpm)` would run the
    // file four times too fast. Importing a 120 BPM file gave 480 (#397).
    // The exact tempo, matching the grid the notes were placed on.
    //
    // Emitting the rounded one would put the drift back in the other
    // direction: a grid built for 100.4 played at 100 walks apart just
    // the same (#433). A fractional cpm is valid and the divisor is the
    // beats-per-cycle conversion (#395).
    // Counted from the rendered lanes, so the summary describes the
    // pattern rather than the file it came from (#433).
    // `renderedNotes` is accumulated as each lane is built, from the
    // slot arrays themselves.
    //
    // It used to be recovered by re-parsing the RENDERED string:
    // split the body on whitespace and count tokens that are not `~`.
    // Multi-bar bodies attach punctuation to their edge tokens, so
    //
    //   <[c4 ~ ~ ~ ... ~] [e4 ~ ~ ~ ... ~]>
    //
    // yields `<[c4`, `~]`, `[e4` and `~]>` among its tokens — and
    // `~]` is not equal to `~`, so two rests counted as notes. Eight
    // notes over two bars reported ten. Single-bar patterns have no
    // such punctuation, which is why every existing test agreed with
    // it (#478).

    const tempoCall = `setcpm(${String(exactBpm)}/${String(BEATS_PER_CYCLE)})`;
    const out = lanes.length === 0
      ? `${tempoCall}\n\n// (no playable notes after parse)\nsilence`
      : `${tempoCall}\n\nstack(\n${lanes.join(',\n')}\n)`;

    return {
      pattern: out,
      summary: {
        bpm,
        bars,
        lanes: lanes.length,
        // Notes the pattern actually contains.
        //
        // This reported every note PARSED, including those it then
        // dropped — the ones past the `bars` cap and those on unmapped
        // drum pitches. Measured, a file of ten notes on an unmapped
        // percussion pitch reported `{lanes: 0, notes: 10}` beside the
        // pattern `silence`: ten notes claimed for a pattern that
        // contains none (#433).
        notes: renderedNotes,
        // The parsed count is still worth having — it is the difference
        // between "the file was empty" and "the file was dropped" — so
        // it is reported alongside rather than instead.
        ...(totalNotes !== renderedNotes ? { notesParsed: totalNotes } : {}),
        unmapped_drums: Array.from(unmappedSet).sort((a, b) => a - b),
        steps_per_cycle: stepsPerCycle,
        ...(discarded.length > 0 ? { discarded } : {}),
      },
    };
  }
}
