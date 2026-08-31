/**
 * Tempo units (#397), the follow-on to #395.
 *
 * #395 fixed three writers that disagreed about how many beats are in a
 * cycle. This covers the readers: two parsers of the same call, only one
 * of which had been taught the canonical `setcpm(130/4)` form, plus a
 * third copy living in a mock that the engine's own tests asserted
 * against.
 */

import {
  BEATS_PER_BAR,
  BARS_PER_CYCLE,
  BEATS_PER_CYCLE,
  declaredBpm,
  playedBpm,
} from '../../utils/Tempo';
import { extractBpm } from '../../services/StrudelEngineHelpers';
import { PatternGenerator } from '../../services/PatternGenerator';
import { DRUM_STYLES } from '../../services/StyleRegistry';

describe('the conversion factor', () => {
  it('is the meter times the convention, not a bare 4', () => {
    expect(BEATS_PER_BAR).toBe(4);
    expect(BARS_PER_CYCLE).toBe(1);
    expect(BEATS_PER_CYCLE).toBe(BEATS_PER_BAR * BARS_PER_CYCLE);
  });
});

describe('declaredBpm — the number the author wrote', () => {
  it.each([
    ['setcpm(130/4)', 130],
    ['setcpm(174/4)\ns("bd*4")', 174],
    ['setcps(174/60/4)', 174],
    ['setcps(90/60)', 90],
    ['setCpm(120/4)', 120], // case-insensitive since #341
    ['setcpm( 130 / 4 )', 130],
    ['setcpm(130)', 130], // no divisor to strip
  ])('%s -> %i', (code, want) => {
    expect(declaredBpm(code)).toBe(want);
  });

  it.each(['s("bd*4")', '', 'setcpm()', 'setcpm(abc)', 'setcpm(130/0)'])(
    'returns undefined for %p',
    code => {
      expect(declaredBpm(code)).toBeUndefined();
    },
  );

  it('never evaluates the text it is handed', () => {
    // The argument reaches this parser straight from a tool call. A
    // parser built on eval would run it.
    expect(declaredBpm('setcpm(globalThis.pwned = 1)')).toBeUndefined();
    expect((globalThis as Record<string, unknown>).pwned).toBeUndefined();
  });
});

describe('playedBpm — what the scheduler will actually do', () => {
  it.each([
    ['setcpm(130/4)', 130],
    ['setcps(174/60/4)', 174],
    // The three shapes #395 fixed, each still readable as what it was.
    ['setcpm(130)', 520],
    ['setcps(174/60)', 696],
    ['setcps(90/60/2)', 180],
  ])('%s plays at %i BPM', (code, want) => {
    expect(playedBpm(code)).toBeCloseTo(want, 6);
  });

  it('agrees with declaredBpm on every style the generator emits', () => {
    const generator = new PatternGenerator();
    for (const style of DRUM_STYLES) {
      const pattern = generator.generateCompletePattern(style, 'C', 174);
      expect(playedBpm(pattern)).toBeCloseTo(174, 6);
      expect(declaredBpm(pattern)).toBe(174);
    }
  });
});

describe('the readers that had their own regexes', () => {
  it('extractBpm reads the canonical form (it always did)', () => {
    expect(extractBpm('setcpm(130/4)')).toBe(130);
  });

  it('extractBpm and declaredBpm are the same function now', () => {
    // Two implementations of one parse is how #397 happened. If these
    // ever disagree, there are two again.
    for (const code of ['setcpm(130/4)', 'setcps(174/60/4)', 'setcpm(90)', 'no tempo']) {
      expect(extractBpm(code)).toBe(declaredBpm(code));
    }
  });
});

describe('MIDI import declares the tempo of the file it read (#397)', () => {
  // Building a real .mid here rather than mocking the parser: the bug
  // was in the arithmetic between the header tempo and the emitted call,
  // and a mock would have agreed with whatever the code did.
  const { Midi } = require('@tonejs/midi') as typeof import('@tonejs/midi');
  const { MIDIImportService } = require('../../services/MIDIImportService') as
    typeof import('../../services/MIDIImportService');

  function midiAt(bpm: number): Buffer {
    const midi = new Midi();
    midi.header.setTempo(bpm);
    midi.header.timeSignatures.push({ ticks: 0, timeSignature: [4, 4] });
    const track = midi.addTrack();
    track.channel = 0;
    // Four notes exactly one beat apart, so the emitted bar is one bar.
    const secondsPerBeat = 60 / bpm;
    for (let i = 0; i < BEATS_PER_BAR; i++) {
      track.addNote({ midi: 60 + i, time: i * secondsPerBeat, duration: 0.1, velocity: 0.8 });
    }
    return Buffer.from(midi.toArray());
  }

  it.each([90, 120, 140, 174])('a %i BPM file imports as %i BPM', bpm => {
    const { pattern, summary } = new MIDIImportService().convertBuffer(midiAt(bpm));
    expect(summary.bpm).toBe(bpm);
    // Not `toContain('setcpm(120/4)')` — that pins the spelling, and the
    // spelling is not what was wrong. This is what it will sound like.
    expect(playedBpm(pattern)).toBeCloseTo(bpm, 6);
  });

  it('puts one bar in one cycle, which is what the divisor assumes', () => {
    const { pattern, summary } = new MIDIImportService().convertBuffer(midiAt(120));
    expect(summary.bars).toBe(1);
    const lane = /note\("([^"]*)"\)/.exec(pattern);
    expect(lane).not.toBeNull();
    const steps = lane?.[1].trim().split(/\s+/) ?? [];
    expect(steps).toHaveLength(summary.steps_per_cycle);
    // Four notes across those steps, evenly spaced: one per beat.
    expect(steps.filter(s => s !== '~')).toHaveLength(BEATS_PER_BAR);
  });
});
