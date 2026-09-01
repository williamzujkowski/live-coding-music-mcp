/**
 * Euclidean rhythms survive MIDI export.
 *
 * `splitLanes` and `tokenize` tracked `[` and `<` but not `(`, so the
 * comma in `bd(3,8)` read as a lane separator. `s("bd(3,8)")` — one of
 * the most common idioms in Strudel, and one `generate_rhythm` emits —
 * split into `bd(3` and `8)`, neither a sample name, and exported ZERO
 * notes (#464).
 */
import { MIDIExportService } from '../../services/MIDIExportService';

describe('Euclidean rhythms in MIDI export', () => {
  let service: MIDIExportService;
  beforeEach(() => { service = new MIDIExportService(); });

  const noteTimes = (pattern: string): number[] => {
    const events = (service as unknown as {
      parseDrumString(s: string, t: number): { time: number }[];
    }).parseDrumString(pattern, 0);
    return events.map(e => e.time);
  };

  it('groups the euclid arguments instead of splitting on their comma', () => {
    expect(MIDIExportService.splitLanes('bd(3,8)')).toEqual(['bd(3,8)']);
    expect(MIDIExportService.tokenize('bd(3,8) sd')).toEqual(['bd(3,8)', 'sd']);
  });

  it('still splits a genuine lane comma outside the parentheses', () => {
    expect(MIDIExportService.splitLanes('bd(3,8), hh*4')).toEqual(['bd(3,8)', 'hh*4']);
  });

  it('exports E(3,8) as the tresillo, not as nothing', () => {
    // Steps 0, 3 and 6 of 8 across a four-beat bar. This is the
    // placement MusicTheory documents for E(3,8) (#319); exporting a
    // rotation of it would be exporting a different rhythm.
    expect(noteTimes('bd(3,8)')).toEqual([0, 1.5, 3]);
  });

  it('honours the rotation argument', () => {
    expect(noteTimes('bd(3,8,2)')).toEqual([0.5, 2, 3]);
  });

  it('lays parallel lanes over the same bar', () => {
    const result = service.exportToBase64('s("bd(3,8), hh*4")', { bpm: 120, bars: 1 });
    expect(result.success).toBe(true);
    expect(result.noteCount).toBe(7); // 3 kicks + 4 hats
  });

  it('refuses a euclid it cannot lay out, and says so', () => {
    // More hits than steps is not a rhythm, and a step count past the
    // repetition ceiling would rewrite the bar for everything beside it.
    const result = service.exportToBase64('s("bd(9,8)")', { bpm: 120, bars: 1 });
    expect(result.noteCount).toBe(0);
    expect(result.warning).toMatch(/bd\(9,8\)/);
  });

  it('works on the note path too', () => {
    const result = service.exportToBase64('note("c4(3,8)")', { bpm: 120, bars: 1 });
    expect(result.success).toBe(true);
    expect(result.noteCount).toBe(3);
  });
});
