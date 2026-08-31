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
  impliedBpm,
} from '../../utils/Tempo';
import { extractBpm } from '../../services/StrudelEngineHelpers';
import { PatternGenerator } from '../../services/PatternGenerator';
import { DRUM_STYLES } from '../../services/StyleRegistry';

describe('the conversion factor', () => {
  it('is four beats, from a 4/4 bar and one bar to a cycle', () => {
    // The product is how BEATS_PER_CYCLE is defined, so asserting it
    // would be checking the language. These are the two claims that
    // could actually be wrong.
    expect(BEATS_PER_BAR).toBe(4);
    expect(BARS_PER_CYCLE).toBe(1);
    expect(BEATS_PER_CYCLE).toBe(4);
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

describe('impliedBpm — what the scheduler will actually do', () => {
  it.each([
    ['setcpm(130/4)', 130],
    ['setcps(174/60/4)', 174],
    // The three shapes #395 fixed, each still readable as what it was.
    ['setcpm(130)', 520],
    ['setcps(174/60)', 696],
    ['setcps(90/60/2)', 180],
  ])('%s plays at %i BPM', (code, want) => {
    expect(impliedBpm(code)).toBeCloseTo(want, 6);
  });

  it('agrees with declaredBpm on every style the generator emits', () => {
    const generator = new PatternGenerator();
    for (const style of DRUM_STYLES) {
      const pattern = generator.generateCompletePattern(style, 'C', 174);
      expect(impliedBpm(pattern)).toBeCloseTo(174, 6);
      expect(declaredBpm(pattern)).toBe(174);
    }
  });
});

describe('the parser reads the right call, in the right unit', () => {
  // Every case here came out of cross-model review of the parser this
  // file introduced. None were caught by the tests written alongside it.

  it('does not read a commented-out tempo', () => {
    // "tempo taken from the wrong place" is the whole subject of #395
    // and #397. A parser that takes the first textual match repeats it.
    const code = '// was setcpm(120/4), too slow\nsetcpm(174/4)\ns("bd*4")';
    expect(declaredBpm(code)).toBe(174);
    expect(declaredBpm('/* setcpm(90/4) */\nsetcpm(130/4)')).toBe(130);
  });

  it('reports no tempo when the only call is commented out', () => {
    expect(declaredBpm('// setcpm(120/4)\ns("bd*4")')).toBeUndefined();
  });

  it('does not match an identifier that merely ends in a tempo call', () => {
    expect(declaredBpm('resetcpm(120)')).toBeUndefined();
    expect(declaredBpm('x.setcps(2)')).toBeUndefined();
  });

  it('does not read setbpm, which Strudel does not bind', () => {
    // The old `ai.ts` parser accepted it and a reviewer called dropping
    // it a regression. But `@strudel/core` binds setcps/setcpm and
    // nothing else — `setbpm` is a keyword token in `@strudel/mini`'s
    // grammar, not a function — so a pattern calling it does not run,
    // and reading a tempo out of it would be inventing one.
    // `StrudelEngineHelpers` excluded it on purpose; this agrees.
    expect(declaredBpm('setbpm(174)')).toBeUndefined();
  });

  it('reads a bare setcps in its own unit, not as a BPM', () => {
    // `setcps(2)` is two cycles a second. Returning 2 as a tempo — which
    // the numerator convention would do — is nonsense.
    expect(declaredBpm('setcps(2)')).toBe(480);
    expect(declaredBpm('setcps(0.5)')).toBe(120);
    // A bare setcpm keeps the #341 convention, and the asymmetry is a
    // choice rather than an oversight: this is what the two answers are.
    expect(declaredBpm('setcpm(130)')).toBe(130);
    expect(impliedBpm('setcpm(130)')).toBe(520);
  });

  it('rejects a zero rather than passing it downstream', () => {
    expect(declaredBpm('setcpm(130/0)')).toBeUndefined();
    expect(declaredBpm('setcpm(0)')).toBeUndefined();
  });
});

describe('impliedBpm reads the tempo call and nothing else', () => {
  it('does not account for .slow(), which the shipped corpus relies on', () => {
    // `patterns/examples/dnb/dnb-classic.json` is `setcpm(174/2)` over a
    // one-bar stack with `.slow(2)`, and plays at 174. Asserted so the
    // docblock's limitation is a fact and not a hope — anyone reaching
    // for this on a hand-written pattern needs to see it.
    const corpus = 'setcpm(174/2)\nstack("[bd ~ ~ bd]").s().slow(2)';
    expect(impliedBpm(corpus)).toBeCloseTo(348, 6);
    expect(declaredBpm(corpus)).toBe(174); // the answer a caller wants
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
    expect(impliedBpm(pattern)).toBeCloseTo(bpm, 6);
  });

  it('puts one bar in one cycle, which is what the divisor assumes', () => {
    const { pattern, summary } = new MIDIImportService().convertBuffer(midiAt(120));
    expect(summary.bars).toBe(1);
    const lane = /note\("([^"]*)"\)/.exec(pattern);
    expect(lane).not.toBeNull();
    const steps = lane?.[1].trim().split(/\s+/) ?? [];
    expect(steps).toHaveLength(summary.steps_per_cycle);
    // Where they land, not just how many there are — four notes bunched
    // into the first half of the bar would pass a count and would mean
    // the grid was wrong.
    const onsets = steps.flatMap((step, i) => (step === '~' ? [] : [i]));
    const perBeat = summary.steps_per_cycle / BEATS_PER_BAR;
    expect(onsets).toEqual([0, perBeat, perBeat * 2, perBeat * 3]);
  });
});

describe('export_midi carries the pattern tempo through (#399)', () => {
  const { MIDIExportService } = require('../../services/MIDIExportService') as
    typeof import('../../services/MIDIExportService');
  const { MIDIImportService } = require('../../services/MIDIImportService') as
    typeof import('../../services/MIDIImportService');
  const { execute } = require('../../server/tools/capture') as
    typeof import('../../server/tools/capture');

  function ctxWith(pattern: string) {
    return {
      midiExportService: new MIDIExportService(),
      logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
      isInitialized: () => true,
      getCurrentPatternSafe: async () => pattern,
    } as unknown as import('../../server/tools/types').ToolContext;
  }

  it('the handler defaults to the tempo the pattern declares', async () => {
    // The default was a flat 120. Driven through the handler, because
    // the default lives there and a service-level test would pass it a
    // bpm and never exercise the line that was wrong.
    const r = (await execute(
      'export_midi', { format: 'base64' }, ctxWith('setcpm(174/4)\ns("bd*4")'),
    )) as { success: boolean; bpm: number };
    expect(r.success).toBe(true);
    expect(r.bpm).toBe(174);
  });

  it('an explicit bpm still wins', async () => {
    const r = (await execute(
      'export_midi', { format: 'base64', bpm: 90 }, ctxWith('setcpm(174/4)\ns("bd*4")'),
    )) as { success: boolean; bpm: number };
    expect(r.bpm).toBe(90);
  });

  it('falls back to 120 when the pattern declares no tempo', async () => {
    const r = (await execute(
      'export_midi', { format: 'base64' }, ctxWith('s("bd*4")'),
    )) as { success: boolean; bpm: number };
    expect(r.bpm).toBe(120);
  });

  it('survives an export/import round trip', () => {
    // `export_midi` defaulted to a flat 120, so this round trip used to
    // return 120 whatever went in. Asserted end to end because the bug
    // was between two services that each looked right alone.
    const pattern = 'setcpm(174/4)\nstack(\n  s("bd*4")\n)';
    const bpm = declaredBpm(pattern);
    expect(bpm).toBe(174);

    const exported = new MIDIExportService().exportToBase64(pattern, { bpm, bars: 4 });
    expect(exported.success).toBe(true);
    const back = new MIDIImportService().convertBuffer(Buffer.from(exported.output!, 'base64'));
    expect(back.summary.bpm).toBe(174);
    expect(impliedBpm(back.pattern)).toBeCloseTo(174, 6);
  });
});
