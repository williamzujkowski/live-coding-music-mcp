/**
 * Drum lanes subdivide brackets, like note lanes do (#433 item 7).
 *
 * The drum path had no bracket branch at all, so `s("[bd sd] hh")` — an
 * ordinary subdivided step — produced ZERO notes: `[bd sd]` is not a
 * sample name, so the all-or-nothing unknown-token rule dropped the
 * whole lane. The note path got recursive layout in #469; this is the
 * same treatment one file over.
 */
import { MIDIExportService } from '../../services/MIDIExportService';

describe('Drum bracket layout', () => {
  let service: MIDIExportService;
  beforeEach(() => { service = new MIDIExportService(); });

  const layout = (pattern: string): string[] => {
    const events = (service as unknown as {
      parseDrumString(s: string, t: number): { note: number; time: number; duration: number }[];
    }).parseDrumString(pattern, 0);
    return events.map(e => `${e.note}@${e.time}/${e.duration}`);
  };

  it('subdivides a bracket group instead of dropping the lane', () => {
    // 36=bd, 38=sd, 42=hh. The group takes the first half-bar and
    // splits it; hh holds the second.
    expect(layout('[bd sd] hh')).toEqual(['36@0/1', '38@1/1', '42@2/2']);
  });

  it('lays it out exactly as the note lane lays out the same shape', () => {
    const notes = (service as unknown as {
      parseNoteString(s: string, t: number): { time: number; duration: number }[];
    }).parseNoteString('[c4 d4] e4', 0).map(e => `${e.time}/${e.duration}`);
    const drums = layout('[bd sd] hh').map(e => e.split('@')[1]);
    expect(drums).toEqual(notes);
  });

  it('treats a comma inside a bracket as parallel lanes', () => {
    // Both sound at the window start and hold it, which is what
    // simultaneous percussion is.
    expect(layout('[bd,hh]')).toEqual(['36@0/4', '42@0/4']);
  });

  it('handles nesting', () => {
    expect(layout('[[bd sd] hh] cp')).toEqual(['36@0/0.5', '38@0.5/0.5', '42@1/1', '39@2/2']);
  });

  it('honours a weight, as Strudel divides a cycle', () => {
    expect(layout('bd@3 sd')).toEqual(['36@0/3', '38@3/1']);
  });

  it('still drops the whole lane when a leaf is unknown, and says so', () => {
    // Deliberate: a partial drum lane is a different rhythm, not a
    // quieter one. The bracket must not hide the unknown token.
    const result = service.exportToBase64('s("[bd wobble] hh")', { bpm: 120, bars: 1 });
    expect(result.noteCount).toBe(0);
    expect(result.warning).toMatch(/wobble/);
  });

  it('leaves an ordinary lane exactly as it was', () => {
    expect(layout('bd sd')).toEqual(['36@0/2', '38@2/2']);
    expect(layout('bd ~ sd ~')).toEqual(['36@0/1', '38@2/1']);
  });

  it('still lays parallel lanes over the same bar', () => {
    expect(layout('bd*2, hh')).toEqual(['36@0/2', '36@2/2', '42@0/4']);
  });
});
