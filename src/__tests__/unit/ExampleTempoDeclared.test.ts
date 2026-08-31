/**
 * An example must play at the tempo it claims (#367).
 *
 * Every shipped example carried a `bpm` field that the pattern never
 * applied, so all seven played at Strudel's default. The field was
 * decorative, and decorative metadata is worse than none: I measured
 * tempo detection against those numbers, got a constant 120 across four
 * genres, and filed a bug against the detector. The detector was right.
 *
 * The tempo is written as `setcpm(<bpm>/<n>)` rather than a computed
 * constant precisely so this test can check it. `<n>` differs per
 * example — it is how many of the pattern's own beats fall in one cycle,
 * which depends on the mini-notation and on any `.slow()` — but the
 * numerator must be the declared BPM, verbatim.
 */

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.join(__dirname, '..', '..', '..', 'patterns', 'examples');

interface Example {
  file: string;
  name: string;
  bpm: number;
  pattern: string;
}

function loadExamples(): Example[] {
  const examples: Example[] = [];
  for (const genre of readdirSync(ROOT, { withFileTypes: true })) {
    if (!genre.isDirectory()) continue;
    for (const file of readdirSync(path.join(ROOT, genre.name))) {
      if (!file.endsWith('.json')) continue;
      const parsed = JSON.parse(
        readFileSync(path.join(ROOT, genre.name, file), 'utf8')
      ) as { name: string; bpm: number; pattern: string };
      examples.push({ file: `${genre.name}/${file}`, ...parsed });
    }
  }
  return examples;
}

const EXAMPLES = loadExamples();

describe('shipped examples declare a tempo they actually set (#367)', () => {
  it('finds the corpus', () => {
    // Guards against the whole suite passing vacuously on an empty read.
    expect(EXAMPLES.length).toBeGreaterThanOrEqual(5);
  });

  it.each(EXAMPLES.map(e => [e.file, e] as const))('%s sets its declared tempo', (_file, example) => {
    expect(typeof example.bpm).toBe('number');
    expect(example.bpm).toBeGreaterThan(0);

    const call = /setcpm\(\s*(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)\s*\)/.exec(example.pattern);
    expect(call).not.toBeNull();
    if (call === null) return;

    // The numerator IS the declared BPM. Writing the arithmetic out
    // rather than folding it to a constant is what makes the claim and
    // the code impossible to drift apart.
    expect(Number(call[1])).toBe(example.bpm);
    expect(Number(call[2])).toBeGreaterThan(0);
  });

  it.each(EXAMPLES.map(e => [e.file, e] as const))('%s sets the tempo before using it', (_file, example) => {
    // setcpm after the pattern would parse and do nothing useful.
    const setcpmAt = example.pattern.indexOf('setcpm(');
    const firstSound = Math.min(
      ...['stack(', 's(', 'note(', 'sound('].map(token => {
        const at = example.pattern.indexOf(token);
        return at === -1 ? Number.MAX_SAFE_INTEGER : at;
      })
    );
    expect(setcpmAt).toBeGreaterThanOrEqual(0);
    expect(setcpmAt).toBeLessThan(firstSound);
  });
});
