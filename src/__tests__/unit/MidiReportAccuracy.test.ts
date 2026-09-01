/**
 * Two reports that described something other than the output (#433).
 *
 * Import counted every note PARSED, including those it then dropped —
 * measured, a file of ten notes on an unmapped percussion pitch:
 *
 *   {"lanes":0,"notes":10,"unmapped_drums":[99]}   beside the pattern `silence`
 *
 * Export truncated a repeat at 64 and said nothing:
 *
 *   note("c4*128") -> noteCount 64, unrepresented undefined,
 *                     partiallyExported undefined
 *
 * — and because layout divides the bar by token count, halving the
 * repeats also changed the rhythm of everything beside it.
 */

import { Midi } from '@tonejs/midi';
import { MIDIImportService } from '../../services/MIDIImportService';
import { MIDIExportService } from '../../services/MIDIExportService';

function file(pitch: number, channel: number, count: number): Buffer {
  const midi = new Midi();
  midi.header.setTempo(120);
  midi.header.timeSignatures.push({ ticks: 0, timeSignature: [4, 4] });
  const track = midi.addTrack();
  track.channel = channel;
  for (let i = 0; i < count; i++) {
    track.addNote({ midi: pitch, time: i * 0.25, duration: 0.1, velocity: 0.8 });
  }
  return Buffer.from(midi.toArray());
}

describe('the import summary describes the pattern (#433)', () => {
  it('does not count notes it dropped', () => {
    // 99 is not in the GM drum map, so nothing is rendered.
    const { pattern, summary } = new MIDIImportService().convertBuffer(file(99, 9, 10));

    expect(pattern).toContain('silence');
    expect(summary.notes).toBe(0);
    // The parsed count still travels, because "the file was empty" and
    // "the file was dropped" are different answers.
    expect((summary as { notesParsed?: number }).notesParsed).toBe(10);
    expect(summary.unmapped_drums).toEqual([99]);
  });

  it('counts an ordinary import exactly', () => {
    const { summary } = new MIDIImportService().convertBuffer(file(60, 0, 4));

    expect(summary.notes).toBe(4);
    // No divergence, so no second number to explain away.
    expect((summary as { notesParsed?: number }).notesParsed).toBeUndefined();
  });
});

describe('export reports a repeat it truncated (#433)', () => {
  it('records the loss for c4*128', () => {
    const result = new MIDIExportService().exportToBase64('note("c4*128")');

    expect(result.noteCount).toBe(64);
    expect(result.partiallyExported).toContain('c4*128');
  });

  it('says nothing for a repeat within the cap', () => {
    // The warning must stay worth reading.
    const result = new MIDIExportService().exportToBase64('note("c4*4")');

    expect(result.noteCount).toBe(4);
    expect(result.partiallyExported).toBeUndefined();
  });
});
