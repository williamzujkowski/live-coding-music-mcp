/**
 * The melody and the chords agree on mode (#324).
 *
 * The melody scale was hardcoded to `minor` for every style except
 * jazz, while house / ambient / default got the `pop` progression — a
 * major I-V-vi-IV. So house in C produced `<C G Am F>` under a melody
 * of `g#3 d#4 f4 c5 …`, sounding Ab and Eb over C major and F major
 * triads.
 */

import { PatternGenerator } from '../../services/PatternGenerator';

const SEMITONE: Record<string, number> = {
  c: 0, 'c#': 1, db: 1, d: 2, 'd#': 3, eb: 3, e: 4, f: 5, 'f#': 6,
  gb: 6, g: 7, 'g#': 8, ab: 8, a: 9, 'a#': 10, bb: 10, b: 11,
};

/** Pitch classes of a scale rooted at C. */
const SCALES: Record<string, number[]> = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
};

function melodyNotes(pattern: string): string[] {
  const line = pattern.split('\n').find(l => l.includes('triangle'));
  const inner = line?.match(/note\("([^"]*)"/)?.[1] ?? '';
  return inner.split(/\s+/).filter(Boolean);
}

function chordSymbols(pattern: string): string[] {
  const line = pattern.split('\n').find(l => l.includes('<'));
  return (line?.match(/<([^>]*)>/)?.[1] ?? '').split(/\s+/).filter(Boolean);
}

/** Pitch class of a note token like "g#3" or "Am". */
function pitchClass(token: string): number | null {
  const m = /^([a-gA-G][#b]?)/.exec(token);
  if (!m) return null;
  const pc = SEMITONE[m[1].toLowerCase()];
  return pc === undefined ? null : pc;
}

describe('melody notes belong to the progression\'s scale (#324)', () => {
  const generator = new PatternGenerator();

  it.each([
    ['house', 'major'],
    ['ambient', 'major'],
    ['breakbeat', 'major'],
    ['techno', 'minor'],
    // 'major', not 'dorian'.
    //
    // This row contradicted the test's own premise. The jazz
    // progression is `Dm7 G7 Cmaj7` — a diatonic ii-V-I in C MAJOR — so
    // "melody notes belong to the progression's scale" makes C major
    // the answer. C dorian puts Eb against Cmaj7's E and Bb against its
    // B, which is precisely the disagreement this file was written to
    // catch, asserted one row below the rows it fixed (#449).
    //
    // The 'dorian' convention is real, but it names the mode of the ii
    // CHORD. Rooted on the key it is a different collection.
    ['jazz', 'major'],
  ])('%s uses the %s scale', (style, scaleName) => {
    // Run several times: the melody is random, so one pass could pass
    // by luck.
    for (let attempt = 0; attempt < 20; attempt++) {
      const pattern = generator.generateCompletePattern(style, 'C', 120);
      const allowed = new Set(SCALES[scaleName]);
      for (const note of melodyNotes(pattern)) {
        const pc = pitchClass(note);
        expect(pc).not.toBeNull();
        expect(allowed.has(pc as number)).toBe(true);
      }
    }
  });

  it.each([
    ['house', 'major'],
    ['techno', 'minor'],
  ])('%s chord roots are also in the %s scale', (style, scaleName) => {
    const pattern = generator.generateCompletePattern(style, 'C', 120);
    const allowed = new Set(SCALES[scaleName]);
    for (const chord of chordSymbols(pattern)) {
      const pc = pitchClass(chord);
      if (pc !== null) expect(allowed.has(pc)).toBe(true);
    }
  });

  it('house never sounds Ab or Eb over its major progression', () => {
    // The two notes the bug produced most visibly: b3 (Eb) and b8 (Ab)
    // are the minor third and minor sixth, both absent from C major.
    for (let attempt = 0; attempt < 30; attempt++) {
      const notes = melodyNotes(generator.generateCompletePattern('house', 'C', 120));
      const classes = notes.map(pitchClass);
      expect(classes).not.toContain(3);  // Eb
      expect(classes).not.toContain(8);  // Ab
    }
  });

  it('works in a key other than C', () => {
    for (const key of ['D', 'F#', 'A#']) {
      const pattern = generator.generateCompletePattern('house', key, 120);
      const root = pitchClass(key) as number;
      const allowed = new Set(SCALES.major.map(i => (i + root) % 12));
      for (const note of melodyNotes(pattern)) {
        expect(allowed.has(pitchClass(note) as number)).toBe(true);
      }
    }
  });
});

describe('the seventh voicing is named for what it does (#324)', () => {
  const generator = new PatternGenerator();

  it('`fifths` exists and produces the transpose it describes', () => {
    // `.add(note("7"))` transposes every note up 7 semitones — a perfect
    // fifth. It was called `seventh`.
    expect(generator.generateChords('C G', 'fifths')).toContain('.add(note("7"))');
  });

  it('`seventh` still resolves, for callers that used it', () => {
    expect(generator.generateChords('C G', 'seventh'))
      .toBe(generator.generateChords('C G', 'fifths'));
  });

  it('an unknown voicing still falls back to triad', () => {
    expect(generator.generateChords('C G', 'nonsense'))
      .toBe(generator.generateChords('C G', 'triad'));
  });
});
