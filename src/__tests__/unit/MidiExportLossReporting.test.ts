/**
 * export_midi says what it could not export (#335).
 *
 * `parseNoteString` reads bare note names separated by whitespace and
 * nothing else. Everything it cannot read was dropped in silence, so a
 * realistic five-lane generated pattern exported as
 * `success: true, noteCount: 2` — because `*`, `!`, `@` and `<>` are in
 * essentially every pattern the generator produces.
 *
 * This does not implement those operators. It stops pretending they
 * were exported.
 */

import { MIDIExportService } from '../../services/MIDIExportService';
import { execute } from '../../server/tools/capture';
import type { ToolContext } from '../../server/tools/types';

const service = () => new MIDIExportService();

/** The shape `compose` actually emits. */
const REALISTIC = [
  'stack(',
  '  s("bd*4"),',
  '  s("~ cp ~ cp"),',
  '  s("hh*8"),',
  '  note("c2*4"),',
  '  note("<c3 eb3 g3 bb3>")',
  ')',
].join('\n');

describe('a lossy export reports the loss (#335)', () => {
  it('names what it could not fully represent', () => {
    // Originally asserted `unrepresented` contained 'c2*4'. #335 then
    // implemented `*`, so c2*4 exports as four notes and is no longer a
    // loss at all. The alternation still is — one bar cannot hold four
    // options — so that is what the warning now names.
    const r = service().exportToBase64(REALISTIC);
    expect(r.warning).toBeDefined();
    expect(r.partiallyExported).toEqual(
      expect.arrayContaining([expect.stringContaining('<c3')]));
  });

  it('explains why, not just that', () => {
    const r = service().exportToBase64(REALISTIC);
    expect(r.warning).toMatch(/alternation|could not be exported/);
  });

  it.each(['note("c4*4")', 'note("c4!2 e4")'])(
    '%s now exports rather than being dropped', pattern => {
      // These were the "reported rather than silently dropped" cases.
      // #335 implemented the operators, so the right assertion is that
      // the notes are there and nothing is claimed lost.
      const r = service().exportToBase64(pattern);
      expect(r.success).toBe(true);
      expect(r.noteCount).toBeGreaterThan(1);
      expect(r.warning).toBeUndefined();
    });

  it.each(['note("c4@3 e4")', 'note("<c4 e4>")'])(
    '%s exports with the loss declared', pattern => {
      // These cannot be fully represented in one bar, so they export
      // what they can and say what they could not.
      const r = service().exportToBase64(pattern);
      expect(r.success).toBe(true);
      expect(r.warning).toBeDefined();
    });

  it('says nothing when nothing was lost', () => {
    const r = service().exportToBase64('note("c4 e4 g4")');
    expect(r.success).toBe(true);
    expect(r.noteCount).toBe(3);
    expect(r.warning).toBeUndefined();
    expect(r.unrepresented).toBeUndefined();
  });

  it('does not carry a warning over from a previous export', () => {
    // The set is instance state; a stale warning on a clean pattern
    // would be its own kind of lie.
    const svc = service();
    svc.exportToBase64(REALISTIC);
    const clean = svc.exportToBase64('note("c4 e4 g4")');
    expect(clean.warning).toBeUndefined();
  });
});

describe('the warning reaches the MCP caller (#335)', () => {
  function ctxWith(pattern: string): ToolContext {
    return {
      midiExportService: new MIDIExportService(),
      logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
      isInitialized: () => true,
      getCurrentPatternSafe: async () => pattern,
    } as unknown as ToolContext;
  }

  it('the tool response carries it, not just the service result', async () => {
    // The handler builds its own response object and used to drop the
    // warning, which would have made the service-side fix inert.
    const r = await execute('export_midi', { format: 'base64' }, ctxWith(REALISTIC)) as {
      success: boolean; message: string; partiallyExported?: string[];
    };
    expect(r.success).toBe(true);
    expect(r.message).toContain('exported with loss');
    expect(r.partiallyExported).toEqual(
      expect.arrayContaining([expect.stringContaining('<c3')]));
  });

  it('a clean export still reads cleanly', async () => {
    const r = await execute(
      'export_midi', { format: 'base64' }, ctxWith('note("c4 e4 g4")')) as {
      message: string; warning?: string;
    };
    expect(r.message).toBe('Exported 3 notes as base64 MIDI data');
    expect(r.warning).toBeUndefined();
  });
});
