/**
 * The export report must describe the file (#433 items 5, 12, 13).
 *
 * Three ways it did not, all measured:
 *
 *   note("c4?")                            -> "No notes found in pattern.
 *                                             Use note(), n(), or chord()"
 *                                             — advice to use the function
 *                                             already used, while the real
 *                                             reason (`c4?` unrepresentable)
 *                                             was computed and discarded
 *   stack(note("c4"), s("bd unknown sd"))  -> success, 1 note, no report:
 *                                             a whole drum lane vanished
 *   note("c4")                             -> bars: 4, for one beat of content
 */

import { MIDIExportService } from '../../services/MIDIExportService';

describe('the export report describes the export (#433)', () => {
  const service = (): MIDIExportService => new MIDIExportService();

  it('names what failed instead of the generic advice', () => {
    const result = service().exportToBase64('note("c4?")');

    expect(result.success).toBe(false);
    expect(result.unrepresented).toContain('c4?');
    // The old message told the caller to use `note()`, which they did.
    expect(result.error).not.toMatch(/Use note\(\), n\(\), or chord\(\)/);
  });

  it.each(['hush()', 'silence', 'setcpm(120/4)'])(
    'still gives the generic advice for %s, which has nothing to report',
    pattern => {
      // No note-bearing syntax at all and nothing unrepresentable, so the
      // generic message is the right one and must not be replaced by an
      // empty loss list.
      //
      // My first example here was `s("bd").room(0.5)`, which exports
      // fine — `bd` is a known sample. Worth the note: "no notes" and
      // "no note() call" are not the same thing.
      const result = service().exportToBase64(pattern);

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/Use note\(\), n\(\), or chord\(\)/);
    });

  it('reports a drum lane it dropped', () => {
    // Dropping the whole lane on one unknown token is deliberate — a
    // partial drum lane is a different rhythm, not a quieter one — but
    // it happened in silence.
    const result = service().exportToBase64('stack(note("c4"), s("bd unknown sd"))');

    expect(result.success).toBe(true);
    expect(result.noteCount).toBe(1);
    expect(result.unrepresented).toContain('unknown');
  });

  it.each([
    ['note("c4")', 1],
    ['note("c4 e4 g4 c5")', 1],
    ['stack(note("c4"), s("bd*4"))', 1],
  ])('%s occupies %i bar', (pattern, expected) => {
    // `bars` reported the requested CAP, so one beat of content came
    // back as 4 and a caller sizing a timeline got four times the music.
    expect(service().exportToBase64(pattern).bars).toBe(expected);
  });

  it('never reports more bars than were asked for', () => {
    // Notes past the cap are not written, so they must not be counted.
    const result = service().exportToBase64('note("c4 e4 g4 c5")', { bars: 1 });

    expect(result.bars).toBeLessThanOrEqual(1);
  });
});
