/**
 * Drums export, and noteCount reports what was written (#335).
 *
 * Import could read a GM channel-9 track into clean `s(...)` lanes.
 * Export had no sample->MIDI map and never set a channel, so every drum
 * pattern returned "No notes found in pattern" — drums were import-only
 * and import's own output could not be re-exported.
 */

import { MIDIExportService, SAMPLE_TO_MIDI, GM_PERCUSSION_CHANNEL } from '../../services/MIDIExportService';
import { MIDIImportService, GM_DRUM_MAP } from '../../services/MIDIImportService';

const exporter = () => new MIDIExportService();
const importer = () => new MIDIImportService();

describe('drum patterns export (#335)', () => {
  it.each([
    ['s("bd*4")', 4],
    ['s("bd sd bd sd")', 4],
    ['s("bd ~ sd ~")', 2],
    ['sound("bd sd")', 2],
    ['stack(s("bd*4"), s("hh*8"))', 12],
  ])('%s exports %i notes', (pattern, expected) => {
    const result = exporter().exportToBase64(pattern);
    expect(result.success).toBe(true);
    expect(result.noteCount).toBe(expected);
  });

  it('a melodic s() is not misread as drums', () => {
    // parseDrumString returns [] unless every token is a known sample,
    // so s("piano") falls through to the .n() handler rather than being
    // silently reinterpreted.
    expect(exporter().exportToBase64('s("piano")').success).toBe(false);
  });

  it('a mixed lane is not half-read', () => {
    expect(exporter().exportToBase64('s("bd piano sd")').success).toBe(false);
  });
});

describe('the two drum maps agree (#335)', () => {
  it('every sample export knows imports back to the same sample', () => {
    // SAMPLE_TO_MIDI is the inverse of GM_DRUM_MAP. If they disagree, a
    // kick exports and imports back as something else.
    for (const [sample, midi] of Object.entries(SAMPLE_TO_MIDI)) {
      expect(GM_DRUM_MAP[midi]).toBe(sample);
    }
  });

  it('covers every sample import can produce', () => {
    for (const sample of Object.values(GM_DRUM_MAP)) {
      expect(Object.hasOwn(SAMPLE_TO_MIDI, sample)).toBe(true);
    }
  });

  it('uses the GM percussion channel', () => {
    expect(GM_PERCUSSION_CHANNEL).toBe(9);
  });
});

describe('drums round-trip (#335)', () => {
  it('s("bd*4") comes back as a bd lane', () => {
    const exported = exporter().exportToBase64('s("bd*4")', { bpm: 120 });
    const back = importer().convertBuffer(
      Buffer.from(exported.output, 'base64'), { steps_per_cycle: 8 });
    expect(back.pattern).toContain('s("bd');
    expect(back.summary.lanes).toBeGreaterThan(0);
  });

  it('separate samples come back as separate lanes', () => {
    const exported = exporter().exportToBase64('s("bd ~ sd ~")', { bpm: 120 });
    const back = importer().convertBuffer(
      Buffer.from(exported.output, 'base64'), { steps_per_cycle: 8 });
    expect(back.pattern).toContain('bd');
    expect(back.pattern).toContain('sd');
  });

  it('a kick does not come back as a pitched note', () => {
    // Without channel 9 an importer cannot tell MIDI 36 as a kick from
    // MIDI 36 as a low C.
    const exported = exporter().exportToBase64('s("bd*4")', { bpm: 120 });
    const back = importer().convertBuffer(Buffer.from(exported.output, 'base64'));
    expect(back.pattern).not.toContain('note(');
  });
});

describe('noteCount reports what was written (#335)', () => {
  /** Five lanes is five bars of material. */
  const fiveLanes = Array.from({ length: 5 }, () => 'note("c4 e4 g4 b4")').join(' ');

  it.each([[1, 4], [2, 8], [5, 20]])(
    'bars=%i writes %i of the 20 parsed notes', (bars, expected) => {
      // It reported `notes.length` — the PARSED count — while the bars
      // filter dropped them afterwards, so 20 was claimed with 4 in the
      // file.
      expect(exporter().exportToBase64(fiveLanes, { bars }).noteCount).toBe(expected);
    });

  it('an untruncated export is unchanged', () => {
    expect(exporter().exportToBase64('note("c4 e4 g4")').noteCount).toBe(3);
  });
});
