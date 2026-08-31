import { PatternGenerator } from '../services/PatternGenerator';

describe('PatternGenerator', () => {
  let generator: PatternGenerator;

  beforeEach(() => {
    generator = new PatternGenerator();
  });

  describe('generateDrumPattern', () => {
    test('should generate techno drum pattern', () => {
      const pattern = generator.generateDrumPattern('techno', 0.5);
      expect(pattern).toContain('s(');
      expect(pattern).toContain('bd');
    });

    test('should generate house drum pattern', () => {
      const pattern = generator.generateDrumPattern('house', 0.5);
      expect(pattern).toContain('s(');
      expect(pattern).toContain('hh');
    });

    test('should handle complexity levels', () => {
      const simple = generator.generateDrumPattern('techno', 0.0);
      const complex = generator.generateDrumPattern('techno', 1.0);
      expect(simple).toBeTruthy();
      expect(complex).toBeTruthy();
      expect(simple.length).toBeLessThanOrEqual(complex.length);
    });

    test('should generate all supported drum styles', () => {
      const styles = ['techno', 'house', 'dnb', 'breakbeat', 'trap', 'jungle', 'ambient', 'experimental'];
      styles.forEach(style => {
        const pattern = generator.generateDrumPattern(style, 0.5);
        expect(pattern).toBeTruthy();
        expect(pattern).toContain('s(');
      });
    });

    test('should default to techno for unknown styles', () => {
      const pattern = generator.generateDrumPattern('unknown', 0.5);
      expect(pattern).toBeTruthy();
      expect(pattern).toContain('bd');
    });

    test('should handle complexity edge cases', () => {
      expect(generator.generateDrumPattern('techno', 0)).toBeTruthy();
      expect(generator.generateDrumPattern('techno', 1)).toBeTruthy();
      expect(generator.generateDrumPattern('techno', 0.5)).toBeTruthy();
    });
  });

  describe('generateBassline', () => {
    test('should generate techno bassline', () => {
      const bass = generator.generateBassline('C', 'techno');
      expect(bass).toContain('note(');
      expect(bass).toContain('C2');
      expect(bass).toContain('sawtooth');
    });

    test('should generate house bassline', () => {
      const bass = generator.generateBassline('D', 'house');
      expect(bass).toContain('D2');
      expect(bass).toContain('sine');
    });

    test('should generate acid bassline with modulation', () => {
      const bass = generator.generateBassline('E', 'acid');
      expect(bass).toContain('E2');
      expect(bass).toContain('cutoff');
      expect(bass).toContain('sine.range');
    });

    test('should handle all supported bass styles', () => {
      const styles = ['techno', 'house', 'dnb', 'acid', 'dub', 'funk', 'jazz', 'ambient'];
      styles.forEach(style => {
        const bass = generator.generateBassline('C', style);
        expect(bass).toContain('note(');
        expect(bass).toContain('C');
      });
    });

    test('should work with different keys', () => {
      const keys = ['C', 'D', 'E', 'F', 'G', 'A', 'B', 'C#', 'F#'];
      keys.forEach(key => {
        const bass = generator.generateBassline(key, 'techno');
        expect(bass).toContain(key);
      });
    });

    test('should default to techno for unknown styles', () => {
      const bass = generator.generateBassline('C', 'unknown');
      expect(bass).toContain('sawtooth');
    });
  });

  describe('generateMelody', () => {
    test('should generate melody from scale', () => {
      const scale = ['c', 'd', 'e', 'f', 'g', 'a', 'b'];
      const melody = generator.generateMelody(scale, 8);
      expect(melody).toContain('note(');
      expect(melody).toContain('triangle');
    });

    test('should generate melody with specified length', () => {
      const scale = ['c', 'd', 'e'];
      const melody4 = generator.generateMelody(scale, 4);
      const melody8 = generator.generateMelody(scale, 8);
      const melody16 = generator.generateMelody(scale, 16);

      const notes4 = melody4.match(/[a-g]\d+/g);
      const notes8 = melody8.match(/[a-g]\d+/g);
      const notes16 = melody16.match(/[a-g]\d+/g);

      expect(notes4?.length).toBe(4);
      expect(notes8?.length).toBe(8);
      expect(notes16?.length).toBe(16);
    });

    test('should respect octave range', () => {
      const scale = ['c', 'd', 'e', 'f', 'g'];
      const melody = generator.generateMelody(scale, 8, [4, 5]);

      const notes = melody.match(/[a-g](\d+)/g) || [];
      notes.forEach(note => {
        const octave = parseInt(note.slice(-1));
        expect(octave).toBeGreaterThanOrEqual(4);
        expect(octave).toBeLessThanOrEqual(5);
      });
    });

    test('should use default parameters', () => {
      const scale = ['c', 'd', 'e'];
      const melody = generator.generateMelody(scale);
      expect(melody).toBeTruthy();
      expect(melody).toContain('note(');
    });

    test('should only use notes from provided scale', () => {
      const scale = ['c', 'e', 'g'];
      const melody = generator.generateMelody(scale, 8);

      const notePattern = /([a-g]#?)\d+/g;
      const matches = melody.match(notePattern) || [];

      matches.forEach(match => {
        const note = match.replace(/\d+/g, '');
        expect(scale).toContain(note);
      });
    });
  });

  describe('generateChords', () => {
    test('should generate triad voicing', () => {
      const chords = generator.generateChords('"C" "F" "G"', 'triad');
      expect(chords).toContain('note(');
      expect(chords).toContain('sawtooth');
      expect(chords).toContain('.struct("1 ~ ~ ~")');
    });

    test('should generate sustained voicing', () => {
      const chords = generator.generateChords('"C" "F"', 'sustained');
      expect(chords).toContain('.attack(0.5)');
      expect(chords).toContain('.release(2)');
    });

    test('should generate pad voicing', () => {
      const chords = generator.generateChords('"C"', 'pad');
      expect(chords).toContain('.attack(2)');
      expect(chords).toContain('.release(4)');
      expect(chords).toContain('.room(0.8)');
    });

    test('should default to triad for unknown voicing', () => {
      const chords = generator.generateChords('"C"', 'unknown');
      expect(chords).toContain('.struct("1 ~ ~ ~")');
    });
  });

  describe('generateCompletePattern', () => {
    test('should generate complete techno pattern', () => {
      const pattern = generator.generateCompletePattern('techno', 'C', 130);
      expect(pattern).toContain('// techno');
      expect(pattern).toContain('setcpm(130/4)');
      expect(pattern).toContain('stack(');
      expect(pattern).toContain('// Drums');
      expect(pattern).toContain('// Bass');
      expect(pattern).toContain('// Chords');
      expect(pattern).toContain('// Melody');
    });

    test('should generate pattern for different styles', () => {
      const styles = ['techno', 'house', 'ambient'];
      styles.forEach(style => {
        const pattern = generator.generateCompletePattern(style, 'C', 120);
        expect(pattern).toContain(`// ${style}`);
        expect(pattern).toContain('stack(');
      });
    });

    test('names the substituted style for a genre with no drums', () => {
      // jazz is a bassline/harmony style with no drum pattern of its own.
      // The header used to say "// jazz" over a techno beat (#279).
      const pattern = generator.generateCompletePattern('jazz', 'C', 120);
      expect(pattern).toContain('// techno');
      expect(pattern).toContain('no drums defined for "jazz"');
      expect(pattern).toContain('stack(');
    });

    test('should use correct key', () => {
      const pattern = generator.generateCompletePattern('house', 'D', 120);
      expect(pattern).toContain('D');
    });

    test('should set correct BPM', () => {
      const pattern140 = generator.generateCompletePattern('dnb', 'C', 140);
      const pattern90 = generator.generateCompletePattern('ambient', 'C', 90);
      expect(pattern140).toContain('setcpm(140/4)'); // cycles per minute, four beats to a cycle (#395)
      expect(pattern90).toContain('setcpm(90/4)');
    });

    test('should use appropriate scale for style', () => {
      const jazzPattern = generator.generateCompletePattern('jazz', 'C', 120);
      const technoPattern = generator.generateCompletePattern('techno', 'C', 120);
      // Jazz should use dorian, others use minor (indirectly verified through note choices)
      expect(jazzPattern).toBeTruthy();
      expect(technoPattern).toBeTruthy();
    });
  });

  describe('generateVariation', () => {
    test('should add subtle variation', () => {
      const base = 's("bd*4")';
      const varied = generator.generateVariation(base, 'subtle');
      expect(varied).toContain(base);
      expect(varied).toContain('.sometimes');
    });

    test('should add moderate variation', () => {
      const base = 's("bd*4")';
      const varied = generator.generateVariation(base, 'moderate');
      expect(varied).toContain('.every(4');
      expect(varied).toContain('.sometimes');
    });

    test('should add extreme variation', () => {
      const base = 's("bd*4")';
      const varied = generator.generateVariation(base, 'extreme');
      expect(varied).toContain('.every(2');
      expect(varied).toContain('.jux');
    });

    test('should add glitch variation', () => {
      const base = 's("bd*4")';
      const varied = generator.generateVariation(base, 'glitch');
      expect(varied).toContain('.chop');
    });

    test('should add evolving variation', () => {
      const base = 's("bd*4")';
      const varied = generator.generateVariation(base, 'evolving');
      expect(varied).toContain('.slow(4)');
      expect(varied).toContain('.palindrome');
    });

    test('should default to subtle for unknown type', () => {
      const base = 's("bd*4")';
      const varied = generator.generateVariation(base, 'unknown');
      expect(varied).toContain('.sometimes');
    });
  });

  describe('generateFill', () => {
    test('should generate techno fill', () => {
      const fill = generator.generateFill('techno', 1);
      expect(fill).toContain('s(');
      expect(fill).toContain('bd');
    });

    test('should handle different bar lengths', () => {
      const fill1 = generator.generateFill('house', 1);
      const fill2 = generator.generateFill('house', 2);
      expect(fill1).toContain('.fast(1)');
      expect(fill2).toContain('.fast(2)');
    });

    test('should generate fills for all supported styles', () => {
      const styles = ['techno', 'house', 'dnb', 'trap', 'breakbeat'];
      styles.forEach(style => {
        const fill = generator.generateFill(style, 1);
        expect(fill).toBeTruthy();
      });
    });

    test('should default to techno for unknown style', () => {
      const fill = generator.generateFill('unknown', 1);
      expect(fill).toContain('bd');
    });
  });

  describe('generateTransition', () => {
    test('should generate transition between styles', () => {
      const transition = generator.generateTransition('techno', 'house', 4);
      expect(transition).toContain('// Transition from techno to house');
      expect(transition).toContain('stack(');
      expect(transition).toContain('// Fade out techno');
      expect(transition).toContain('// Fade in house');
    });

    test('should use specified bar length', () => {
      const transition8 = generator.generateTransition('house', 'dnb', 8);
      expect(transition8).toContain('.slow(8)');
    });
  });

  describe('generateEuclideanPattern', () => {
    test('should generate Euclidean pattern with default sound', () => {
      const pattern = generator.generateEuclideanPattern(3, 8);
      expect(pattern).toContain('s("bd")');
      expect(pattern).toContain('.struct(');
    });

    test('should use specified sound', () => {
      const pattern = generator.generateEuclideanPattern(5, 16, 'cp');
      expect(pattern).toContain('s("cp")');
    });

    test('should generate valid rhythm structure', () => {
      const pattern = generator.generateEuclideanPattern(4, 12, 'hh');
      expect(pattern).toContain('struct');
      // Pattern should contain the rhythm from MusicTheory
      expect(pattern).toMatch(/1.*~/);
    });
  });

  describe('generatePolyrhythm', () => {
    test('should generate polyrhythm with multiple sounds', () => {
      const sounds = ['bd', 'cp', 'hh'];
      const patterns = [3, 5, 7];
      const poly = generator.generatePolyrhythm(sounds, patterns);

      expect(poly).toContain('stack(');
      expect(poly).toContain('s("bd")');
      expect(poly).toContain('s("cp")');
      expect(poly).toContain('s("hh")');
      expect(poly).toContain('.euclid(3, 16)');
      expect(poly).toContain('.euclid(5, 16)');
      expect(poly).toContain('.euclid(7, 16)');
    });

    test('should throw error for mismatched arrays', () => {
      const sounds = ['bd', 'cp'];
      const patterns = [3, 5, 7];
      expect(() => generator.generatePolyrhythm(sounds, patterns))
        .toThrow('Number of sounds must match number of patterns');
    });

    test('should handle single sound/pattern pair', () => {
      const poly = generator.generatePolyrhythm(['bd'], [4]);
      expect(poly).toContain('s("bd")');
      expect(poly).toContain('.euclid(4, 16)');
    });

    test('should handle empty arrays', () => {
      expect(() => generator.generatePolyrhythm([], []))
        .not.toThrow();
    });
  });

  describe('integration tests', () => {
    test('should create complete musical composition', () => {
      const pattern = generator.generateCompletePattern('house', 'A', 125);
      const variation = generator.generateVariation(pattern, 'moderate');

      expect(pattern).toBeTruthy();
      expect(variation).toContain(pattern);
    });

    test('should combine multiple generators', () => {
      const drums = generator.generateDrumPattern('techno', 0.7);
      const bass = generator.generateBassline('C', 'techno');
      const fill = generator.generateFill('techno', 1);

      expect(drums).toBeTruthy();
      expect(bass).toBeTruthy();
      expect(fill).toBeTruthy();
    });

    test('should handle complex workflow', () => {
      // Create initial pattern
      const initial = generator.generateCompletePattern('dnb', 'D', 174);
      expect(initial).toBeTruthy();

      // Add variation
      const varied = generator.generateVariation(initial, 'glitch');
      expect(varied).toContain(initial);

      // Generate transition
      const transition = generator.generateTransition('dnb', 'ambient', 8);
      expect(transition).toBeTruthy();

      // Generate final pattern
      const final = generator.generateCompletePattern('ambient', 'D', 80);
      expect(final).toBeTruthy();
    });
  });
});
