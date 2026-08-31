/**
 * The import grid must use the tempo the notes were timed at (#433).
 *
 * `convertBuffer` rounded the header tempo and derived the whole grid
 * from the rounded value, while note times come from @tonejs/midi at the
 * file's TRUE tempo. The two disagreed by the rounding error and it
 * accumulated. Measured on a 100.4 BPM file with a note on beat 1 of
 * each of sixteen bars:
 *
 *   bar  0  first onset at step 0
 *   bar 13  first onset at step 15      <- a full step early
 *
 * The downbeat had walked backwards past the bar line, so bar 13's note
 * renders at the end of bar 12.
 */

import { Midi } from '@tonejs/midi';
import { MIDIImportService } from '../../services/MIDIImportService';

/** A file with one note on beat 1 of each of `bars` bars. */
function downbeats(bpm: number, bars: number): Buffer {
  const midi = new Midi();
  midi.header.setTempo(bpm);
  midi.header.timeSignatures.push({ ticks: 0, timeSignature: [4, 4] });
  const track = midi.addTrack();
  track.channel = 0;
  const secondsPerBeat = 60 / bpm;
  for (let bar = 0; bar < bars; bar++) {
    track.addNote({ midi: 60, time: bar * 4 * secondsPerBeat, duration: 0.1, velocity: 0.8 });
  }
  return Buffer.from(midi.toArray());
}

/** The step each rendered bar's first note lands on. */
function firstOnsetPerBar(pattern: string): number[] {
  const lane = /note\("([^"]+)"\)/.exec(pattern);
  return (lane?.[1] ?? '')
    .split(/\]\s*\[/)
    .map(bar => bar.replace(/[[\]]/g, '').trim().split(/\s+/).findIndex(t => t !== '~'));
}

describe('import does not drift against its own grid (#433)', () => {
  it.each([100.4, 174.3, 96.7])('a %p BPM file keeps every downbeat on step 0', bpm => {
    const { pattern } = new MIDIImportService().convertBuffer(downbeats(bpm, 16), { bars: 16 });

    // Every bar, not just the first — the error accumulates, so a
    // one-bar check would pass on the unfixed code.
    expect(firstOnsetPerBar(pattern)).toEqual(new Array(16).fill(0));
  });

  it('an integer tempo is unaffected', () => {
    const { pattern } = new MIDIImportService().convertBuffer(downbeats(120, 16), { bars: 16 });

    expect(firstOnsetPerBar(pattern)).toEqual(new Array(16).fill(0));
    expect(pattern).toContain('setcpm(120/4)');
  });

  it('writes a readable tempo, not float noise', () => {
    // A MIDI tempo is microseconds per quarter note, so the library
    // hands back 100.40009437608872 for a 100.4 BPM file.
    const { pattern } = new MIDIImportService().convertBuffer(downbeats(100.4, 4), { bars: 4 });

    expect(pattern).toContain('setcpm(100.4/4)');
  });

  it('the summary still reports a whole BPM for a human', () => {
    const { summary } = new MIDIImportService().convertBuffer(downbeats(100.4, 4), { bars: 4 });

    expect(summary.bpm).toBe(100);
  });
});
