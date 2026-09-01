/**
 * Three places where MIDI import did not match its own contract (#475),
 * all found by cross-model review.
 */
import * as midiModule from '@tonejs/midi';

import { MIDIImportService } from '../../services/MIDIImportService';
import { ValidationError } from '../../utils/CategorisedError';

const Midi = (midiModule as unknown as { Midi: new () => any }).Midi
  ?? (midiModule as unknown as { default: { Midi: new () => any } }).default.Midi;

/** A one-bar file holding a single note. */
const oneBar = (opts: { drum?: boolean } = {}): Buffer => {
  const file = new Midi();
  file.header.setTempo(120);
  const track = file.addTrack();
  if (opts.drum) track.channel = 9;
  track.addNote({ midi: opts.drum ? 36 : 60, time: 0, duration: 0.5 });
  return Buffer.from(file.toArray());
};

describe('MIDI import contract', () => {
  let service: MIDIImportService;
  beforeEach(() => { service = new MIDIImportService(); });

  describe('`bars` is a cap', () => {
    it('does not lengthen a file that is shorter than the cap', () => {
      // Documented as "Cap on bars to emit". It used to be taken
      // literally in both directions, so this emitted two bars — the
      // second entirely rests — and reported bars: 2. A cap that
      // lengthens its input is not a cap, and the extra bar is silence
      // the file does not contain.
      const result = service.convertBuffer(oneBar(), { bars: 2 });
      expect(result.summary.bars).toBe(1);
      expect(result.pattern).not.toMatch(/</); // no alternation across bars
    });

    it('still caps a file that is longer', () => {
      const file = new Midi();
      file.header.setTempo(120);
      const track = file.addTrack();
      for (let bar = 0; bar < 4; bar++) {
        track.addNote({ midi: 60, time: bar * 2, duration: 0.5 });
      }
      expect(service.convertBuffer(Buffer.from(file.toArray()), { bars: 2 })
        .summary.bars).toBe(2);
    });
  });

  describe('drum_map sample names are validated', () => {
    it('refuses a name that would break out of the pattern string', () => {
      // `{ 36: 'x"y' }` produced  s("x"y ~ ~ ~ ...")  — the quote closes
      // the string and the rest of the bar becomes syntax. Same class as
      // the scale-name injection: a value reaching generated code
      // without ever being checked as an identifier.
      expect(() => service.convertBuffer(oneBar({ drum: true }), { drum_map: { 36: 'x"y' } }))
        .toThrow(ValidationError);
    });

    it.each([['a space', 'bd sd'], ['a call', 'bd").gain(9'], ['empty', '']])(
      'refuses %s', (_label, name) => {
        expect(() => service.convertBuffer(oneBar({ drum: true }), { drum_map: { 36: name } }))
          .toThrow(ValidationError);
      });

    it('still accepts an ordinary name and a bank variant', () => {
      expect(service.convertBuffer(oneBar({ drum: true }), { drum_map: { 36: 'kick' } })
        .pattern).toContain('kick');
      expect(service.convertBuffer(oneBar({ drum: true }), { drum_map: { 36: 'bd:3' } })
        .pattern).toContain('bd:3');
    });
  });

  it('declares notesParsed on the summary type', () => {
    // Set at runtime by #463 and never declared, so no TypeScript
    // consumer could see it.
    //
    // The guard here is `tsc`, not this assertion: ts-jest does not
    // type-check, so this body passes with or without the declaration.
    // `npm run build` is what fails when the field is missing.
    const summary = service.convertBuffer(oneBar(), {}).summary;
    const parsed: number | undefined = summary.notesParsed;
    expect(parsed === undefined || typeof parsed === 'number').toBe(true);
  });
});
