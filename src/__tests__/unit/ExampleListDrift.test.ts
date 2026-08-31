/**
 * The README's example list must match what actually ships.
 *
 * It did not. #359 deleted eighteen generated examples and #358 added
 * seven real ones, and the README went on listing the eighteen by name —
 * hard-techno, liquid-dnb, four longform pieces — none of which exist.
 * Every one of those was a promise to a reader that the repository could
 * not keep, and both changes were mine.
 *
 * The tool table has a generator and a drift guard for exactly this
 * reason (#221). The example list had neither.
 */

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.join(__dirname, '..', '..', '..');
const EXAMPLES_DIR = path.join(ROOT, 'patterns', 'examples');
const README = readFileSync(path.join(ROOT, 'README.md'), 'utf8');

function shippedExamples(): { genre: string; name: string; bpm: number }[] {
  const found: { genre: string; name: string; bpm: number }[] = [];
  for (const genre of readdirSync(EXAMPLES_DIR, { withFileTypes: true })) {
    if (!genre.isDirectory()) continue;
    for (const file of readdirSync(path.join(EXAMPLES_DIR, genre.name))) {
      if (!file.endsWith('.json')) continue;
      const parsed = JSON.parse(
        readFileSync(path.join(EXAMPLES_DIR, genre.name, file), 'utf8')
      ) as { bpm: number };
      found.push({ genre: genre.name, name: file.replace(/\.json$/, ''), bpm: parsed.bpm });
    }
  }
  return found;
}

const SHIPPED = shippedExamples();

/** Where the example list begins. Everything this guard reads is after it. */
const SECTION_START = /\d+ example patterns ship in/;

describe('README example list matches the corpus', () => {
  it('finds examples on disk at all', () => {
    expect(SHIPPED.length).toBeGreaterThanOrEqual(5);
  });

  it('states the right count', () => {
    const claimed = /(\d+) example patterns ship in/.exec(README);
    expect(claimed).not.toBeNull();
    expect(Number(claimed?.[1])).toBe(SHIPPED.length);
  });

  it.each(SHIPPED.map(e => [e.name, e] as const))('names %s with its tempo', (_name, example) => {
    expect(README).toContain(`${example.name} (${String(example.bpm)} BPM)`);
  });

  it('does not name an example that no longer exists', () => {
    // Scoped to the example section, not the whole README. A bare
    // substring search over the file flagged "drone" in the comment
    // "// Deep bass drone" inside an unrelated code sample — a guard
    // that fails on prose it was never meant to police is a guard people
    // learn to edit around.
    const start = SECTION_START.exec(README);
    expect(start).not.toBeNull();
    if (start === null) return;
    const section = README.slice(start.index, README.indexOf('Each example is a JSON file', start.index));

    for (const gone of [
      'hard-techno', 'minimal-techno', 'deep-house', 'tech-house',
      'liquid-dnb', 'neurofunk', 'dark-ambient', 'drone', 'cloud-trap',
      'classic-jungle', 'ragga-jungle', 'bebop', 'modal-jazz',
      'Longform',
    ]) {
      expect(section).not.toContain(gone);
    }
  });
});
