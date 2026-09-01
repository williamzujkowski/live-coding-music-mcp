/**
 * Bracket layout on the note lane, and unknown names.
 *
 * Two defects, both #469:
 *
 *  - `[c4 e4, g4]` mixes the two separators. The old code decided
 *    `isChord = subContent.includes(',')` and then split on
 *    `/[\s,]+/`, flattening both and applying one verdict to the lot —
 *    so a sequence played against a held note exported as a three-note
 *    chord, with every note four times too long.
 *  - `note("c4 zz g4")` dropped `zz` in silence. The drum lane got that
 *    fix in #433; the note lane never did.
 */
import { MIDIExportService } from '../../services/MIDIExportService';

describe('Note lane layout', () => {
  let service: MIDIExportService;
  beforeEach(() => { service = new MIDIExportService(); });

  const layout = (pattern: string): string[] => {
    const events = (service as unknown as {
      parseNoteString(s: string, t: number): { note: number; time: number; duration: number }[];
    }).parseNoteString(pattern, 0);
    return events.map(e => `${e.note}@${e.time}/${e.duration}`);
  };

  it('reads a comma inside a bracket as parallel lanes, not as a chord', () => {
    // `c4 e4` is a sequence filling the bar against a held g4 — the
    // same layout as the unbracketed form, since the bracket spans the
    // whole bar. It used to collapse to three simultaneous whole notes.
    expect(layout('[c4 e4, g4]')).toEqual(['60@0/2', '64@2/2', '67@0/4']);
    expect(layout('[c4 e4, g4]')).toEqual(layout('c4 e4, g4'));
  });

  it('still treats a comma-only bracket as a chord', () => {
    // Three one-token lanes: all at the window start, all full width.
    // This is what import emits for simultaneous notes (#433).
    expect(layout('[c4,e4,g4]')).toEqual(['60@0/4', '64@0/4', '67@0/4']);
  });

  it('still subdivides a space-only bracket', () => {
    expect(layout('[c4 e4] g4')).toEqual(['60@0/1', '64@1/1', '67@2/2']);
  });

  it('keeps the inner structure of a nested bracket', () => {
    // The old code stripped every bracket in the token with
    // `replace(/[[\]]/g, '')`, erasing the nesting before anything read
    // it: all three landed together. c4/e4 share the first half of the
    // group's half-bar; g4 holds the second.
    expect(layout('[[c4 e4] g4] a4')).toEqual(['60@0/0.5', '64@0.5/0.5', '67@1/1', '69@2/2']);
  });

  it('reports a note name it cannot read instead of dropping it', () => {
    const result = service.exportToBase64('note("c4 zz g4")', { bpm: 120, bars: 1 });
    expect(result.noteCount).toBe(2);
    expect(result.unrepresented).toContain('zz');
    expect(result.warning).toMatch(/zz/);
  });

  it('does not report rests as lost', () => {
    const result = service.exportToBase64('note("c4 ~ g4")', { bpm: 120, bars: 1 });
    expect(result.noteCount).toBe(2);
    expect(result.unrepresented ?? []).toEqual([]);
    expect(result.warning).toBeUndefined();
  });
});
