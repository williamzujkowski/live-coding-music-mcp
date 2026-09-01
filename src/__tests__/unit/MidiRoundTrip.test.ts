/**
 * Export and import agree on time, and on each other's notation (#336).
 *
 * Export treated a whole `note("...")` as **1 beat**; import lays a
 * cycle out over **4** (`secondsPerBeat * 4`). A round trip therefore
 * compressed everything 4×, and the collisions that caused looked like
 * the documented quantization loss when they were a unit disagreement.
 */

import { MIDIExportService } from '../../services/MIDIExportService';
import { BEATS_PER_BAR } from '../../utils/Tempo';
import { MIDIImportService } from '../../services/MIDIImportService';

const exporter = () => new MIDIExportService();
const importer = () => new MIDIImportService();

/** Export then import, returning the note lane. */
function roundTrip(pattern: string, stepsPerCycle = 16): string {
  const exported = exporter().exportToBase64(pattern, { bpm: 120 });
  expect(exported.success).toBe(true);
  const back = importer().convertBuffer(
    Buffer.from(exported.output, 'base64'), { steps_per_cycle: stepsPerCycle });
  return back.pattern.split('\n').find(l => l.includes('note(')) ?? '';
}

/**
 * The step a note starts on, counting mini-notation weights.
 *
 * These assertions used to index into the space-split token list, which
 * assumed one token per step. Import carries note duration now, so a
 * held note is one weighted token covering several steps (`c4@2`) and
 * an index is no longer a position. The question each test is asking —
 * does this note come back at the right TIME — is unchanged (#477).
 */
function stepOf(lane: string, name: string): number {
  const body = /"([^"]*)"/.exec(lane)?.[1] ?? '';
  let step = 0;
  for (const raw of body.split(' ')) {
    const weighted = /^(.+?)@(\d+(?:\.\d+)?)$/.exec(raw);
    const token = weighted ? weighted[1] : raw;
    if (token === name) return step;
    step += weighted ? Number(weighted[2]) : 1;
  }
  return -1;
}

describe('a scale survives as a scale (#336)', () => {
  it('eight evenly spaced notes come back evenly spaced', () => {
    // Came back as note("c4 [d4,e4] [f4,g4] [a4,b4] c5 ~ ~ ...") —
    // a scale turned into chords by the 4x compression.
    const lane = roundTrip('note("c4 d4 e4 f4 g4 a4 b4 c5")');
    // Eight notes over sixteen steps: one every two steps, in order.
    ['c4', 'd4', 'e4', 'f4', 'g4', 'a4', 'b4', 'c5'].forEach((note, index) => {
      expect(stepOf(lane, note)).toBe(index * 2);
    });
    expect(lane).not.toContain(',');   // no collapsed chords
  });

  it('three notes land at even thirds of the bar', () => {
    const lane = roundTrip('note("c3 e3 g3")');
    expect(stepOf(lane, 'c3')).toBe(0);
    // 16 steps / 3 notes; quantization puts them near 5 and 11.
    expect(stepOf(lane, 'e3')).toBeGreaterThan(3);
    expect(stepOf(lane, 'g3')).toBeGreaterThan(9);
  });

  it('two notes split the bar in half', () => {
    const lane = roundTrip('note("c4 e4")');
    expect(stepOf(lane, 'c4')).toBe(0);
    expect(stepOf(lane, 'e4')).toBe(8);
  });

  it('the two services share the constant, so they cannot drift apart', () => {
    expect(BEATS_PER_BAR).toBe(4);
  });
});

describe('bracket tokens survive tokenization (#336)', () => {
  it('keeps a bracket group whole', () => {
    // The split ran before the bracket branch, so that branch could
    // only ever see a bracket with no spaces or commas — never a real
    // chord.
    expect(MIDIExportService.tokenize('[c4 e4] g4')).toEqual(['[c4 e4]', 'g4']);
  });

  it.each([
    ['[c4,e4,g4] b4', ['[c4,e4,g4]', 'b4']],
    ['c4 [e4 g4] b4', ['c4', '[e4 g4]', 'b4']],
    ['[c4 [e4 g4]] b4', ['[c4 [e4 g4]]', 'b4']],
    ['c4 e4', ['c4', 'e4']],
    ['   c4   e4   ', ['c4', 'e4']],
  ])('tokenizes %s', (input, expected) => {
    expect(MIDIExportService.tokenize(input)).toEqual(expected);
  });

  it('does not lose the last note of a chord', () => {
    // "[c4 e4] g4" gave 2 notes: e4 was dropped because "e4]" fails
    // noteNameToMidi.
    expect(exporter().exportToBase64('note("[c4 e4] g4")').noteCount).toBe(3);
  });
});

describe("export can read import's own output (#336)", () => {
  it('a three-leg round trip keeps every note', () => {
    // leg1 produced 7 notes; leg2 produced 5, because import emits
    // [a,b,c] chord tokens that export could not parse. Import's own
    // output was not re-exportable.
    const leg1 = exporter().exportToBase64('chord("Cmaj7 Am")', { bpm: 120 });
    expect(leg1.noteCount).toBe(7);

    const imported = importer().convertBuffer(
      Buffer.from(leg1.output, 'base64'), { steps_per_cycle: 16 });
    const laneOnly = imported.pattern.split('\n').filter(l => l.includes('note(')).join('\n');

    const leg2 = exporter().exportToBase64(laneOnly, { bpm: 120 });
    expect(leg2.noteCount).toBe(leg1.noteCount);
  });

  it('the imported pattern really does use chord tokens', () => {
    // If it stopped emitting them the test above would pass vacuously.
    const exported = exporter().exportToBase64('chord("Cmaj7 Am")', { bpm: 120 });
    const imported = importer().convertBuffer(
      Buffer.from(exported.output, 'base64'), { steps_per_cycle: 16 });
    expect(imported.pattern).toMatch(/\[[a-g][#b]?\d,/);
  });
});
