/**
 * Wrong events where an error belonged (#433 items 8-11).
 *
 * Each of these produced a plausible-looking note the pattern does not
 * describe, or nothing at all, and reported success either way.
 */

import { MIDIExportService } from '../../services/MIDIExportService';

describe('chord and sound parsing (#433)', () => {
  const parse = (pattern: string): Array<{ time: number; note: number }> =>
    new MIDIExportService().parsePatternNotes(pattern);
  const notesAt = (pattern: string, time: number): number[] =>
    parse(pattern).filter(e => e.time === time).map(e => e.note).sort((a, b) => a - b);

  it('sound().n() is parsed, like s().n() already was (item 8)', () => {
    // Three passes and none took it: the drum pass's lookahead skipped
    // it, this pass only knew `s(`, and the bare n() pass is blocked by
    // its own lookbehind. Zero notes, no error.
    expect(parse('sound("piano").n("60 62")')).toHaveLength(2);
    // The spelling that already worked must keep working.
    expect(parse('s("piano").n("60 62")')).toHaveLength(2);
  });

  it('does not double-count s("bd").n(...) (item 8 guard)', () => {
    // Widening the regex must not make two passes claim the same text —
    // that was #335, and it is the obvious way to break this.
    expect(parse('s("bd").n("0 1 2")')).toHaveLength(3);
    expect(parse('sound("bd").n("0 1 2")')).toHaveLength(3);
  });

  it('an unknown chord suffix is reported, not silently majorised (item 9)', () => {
    // The major-triad fallback stays — #336 chose it deliberately for
    // input nobody can interpret, and a triad on the named root is a
    // defensible reading of `chord("Cfoo")`. What was wrong was the
    // silence: the caller had no way to learn the suffix was ignored.
    const service = new MIDIExportService();
    const result = service.exportToBase64('chord("Cxyz")');

    expect(result.success).toBe(true);
    expect(result.unrepresented).toContain('Cxyz');
    // And it still exports the triad, rather than dropping the chord.
    expect(notesAt('chord("Cxyz")', 0)).toEqual([60, 64, 67]);
  });

  it('an alternation is not mangled into a chord from neither position (item 10)', () => {
    // `chord("<C Dm>")` split on whitespace into "<C" (rejected) and
    // "Dm>" (suffix "m>" unknown -> major triad), exporting a D MAJOR.
    expect(notesAt('chord("<C Dm>")', 0)).toEqual([60, 64, 67]);
  });

  it('Cb roots an octave below C, as noteNameToMidi already knew (item 11)', () => {
    // Cb4 is B3 (59), not B4 (71). `noteNameToMidi` has this correction
    // and `expandChord` did not.
    expect(notesAt('chord("Cb")', 0)).toEqual([59, 63, 66]);
  });

  it('ordinary chords are unchanged', () => {
    expect(notesAt('chord("C")', 0)).toEqual([60, 64, 67]);
    expect(notesAt('chord("Am")', 0)).toEqual([69, 72, 76]);
    // Case-sensitive suffix: M7 is major 7, not minor 7 (#336).
    expect(notesAt('chord("CM7")', 0)).toEqual([60, 64, 67, 71]);
  });
});
