/**
 * Mini-notation repetition and alternation now export (#335).
 *
 * `*`, `!`, `@` and `<>` appear in essentially every pattern the
 * generator produces, and every one used to be dropped. #338 made the
 * loss visible; this makes most of it stop happening.
 */

import { MIDIExportService } from '../../services/MIDIExportService';

const service = () => new MIDIExportService();
const noop = () => undefined;
const expand = (token: string) => MIDIExportService.expandOperators([token], noop);

describe('operator expansion (#335)', () => {
  it.each([
    ['c4*4', ['c4', 'c4', 'c4', 'c4']],
    ['c4*1', ['c4']],
    ['c4!2', ['c4', 'c4']],
    // The weight is PRESERVED and applied by the layout. Dropping it
    // did not merely lose the duration, it moved every note after it:
    // `c4@3 e4` laid out as equal halves, so e4 sounded at the bar's
    // midpoint instead of three quarters in (#477).
    ['c4@3', ['c4@3']],
    ['<c4 e4 g4>', ['c4']],     // first option of the alternation
    ['c4', ['c4']],             // untouched
    ['[c4 e4]', ['[c4 e4]']],   // brackets pass through to the chord branch
  ])('%s expands to %p', (token, expected) => {
    expect(expand(token)).toEqual(expected);
  });

  it('caps runaway repetition', () => {
    // A caller-supplied multiplier must not allocate without bound.
    expect(expand('c4*100000').length).toBeLessThanOrEqual(64);
  });

  it('handles a zero or negative count without producing junk', () => {
    expect(expand('c4*0')).toEqual([]);
  });
});

describe('the tokenizer groups angle brackets (#335)', () => {
  it('keeps an alternation whole', () => {
    // Tracking only `[` meant `<c4 e4>` split on the space into
    // ["<c4", "e4>"] — neither a note nor a recognisable alternation,
    // so the token was reported unrepresentable even after expansion
    // existed.
    expect(MIDIExportService.tokenize('<c4 e4> g4')).toEqual(['<c4 e4>', 'g4']);
  });

  it('still groups square brackets', () => {
    expect(MIDIExportService.tokenize('[c4 e4] g4')).toEqual(['[c4 e4]', 'g4']);
  });
});

describe('export counts (#335)', () => {
  it.each([
    ['note("c4*4")', 4],
    ['note("c4!2 e4")', 3],
    ['note("c4@3 e4")', 2],
    ['note("<c4 e4>")', 1],
    ['note("c2*4")', 4],
  ])('%s exports %i notes', (pattern, expected) => {
    expect(service().exportToBase64(pattern).noteCount).toBe(expected);
  });

  it('a realistic generated pattern is no longer nearly empty', () => {
    // Was success:true, noteCount:2 for five lanes. Operators took it
    // to 5, drum export to 11, and stack layering to 19 — the three
    // drum lanes no longer fall outside the 4-bar window (#335).
    const realistic = [
      'stack(', '  s("bd*4"),', '  s("~ cp ~ cp"),', '  s("hh*8"),',
      '  note("c2*4"),', '  note("<c3 eb3 g3 bb3>")', ')',
    ].join('\n');
    expect(service().exportToBase64(realistic).noteCount).toBe(19);
  });
});

describe('loss reporting distinguishes skipped from lossy (#335)', () => {
  it('an alternation is reported as lossy, not skipped', () => {
    // "we kept the first of four" and "we skipped it" are different
    // things to tell a caller, and the message used to say the
    // operators were "not implemented" after they were.
    const r = service().exportToBase64('note("<c4 e4 g4 b4>")');
    expect(r.partiallyExported).toContain('<c4 e4 g4 b4>');
    expect(r.unrepresented).toBeUndefined();
    expect(r.warning).toContain('exported with loss');
    expect(r.warning).not.toContain('not implemented');
  });

  it('a single-option alternation is not reported at all', () => {
    // Nothing was lost, so nothing should be claimed.
    expect(service().exportToBase64('note("<c4>")').warning).toBeUndefined();
  });

  it('a clean pattern still reports nothing', () => {
    const r = service().exportToBase64('note("c4 e4 g4")');
    expect(r.warning).toBeUndefined();
    expect(r.partiallyExported).toBeUndefined();
  });

  it('repetition is not reported as a loss, because it is not one', () => {
    expect(service().exportToBase64('note("c4*4")').warning).toBeUndefined();
  });
});
