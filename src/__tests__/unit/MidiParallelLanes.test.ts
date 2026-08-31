/**
 * A comma stacks lanes; it does not sequence them (#432).
 *
 * `tokenize` treated a depth-0 comma as an ordinary separator, so the
 * lanes were concatenated and redistributed across the bar. Measured
 * before the fix:
 *
 *     s("bd*4")        -> beats [0, 1, 2, 3]                 correct
 *     s("hh*8")        -> beats [0, .5, 1, ... 3.5]          correct
 *     s("bd*4, hh*8")  -> beats [0, .33, .67, 1, ... 3.67]   WRONG
 *
 * The note COUNT was right — twelve either way — which is why nothing
 * caught it, and why every assertion here is on TIMES.
 *
 * `PatternGenerator` emits `s("bd*4, ~ cp ~ cp, hh*8")` as its standard
 * drum line, so every generated drum pattern exported at the wrong
 * rhythm and reported success.
 */

import { MIDIExportService } from '../../services/MIDIExportService';
import { PatternGenerator } from '../../services/PatternGenerator';

const times = (events: Array<{ time: number }>): number[] =>
  events.map(e => Number(e.time.toFixed(4))).sort((a, b) => a - b);

describe('parallel lanes keep their own timing (#432)', () => {
  const service = (): MIDIExportService => new MIDIExportService();

  it('a stacked pattern is the union of its lanes played separately', () => {
    // The strongest form of the claim: two lanes together must produce
    // exactly what each produces alone, not a redistribution.
    const kicks = times(service().parsePatternNotes('s("bd*4")'));
    const hats = times(service().parsePatternNotes('s("hh*8")'));
    const both = times(service().parsePatternNotes('s("bd*4, hh*8")'));

    expect(kicks).toEqual([0, 1, 2, 3]);
    expect(hats).toEqual([0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5]);
    expect(both).toEqual([...kicks, ...hats].sort((a, b) => a - b));
  });

  it('the generator’s own drum line exports the rhythm it describes', () => {
    const pattern = new PatternGenerator().generateCompletePattern('techno', 'C', 130);
    const drumLine = /s\("([^"]+)"\)/.exec(pattern);
    expect(drumLine).not.toBeNull();

    const events = service().parsePatternNotes(drumLine?.[0] ?? '');
    // Kick on every beat.
    const kickTimes = events
      .filter(e => e.note === 36)
      .map(e => Number(e.time.toFixed(4)))
      .sort((a, b) => a - b);
    expect(kickTimes).toEqual([0, 1, 2, 3]);
    // Clap on the backbeat, not scattered across thirds.
    const clapTimes = events
      .filter(e => e.note === 39)
      .map(e => Number(e.time.toFixed(4)))
      .sort((a, b) => a - b);
    expect(clapTimes).toEqual([1, 3]);
  });

  it('note() stacks too: g4 sounds with c4, not two thirds in', () => {
    const events = service().parsePatternNotes('note("c4 e4, g4")');
    const g4 = events.find(e => e.note === 67);

    expect(g4?.time).toBe(0);
  });

  it('a comma inside brackets is a chord, not a lane', () => {
    // Splitting those would be the same bug in the other direction.
    const events = service().parsePatternNotes('note("[c4,e4,g4] a4")');
    const chord = events.filter(e => e.time === 0).map(e => e.note).sort((a, b) => a - b);

    expect(chord).toEqual([60, 64, 67]);
  });

  it('a single lane is unchanged', () => {
    // The layout for patterns without commas must not move.
    expect(times(service().parsePatternNotes('s("bd sd bd sd")'))).toEqual([0, 1, 2, 3]);
    expect(times(service().parsePatternNotes('note("c4 e4 g4 c5")'))).toEqual([0, 1, 2, 3]);
  });

  describe('splitLanes', () => {
    it.each([
      ['bd*4, hh*8', ['bd*4', 'hh*8']],
      ['[c4,e4] g4', ['[c4,e4] g4']],
      ['<c4 e4>, g4', ['<c4 e4>', 'g4']],
      ['a, , b', ['a', 'b']],
      ['solo', ['solo']],
    ])('%s', (source, expected) => {
      expect(MIDIExportService.splitLanes(source)).toEqual(expected);
    });
  });
});
