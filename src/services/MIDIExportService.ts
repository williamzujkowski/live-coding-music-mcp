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
 * Beats in one bar / cycle.
 *
 * Export and import must agree on this or a round trip rescales time.
 * `MIDIImportService` uses `secondsPerBeat * 4`; this is the same 4,
 * named so the next person changing one finds the other (#336).
 */
export const BEATS_PER_BAR = 4;

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
    const intervals = Object.hasOwn(CASE_SENSITIVE_CHORDS, chordType)
      ? CASE_SENSITIVE_CHORDS[chordType]
      : Object.hasOwn(CHORD_INTERVALS, key)
        ? CHORD_INTERVALS[key]
        : CHORD_INTERVALS[''];

    const rootMidi = (octave + 1) * 12 + rootSemitone;

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
    let currentTime = 0;

    // Extract note() function calls
    // Matches: note("c4 e4 g4"), note("c4", "e4"), note(`c4`)
    const noteRegex = /note\s*\(\s*["'`]([^"'`]+)["'`]\s*\)/gi;
    let noteMatch;

    while ((noteMatch = noteRegex.exec(pattern)) !== null) {
      const noteContent = noteMatch[1];
      const parsedNotes = this.parseNoteString(noteContent, currentTime);
      notes.push(...parsedNotes);
      currentTime += parsedNotes.length > 0 ? BEATS_PER_BAR : 0;
    }

    // Extract n() function calls (Strudel shorthand)
    const nRegex = /\bn\s*\(\s*["'`]([^"'`]+)["'`]\s*\)/gi;
    let nMatch;

    while ((nMatch = nRegex.exec(pattern)) !== null) {
      const noteContent = nMatch[1];
      // n() uses MIDI numbers directly
      const parsedNotes = this.parseNoteString(noteContent, currentTime, true);
      notes.push(...parsedNotes);
      currentTime += parsedNotes.length > 0 ? BEATS_PER_BAR : 0;
    }

    // Extract chord patterns
    const chordRegex = /chord\s*\(\s*["'`]([^"'`]+)["'`]\s*\)/gi;
    let chordMatch;

    while ((chordMatch = chordRegex.exec(pattern)) !== null) {
      const chordContent = chordMatch[1];
      const parsedChords = this.parseChordString(chordContent, currentTime);
      notes.push(...parsedChords);
      currentTime += parsedChords.length > 0 ? BEATS_PER_BAR : 0;
    }

    // Extract s() sound patterns with n() modifier for samples
    // e.g., s("piano").n("0 2 4 7")
    const soundNRegex = /s\s*\([^)]+\)\s*\.n\s*\(\s*["'`]([^"'`]+)["'`]\s*\)/gi;
    let soundNMatch;

    while ((soundNMatch = soundNRegex.exec(pattern)) !== null) {
      const noteContent = soundNMatch[1];
      const parsedNotes = this.parseNoteString(noteContent, currentTime, true);
      notes.push(...parsedNotes);
      currentTime += parsedNotes.length > 0 ? BEATS_PER_BAR : 0;
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
   * MIDIExportService.tokenize('[c4 e4] g4'); // ['[c4 e4]', 'g4']
   */
  static tokenize(source: string): string[] {
    const tokens: string[] = [];
    let current = '';
    let depth = 0;

    for (const char of source) {
      if (char === '[') depth++;
      if (char === ']') depth = Math.max(0, depth - 1);

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
    const parts = MIDIExportService.tokenize(noteString);

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
      if (/[*!@<>?%]/.test(part)) {
        this.unrepresented.add(part);
        return;
      }

      // Handle sub-patterns in brackets [c4 e4]
      if (part.startsWith('[')) {
        const subContent = part.replace(/[[\]]/g, '');
        const subParts = subContent.split(/[\s,]+/);
        subParts.forEach(subPart => {
          const midi = asMidiNumbers
            ? parseInt(subPart, 10)
            : this.noteNameToMidi(subPart);

          if (midi !== null && !isNaN(midi) && midi >= 0 && midi <= 127) {
            notes.push({
              note: midi,
              time: startTime + index * noteDuration,
              duration: noteDuration / subParts.length,
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
    const chords = chordString.split(/[\s,]+/).filter(c => c.length > 0);

    const chordDuration = chords.length > 0 ? 1 / chords.length : 1;

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
      const parsed = this.parseNoteString(noteSequence, notes.length);
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

    // Create track
    const track = midi.addTrack();
    track.name = trackName;

    // Add notes to track
    notes.forEach(noteEvent => {
      // Only add notes within the specified bar range
      const maxTime = bars * timeSignatureNumerator;
      if (noteEvent.time >= maxTime) {
        return;
      }

      // Convert beat time to seconds at the given BPM
      const timeInSeconds = (noteEvent.time / (bpm / 60));
      const durationInSeconds = (noteEvent.duration / (bpm / 60));

      track.addNote({
        midi: noteEvent.note,
        time: timeInSeconds,
        duration: durationInSeconds,
        velocity: noteEvent.velocity / 127
      });
    });

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
      const notes = this.parsePatternNotes(pattern);

      if (notes.length === 0) {
        return {
          success: false,
          output: '',
          noteCount: 0,
          bars: options.bars || 4,
          bpm: options.bpm || 120,
          error: 'No notes found in pattern. Use note(), n(), or chord() functions.'
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
        noteCount: notes.length,
        bars: options.bars || 4,
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
  private lossReport(): { warning?: string; unrepresented?: string[] } {
    if (this.unrepresented.size === 0) return {};
    const tokens = [...this.unrepresented].sort();
    return {
      warning:
        `${String(tokens.length)} token(s) could not be exported and were skipped: ` +
        `${tokens.slice(0, 8).join(', ')}${tokens.length > 8 ? ', ...' : ''}. ` +
        'MIDI export reads plain note names only — mini-notation operators ' +
        '(*, !, @, <>) are not implemented.',
      unrepresented: tokens,
    };
  }

  exportToBase64(pattern: string, options: MIDIExportOptions = {}): MIDIExportResult {
    try {
      this.unrepresented.clear();
      const notes = this.parsePatternNotes(pattern);

      if (notes.length === 0) {
        return {
          success: false,
          output: '',
          noteCount: 0,
          bars: options.bars || 4,
          bpm: options.bpm || 120,
          error: 'No notes found in pattern. Use note(), n(), or chord() functions.'
        };
      }

      const midi = this.convertToMidi(notes, options);
      const midiArray = midi.toArray();
      const buffer = Buffer.from(midiArray);
      const base64 = buffer.toString('base64');

      return {
        success: true,
        output: base64,
        noteCount: notes.length,
        bars: options.bars || 4,
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
