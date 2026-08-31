/**
 * The melody collection must match the chords it plays over (#449).
 *
 * `scaleForChords.jazz` was `'dorian'` "by convention" — and the
 * convention is real, but it names the mode of the ii CHORD, not of the
 * key. Rooted on the key it gave the wrong collection outright:
 *
 *   jazz progression in C  ->  Dm7 G7 Cmaj7   (diatonic ii-V-I in C major)
 *   melody scale           ->  C dorian = C D D# F G A A#
 *
 * Eb against Cmaj7's E, and Bb against the B in both Cmaj7 and G7. The
 * bassline for the same style is `C2 E2 G2` — a major third — so two of
 * the three layers already agreed on major and the melody was the odd
 * one out.
 *
 * Same defect the file records fixing for house in #324, in the style
 * that fix skipped.
 */

import { PatternGenerator } from '../../services/PatternGenerator';
import { MusicTheory } from '../../services/MusicTheory';

/** Pitch classes a generated pattern's melody line uses. */
function melodyPitchClasses(pattern: string): Set<string> {
  const melody = /note\("([^"]+)"\)\.s\("triangle"\)/.exec(pattern);
  const classes = new Set<string>();
  for (const token of (melody?.[1] ?? '').split(/\s+/)) {
    const note = /^([a-g][#b]?)\d?$/i.exec(token);
    if (note !== null) classes.add(note[1].toUpperCase());
  }
  return classes;
}

describe('a jazz melody stays inside the chords (#449)', () => {
  const generator = new PatternGenerator();
  const theory = new MusicTheory();

  it('uses the collection the progression is built from', () => {
    const pattern = generator.generateCompletePattern('jazz', 'C', 120);

    // The progression is a diatonic ii-V-I in C major.
    expect(pattern).toContain('Dm7 G7 Cmaj7');

    const inKey = new Set(theory.generateScale('C', 'major').map(n => n.toUpperCase()));
    for (const pitch of melodyPitchClasses(pattern)) {
      expect([...inKey]).toContain(pitch);
    }
  });

  it('never sounds the notes that clashed', () => {
    // D# (Eb) against Cmaj7's E, A# (Bb) against its B. Named directly,
    // because "is in C major" and "is not C dorian" are the same claim
    // only while the progression stays diatonic.
    for (let i = 0; i < 20; i++) {
      const classes = melodyPitchClasses(generator.generateCompletePattern('jazz', 'C', 120));
      expect(classes.has('D#')).toBe(false);
      expect(classes.has('A#')).toBe(false);
    }
  });

  it('leaves the other styles alone', () => {
    // house/techno were already correct; this must not move them.
    const house = generator.generateCompletePattern('house', 'C', 125);
    const inMajor = new Set(theory.generateScale('C', 'major').map(n => n.toUpperCase()));
    for (const pitch of melodyPitchClasses(house)) {
      expect([...inMajor]).toContain(pitch);
    }
  });
});
