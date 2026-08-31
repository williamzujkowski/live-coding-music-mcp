/**
 * The example corpus states its own harmony, checked independently (#353).
 *
 * The previous 18 examples were `PatternGenerator` output, so grading
 * the analyzer against them compared the analyzer to its own generator.
 * Hand-written replacements carry the same risk one step removed — so
 * each states its key and progression, and this checks the two agree
 * using plain interval arithmetic and NO project code.
 *
 * The analyzer can be wrong about these files and this will still pass.
 * That is the point.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const EXAMPLES = join(__dirname, '..', '..', '..', 'patterns', 'examples');

const PITCH_CLASS: Record<string, number> = {
  C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6,
  Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11,
};
const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const MINOR = [0, 2, 3, 5, 7, 8, 10];
const CHORD_TONES: Record<string, number[]> = {
  '': [0, 4, 7], m: [0, 3, 7], m7: [0, 3, 7, 10], '7': [0, 4, 7, 10], maj7: [0, 4, 7, 11],
};

interface Example {
  name: string; genre: string; pattern: string; key?: string;
  progression?: string; source?: { license: string; origin: string };
}

function loadAll(): { path: string; doc: Example }[] {
  const out: { path: string; doc: Example }[] = [];
  for (const genre of readdirSync(EXAMPLES)) {
    const dir = join(EXAMPLES, genre);
    // SOURCES.md and README.md live alongside the genre directories.
    if (!statSync(dir).isDirectory()) continue;
    for (const file of readdirSync(dir).filter(f => f.endsWith('.json'))) {
      out.push({
        path: `${genre}/${file}`,
        doc: JSON.parse(readFileSync(join(dir, file), 'utf-8')) as Example,
      });
    }
  }
  return out;
}

const sourced = loadAll().filter(e => e.doc.source !== undefined);

describe('the new corpus declares its provenance (#353)', () => {
  it('there are examples with a source field', () => {
    expect(sourced.length).toBeGreaterThanOrEqual(7);
  });

  it.each(sourced.map(e => [e.path, e.doc] as const))(
    '%s names a licence and an origin', (_path, doc) => {
      expect(doc.source?.license).toBeTruthy();
      expect(doc.source?.origin).toBeTruthy();
    });

  it('every sourced licence is one we can actually use', () => {
    // AGPL is ours; GPL-3.0 combines into it under AGPLv3 §13. Anything
    // else — a NonCommercial clause especially — would be a problem,
    // and CC BY-NC-SA is exactly what we had to turn down.
    const allowed = new Set(['GPL-3.0', 'AGPL-3.0-or-later']);
    for (const { doc } of sourced) {
      expect(allowed.has(doc.source?.license ?? '')).toBe(true);
    }
  });

  it('a GPL-3.0 example credits its upstream, not just Strudel', () => {
    const gpl = sourced.filter(e => e.doc.source?.license === 'GPL-3.0');
    expect(gpl.length).toBeGreaterThan(0);
    for (const { doc } of gpl) {
      expect(doc.source?.origin).toContain('tidal-drum-patterns');
    }
  });

  it('SOURCES.md exists and explains both categories', () => {
    const text = readFileSync(join(EXAMPLES, 'SOURCES.md'), 'utf-8');
    expect(text).toContain('GPL-3.0');
    expect(text).toContain('CC BY-NC-SA');
  });
});

describe('stated harmony is internally consistent (#353)', () => {
  /** Chord symbol -> pitch classes, by interval arithmetic alone. */
  function chordPitchClasses(symbol: string): number[] {
    const match = /^([A-G][#b]?)(maj7|m7|m|7)?$/.exec(symbol);
    if (match === null) return [];
    const root = PITCH_CLASS[match[1]];
    const tones = CHORD_TONES[match[2] ?? ''] ?? CHORD_TONES[''];
    return tones.map(t => (root + t) % 12);
  }

  const withHarmony = sourced.filter(e => e.doc.progression !== undefined);

  it('the hand-written examples declare a progression', () => {
    expect(withHarmony.length).toBeGreaterThanOrEqual(4);
  });

  it.each(withHarmony.map(e => [e.path, e.doc] as const))(
    '%s: every chord is diatonic to its stated key', (_path, doc) => {
      const [rootName, quality] = (doc.key ?? '').split(' ');
      const root = PITCH_CLASS[rootName];
      expect(root).toBeDefined();

      const scale = quality === 'minor' ? MINOR : MAJOR;
      const allowed = new Set(scale.map(i => (root + i) % 12));

      const symbols = (doc.progression ?? '').split('(')[0]
        .match(/[A-G][#b]?(?:maj7|m7|m|7)?/g) ?? [];
      expect(symbols.length).toBeGreaterThan(1);

      for (const symbol of symbols) {
        for (const pc of chordPitchClasses(symbol)) {
          expect(allowed.has(pc)).toBe(true);
        }
      }
    });

  it('the check can fail — a non-diatonic chord is caught', () => {
    // A guard that cannot fail is not a guard. F# is not in C major.
    const allowed = new Set(MAJOR.map(i => (PITCH_CLASS.C + i) % 12));
    expect(chordPitchClasses('F#').every(pc => allowed.has(pc))).toBe(false);
  });
});
