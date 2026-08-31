/**
 * Import reports the losses it used to keep quiet about (#336).
 *
 * The file header lists quantized timing, dropped velocity and
 * collapsed voices as known Phase 1 losses. These two were neither
 * listed nor reported: a 3/4 file was laid onto a 4/4 grid, and a file
 * with a 120->200 tempo change imported as 120 with no warning.
 *
 * A loss nobody is told about is indistinguishable from correct output.
 */

import { MIDIExportService } from '../../services/MIDIExportService';
import { MIDIImportService } from '../../services/MIDIImportService';

const exporter = () => new MIDIExportService();
const importer = () => new MIDIImportService();

/** A MIDI buffer with the given header properties. */
function buildMidi(options: {
  bpm?: number; numerator?: number; denominator?: number; extraTempo?: number;
}): Buffer {
  const service = exporter();
  const midi = service.convertToMidi(
    service.parsePatternNotes('note("c4 e4 g4")'),
    {
      bpm: options.bpm ?? 120,
      timeSignatureNumerator: options.numerator ?? 4,
      timeSignatureDenominator: options.denominator ?? 4,
    });
  if (options.extraTempo !== undefined) {
    (midi.header as unknown as { tempos: { ticks: number; bpm: number }[] })
      .tempos.push({ ticks: 480, bpm: options.extraTempo });
  }
  return Buffer.from(midi.toArray());
}

describe('a clean file reports no losses (#336)', () => {
  it('4/4 at a single tempo says nothing', () => {
    // A warning that always fires teaches callers to ignore it.
    const result = importer().convertBuffer(buildMidi({}));
    expect(result.summary.discarded).toBeUndefined();
  });
});

describe('tempo changes are disclosed (#336)', () => {
  it('names the tempo used and the ones dropped', () => {
    const result = importer().convertBuffer(buildMidi({ bpm: 120, extraTempo: 200 }));
    expect(result.summary.discarded).toBeDefined();
    const text = (result.summary.discarded ?? []).join(' ');
    expect(text).toContain('tempo change');
    expect(text).toContain('120');
    expect(text).toContain('200');
  });

  it('still imports at the first tempo', () => {
    // Disclosing the loss must not change the behaviour it describes.
    expect(importer().convertBuffer(buildMidi({ bpm: 174, extraTempo: 90 })).summary.bpm)
      .toBe(174);
  });
});

describe('a non-4/4 meter is disclosed (#336)', () => {
  it.each([[3, 4], [7, 8], [5, 4]])(
    '%i/%i is reported', (numerator, denominator) => {
      const result = importer().convertBuffer(buildMidi({ numerator, denominator }));
      const text = (result.summary.discarded ?? []).join(' ');
      expect(text).toContain(`${String(numerator)}/${String(denominator)}`);
      expect(text).toContain('4/4');
    });

  it('says what the consequence is, not just what was dropped', () => {
    const text = (importer().convertBuffer(buildMidi({ numerator: 3 }))
      .summary.discarded ?? []).join(' ');
    expect(text).toMatch(/bar lines will not line up/);
  });

  it('4/4 is not reported', () => {
    expect(importer().convertBuffer(buildMidi({ numerator: 4, denominator: 4 }))
      .summary.discarded).toBeUndefined();
  });
});

describe('both losses are reported together (#336)', () => {
  it('a 3/4 file with a tempo change lists two', () => {
    const result = importer().convertBuffer(
      buildMidi({ numerator: 3, extraTempo: 200 }));
    expect(result.summary.discarded).toHaveLength(2);
  });
});
