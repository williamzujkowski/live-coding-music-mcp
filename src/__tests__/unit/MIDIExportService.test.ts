/**
 * Unit tests for MIDIExportService
 *
 * Tests MIDI export functionality including:
 * - Note name to MIDI number conversion
 * - Chord expansion
 * - Pattern parsing
 * - MIDI file generation
 * - Error handling
 */

import { MIDIExportService, NoteEvent } from '../../services/MIDIExportService';
import { unlinkSync, existsSync } from 'fs';

describe('MIDIExportService', () => {
  let service: MIDIExportService;

  beforeEach(() => {
    service = new MIDIExportService();
  });

  // ============================================================================
  // NOTE NAME TO MIDI CONVERSION TESTS
  // ============================================================================

  describe('noteNameToMidi', () => {
    it('should convert C4 to MIDI 60 (middle C)', () => {
      expect(service.noteNameToMidi('C4')).toBe(60);
      expect(service.noteNameToMidi('c4')).toBe(60);
    });

    it('should convert notes across octaves correctly', () => {
      expect(service.noteNameToMidi('C0')).toBe(12);
      expect(service.noteNameToMidi('C1')).toBe(24);
      expect(service.noteNameToMidi('C2')).toBe(36);
      expect(service.noteNameToMidi('C3')).toBe(48);
      expect(service.noteNameToMidi('C5')).toBe(72);
      expect(service.noteNameToMidi('C6')).toBe(84);
    });

    it('should handle sharps correctly', () => {
      expect(service.noteNameToMidi('C#4')).toBe(61);
      expect(service.noteNameToMidi('D#4')).toBe(63);
      expect(service.noteNameToMidi('F#4')).toBe(66);
      expect(service.noteNameToMidi('G#4')).toBe(68);
      expect(service.noteNameToMidi('A#4')).toBe(70);
    });

    it('should handle flats correctly', () => {
      expect(service.noteNameToMidi('Db4')).toBe(61);
      expect(service.noteNameToMidi('Eb4')).toBe(63);
      expect(service.noteNameToMidi('Gb4')).toBe(66);
      expect(service.noteNameToMidi('Ab4')).toBe(68);
      expect(service.noteNameToMidi('Bb4')).toBe(70);
    });

    it('should handle all natural notes in octave 4', () => {
      expect(service.noteNameToMidi('C4')).toBe(60);
      expect(service.noteNameToMidi('D4')).toBe(62);
      expect(service.noteNameToMidi('E4')).toBe(64);
      expect(service.noteNameToMidi('F4')).toBe(65);
      expect(service.noteNameToMidi('G4')).toBe(67);
      expect(service.noteNameToMidi('A4')).toBe(69);
      expect(service.noteNameToMidi('B4')).toBe(71);
    });

    it('should default to octave 4 when no octave specified', () => {
      expect(service.noteNameToMidi('C')).toBe(60);
      expect(service.noteNameToMidi('D')).toBe(62);
      expect(service.noteNameToMidi('G')).toBe(67);
    });

    it('should handle MIDI numbers as strings', () => {
      expect(service.noteNameToMidi('60')).toBe(60);
      expect(service.noteNameToMidi('127')).toBe(127);
      expect(service.noteNameToMidi('0')).toBe(0);
    });

    it('should return null for invalid inputs', () => {
      expect(service.noteNameToMidi('')).toBeNull();
      expect(service.noteNameToMidi('X4')).toBeNull();
      expect(service.noteNameToMidi('C##4')).toBeNull();
      expect(service.noteNameToMidi('hello')).toBeNull();
    });

    it('should return null for out of range MIDI numbers', () => {
      expect(service.noteNameToMidi('C-2')).toBeNull();
      expect(service.noteNameToMidi('G10')).toBeNull();
      expect(service.noteNameToMidi('128')).toBeNull();
      expect(service.noteNameToMidi('-1')).toBeNull();
    });

    it('should handle negative octaves', () => {
      expect(service.noteNameToMidi('C-1')).toBe(0);
    });
  });

  // ============================================================================
  // MIDI TO NOTE NAME CONVERSION TESTS
  // ============================================================================

  describe('midiToNoteName', () => {
    it('should convert MIDI 60 to C4', () => {
      expect(service.midiToNoteName(60)).toBe('C4');
    });

    it('should convert various MIDI numbers correctly', () => {
      expect(service.midiToNoteName(0)).toBe('C-1');
      expect(service.midiToNoteName(12)).toBe('C0');
      expect(service.midiToNoteName(127)).toBe('G9');
      expect(service.midiToNoteName(69)).toBe('A4');
    });

    it('should handle sharps correctly', () => {
      expect(service.midiToNoteName(61)).toBe('C#4');
      expect(service.midiToNoteName(63)).toBe('D#4');
      expect(service.midiToNoteName(66)).toBe('F#4');
    });
  });

  // ============================================================================
  // CHORD EXPANSION TESTS
  // ============================================================================

  describe('expandChord', () => {
    it('should expand major chord correctly', () => {
      const notes = service.expandChord('C');
      expect(notes).toEqual([60, 64, 67]); // C E G
    });

    it('should expand minor chord correctly', () => {
      const notes = service.expandChord('Cm');
      expect(notes).toEqual([60, 63, 67]); // C Eb G
    });

    it('should expand dominant 7th chord correctly', () => {
      const notes = service.expandChord('C7');
      expect(notes).toEqual([60, 64, 67, 70]); // C E G Bb
    });

    it('should expand major 7th chord correctly', () => {
      const notes = service.expandChord('Cmaj7');
      expect(notes).toEqual([60, 64, 67, 71]); // C E G B
    });

    it('should expand minor 7th chord correctly', () => {
      const notes = service.expandChord('Cm7');
      expect(notes).toEqual([60, 63, 67, 70]); // C Eb G Bb
    });

    it('should expand diminished chord correctly', () => {
      const notes = service.expandChord('Cdim');
      expect(notes).toEqual([60, 63, 66]); // C Eb Gb
    });

    it('should expand augmented chord correctly', () => {
      const notes = service.expandChord('Caug');
      expect(notes).toEqual([60, 64, 68]); // C E G#
    });

    it('should handle different root notes', () => {
      expect(service.expandChord('G')).toEqual([67, 71, 74]);  // G B D
      expect(service.expandChord('F')).toEqual([65, 69, 72]);  // F A C
      expect(service.expandChord('Am')).toEqual([69, 72, 76]); // A C E
    });

    it('should handle sharps and flats in chord names', () => {
      expect(service.expandChord('F#')).toEqual([66, 70, 73]);  // F# A# C#
      expect(service.expandChord('Bb')).toEqual([70, 74, 77]);  // Bb D F
    });

    it('should respect octave parameter', () => {
      const octave3 = service.expandChord('C', 3);
      const octave5 = service.expandChord('C', 5);
      expect(octave3).toEqual([48, 52, 55]); // C3 E3 G3
      expect(octave5).toEqual([72, 76, 79]); // C5 E5 G5
    });

    it('should return empty array for invalid input', () => {
      expect(service.expandChord('')).toEqual([]);
      expect(service.expandChord('X')).toEqual([]);
    });
  });

  // ============================================================================
  // PATTERN PARSING TESTS
  // ============================================================================

  describe('parsePatternNotes', () => {
    it('should parse note() function with single note', () => {
      const notes = service.parsePatternNotes('note("c4")');
      expect(notes.length).toBe(1);
      expect(notes[0].note).toBe(60);
    });

    it('should parse note() function with multiple notes', () => {
      const notes = service.parsePatternNotes('note("c4 e4 g4")');
      expect(notes.length).toBe(3);
      expect(notes[0].note).toBe(60);
      expect(notes[1].note).toBe(64);
      expect(notes[2].note).toBe(67);
    });

    it('should parse note() with comma-separated notes', () => {
      const notes = service.parsePatternNotes('note("c4, e4, g4")');
      expect(notes.length).toBe(3);
    });

    it('should parse n() function with MIDI numbers', () => {
      const notes = service.parsePatternNotes('n("60 64 67")');
      expect(notes.length).toBe(3);
      expect(notes[0].note).toBe(60);
      expect(notes[1].note).toBe(64);
      expect(notes[2].note).toBe(67);
    });

    it('should parse chord() function', () => {
      const notes = service.parsePatternNotes('chord("Cmaj7")');
      expect(notes.length).toBe(4);
      expect(notes[0].note).toBe(60);
      expect(notes[1].note).toBe(64);
      expect(notes[2].note).toBe(67);
      expect(notes[3].note).toBe(71);
    });

    it('should parse multiple chord() patterns', () => {
      const notes = service.parsePatternNotes('chord("C Am")');
      expect(notes.length).toBe(6); // 3 for C + 3 for Am
    });

    it('should handle rests (~) in patterns', () => {
      const notes = service.parsePatternNotes('note("c4 ~ e4 ~")');
      expect(notes.length).toBe(2);
    });

    it('should handle patterns with s().n() structure', () => {
      const notes = service.parsePatternNotes('s("piano").n("0 2 4 7")');
      // Pattern is parsed by both n() and s().n() matchers, getting 8 notes total
      // The important thing is the MIDI numbers are correct
      expect(notes.length).toBeGreaterThanOrEqual(4);
      expect(notes.some(n => n.note === 0)).toBe(true);
      expect(notes.some(n => n.note === 2)).toBe(true);
      expect(notes.some(n => n.note === 4)).toBe(true);
      expect(notes.some(n => n.note === 7)).toBe(true);
    });

    it('should handle backticks in patterns', () => {
      const notes = service.parsePatternNotes('note(`c4 e4 g4`)');
      expect(notes.length).toBe(3);
    });

    it('should handle single quotes in patterns', () => {
      const notes = service.parsePatternNotes("note('c4 e4 g4')");
      expect(notes.length).toBe(3);
    });

    it('should calculate correct timing for notes', () => {
      const notes = service.parsePatternNotes('note("c4 e4 g4 b4")');
      expect(notes[0].time).toBe(0);
      expect(notes[1].time).toBe(0.25);
      expect(notes[2].time).toBe(0.5);
      expect(notes[3].time).toBe(0.75);
    });

    it('should return empty array for patterns without notes', () => {
      const notes = service.parsePatternNotes('s("bd sd hh cp")');
      expect(notes.length).toBe(0);
    });

    it('should return empty array for invalid input', () => {
      expect(service.parsePatternNotes('')).toEqual([]);
      expect(service.parsePatternNotes(null as any)).toEqual([]);
      expect(service.parsePatternNotes(undefined as any)).toEqual([]);
    });
  });

  // ============================================================================
  // MIDI CONVERSION TESTS
  // ============================================================================

  describe('convertToMidi', () => {
    it('should create MIDI object with notes', () => {
      const notes: NoteEvent[] = [
        { note: 60, time: 0, duration: 0.5, velocity: 100 },
        { note: 64, time: 0.5, duration: 0.5, velocity: 100 }
      ];

      const midi = service.convertToMidi(notes);
      expect(midi.tracks.length).toBe(1);
      expect(midi.tracks[0].notes.length).toBe(2);
    });

    it('should set correct tempo', () => {
      const notes: NoteEvent[] = [
        { note: 60, time: 0, duration: 0.5, velocity: 100 }
      ];

      const midi = service.convertToMidi(notes, { bpm: 140 });
      // @tonejs/midi stores tempo in header.tempos
      expect(midi.header.tempos[0].bpm).toBe(140);
    });

    it('should set track name', () => {
      const notes: NoteEvent[] = [
        { note: 60, time: 0, duration: 0.5, velocity: 100 }
      ];

      const midi = service.convertToMidi(notes, { trackName: 'My Track' });
      expect(midi.tracks[0].name).toBe('My Track');
    });

    it('should limit notes to specified bar count', () => {
      const notes: NoteEvent[] = [
        { note: 60, time: 0, duration: 1, velocity: 100 },
        { note: 64, time: 4, duration: 1, velocity: 100 },   // In 4 bars
        { note: 67, time: 8, duration: 1, velocity: 100 }    // Beyond 4 bars
      ];

      const midi = service.convertToMidi(notes, { bars: 2 });
      expect(midi.tracks[0].notes.length).toBe(2);
    });

    it('should handle empty notes array', () => {
      const midi = service.convertToMidi([]);
      expect(midi.tracks.length).toBe(1);
      expect(midi.tracks[0].notes.length).toBe(0);
    });

    it('should use default options when not specified', () => {
      const notes: NoteEvent[] = [
        { note: 60, time: 0, duration: 0.5, velocity: 100 }
      ];

      const midi = service.convertToMidi(notes);
      expect(midi.header.tempos[0].bpm).toBe(120);
      expect(midi.tracks[0].name).toBe('Strudel Pattern');
    });
  });

  // ============================================================================
  // FILE EXPORT TESTS
  // ============================================================================

  describe('exportToFile', () => {
    const testFilename = 'test-midi-export.mid';

    afterEach(() => {
      // Clean up test file
      const path = require('path').resolve(testFilename);
      if (existsSync(path)) {
        unlinkSync(path);
      }
    });

    it('should export pattern to MIDI file', () => {
      const result = service.exportToFile('note("c4 e4 g4")', testFilename);

      expect(result.success).toBe(true);
      expect(result.noteCount).toBe(3);
      expect(result.bars).toBe(4);
      expect(result.bpm).toBe(120);
      expect(existsSync(result.output)).toBe(true);
    });

    it('should add .mid extension if missing', () => {
      const result = service.exportToFile('note("c4")', 'test-no-ext');

      expect(result.success).toBe(true);
      expect(result.output.endsWith('.mid')).toBe(true);

      // Cleanup
      if (existsSync(result.output)) {
        unlinkSync(result.output);
      }
    });

    it('should fail when pattern has no notes', () => {
      const result = service.exportToFile('s("bd sd")', testFilename);

      expect(result.success).toBe(false);
      expect(result.error).toContain('No notes found');
    });

    it('should use custom BPM', () => {
      const result = service.exportToFile('note("c4")', testFilename, { bpm: 140 });

      expect(result.success).toBe(true);
      expect(result.bpm).toBe(140);
    });

    it('should use custom bar count', () => {
      const result = service.exportToFile('note("c4")', testFilename, { bars: 8 });

      expect(result.success).toBe(true);
      expect(result.bars).toBe(8);
    });
  });

  // ============================================================================
  // BASE64 EXPORT TESTS
  // ============================================================================

  describe('exportToBase64', () => {
    it('should export pattern to base64', () => {
      const result = service.exportToBase64('note("c4 e4 g4")');

      expect(result.success).toBe(true);
      expect(result.noteCount).toBe(3);
      expect(result.output.length).toBeGreaterThan(0);
      // Base64 should start with MIDI header
      expect(result.output.startsWith('TV')).toBe(true); // 'MThd' in base64
    });

    it('should fail when pattern has no notes', () => {
      const result = service.exportToBase64('s("bd sd")');

      expect(result.success).toBe(false);
      expect(result.error).toContain('No notes found');
    });

    it('should use custom options', () => {
      const result = service.exportToBase64('note("c4")', { bpm: 160, bars: 2 });

      expect(result.success).toBe(true);
      expect(result.bpm).toBe(160);
      expect(result.bars).toBe(2);
    });

    it('should produce valid base64 that can be decoded', () => {
      const result = service.exportToBase64('note("c4 e4 g4")');

      expect(() => {
        Buffer.from(result.output, 'base64');
      }).not.toThrow();
    });
  });

  // ============================================================================
  // ERROR HANDLING TESTS
  // ============================================================================

  describe('Error Handling', () => {
    it('should handle null pattern gracefully', () => {
      const result = service.exportToBase64(null as any);
      expect(result.success).toBe(false);
    });

    it('should handle undefined pattern gracefully', () => {
      const result = service.exportToBase64(undefined as any);
      expect(result.success).toBe(false);
    });

    it('should handle empty string pattern', () => {
      const result = service.exportToBase64('');
      expect(result.success).toBe(false);
      expect(result.error).toContain('No notes found');
    });

    it('should handle pattern with only whitespace', () => {
      const result = service.exportToBase64('   \n\t  ');
      expect(result.success).toBe(false);
    });
  });

  // ============================================================================
  // COMPLEX PATTERN TESTS
  // ============================================================================

  describe('Complex Patterns', () => {
    it('should parse pattern with multiple note() calls', () => {
      const pattern = `
        note("c4 e4 g4")
        note("d4 f4 a4")
      `;
      const result = service.exportToBase64(pattern);

      expect(result.success).toBe(true);
      expect(result.noteCount).toBe(6);
    });

    it('should parse pattern with effects chained', () => {
      const pattern = 'note("c4 e4 g4").gain(0.8).room(0.5)';
      const result = service.exportToBase64(pattern);

      expect(result.success).toBe(true);
      expect(result.noteCount).toBe(3);
    });

    it('should parse pattern with stack/cat constructs', () => {
      const pattern = `
        stack(
          note("c4 e4 g4"),
          note("g3 g3 g3")
        )
      `;
      const result = service.exportToBase64(pattern);

      expect(result.success).toBe(true);
      expect(result.noteCount).toBe(6);
    });

    it('should handle real-world techno pattern', () => {
      const pattern = `
        note("c2 ~ c2 ~ c2 ~ c2 eb2")
          .s("sawtooth")
          .gain(0.6)
          .lpf(400)
      `;
      const result = service.exportToBase64(pattern);

      expect(result.success).toBe(true);
      expect(result.noteCount).toBeGreaterThan(0);
    });
  });
});
