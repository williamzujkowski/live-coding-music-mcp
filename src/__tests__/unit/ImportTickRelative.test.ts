/**
 * Note positions come from ticks, and the note count from the slots.
 *
 * Two defects, both #478.
 *
 * `@tonejs/midi` resolves `note.time` against the file's whole tempo
 * MAP, while the emitted pattern carries ONE `setcpm`. A tempo change
 * was therefore baked into the spacing of a pattern that declares a
 * constant tempo — and `discarded` said the later tempo "was dropped",
 * which was worse than dropping it: the music changed and the summary
 * denied it.
 *
 * The note count was recovered by re-parsing the rendered string, which
 * multi-bar bodies defeat: `<[c4 ... ~] [e4 ... ~]>` splits into tokens
 * including `~]` and `~]>`, neither equal to `~`. Single-bar patterns
 * have no such punctuation, which is why every existing test agreed
 * with it.
 */
import * as midiModule from '@tonejs/midi';

import { MIDIImportService } from '../../services/MIDIImportService';

const Midi = (midiModule as unknown as { Midi: new (b?: Buffer) => any }).Midi
  ?? (midiModule as unknown as { default: { Midi: new (b?: Buffer) => any } }).default.Midi;

/** Eight even quarter notes over two bars, with an optional tempo change. */
const evenQuarters = (opts: { tempoChangeAtBar?: number } = {}): Buffer => {
  const file = new Midi();
  file.header.setTempo(120);
  const ppq = file.header.ppq;
  if (opts.tempoChangeAtBar !== undefined) {
    file.header.tempos.push({ ticks: opts.tempoChangeAtBar * ppq * 4, bpm: 60, time: 0 });
  }
  const track = file.addTrack();
  for (let beat = 0; beat < 8; beat++) {
    track.addNote({ midi: 60 + beat, ticks: beat * ppq, durationTicks: ppq / 2 });
  }
  return Buffer.from(file.toArray());
};

describe('MIDI import is tick-relative', () => {
  let service: MIDIImportService;
  beforeEach(() => { service = new MIDIImportService(); });

  it('spaces notes the same with and without a mid-file tempo change', () => {
    const steady = service.convertBuffer(evenQuarters(), {});
    const changed = service.convertBuffer(evenQuarters({ tempoChangeAtBar: 1 }), {});

    // The source is eight evenly spaced quarter notes either way. The
    // tempo change used to stretch the second half to half speed and
    // spill into a third bar.
    expect(changed.pattern).toBe(steady.pattern);
    expect(changed.summary.bars).toBe(2);
  });

  it('still reports the dropped tempo change', () => {
    // The pattern now genuinely is at one tempo, so the existing
    // `discarded` wording is finally true.
    expect(service.convertBuffer(evenQuarters({ tempoChangeAtBar: 1 }), {}).summary.discarded)
      .toEqual([expect.stringMatching(/tempo change/)]);
  });

  it('lays every quarter note on its own beat', () => {
    const { pattern } = service.convertBuffer(evenQuarters(), {});
    expect(pattern).toContain(
      '<[c4 ~ ~ ~ c#4 ~ ~ ~ d4 ~ ~ ~ d#4 ~ ~ ~] [e4 ~ ~ ~ f4 ~ ~ ~ f#4 ~ ~ ~ g4 ~ ~ ~]>');
  });
});

describe('MIDI import note count', () => {
  let service: MIDIImportService;
  beforeEach(() => { service = new MIDIImportService(); });

  it('does not count a multi-bar pattern\'s punctuation as notes', () => {
    // Eight notes over two bars reported ten: `~]` and `~]>` are not
    // equal to `~`, so two rests counted.
    const summary = service.convertBuffer(evenQuarters(), {}).summary;
    expect(summary.notes).toBe(8);
    // Equal to what was parsed, so the discrepancy field stays absent.
    expect(summary.notesParsed).toBeUndefined();
  });

  it('counts every note in a chord', () => {
    const file = new Midi();
    file.header.setTempo(120);
    const track = file.addTrack();
    for (const midi of [60, 64, 67]) {
      track.addNote({ midi, ticks: 0, durationTicks: 240 });
    }
    const summary = service.convertBuffer(Buffer.from(file.toArray()), {}).summary;
    expect(summary.notes).toBe(3); // [c4,e4,g4] is three notes, not one
  });

  it('reports notes dropped by the bars cap', () => {
    const file = new Midi();
    file.header.setTempo(120);
    const track = file.addTrack();
    for (let bar = 0; bar < 4; bar++) {
      track.addNote({ midi: 60, ticks: bar * 1920, durationTicks: 240 });
    }
    const summary = service.convertBuffer(Buffer.from(file.toArray()), { bars: 2 }).summary;
    expect(summary.notes).toBe(2);
    expect(summary.notesParsed).toBe(4);
  });

  it('counts a drum lane', () => {
    const file = new Midi();
    file.header.setTempo(120);
    const track = file.addTrack();
    track.channel = 9;
    for (let i = 0; i < 4; i++) {
      track.addNote({ midi: 36, ticks: i * 480, durationTicks: 120 });
    }
    expect(service.convertBuffer(Buffer.from(file.toArray()), {}).summary.notes).toBe(4);
  });
});
