/**
 * Chord suffix and enharmonic correctness in MIDI export (#336).
 */

import { MIDIExportService } from '../../services/MIDIExportService';

const service = () => new MIDIExportService();
/** Interval pattern relative to the root, so the tests read musically. */
const intervals = (chord: string): number[] => {
  const notes = service().expandChord(chord);
  return notes.map(n => n - notes[0]);
};

describe('case-sensitive chord suffixes (#336)', () => {
  it('CM7 is a major seventh, not a minor seventh', () => {
    // The lookup lowercased first, so 'M7' became the 'm7' key and CM7
    // produced [60,63,67,70] — a C MINOR 7. Two spellings of the same
    // chord, a semitone apart.
    expect(intervals('CM7')).toEqual([0, 4, 7, 11]);
  });

  it('CM7 and Cmaj7 agree', () => {
    expect(service().expandChord('CM7')).toEqual(service().expandChord('Cmaj7'));
  });

  it('lowercase m7 is still minor', () => {
    expect(intervals('Cm7')).toEqual([0, 3, 7, 10]);
  });

  it.each([['CM9', [0, 4, 7, 11, 14]], ['CM6', [0, 4, 7, 9]]])(
    '%s keeps its major quality', (chord, expected) => {
      expect(intervals(chord)).toEqual(expected);
    });
});

describe('minor spellings do not become major (#336)', () => {
  it.each(['Cmin', 'Cminor', 'Cm11', 'Cm7b5', 'Cm13'])(
    '%s has a minor third', chord => {
      // All of these fell through to the major-triad fallback, so they
      // came back with a MAJOR third — silently wrong, and worse than
      // the unknown suffix the fallback was written for.
      expect(intervals(chord)).toContain(3);
      expect(intervals(chord)).not.toContain(4);
    });

  it('m7b5 is half-diminished, with a flat fifth', () => {
    expect(intervals('Cm7b5')).toEqual([0, 3, 6, 10]);
  });

  it('a genuinely unknown suffix still falls back to a major triad', () => {
    // The fallback is fine for input nobody can interpret; the bug was
    // applying it to suffixes with an obvious meaning.
    expect(intervals('Cfoo')).toEqual([0, 4, 7]);
  });

  it.each([['C13', 6], ['Csus', 3], ['C5', 2], ['C7sus4', 4]])(
    '%s is recognised rather than silently majorised', (chord, size) => {
      expect(service().expandChord(chord)).toHaveLength(size);
    });
});

describe('enharmonics land in the right octave (#336)', () => {
  it.each([
    ['cb4', 59],   // B3, not B4
    ['b#4', 72],   // C5, not C4
    ['cb0', 11],
    ['b#-1', 12],
  ])('%s is MIDI %i', (name, expected) => {
    // NOTE_NAMES maps 'cb' to 11 and 'b#' to 0 — the right pitch
    // classes — but the octave has to move with them across the C
    // boundary. The semitone was right and the octave was not.
    expect(service().noteNameToMidi(name)).toBe(expected);
  });

  it('agrees with the plain spelling of the same pitch', () => {
    const svc = service();
    expect(svc.noteNameToMidi('cb4')).toBe(svc.noteNameToMidi('b3'));
    expect(svc.noteNameToMidi('b#4')).toBe(svc.noteNameToMidi('c5'));
  });

  it.each([['c4', 60], ['b4', 71], ['db4', 61], ['c5', 72]])(
    'leaves %s alone', (name, expected) => {
      expect(service().noteNameToMidi(name)).toBe(expected);
    });
});

describe('bpm <= 0 is refused, not hung (#336)', () => {
  it.each([0, -5, NaN, Infinity])('bpm %p fails fast', bpm => {
    // `time = beats / (bpm / 60)` is non-finite, and @tonejs/midi's
    // addNote then never returns — an infinite loop, not an exception,
    // so the surrounding try/catch could not catch it. Shielded at the
    // tool boundary, but this is a public service method.
    const started = Date.now();
    const result = service().exportToBase64('note("c4 e4")', { bpm });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Invalid BPM/);
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it('a valid bpm still exports', () => {
    expect(service().exportToBase64('note("c4 e4")', { bpm: 174 }).success).toBe(true);
  });
});
