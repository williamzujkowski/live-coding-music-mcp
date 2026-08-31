/**
 * Four layout errors in the export path (#433 items 1-4).
 *
 * Each is plain arithmetic with an unambiguous right answer, and each
 * put notes at times the pattern does not describe.
 */

import { MIDIExportService } from '../../services/MIDIExportService';

interface Ev { time: number; duration: number; note: number }
const at = (events: Ev[], time: number): number[] =>
  events.filter(e => Math.abs(e.time - time) < 1e-6).map(e => e.note).sort((a, b) => a - b);

describe('export layout arithmetic (#433)', () => {
  const parse = (pattern: string): Ev[] =>
    new MIDIExportService().parsePatternNotes(pattern) as Ev[];

  it('chords span the bar, like every other path (item 1)', () => {
    // `chordDuration` divided 1 where `parseNoteString` and
    // `parseDrumString` both divide BEATS_PER_BAR, so both chords were
    // packed into beat 0-1 and three quarters of the bar was empty.
    const events = parse('chord("C Dm")');

    expect(at(events, 0)).toEqual([60, 64, 67]);   // C
    expect(at(events, 2)).toEqual([62, 65, 69]);   // Dm, halfway through
    expect(events.every(e => e.duration === 2)).toBe(true);
  });

  it('a bracket with spaces subdivides its step (item 2)', () => {
    // `[c4 d4]` is two notes inside one step. Both used to get the
    // step's start time, turning a subdivision into a chord.
    const events = parse('note("[c4 d4] e4")');

    expect(at(events, 0)).toEqual([60]);
    expect(at(events, 1)).toEqual([62]);
    expect(at(events, 2)).toEqual([64]);
  });

  it('a bracket with commas is a chord and keeps full length (item 3)', () => {
    // `[c4,e4,g4]` is what IMPORT emits for simultaneous notes, so this
    // is the round trip of the exporter's own input. Every note used to
    // be shortened by the chord size — a third of its length here.
    const events = parse('note("[c4,e4,g4]")');

    expect(at(events, 0)).toEqual([60, 64, 67]);
    expect(events.every(e => e.duration === 4)).toBe(true);
  });

  it('a second quoted sequence is not pushed late by the first (item 4)', () => {
    // `parseInlineNotes` passed `notes.length` — a COUNT of events —
    // where a beat offset belongs, so the second sequence started three
    // beats after the first, and a longer one would land past the bar.
    const events = parse('someUnknownFn("c4 e4 g4").other("a4 b4 c5")');

    // Both sequences are lanes over the same bar.
    expect(at(events, 0)).toEqual([60, 69]);
    expect(events.every(e => e.time < 4)).toBe(true);
  });

  it('an ordinary sequence is unchanged', () => {
    // The layouts that were already right must not move.
    const events = parse('note("c4 e4 g4 c5")');

    expect(events.map(e => e.time)).toEqual([0, 1, 2, 3]);
    expect(events.every(e => e.duration === 1)).toBe(true);
  });
});
