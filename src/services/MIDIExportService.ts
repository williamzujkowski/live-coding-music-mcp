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
import { writeFileSync } from 'fs';
import { resolve } from 'path';

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
  /** Error message if failed */
  error?: string;
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
  'm6': [0, 3, 7, 9]          // minor 6
};

export class MIDIExportService {
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
    const octave = octaveStr !== undefined ? parseInt(octaveStr, 10) : 4;

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
    const intervals = CHORD_INTERVALS[chordType.toLowerCase()] || CHORD_INTERVALS[''];

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
      currentTime += parsedNotes.length > 0 ? 1 : 0;
    }

    // Extract n() function calls (Strudel shorthand)
    const nRegex = /\bn\s*\(\s*["'`]([^"'`]+)["'`]\s*\)/gi;
    let nMatch;

    while ((nMatch = nRegex.exec(pattern)) !== null) {
      const noteContent = nMatch[1];
      // n() uses MIDI numbers directly
      const parsedNotes = this.parseNoteString(noteContent, currentTime, true);
      notes.push(...parsedNotes);
      currentTime += parsedNotes.length > 0 ? 1 : 0;
    }

    // Extract chord patterns
    const chordRegex = /chord\s*\(\s*["'`]([^"'`]+)["'`]\s*\)/gi;
    let chordMatch;

    while ((chordMatch = chordRegex.exec(pattern)) !== null) {
      const chordContent = chordMatch[1];
      const parsedChords = this.parseChordString(chordContent, currentTime);
      notes.push(...parsedChords);
      currentTime += parsedChords.length > 0 ? 1 : 0;
    }

    // Extract s() sound patterns with n() modifier for samples
    // e.g., s("piano").n("0 2 4 7")
    const soundNRegex = /s\s*\([^)]+\)\s*\.n\s*\(\s*["'`]([^"'`]+)["'`]\s*\)/gi;
    let soundNMatch;

    while ((soundNMatch = soundNRegex.exec(pattern)) !== null) {
      const noteContent = soundNMatch[1];
      const parsedNotes = this.parseNoteString(noteContent, currentTime, true);
      notes.push(...parsedNotes);
      currentTime += parsedNotes.length > 0 ? 1 : 0;
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
  private parseNoteString(
    noteString: string,
    startTime: number,
    asMidiNumbers: boolean = false
  ): NoteEvent[] {
    const notes: NoteEvent[] = [];
    const parts = noteString.split(/[\s,]+/).filter(p => p.length > 0);

    const noteDuration = parts.length > 0 ? 1 / parts.length : 1;

    parts.forEach((part, index) => {
      // Check for rest
      if (part === '~' || part === '-' || part === 'r') {
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

      // Ensure filename has .mid extension
      const finalFilename = filename.endsWith('.mid') ? filename : `${filename}.mid`;
      const outputPath = resolve(finalFilename);

      // Write MIDI data
      const midiArray = midi.toArray();
      writeFileSync(outputPath, Buffer.from(midiArray));

      return {
        success: true,
        output: outputPath,
        noteCount: notes.length,
        bars: options.bars || 4,
        bpm: options.bpm || 120
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
  exportToBase64(pattern: string, options: MIDIExportOptions = {}): MIDIExportResult {
    try {
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
        bpm: options.bpm || 120
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
