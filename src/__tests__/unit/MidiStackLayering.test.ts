/**
 * Stack lanes layer, and s().n() is counted once (#335).
 */

import { MIDIExportService } from '../../services/MIDIExportService';

const service = () => new MIDIExportService();

describe('stack lanes are simultaneous (#335)', () => {
  it('two lanes occupy the same bar, not consecutive bars', () => {
    // `currentTime += BEATS_PER_BAR` after each match meant lane 2
    // started a bar AFTER lane 1 — parallelism destroyed at export,
    // before import had a chance to preserve it.
    const notes = service().parsePatternNotes(
      'stack(note("c3 e3 g3 b3"), note("c2 c2 g2 g2"))');
    expect(Math.max(...notes.map(n => n.time))).toBe(3);
    expect(notes).toHaveLength(8);
  });

  it('both lanes have a note at time 0', () => {
    const notes = service().parsePatternNotes(
      'stack(note("c3 e3 g3 b3"), note("c2 c2 g2 g2"))');
    // The melody's c3 (48) and the bass's c2 (36) both start the bar.
    const atZero = notes.filter(n => n.time === 0).map(n => n.note).sort((a, b) => a - b);
    expect(atZero).toEqual([36, 48]);
  });

  it('a drum lane layers with a melodic one', () => {
    const notes = service().parsePatternNotes('stack(s("bd*4"), note("c3 e3 g3 b3"))');
    const drums = notes.filter(n => n.channel === 9);
    const melodic = notes.filter(n => n.channel !== 9);
    expect(drums.length).toBeGreaterThan(0);
    expect(melodic.length).toBeGreaterThan(0);
    expect(Math.min(...drums.map(n => n.time))).toBe(0);
    expect(Math.min(...melodic.map(n => n.time))).toBe(0);
  });

  it('a single lane is unaffected', () => {
    const notes = service().parsePatternNotes('note("c4 e4 g4 b4")');
    expect(notes.map(n => n.time)).toEqual([0, 1, 2, 3]);
  });

  it('five lanes fit in one bar, so bars=1 keeps them all', () => {
    // Before, five lanes spanned five bars and bars=1 kept a fifth of
    // the material.
    const five = Array.from({ length: 5 }, () => 'note("c4 e4 g4 b4")').join(' ');
    expect(service().exportToBase64(five, { bars: 1 }).noteCount).toBe(20);
  });
});

describe('s().n() is counted once (#335)', () => {
  it.each([
    ['s("bd").n("0 1 2")', 3],
    ['s("piano").n("60 64")', 2],
    ['n("0 1 2")', 3],
  ])('%s exports %i notes', (pattern, expected) => {
    // Two regexes matched the same text and both fired, so every note
    // in this form was counted twice — the exact form the code's own
    // comment advertises as supported.
    expect(service().exportToBase64(pattern).noteCount).toBe(expected);
  });

  it('a bare drum lane still exports', () => {
    // The lookahead must skip only s(...) that has .n() attached.
    expect(service().exportToBase64('s("bd*4")').noteCount).toBe(4);
  });

  it('a drum lane and an s().n() lane coexist', () => {
    const result = service().exportToBase64('stack(s("bd*4"), s("piano").n("60 64"))');
    expect(result.noteCount).toBe(6);
  });
});
