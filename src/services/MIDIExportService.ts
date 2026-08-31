/**
 * MIDI Export Service
 *
 * Converts Strudel patterns to MIDI files using @tonejs/midi.
 * Parses note() functions, MIDI numbers, and chord names from patterns.
 *
 * @example
 * const service = new MIDIExportService();
 * const notes = service.parsePatternNotes('note("c4 e4 g4")');
 * const midi = service.convertToMidi(notes, { bpm: 120 });
 * const base64 = service.exportToBase64(midi);
 */

// @tonejs/midi is CommonJS - use dynamic import approach
import * as midiModule from '@tonejs/midi';
import { BEATS_PER_BAR } from '../utils/Tempo.js';

// Handle both ESM and CJS interop
const Midi = (midiModule as any).Midi || (midiModule as any).default?.Midi;
import { writeFileSync, mkdirSync } from 'fs';
import { resolveSafeOutputPath, resolveExportDirectory } from '../utils/SafePath.js';

/** Represents a single note event parsed from a Strudel pattern */
export interface NoteEvent {
  /** MIDI note number (0-127) */
  note: number;
  /** Start time in beats */
  time: number;
  /** Duration in beats */
  duration: number;
  /** Velocity (0-127) */
  velocity: number;
  /**
   * MIDI channel. Omitted means the default melodic track; 9 is the GM
   * percussion channel, which is how a drum hit is distinguished from a
   * pitched note of the same number (#335).
   */
  channel?: number;
}

/** Options for MIDI export */
export interface MIDIExportOptions {
  /** Tempo in BPM (default: 120) */
  bpm?: number;
  /** Duration in bars to export (default: 4) */
  bars?: number;
  /** MIDI track name (default: 'Strudel Pattern') */
  trackName?: string;
  /** Time signature numerator (default: 4) */
  timeSignatureNumerator?: number;
  /** Time signature denominator (default: 4) */
  timeSignatureDenominator?: number;
}

/** Result of MIDI export */
export interface MIDIExportResult {
  /** Whether export succeeded */
  success: boolean;
  /** Output filename or base64 data */
  output: string;
  /** Number of notes exported */
  noteCount: number;
  /** Duration in bars */
  bars: number;
  /** BPM used */
  bpm: number;
  /** Present when material was skipped rather than exported (#335). */
  warning?: string;
  /** The specific tokens that could not be represented (#335). */
  unrepresented?: string[];
  /** Tokens exported with loss — an alternation, or a dropped weight (#335). */
  partiallyExported?: string[];
  /** Error message if failed */
  error?: string;
  /** Set when the requested filename had to be sanitized (#224). */
  sanitizedFilename?: string;
  /** The caller's original filename, when it was sanitized (#224). */
  requestedFilename?: string;
}

/**
 * Note name to MIDI number mapping.
 * C4 = 60 (middle C)
 */
const NOTE_NAMES: Record<string, number> = {
  'c': 0, 'c#': 1, 'db': 1,
  'd': 2, 'd#': 3, 'eb': 3,
  'e': 4, 'fb': 4, 'e#': 5,
  'f': 5, 'f#': 6, 'gb': 6,
  'g': 7, 'g#': 8, 'ab': 8,
  'a': 9, 'a#': 10, 'bb': 10,
  'b': 11, 'cb': 11, 'b#': 0
};

/**
 * Chord intervals from root note.
 * Used to expand chord names to individual notes.
 */
const CHORD_INTERVALS: Record<string, number[]> = {
  '': [0, 4, 7],              // major
  'm': [0, 3, 7],             // minor
  '7': [0, 4, 7, 10],         // dominant 7
  'maj7': [0, 4, 7, 11],      // major 7
  'm7': [0, 3, 7, 10],        // minor 7
  'dim': [0, 3, 6],           // diminished
  'aug': [0, 4, 8],           // augmented
  'dim7': [0, 3, 6, 9],       // diminished 7
  'sus2': [0, 2, 7],          // suspended 2
  'sus4': [0, 5, 7],          // suspended 4
  '9': [0, 4, 7, 10, 14],     // dominant 9
  'maj9': [0, 4, 7, 11, 14],  // major 9
  'm9': [0, 3, 7, 10, 14],    // minor 9
  'add9': [0, 4, 7, 14],      // add 9
  '6': [0, 4, 7, 9],          // major 6
  'm6': [0, 3, 7, 9],         // minor 6

  // Aliases people actually write. Without these they fell through to
  // the major-triad fallback, so `Cmin` and `Cm7b5` both came back as
  // C major — a wrong third, silently, which is worse than the unknown
  // suffix the fallback was written for (#336).
  'min': [0, 3, 7],           // minor, spelled out
  'minor': [0, 3, 7],
  'maj': [0, 4, 7],           // major, spelled out
  'major': [0, 4, 7],
  'sus': [0, 5, 7],           // bare sus is conventionally sus4
  'm7b5': [0, 3, 6, 10],      // half-diminished
  'm11': [0, 3, 7, 10, 14, 17],
  '11': [0, 4, 7, 10, 14, 17],
  '13': [0, 4, 7, 10, 14, 21],
  'maj13': [0, 4, 7, 11, 14, 21],
  'm13': [0, 3, 7, 10, 14, 21],
  '7sus4': [0, 5, 7, 10],
  'add11': [0, 4, 7, 17],
  '5': [0, 7],                // power chord
};

/**
 * Suffixes whose meaning depends on case, checked before lowercasing.
 *
 * `M7` is standard notation for a major seventh, but the lookup
 * lowercased first, turning it into the `m7` key — so `CM7` produced a
 * C MINOR 7 while `Cmaj7` produced the correct major 7. Two spellings
 * of the same chord, a semitone apart (#336).
 */
const CASE_SENSITIVE_CHORDS: Record<string, number[]> = {
  'M7': [0, 4, 7, 11],   // major 7
  'M9': [0, 4, 7, 11, 14],
  'M6': [0, 4, 7, 9],
  'M13': [0, 4, 7, 11, 14, 21],
};


/**
 * Strudel sample name -> GM percussion note.
 *
 * The inverse of `MIDIImportService.GM_DRUM_MAP`. Import could read a
 * GM channel-9 track into clean `s(...)` lanes; export had no
 * counterpart at all, so `s("bd*4")` returned "No notes found in
 * pattern" and drums were import-only. Import's own output could not be
 * re-exported (#335).
 *
 * Where import maps several notes onto one sample (35 and 36 both ->
 * bd), the canonical one is used here.
 */
export const SAMPLE_TO_MIDI: Record<string, number> = {
  bd: 36,    // bass drum 1
  rim: 37,   // side stick
  sd: 38,    // acoustic snare
  cp: 39,    // hand clap
  lt: 41,    // low floor tom
  hh: 42,    // closed hi-hat
  mt: 45,    // low tom
  oh: 46,    // open hi-hat
  ht: 48,    // hi-mid tom
  cr: 49,    // crash cymbal 1
  rd: 51,    // ride cymbal 1
  tb: 54,    // tambourine
  cb: 56,    // cowbell
};

/** The General MIDI percussion channel. */
export const GM_PERCUSSION_CHANNEL = 9;

export class MIDIExportService {
  /**
   * Mini-notation tokens the parser could not represent, collected
   * during the most recent conversion.
   *
   * `parseNoteString` handles bare note names separated by whitespace
   * and nothing else. Everything it cannot read was previously dropped
   * without a word, so an export that lost most of its material still
   * reported plain success (#335).
   */
  private unrepresented = new Set<string>();
  /**
   * Tokens that WERE exported, but lossily — an alternation whose
   * later options a single bar cannot hold, or a duration weight that
   * was dropped. Distinct from `unrepresented`, because "we kept the
   * first of four" and "we skipped it" are different things to tell a
   * caller (#335).
   */
  private partial = new Set<string>();
  /** Notes actually written by the last convertToMidi, for noteCount. */
  private lastWrittenCount = 0;
  /** Directory file exports are confined to. */
  private readonly exportDir: string;

  /**
   * @param exportDir - Export directory (default `./exports`, or `exports_dir`)
   */
  constructor(exportDir?: string) {
    this.exportDir = resolveExportDirectory(exportDir);
  }

  /**
   * Converts a note name (e.g., "C4", "D#5", "Bb3") to MIDI number
   * @param noteName - Note name with optional accidental and octave
   * @returns MIDI note number (0-127) or null if invalid
   */
  noteNameToMidi(noteName: string): number | null {
    if (!noteName || typeof noteName !== 'string') {
      return null;
    }

    const cleaned = noteName.toLowerCase().trim();

    // Check for pure MIDI number
    const midiNum = parseInt(cleaned, 10);
    if (!isNaN(midiNum) && midiNum >= 0 && midiNum <= 127 && cleaned === midiNum.toString()) {
      return midiNum;
    }

    // Parse note name with regex
    // Matches: c, c#, db, c4, c#4, db4, etc.
    const match = cleaned.match(/^([a-g])([#b]?)(-?\d+)?$/);
    if (!match) {
      return null;
    }

    const [, letter, accidental, octaveStr] = match;
    const noteKey = letter + (accidental || '');

    const semitone = NOTE_NAMES[noteKey];
    if (semitone === undefined) {
      return null;
    }

    // Default octave is 4 (middle C area)
    let octave = octaveStr !== undefined ? parseInt(octaveStr, 10) : 4;

    // Cb and B# cross the octave boundary. NOTE_NAMES maps 'cb' to 11
    // and 'b#' to 0, which are the right pitch CLASSES, but the octave
    // has to move with them: Cb4 is B3 (59), not B4 (71), and B#4 is C5
    // (72), not C4 (60). The semitone was right and the octave was not
    // — the classic off-by-one-octave (#336).
    if (noteKey === 'cb') {
      octave -= 1;
    } else if (noteKey === 'b#') {
      octave += 1;
    }

    // MIDI note = (octave + 1) * 12 + semitone
    // C4 = 60, so octave 4 base = 60, but 60 = (4+1)*12 + 0
    const midi = (octave + 1) * 12 + semitone;

    // Clamp to valid MIDI range
    if (midi < 0 || midi > 127) {
      return null;
    }

    return midi;
  }

  /**
   * Converts a MIDI number to note name
   * @param midi - MIDI note number (0-127)
   * @returns Note name with octave (e.g., "C4")
   */
  midiToNoteName(midi: number): string {
    const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    const octave = Math.floor(midi / 12) - 1;
    const note = noteNames[midi % 12];
    return `${note}${octave}`;
  }

  /**
   * Expands a chord name to individual MIDI note numbers
   * @param chordName - Chord name (e.g., "Cmaj7", "Am", "G7")
   * @param octave - Base octave (default: 4)
   * @returns Array of MIDI note numbers or empty array if invalid
   */
  expandChord(chordName: string, octave: number = 4): number[] {
    if (!chordName || typeof chordName !== 'string') {
      return [];
    }

    const cleaned = chordName.trim();

    // Parse chord: root note + optional accidental + chord type
    const match = cleaned.match(/^([A-Ga-g])([#b]?)(.*)$/);
    if (!match) {
      return [];
    }

    const [, letter, accidental, chordType] = match;
    const rootKey = letter.toLowerCase() + (accidental || '');

    const rootSemitone = NOTE_NAMES[rootKey];
    if (rootSemitone === undefined) {
      return [];
    }

    // Get chord intervals, default to major triad
    // hasOwn, not `||`: CHORD_INTERVALS is a plain object literal, so
    // CHORD_INTERVALS['constructor'] inherits Object — truthy — and the
    // fallback never fired. `intervals.map` then threw a TypeError that
    // failed the whole export, including any valid chords beside it
    // (#308).
    // Case-sensitive suffixes first: 'M7' means major 7 and must not be
    // lowercased into the 'm7' (minor 7) key (#336).
    const key = chordType.toLowerCase();
    const known = Object.hasOwn(CASE_SENSITIVE_CHORDS, chordType)
      || Object.hasOwn(CHORD_INTERVALS, key);
    if (!known && chordType.length > 0) {
      // The major-triad fallback STAYS. #336 chose it deliberately —
      // "the fallback is fine for input nobody can interpret" — and a
      // triad on the root the caller named is a defensible reading of
      // `chord("Cfoo")`.
      //
      // What was wrong is that it happened in silence. #433 reported it
      // as `chord("Cxyz")` exporting C major, and the sharper case was
      // `chord("<C Dm>")` exporting a D MAJOR — but that came from the
      // string never being tokenized (fixed below), not from the
      // fallback. What reaches here now is genuinely uninterpretable,
      // and the honest response is to interpret it AND say so.
      this.unrepresented.add(chordName);
    }
    const intervals = Object.hasOwn(CASE_SENSITIVE_CHORDS, chordType)
      ? CASE_SENSITIVE_CHORDS[chordType]
      : Object.hasOwn(CHORD_INTERVALS, key)
        ? CHORD_INTERVALS[key]
        : CHORD_INTERVALS[''];

    // Cb and B# cross the octave boundary — the same correction
    // `noteNameToMidi` makes and this did not, so `chord("Cb")` rooted
    // on B4 (71) instead of B3 (59), a whole octave out (#433).
    let rootOctave = octave;
    if (rootKey === 'cb') {
      rootOctave -= 1;
    } else if (rootKey === 'b#') {
      rootOctave += 1;
    }

    const rootMidi = (rootOctave + 1) * 12 + rootSemitone;

    return intervals.map(interval => {
      const midi = rootMidi + interval;
      return midi >= 0 && midi <= 127 ? midi : -1;
    }).filter(n => n >= 0);
  }

  /**
   * Parses a Strudel pattern and extracts note events
   * @param pattern - Strudel pattern code
   * @returns Array of NoteEvent objects
   */
  parsePatternNotes(pattern: string): NoteEvent[] {
    if (!pattern || typeof pattern !== 'string') {
      return [];
    }

    const notes: NoteEvent[] = [];
    // Lanes layer; they do not follow one another.
    //
    // `currentTime += BEATS_PER_BAR` after each match meant lane 2
    // started a bar AFTER lane 1, so stack(note(a), note(b)) exported
    // as a then b instead of a over b — parallelism destroyed at export,
    // before import had a chance to preserve it (#335).
    //
    // Every lane therefore starts at bar 0. That is right for stack(),
    // which is how Strudel expresses simultaneity, and for a single
    // pattern. It is NOT right for cat()/seq(), which this regex-based
    // parser does not recognise as sequential either way — those were
    // already flattened before this change.
    const laneStart = 0;

    // Extract note() function calls
    // Matches: note("c4 e4 g4"), note("c4", "e4"), note(`c4`)
    const noteRegex = /note\s*\(\s*["'`]([^"'`]+)["'`]\s*\)/gi;
    let noteMatch;

    while ((noteMatch = noteRegex.exec(pattern)) !== null) {
      const noteContent = noteMatch[1];
      const parsedNotes = this.parseNoteString(noteContent, laneStart);
      notes.push(...parsedNotes);
    }

    // Extract n() function calls (Strudel shorthand)
    //
    // The lookbehind keeps this from also matching the `.n(...)` in
    // `s("piano").n("0 1 2")`, which the pass below already handles.
    // Both fired on the same text, so every note in that form was
    // counted twice: s("bd").n("0 1 2") produced 6 notes, not 3 — and
    // that is the exact form the code's own comment advertises as
    // supported (#335).
    const nRegex = /(?<![)\w$.])\bn\s*\(\s*["'`]([^"'`]+)["'`]\s*\)/gi;
    let nMatch;

    while ((nMatch = nRegex.exec(pattern)) !== null) {
      const noteContent = nMatch[1];
      // n() uses MIDI numbers directly
      const parsedNotes = this.parseNoteString(noteContent, laneStart, true);
      notes.push(...parsedNotes);
    }

    // Extract chord patterns
    const chordRegex = /chord\s*\(\s*["'`]([^"'`]+)["'`]\s*\)/gi;
    let chordMatch;

    while ((chordMatch = chordRegex.exec(pattern)) !== null) {
      const chordContent = chordMatch[1];
      const parsedChords = this.parseChordString(chordContent, laneStart);
      notes.push(...parsedChords);
    }

    // Drum lanes: s("bd*4"), sound("bd sd"), etc.
    //
    // Export had no sample->MIDI map and never set a channel, so every
    // drum pattern returned "No notes found in pattern" — drums were
    // import-only, and import's own output could not be re-exported
    // (#335). Only lanes whose tokens are all recognised drum samples
    // are taken; s("piano") is left to the .n() pass below.
    // The lookahead skips `s("bd").n(...)`, which the .n() pass owns:
    // in Strudel that is one lane selecting sample variants, not a kick
    // plus three notes. Without it both passes claimed the same text
    // and s("bd").n("0 1 2") exported 4 notes for 3 events (#335).
    const drumRegex = /\b(?:s|sound)\s*\(\s*["'`]([^"'`]+)["'`]\s*\)(?!\s*\.\s*n\s*\()/gi;
    let drumMatch;
    while ((drumMatch = drumRegex.exec(pattern)) !== null) {
      const parsedDrums = this.parseDrumString(drumMatch[1], laneStart);
      notes.push(...parsedDrums);
    }

    // Extract s() sound patterns with n() modifier for samples
    // e.g., s("piano").n("0 2 4 7")
    // `sound(...)` as well as `s(...)`.
    //
    // The drum pass above accepts both spellings and its lookahead skips
    // either when `.n(` follows — handing it to this pass, which only
    // knew `s(`. So `sound("piano").n("60 62")` matched the drum pass's
    // lookahead, missed here, and was blocked from the bare `n()` pass
    // by its own lookbehind: three passes, none of them taking it, zero
    // notes and no error (#433). `s("piano").n("60 62")` worked.
    //
    // `\b(?:s|sound)` mirrors the drum regex exactly, so the two cannot
    // disagree about what a lane looks like.
    const soundNRegex = /\b(?:s|sound)\s*\([^)]+\)\s*\.n\s*\(\s*["'`]([^"'`]+)["'`]\s*\)/gi;
    let soundNMatch;

    while ((soundNMatch = soundNRegex.exec(pattern)) !== null) {
      const noteContent = soundNMatch[1];
      const parsedNotes = this.parseNoteString(noteContent, laneStart, true);
      notes.push(...parsedNotes);
    }

    // If no notes found through function parsing, try to find inline notes
    if (notes.length === 0) {
      const inlineNotes = this.parseInlineNotes(pattern);
      notes.push(...inlineNotes);
    }

    return notes;
  }

  /**
   * Parses a space/comma-separated note string
   * @param noteString - String of notes (e.g., "c4 e4 g4" or "60 64 67")
   * @param startTime - Starting time in beats
   * @param asMidiNumbers - Treat values as MIDI numbers
   * @returns Array of NoteEvent objects
   */
  /**
   * Splits mini-notation into tokens, treating `[...]` as one token.
   *
   * @param source - A mini-notation string
   * @returns Tokens, with bracket groups intact
   * @example
   * MIDIExportService.tokenize('[c4 e4] g4');  // ['[c4 e4]', 'g4']
   * MIDIExportService.tokenize('<c4 e4> g4');  // ['<c4 e4>', 'g4']
   */
  /**
   * Splits a pattern string into its parallel lanes.
   *
   * A comma at depth 0 stacks lanes in Strudel — `s("bd*4, hh*8")` is a
   * kick on every beat AND a hat on every eighth, both spanning the bar.
   * `tokenize` treated it as an ordinary separator, so the lanes were
   * concatenated and redistributed across the bar. Measured:
   *
   *   s("bd*4")        -> beats [0, 1, 2, 3]                  correct
   *   s("hh*8")        -> beats [0, .5, 1, ... 3.5]           correct
   *   s("bd*4, hh*8")  -> beats [0, .33, .67, 1, ... 3.67]    WRONG
   *
   * The note COUNT was right, which is why nothing caught it. And this
   * is the shape the generator emits — `s("bd*4, ~ cp ~ cp, hh*8")` is
   * its standard drum line — so every generated drum pattern exported
   * at the wrong rhythm and reported success (#432).
   *
   * A comma inside `[...]` or `<...>` is a chord or an alternation and
   * stays where it is; only depth 0 separates lanes.
   *
   * @param source - Pattern string, e.g. `bd*4, hh*8`
   * @returns One string per lane, in order; `['']` becomes `[]`
   *
   * @example
   * MIDIExportService.splitLanes('bd*4, hh*8');   // ['bd*4', 'hh*8']
   * MIDIExportService.splitLanes('[c4,e4] g4');   // ['[c4,e4] g4']
   */
  static splitLanes(source: string): string[] {
    const lanes: string[] = [];
    let current = '';
    let depth = 0;

    for (const char of source) {
      if (char === '[' || char === '<') depth++;
      if (char === ']' || char === '>') depth = Math.max(0, depth - 1);

      if (char === ',' && depth === 0) {
        lanes.push(current);
        current = '';
        continue;
      }
      current += char;
    }
    lanes.push(current);

    return lanes.map(lane => lane.trim()).filter(lane => lane.length > 0);
  }

  static tokenize(source: string): string[] {
    const tokens: string[] = [];
    let current = '';
    let depth = 0;

    for (const char of source) {
      // Angle brackets group too. Tracking only `[` meant `<c4 e4>` was
      // split on the space into ["<c4", "e4>"], neither of which is a
      // note or a recognisable alternation — so the whole token was
      // reported unrepresentable even after expansion existed (#335).
      if (char === '[' || char === '<') depth++;
      if (char === ']' || char === '>') depth = Math.max(0, depth - 1);

      const isSeparator = (char === ' ' || char === '\t' || char === '\n' || char === ',');
      if (isSeparator && depth === 0) {
        if (current.length > 0) tokens.push(current);
        current = '';
        continue;
      }
      current += char;
    }
    if (current.length > 0) tokens.push(current);
    return tokens;
  }

  /**
   * Expands the repetition operators into plain tokens.
   *
   * `*n` and `!n` both mean "this token, n times" for export purposes:
   * `*` subdivides the step and `!` repeats it across steps, and since
   * export lays tokens out evenly across the bar the two collapse to
   * the same thing here. `@n` weights a token's duration; the note is
   * kept and the weight dropped, which is a smaller loss than dropping
   * the note.
   *
   * `<a b c>` alternates across cycles. A single exported bar can only
   * hold one of them, so the first is taken and the rest reported —
   * previously the whole token was dropped, which is why
   * note("<c3 eb3 g3 bb3>") contributed nothing (#335).
   *
   * @param tokens - Tokens from `tokenize`
   * @param onUnrepresented - Called with anything still not expressible
   * @returns Plain tokens, ready for note lookup
   * @example
   * MIDIExportService.expandOperators(['c4*3'], () => {}); // ['c4','c4','c4']
   */
  static expandOperators(
    tokens: string[],
    onUnrepresented: (token: string) => void,
    onPartial: (token: string) => void = () => undefined,
  ): string[] {
    const MAX_REPEAT = 64;
    const out: string[] = [];

    for (const token of tokens) {
      // <a b c> — alternation. Take the first; report the rest.
      const alternation = /^<(.+)>$/.exec(token);
      if (alternation) {
        const options = MIDIExportService.tokenize(alternation[1]);
        if (options.length === 0) continue;
        out.push(...MIDIExportService.expandOperators([options[0]], onUnrepresented, onPartial));
        if (options.length > 1) onPartial(token);
        continue;
      }

      // name*n or name!n — repetition.
      const repeat = /^(.+?)[*!](\d+)$/.exec(token);
      if (repeat) {
        const count = Math.min(Number.parseInt(repeat[2], 10), MAX_REPEAT);
        if (count > 0) {
          const inner = MIDIExportService.expandOperators([repeat[1]], onUnrepresented, onPartial);
          for (let i = 0; i < count; i++) out.push(...inner);
        }
        continue;
      }

      // name@n — duration weight. Keep the note, drop the weight.
      const weighted = /^(.+?)@\d+(?:\.\d+)?$/.exec(token);
      if (weighted) {
        out.push(...MIDIExportService.expandOperators([weighted[1]], onUnrepresented, onPartial));
        onPartial(token);
        continue;
      }

      if (/[*!@<>?%]/.test(token)) {
        onUnrepresented(token);
        continue;
      }
      out.push(token);
    }

    return out;
  }

  /**
   * Parses a drum lane into GM percussion events on channel 9.
   *
   * Returns an empty array if the lane contains anything that is not a
   * known sample or a rest, so a melodic `s("piano")` falls through to
   * the `.n()` handler instead of being silently misread as drums.
   *
   * @param soundString - Contents of an s(...) call
   * @param startTime - Bar start, in beats
   * @returns Percussion events, or [] if this is not a drum lane
   */
  private parseDrumString(soundString: string, startTime: number): NoteEvent[] {
    // Each lane spans the whole bar; they play together, not in turn
    // (#432). Laid out independently and concatenated, which is what
    // `parsePatternNotes` already does across separate `s(...)` calls in
    // a stack — this is the same thing one nesting level down.
    const lanes = MIDIExportService.splitLanes(soundString);
    if (lanes.length > 1) {
      return lanes.flatMap(lane => this.parseDrumString(lane, startTime));
    }

    const tokens = MIDIExportService.expandOperators(
      MIDIExportService.tokenize(soundString),
      token => { this.unrepresented.add(token); },
      token => { this.partial.add(token); },
    );
    if (tokens.length === 0) return [];

    const isRest = (t: string) => t === '~' || t === '-' || t === 'r';
    const unknown = tokens.filter(
      t => !isRest(t) && !Object.hasOwn(SAMPLE_TO_MIDI, t.toLowerCase()));
    if (unknown.length > 0) {
      // The whole lane is dropped when any token is unrecognised — a
      // deliberate choice, since a partial drum lane is a different
      // rhythm rather than a quieter one. But it used to happen in
      // silence: `stack(note("c4"), s("bd unknown sd"))` exported one
      // note with success:true and no `unrepresented` entry, so the
      // caller had no way to learn a whole lane had vanished (#433).
      for (const token of unknown) this.unrepresented.add(token);
      return [];
    }

    const step = BEATS_PER_BAR / tokens.length;
    const events: NoteEvent[] = [];
    tokens.forEach((token, index) => {
      if (isRest(token)) return;
      events.push({
        note: SAMPLE_TO_MIDI[token.toLowerCase()],
        time: startTime + index * step,
        duration: step,
        velocity: 100,
        channel: GM_PERCUSSION_CHANNEL,
      });
    });
    return events;
  }

  private parseNoteString(
    noteString: string,
    startTime: number,
    asMidiNumbers: boolean = false
  ): NoteEvent[] {
    const notes: NoteEvent[] = [];
    // Tokenize with brackets kept whole.
    //
    // Splitting on /[\s,]+/ first meant the `startsWith('[')` branch
    // below could only ever see a bracket containing no spaces or
    // commas — i.e. never a real chord. `[c4 e4] g4` became
    // ["[c4", "e4]", "g4"], and "e4]" fails noteNameToMidi, so the last
    // note of every chord was dropped. Import emits exactly this
    // notation, so its own output could not be re-exported (#336).
    // Parallel lanes, as in parseDrumString (#432). `note("c4 e4, g4")`
    // sounds g4 with c4 at beat 0, not two thirds of the way through.
    const lanes = MIDIExportService.splitLanes(noteString);
    if (lanes.length > 1) {
      return lanes.flatMap(lane => this.parseNoteString(lane, startTime, asMidiNumbers));
    }

    const parts = MIDIExportService.expandOperators(
      MIDIExportService.tokenize(noteString),
      token => { this.unrepresented.add(token); },
      token => { this.partial.add(token); },
    );

    // One pattern string spans one BAR, not one beat.
    //
    // Export treated a whole note("...") as 1 beat while import lays a
    // cycle out over 4 (`secondsPerBar = secondsPerBeat * 4`), so a
    // round trip compressed everything 4x: an 8-note scale came back as
    // note("c4 [d4,e4] [f4,g4] [a4,b4] c5 ~ ~ ...") — collisions from
    // the mismatch, which then triggered the documented chord-collapse
    // and looked like a quantization loss. It was a unit disagreement
    // (#336).
    const noteDuration = parts.length > 0 ? BEATS_PER_BAR / parts.length : BEATS_PER_BAR;

    parts.forEach((part, index) => {
      // Check for rest
      if (part === '~' || part === '-' || part === 'r') {
        return;
      }

      // Mini-notation operators this parser does not implement. They
      // used to be dropped in silence: a realistic five-lane generated
      // pattern exported as success:true with noteCount 2, because
      // `*`, `!`, `@` and `<>` are in essentially every pattern the
      // generator produces. Recording them lets the caller be told
      // (#335).


      // Handle sub-patterns in brackets [c4 e4]
      if (part.startsWith('[')) {
        const subContent = part.replace(/[[\]]/g, '');
        // A comma inside the bracket is a CHORD — simultaneous, each
        // note holding the whole step. A space is a SUBDIVISION — the
        // step is split between them.
        //
        // Both were treated as a chord with shortened notes: every part
        // got the step's start time and `noteDuration / subParts.length`.
        // So `[c4 d4] e4` stacked c4 and d4 at beat 0 instead of
        // subdividing, and `[c4,e4,g4]` — which is exactly what IMPORT
        // emits for simultaneous notes — came back a third as long as it
        // should be (#433 items 2 and 3).
        const isChord = subContent.includes(',');
        const subParts = subContent.split(/[\s,]+/).filter(p => p.length > 0);
        const subDuration = isChord ? noteDuration : noteDuration / subParts.length;
        subParts.forEach((subPart, subIndex) => {
          const midi = asMidiNumbers
            ? parseInt(subPart, 10)
            : this.noteNameToMidi(subPart);

          if (midi !== null && !isNaN(midi) && midi >= 0 && midi <= 127) {
            notes.push({
              note: midi,
              time: startTime + index * noteDuration
                + (isChord ? 0 : subIndex * subDuration),
              duration: subDuration,
              velocity: 100
            });
          }
        });
        return;
      }

      const midi = asMidiNumbers
        ? parseInt(part, 10)
        : this.noteNameToMidi(part);

      if (midi !== null && !isNaN(midi) && midi >= 0 && midi <= 127) {
        notes.push({
          note: midi,
          time: startTime + index * noteDuration,
          duration: noteDuration,
          velocity: 100
        });
      }
    });

    return notes;
  }

  /**
   * Parses a chord string and expands to note events
   * @param chordString - String of chord names (e.g., "Cmaj7 Am Dm G7")
   * @param startTime - Starting time in beats
   * @returns Array of NoteEvent objects
   */
  private parseChordString(chordString: string, startTime: number): NoteEvent[] {
    const notes: NoteEvent[] = [];
    // Lanes first, then the shared tokenizer.
    //
    // This split on whitespace and commas directly, so it never saw
    // brackets or alternations: `chord("<C Dm>")` became ["<C", "Dm>"],
    // the first was rejected and the second read its suffix as "m>",
    // which was unknown — and an unknown suffix used to mean a major
    // triad, so the export was a D MAJOR, a chord in neither position
    // (#433). Both halves of that are fixed; this is the half that
    // stops the string being mangled in the first place.
    const lanes = MIDIExportService.splitLanes(chordString);
    if (lanes.length > 1) {
      return lanes.flatMap(lane => this.parseChordString(lane, startTime));
    }

    const chords = MIDIExportService.expandOperators(
      MIDIExportService.tokenize(chordString),
      token => { this.unrepresented.add(token); },
      token => { this.partial.add(token); },
    );

    // One pattern string spans a BAR, as everywhere else in this file —
    // `parseNoteString` and `parseDrumString` both divide
    // BEATS_PER_BAR. This divided 1, so `chord("C Dm")` packed both
    // chords into beat 0-1 and left three quarters of the bar empty
    // (#433 item 1).
    const chordDuration = chords.length > 0 ? BEATS_PER_BAR / chords.length : BEATS_PER_BAR;

    chords.forEach((chord, index) => {
      if (chord === '~' || chord === '-' || chord === 'r') {
        return;
      }

      const midiNotes = this.expandChord(chord);
      midiNotes.forEach(midi => {
        notes.push({
          note: midi,
          time: startTime + index * chordDuration,
          duration: chordDuration,
          velocity: 100
        });
      });
    });

    return notes;
  }

  /**
   * Attempts to find note-like patterns inline in the pattern code
   * @param pattern - Full pattern string
   * @returns Array of NoteEvent objects
   */
  private parseInlineNotes(pattern: string): NoteEvent[] {
    const notes: NoteEvent[] = [];

    // Find quoted strings that look like note sequences
    const quotedRegex = /["'`]([a-g][#b]?\d[\s,a-g#b0-9~\-[\]]+)["'`]/gi;
    let match;

    while ((match = quotedRegex.exec(pattern)) !== null) {
      const noteSequence = match[1];
      // `notes.length` was passed here — a COUNT of events, used as an
      // offset in BEATS. Two quoted sequences of three notes each put
      // the second one three beats late, and eight notes put it eight
      // beats out, past the end of the bar (#433 item 4).
      //
      // Each quoted sequence is its own lane over the same bar, which is
      // how `parsePatternNotes` treats separate `s(...)` calls.
      const parsed = this.parseNoteString(noteSequence, 0);
      notes.push(...parsed);
    }

    return notes;
  }

  /**
   * Converts parsed note events to a MIDI object
   * @param notes - Array of NoteEvent objects
   * @param options - MIDI export options
   * @returns Midi object
   */
  convertToMidi(notes: NoteEvent[], options: MIDIExportOptions = {}): InstanceType<typeof Midi> {
    const {
      bpm = 120,
      bars = 4,
      trackName = 'Strudel Pattern',
      timeSignatureNumerator = 4,
      timeSignatureDenominator = 4
    } = options;

    // bpm <= 0 makes `time = beats / (bpm / 60)` non-finite, and
    // @tonejs/midi's addNote then never returns — an infinite loop, not
    // an exception, so the try/catch around this cannot catch it.
    // Currently shielded by InputValidator at the tool boundary, but an
    // unguarded hang at a public service method is not something to
    // leave to a caller two layers up (#336).
    if (!Number.isFinite(bpm) || bpm <= 0) {
      throw new Error(`Invalid BPM: ${String(bpm)}. Must be a positive number.`);
    }
    if (!Number.isFinite(bars) || bars < 1) {
      throw new Error(`Invalid bars: ${String(bars)}. Must be at least 1.`);
    }

    const midi = new Midi();

    // Set tempo
    midi.header.setTempo(bpm);

    // Set time signature
    midi.header.timeSignatures.push({
      ticks: 0,
      timeSignature: [timeSignatureNumerator, timeSignatureDenominator],
      measures: 0
    });

    // One track per channel.
    //
    // Percussion has to land on GM channel 9 or an importer cannot tell
    // a kick from a pitched C2 — MIDIImportService keys its drum
    // handling on `track.channel === 9` exactly. Everything melodic
    // shares the default track, as before.
    const tracksByChannel = new Map<number, ReturnType<typeof midi.addTrack>>();
    const trackFor = (channel: number) => {
      let track = tracksByChannel.get(channel);
      if (!track) {
        track = midi.addTrack();
        track.name = channel === GM_PERCUSSION_CHANNEL ? `${trackName} (drums)` : trackName;
        track.channel = channel;
        tracksByChannel.set(channel, track);
      }
      return track;
    };
    // Keep a melodic track first even for a drums-only export, so the
    // file shape does not change depending on content.
    trackFor(0);

    let written = 0;
    notes.forEach(noteEvent => {
      // Only add notes within the specified bar range
      const maxTime = bars * timeSignatureNumerator;
      if (noteEvent.time >= maxTime) {
        return;
      }

      // Convert beat time to seconds at the given BPM
      const timeInSeconds = (noteEvent.time / (bpm / 60));
      const durationInSeconds = (noteEvent.duration / (bpm / 60));

      trackFor(noteEvent.channel ?? 0).addNote({
        midi: noteEvent.note,
        time: timeInSeconds,
        duration: durationInSeconds,
        velocity: noteEvent.velocity / 127
      });
      written++;
    });

    // `noteCount` reported parsed notes, not written ones, so a pattern
    // truncated by `bars` still claimed the full count — 40 note() calls
    // at bars=1 reported 40 with 4 in the file (#335).
    this.lastWrittenCount = written;

    return midi;
  }

  /**
   * Exports a Strudel pattern to a MIDI file
   * @param pattern - Strudel pattern code
   * @param filename - Output filename (default: 'pattern.mid')
   * @param options - MIDI export options
   * @returns Export result
   */
  exportToFile(
    pattern: string,
    filename: string = 'pattern.mid',
    options: MIDIExportOptions = {}
  ): MIDIExportResult {
    try {
      this.unrepresented.clear();
      this.partial.clear();
      const notes = this.parsePatternNotes(pattern);

      if (notes.length === 0) {
        // The loss report is dropped exactly where it is most useful.
        //
        // `note("c4?")` records `c4?` as unrepresented and then returns
        // here, so the caller got the generic "use note(), n(), or
        // chord()" — advice to use the function they already used —
        // instead of the list of what actually failed (#433).
        const loss = this.lossReport();
        return {
          success: false,
          output: '',
          noteCount: 0,
          bars: options.bars || 4,
          bpm: options.bpm || 120,
          ...loss,
          error: loss.unrepresented !== undefined
            ? `No notes could be exported. ${loss.warning ?? ''}`.trim()
            : 'No notes found in pattern. Use note(), n(), or chord() functions.',
        };
      }

      const midi = this.convertToMidi(notes, options);

      // Confine the write to the export directory. `filename` comes from
      // MCP tool arguments, so it is model-generated and may be hostile;
      // this used to be a bare resolve() that wrote anywhere (#224).
      const target = resolveSafeOutputPath(filename, {
        directory: this.exportDir,
        extension: '.mid',
        defaultName: 'pattern.mid',
      });

      mkdirSync(this.exportDir, { recursive: true });

      const midiArray = midi.toArray();
      writeFileSync(target.path, Buffer.from(midiArray));

      return {
        success: true,
        output: target.path,
        noteCount: this.lastWrittenCount,
        bars: this.barsProduced(notes, options.bars ?? 4),
        bpm: options.bpm || 120,
        // Surfaced so the caller knows the file did not land where it
        // asked, rather than silently believing the traversal worked.
        ...(target.wasModified
          ? { sanitizedFilename: target.filename, requestedFilename: target.requested }
          : {}),
        ...this.lossReport(),
      };
    } catch (error: any) {
      return {
        success: false,
        output: '',
        noteCount: 0,
        bars: options.bars || 4,
        bpm: options.bpm || 120,
        error: `MIDI export failed: ${error.message}`
      };
    }
  }

  /**
   * Exports a Strudel pattern to base64-encoded MIDI data
   * @param pattern - Strudel pattern code
   * @param options - MIDI export options
   * @returns Export result with base64 data
   */
  /**
   * Describes anything the parser could not represent.
   *
   * Spread into a successful result, so a caller that checks only
   * `success` is unchanged while one that reads the response sees what
   * was lost. An export that silently drops most of a pattern is the
   * shape #274 and #287 were about, one layer down (#335).
   *
   * @returns `{}` when everything was representable
   */
  /**
   * Bars the exported notes actually occupy.
   *
   * `bars: options.bars || 4` reported the CAP, so `note("c4")` — one
   * beat of content — came back `bars: 4`. A caller sizing a timeline
   * from that gets four times the music (#433).
   *
   * Never more than the cap, since notes past it are not written, and
   * never less than one: a file with content occupies a bar even if the
   * content is a single note.
   *
   * @param notes - The events actually written
   * @param cap - The requested `bars` limit
   * @returns Bars occupied, 1..cap
   */
  private barsProduced(notes: NoteEvent[], cap: number): number {
    if (notes.length === 0) return 0;
    const end = Math.max(...notes.map(n => n.time + n.duration));
    return Math.max(1, Math.min(cap, Math.ceil(end / BEATS_PER_BAR)));
  }

  private lossReport(): {
    warning?: string; unrepresented?: string[]; partiallyExported?: string[];
  } {
    const skipped = [...this.unrepresented].sort();
    const lossy = [...this.partial].sort();
    if (skipped.length === 0 && lossy.length === 0) return {};

    const parts: string[] = [];
    if (skipped.length > 0) {
      parts.push(
        `${String(skipped.length)} token(s) could not be exported and were skipped: ` +
        `${skipped.slice(0, 8).join(', ')}${skipped.length > 8 ? ', ...' : ''}`
      );
    }
    if (lossy.length > 0) {
      parts.push(
        `${String(lossy.length)} token(s) were exported with loss: ` +
        `${lossy.slice(0, 8).join(', ')}${lossy.length > 8 ? ', ...' : ''} ` +
        '(an alternation gives only its first option in a single bar; ' +
        'a duration weight is dropped)'
      );
    }

    return {
      warning: `${parts.join('. ')}.`,
      ...(skipped.length > 0 ? { unrepresented: skipped } : {}),
      ...(lossy.length > 0 ? { partiallyExported: lossy } : {}),
    };
  }

  exportToBase64(pattern: string, options: MIDIExportOptions = {}): MIDIExportResult {
    try {
      this.unrepresented.clear();
      this.partial.clear();
      const notes = this.parsePatternNotes(pattern);

      if (notes.length === 0) {
        // The loss report is dropped exactly where it is most useful.
        //
        // `note("c4?")` records `c4?` as unrepresented and then returns
        // here, so the caller got the generic "use note(), n(), or
        // chord()" — advice to use the function they already used —
        // instead of the list of what actually failed (#433).
        const loss = this.lossReport();
        return {
          success: false,
          output: '',
          noteCount: 0,
          bars: options.bars || 4,
          bpm: options.bpm || 120,
          ...loss,
          error: loss.unrepresented !== undefined
            ? `No notes could be exported. ${loss.warning ?? ''}`.trim()
            : 'No notes found in pattern. Use note(), n(), or chord() functions.',
        };
      }

      const midi = this.convertToMidi(notes, options);
      const midiArray = midi.toArray();
      const buffer = Buffer.from(midiArray);
      const base64 = buffer.toString('base64');

      return {
        success: true,
        output: base64,
        noteCount: this.lastWrittenCount,
        bars: this.barsProduced(notes, options.bars ?? 4),
        bpm: options.bpm || 120,
        ...this.lossReport(),
      };
    } catch (error: any) {
      return {
        success: false,
        output: '',
        noteCount: 0,
        bars: options.bars || 4,
        bpm: options.bpm || 120,
        error: `MIDI export failed: ${error.message}`
      };
    }
  }
}
