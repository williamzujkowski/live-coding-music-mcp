import { MusicTheory } from '../services/MusicTheory';

describe('MusicTheory', () => {
  let theory: MusicTheory;

  beforeEach(() => {
    theory = new MusicTheory();
  });

  describe('generateScale', () => {
    test('should generate correct major scale', () => {
      const scale = theory.generateScale('C', 'major');
      expect(scale).toEqual(['C', 'D', 'E', 'F', 'G', 'A', 'B']);
    });

    test('should generate correct minor scale', () => {
      const scale = theory.generateScale('A', 'minor');
      expect(scale).toEqual(['A', 'B', 'C', 'D', 'E', 'F', 'G']);
    });

    test('should generate correct dorian scale', () => {
      const scale = theory.generateScale('D', 'dorian');
      expect(scale).toEqual(['D', 'E', 'F', 'G', 'A', 'B', 'C']);
    });

    test('should generate correct pentatonic scale', () => {
      const scale = theory.generateScale('C', 'pentatonic');
      expect(scale).toEqual(['C', 'D', 'E', 'G', 'A']);
    });

    test('should generate correct blues scale', () => {
      const scale = theory.generateScale('C', 'blues');
      expect(scale).toEqual(['C', 'D#', 'F', 'F#', 'G', 'A#']);
    });

    test('should generate all modal scales correctly', () => {
      const modes = ['dorian', 'phrygian', 'lydian', 'mixolydian', 'aeolian', 'locrian'];
      modes.forEach(mode => {
        const scale = theory.generateScale('C', mode as any);
        expect(scale).toHaveLength(7);
        expect(scale[0]).toBe('C');
      });
    });

    test('should handle sharps correctly', () => {
      const scale = theory.generateScale('F#', 'major');
      expect(scale).toContain('F#');
      expect(scale).toHaveLength(7);
    });

    test('should throw error for invalid root note', () => {
      expect(() => theory.generateScale('X', 'major')).toThrow('Invalid root note: X');
    });

    test('should throw error for invalid scale type', () => {
      expect(() => theory.generateScale('C', 'invalid' as any)).toThrow('Invalid scale: invalid');
    });

    test('should handle all chromatic notes', () => {
      const notes = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
      notes.forEach(note => {
        const scale = theory.generateScale(note, 'major');
        expect(scale).toHaveLength(7);
        expect(scale[0]).toBe(note);
      });
    });
  });

  describe('generateChordProgression', () => {
    test('should generate pop progression (I-V-vi-IV)', () => {
      const progression = theory.generateChordProgression('C', 'pop');
      expect(progression).toBe('C G Am F');
    });

    test('should generate jazz progression', () => {
      const progression = theory.generateChordProgression('C', 'jazz');
      expect(progression).toBe('Dm7 G7 Cmaj7');
    });

    test('should generate blues progression', () => {
      const progression = theory.generateChordProgression('C', 'blues');
      expect(progression).toContain('C7');
      expect(progression.split(' ')).toHaveLength(12); // 12-bar blues
    });

    test('should handle different keys', () => {
      const progressionC = theory.generateChordProgression('C', 'pop');
      const progressionG = theory.generateChordProgression('G', 'pop');
      expect(progressionC).not.toBe(progressionG);
    });

    test('should generate all progression types', () => {
      const styles = ['pop', 'jazz', 'blues', 'folk', 'rock', 'classical', 'modal', 'edm'];
      styles.forEach(style => {
        const progression = theory.generateChordProgression('C', style as any);
        expect(progression).toBeTruthy();
        expect(progression.length).toBeGreaterThan(0);
      });
    });

    test('should throw error for invalid style', () => {
      expect(() => theory.generateChordProgression('C', 'invalid' as any))
        .toThrow('Invalid progression style: invalid');
    });
  });

  describe('getNote', () => {
    test('should transpose notes correctly', () => {
      expect(theory.getNote('C', 0)).toBe('C');
      expect(theory.getNote('C', 2)).toBe('D');
      expect(theory.getNote('C', 4)).toBe('E');
      expect(theory.getNote('C', 5)).toBe('F');
      expect(theory.getNote('C', 7)).toBe('G');
      expect(theory.getNote('C', 9)).toBe('A');
      expect(theory.getNote('C', 11)).toBe('B');
    });

    test('should wrap around octave', () => {
      expect(theory.getNote('C', 12)).toBe('C');
      expect(theory.getNote('C', 13)).toBe('C#');
      expect(theory.getNote('C', 24)).toBe('C');
    });

    test('should handle sharps', () => {
      expect(theory.getNote('C#', 2)).toBe('D#');
      expect(theory.getNote('F#', 5)).toBe('B');
    });

    test('should return original note for invalid root', () => {
      expect(theory.getNote('X', 5)).toBe('X');
    });
  });

  describe('generateEuclideanRhythm', () => {
    test('should generate valid Euclidean rhythm', () => {
      const rhythm = theory.generateEuclideanRhythm(3, 8);
      const hits = rhythm.split(' ').filter(x => x === '1').length;
      expect(hits).toBe(3);
    });

    test('should handle different hit/step combinations', () => {
      const testCases = [
        { hits: 3, steps: 8 },
        { hits: 5, steps: 8 },
        { hits: 5, steps: 16 },
        { hits: 7, steps: 16 },
      ];

      testCases.forEach(({ hits, steps }) => {
        const rhythm = theory.generateEuclideanRhythm(hits, steps);
        const actualHits = rhythm.split(' ').filter(x => x === '1').length;
        expect(actualHits).toBe(hits);
        expect(rhythm.split(' ')).toHaveLength(steps);
      });
    });

    test('should distribute hits evenly', () => {
      const rhythm = theory.generateEuclideanRhythm(4, 16);
      const steps = rhythm.split(' ');
      expect(steps).toHaveLength(16);

      // Check that hits are evenly distributed (every 4 steps for 4 hits in 16 steps)
      expect(steps[0]).toBe('1');
      expect(steps[4]).toBe('1');
      expect(steps[8]).toBe('1');
      expect(steps[12]).toBe('1');
    });

    test('should throw error when hits exceed steps', () => {
      expect(() => theory.generateEuclideanRhythm(10, 8))
        .toThrow('Hits cannot exceed steps');
    });

    test('should handle edge cases', () => {
      expect(theory.generateEuclideanRhythm(0, 8).split(' ').filter(x => x === '1')).toHaveLength(0);
      expect(theory.generateEuclideanRhythm(8, 8).split(' ').filter(x => x === '1')).toHaveLength(8);
      expect(theory.generateEuclideanRhythm(1, 16).split(' ').filter(x => x === '1')).toHaveLength(1);
    });
  });

  describe('generatePolyrhythm', () => {
    test('should generate polyrhythm with two patterns', () => {
      const polyrhythm = theory.generatePolyrhythm(3, 5, 16);
      expect(polyrhythm).toContain('[');
      expect(polyrhythm).toContain(']');
      expect(polyrhythm.split('],').length).toBe(2);
    });

    test('should use default length of 16', () => {
      const polyrhythm = theory.generatePolyrhythm(3, 5);
      const patterns = polyrhythm.split('], [');
      patterns.forEach(pattern => {
        const cleaned = pattern.replace(/[[\]]/g, '');
        expect(cleaned.split(' ')).toHaveLength(16);
      });
    });

    test('should generate different rhythms for different patterns', () => {
      const poly1 = theory.generatePolyrhythm(3, 5, 16);
      const poly2 = theory.generatePolyrhythm(5, 3, 16);
      expect(poly1).not.toBe(poly2);
    });
  });

  describe('getScaleNotes', () => {
    test('should return scale notes with octave numbers', () => {
      const notes = theory.getScaleNotes('C', 'major', 3);
      expect(notes).toEqual(['c3', 'd3', 'e3', 'f3', 'g3', 'a3', 'b3']);
    });

    test('should handle different octaves', () => {
      const notes4 = theory.getScaleNotes('C', 'major', 4);
      const notes5 = theory.getScaleNotes('C', 'major', 5);
      expect(notes4).toEqual(['c4', 'd4', 'e4', 'f4', 'g4', 'a4', 'b4']);
      expect(notes5).toEqual(['c5', 'd5', 'e5', 'f5', 'g5', 'a5', 'b5']);
    });

    test('should lowercase note names', () => {
      const notes = theory.getScaleNotes('C#', 'major', 3);
      notes.forEach(note => {
        expect(note[0]).toBe(note[0].toLowerCase());
      });
    });
  });

  describe('generateArpeggio', () => {
    test('should generate upward arpeggio', () => {
      const arp = theory.generateArpeggio('C', 'up');
      expect(arp).toBeTruthy();
      expect(arp.split(' ')).toHaveLength(4);
    });

    test('should generate downward arpeggio', () => {
      const arp = theory.generateArpeggio('C', 'down');
      expect(arp).toBeTruthy();
      expect(arp.split(' ')).toHaveLength(4);
    });

    test('should generate up-down arpeggio', () => {
      const arp = theory.generateArpeggio('C', 'updown');
      expect(arp.split(' ')).toHaveLength(6);
    });

    test('should generate random arpeggio', () => {
      const arp = theory.generateArpeggio('C', 'random');
      expect(arp.split(' ')).toHaveLength(8);
    });

    test('should default to up pattern for invalid pattern type', () => {
      const arp = theory.generateArpeggio('C', 'invalid');
      expect(arp.split(' ')).toHaveLength(4);
    });

    test('should handle different chord types', () => {
      const chords = ['C', 'Cm', 'C7', 'Cmaj7', 'Cm7'];
      chords.forEach(chord => {
        const arp = theory.generateArpeggio(chord, 'up');
        expect(arp).toBeTruthy();
      });
    });
  });

  describe('integration tests', () => {
    test('should create complete musical context', () => {
      const key = 'C';
      const scale = theory.generateScale(key, 'major');
      const progression = theory.generateChordProgression(key, 'pop');
      const rhythm = theory.generateEuclideanRhythm(4, 16);

      expect(scale).toHaveLength(7);
      expect(progression).toContain('C');
      expect(rhythm.split(' ')).toHaveLength(16);
    });

    test('should work with all supported scales and progressions', () => {
      const scales = ['major', 'minor', 'dorian', 'phrygian', 'lydian', 'mixolydian',
                     'aeolian', 'locrian', 'pentatonic', 'blues'];
      const progressions = ['pop', 'jazz', 'blues', 'folk', 'rock', 'classical', 'modal', 'edm'];

      scales.forEach(scaleName => {
        const scale = theory.generateScale('C', scaleName as any);
        expect(scale.length).toBeGreaterThan(0);
      });

      progressions.forEach(style => {
        const progression = theory.generateChordProgression('C', style as any);
        expect(progression.length).toBeGreaterThan(0);
      });
    });
  });
});
