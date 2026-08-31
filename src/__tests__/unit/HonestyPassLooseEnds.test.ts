/**
 * Four small defects left by the honesty pass (#297).
 *
 * Each was found by an external-model review of the #279/#280/#285/#287
 * commits and reproduced before being fixed.
 */

import {
  categorizeError, withStashField, withStashNotice,
  PATTERN_STASHED_PREFIX, STASH_WARNING,
} from '../../server/tools/types';
import { MIDIImportService } from '../../services/MIDIImportService';

const STASHED = `${PATTERN_STASHED_PREFIX} s("bd*4")...`;

describe('the MIDI message does not contradict the parser it quotes (#297)', () => {
  const svc = new MIDIImportService();

  function messageFor(input: string): string {
    try {
      svc.convertBuffer(Buffer.from(input, 'binary'));
    } catch (e) {
      return (e as Error).message;
    }
    throw new Error('expected a parse failure');
  }

  it('no longer names a chunk the quoted parser disagrees about', () => {
    const msg = messageFor('not a midi file');
    // @tonejs/midi says "Expected 'MHdr'"; the real bytes are 'MThd'.
    // Naming one while quoting the other read as a contradiction.
    expect(msg).not.toContain('MThd');
    expect(msg).toContain('Invalid MIDI file');
  });

  it('still tells the caller what to do', () => {
    expect(messageFor('junk')).toContain('another MIDI tool');
  });

  it('still keeps the underlying detail for debugging', () => {
    expect(messageFor('junk')).toContain('MHdr');
  });
});

describe('categorizeError does not depend on one adjective (#297)', () => {
  // #280's two halves were coupled by vocabulary alone: the MIDI parse
  // message reached `validation` only because it contains 'Invalid'.
  it.each([
    'MIDI could not be parsed',
    'Failed to parse MIDI buffer: unexpected end of input',
    'parse error at byte 12',
    'malformed header chunk',
    'corrupt track data',
  ])('%s is validation, not internal', message => {
    expect(categorizeError(new Error(message))).toBe('validation');
  });

  it('a genuine internal fault is still internal', () => {
    expect(categorizeError(new Error('Cannot read properties of undefined')))
      .toBe('internal');
  });

  it('the current MIDI message would survive losing the word "Invalid"', () => {
    const withoutAdjective =
      'MIDI file could not be parsed. It may be truncated, or not a MIDI file at all.';
    expect(categorizeError(new Error(withoutAdjective))).toBe('validation');
  });
});

describe('withStashField keeps its promise (#297)', () => {
  it('appends to an existing warning instead of eating it', () => {
    const r = withStashField({ success: true, warning: 'gain clamped to 2.0' }, STASHED);
    expect(r.warning).toContain('gain clamped to 2.0');
    expect(r.warning).toContain('not in the editor yet');
  });

  it('uses the stash warning alone when there is nothing to keep', () => {
    expect(withStashField({ success: true }, STASHED).warning).toBe(STASH_WARNING);
  });

  it('ignores an empty existing warning rather than prefixing a space', () => {
    expect(withStashField({ success: true, warning: '' }, STASHED).warning)
      .toBe(STASH_WARNING);
  });

  it('refuses an array rather than silently reshaping it', () => {
    // Spreading ['a','b'] produced {"0":"a","1":"b"} — a shape change
    // the `T & { warning?: string }` signature promised not to make.
    expect(() => withStashField(['a', 'b'] as unknown as Record<string, unknown>, STASHED))
      .toThrow(/not an array/);
  });

  it('leaves a non-stashed result completely alone', () => {
    const input = { success: true, warning: 'gain clamped' };
    expect(withStashField(input, 'written')).toBe(input);
  });

  it('does not mutate its input', () => {
    const input = { success: true, warning: 'keep me' };
    withStashField(input, STASHED);
    expect(input.warning).toBe('keep me');
  });
});

describe('withStashNotice punctuation (#297)', () => {
  it('does not produce ". —"', () => {
    const r = withStashNotice('Styles with their own drums: techno, boom_bap.', STASHED);
    expect(r).not.toContain('. —');
    expect(r).toContain('boom_bap —');
  });

  it('handles a message with no trailing period', () => {
    expect(withStashNotice('Generated techno drums', STASHED))
      .toContain('Generated techno drums —');
  });

  it('handles trailing whitespace after the period', () => {
    expect(withStashNotice('Done.  ', STASHED)).toContain('Done —');
  });

  it('leaves an internal period alone', () => {
    expect(withStashNotice('Set tempo to 1.5 BPM', STASHED))
      .toContain('Set tempo to 1.5 BPM —');
  });
});
