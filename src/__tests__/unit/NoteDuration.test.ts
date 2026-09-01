/**
 * Note duration survives import, and `@` weights survive export (#477).
 *
 * Import placed every note in exactly one grid step, so a whole-bar
 * note, a half note and a 60-tick staccato all produced the identical
 * pattern — and `discarded` was empty, so nothing said the length had
 * gone. A loss nobody is told about is indistinguishable from correct
 * output (#336).
 *
 * Export was independently wrong about `@`. It dropped the weight and
 * reported "a duration weight is dropped", but Strudel divides the
 * cycle by TOTAL weight, so dropping it moves every note after it.
 * Measured against @strudel/core:
 *
 *   mini('c4@4 e4')   ->  c4[0.000-0.800]  e4[0.800-1.000]
 *   export (before)   ->  c4@0/2           e4@2/2
 *
 * — the same layout as an unweighted `c4 e4`, so the onsets were wrong
 * too, not just the durations.
 */
import * as midiModule from '@tonejs/midi';

import { MIDIExportService } from '../../services/MIDIExportService';
import { MIDIImportService } from '../../services/MIDIImportService';

const Midi = (midiModule as unknown as { Midi: new (b?: Buffer) => any }).Midi
  ?? (midiModule as unknown as { default: { Midi: new (b?: Buffer) => any } }).default.Midi;

/** One note at the bar start, of the given tick length, plus a marker at beat 2. */
const withDuration = (durationTicks: number): Buffer => {
  const file = new Midi();
  file.header.setTempo(120);
  const track = file.addTrack();
  track.addNote({ midi: 60, ticks: 0, durationTicks });
  track.addNote({ midi: 67, ticks: 960, durationTicks: 120 });
  return Buffer.from(file.toArray());
};

const lane = (buffer: Buffer, opts = {}): string =>
  new MIDIImportService().convertBuffer(buffer, opts).pattern
    .split('\n').find(l => l.includes('note(')) ?? '';

describe('import carries note duration', () => {
  it('holds a long note across the steps it covers', () => {
    // Clipped at the next onset on this lane: one lane is one voice.
    expect(lane(withDuration(1920))).toContain('c4@8');
  });

  it('leaves a staccato note on a single step', () => {
    expect(lane(withDuration(60))).toContain('c4 ');
    expect(lane(withDuration(60))).not.toContain('c4@');
  });

  it('distinguishes lengths that used to be identical', () => {
    // A whole-bar note and a 60-tick stab produced the same pattern.
    expect(lane(withDuration(1920))).not.toBe(lane(withDuration(60)));
  });

  it('keeps each bar\'s weights summing to the step count', () => {
    const body = /"([^"]*)"/.exec(lane(withDuration(1920)))?.[1] ?? '';
    const total = body.split(' ').reduce((sum, token) => {
      const weighted = /@(\d+(?:\.\d+)?)$/.exec(token);
      return sum + (weighted ? Number(weighted[1]) : 1);
    }, 0);
    // Anything else changes the bar's own division.
    expect(total).toBe(16);
  });

  it('reports a note still sounding at the bar line', () => {
    const file = new Midi();
    file.header.setTempo(120);
    const track = file.addTrack();
    track.addNote({ midi: 60, ticks: 960, durationTicks: 1920 }); // crosses the bar
    track.addNote({ midi: 67, ticks: 3840, durationTicks: 240 });
    const summary = new MIDIImportService()
      .convertBuffer(Buffer.from(file.toArray()), {}).summary;
    // A bar is one token list and cannot lend weight to the next, so
    // the hold is cut there -- and said so rather than done quietly.
    expect(summary.discarded).toEqual(
      expect.arrayContaining([expect.stringMatching(/bar line/)]));
  });

  it('says nothing when no note crosses a bar line', () => {
    const summary = new MIDIImportService()
      .convertBuffer(withDuration(1920), {}).summary;
    expect(summary.discarded ?? []).not.toEqual(
      expect.arrayContaining([expect.stringMatching(/bar line/)]));
  });
});

describe('export honours @ weights', () => {
  const times = (pattern: string): string[] => {
    const events = (new MIDIExportService() as unknown as {
      parseNoteString(s: string, t: number): { note: number; time: number; duration: number }[];
    }).parseNoteString(pattern, 0);
    return events.map(e => `${e.note}@${e.time}/${e.duration}`);
  };

  it('divides the bar by total weight, as Strudel does', () => {
    // Strudel: c4[0.000-0.800] e4[0.800-1.000] over a 4-beat bar.
    expect(times('c4@4 e4')).toEqual(['60@0/3.2', '64@3.2/0.8']);
  });

  it('puts a 3:1 split three quarters in, not at the midpoint', () => {
    expect(times('c4@3 e4@1')).toEqual(['60@0/3', '64@3/1']);
  });

  it('leaves an unweighted sequence exactly as it was', () => {
    expect(times('c4 e4')).toEqual(['60@0/2', '64@2/2']);
  });

  it('no longer calls a weighted pattern lossy', () => {
    const result = new MIDIExportService().exportToBase64('note("c4@3 e4")');
    expect(result.success).toBe(true);
    expect(result.warning).toBeUndefined();
  });

  it('round-trips a held note without reporting loss', () => {
    const exported = new MIDIExportService()
      .exportToBase64('note("c4@2 d4@2 e4@2 f4@2 g4@2 a4@2 b4@2 c5@2")');
    expect(exported.success).toBe(true);
    expect(exported.noteCount).toBe(8);
    expect(exported.warning).toBeUndefined();
  });
});
