import { InputValidator } from '../utils/InputValidator';

describe('InputValidator', () => {
  describe('validateBPM', () => {
    describe('valid inputs', () => {
      test('should accept BPM of 20 (minimum boundary)', () => {
        expect(() => InputValidator.validateBPM(20)).not.toThrow();
      });

      test('should accept BPM of 300 (maximum boundary)', () => {
        expect(() => InputValidator.validateBPM(300)).not.toThrow();
      });

      test('should accept BPM in normal range (120)', () => {
        expect(() => InputValidator.validateBPM(120)).not.toThrow();
      });

      test('should accept BPM with decimal values', () => {
        expect(() => InputValidator.validateBPM(128.5)).not.toThrow();
      });

      test('should accept various valid BPM values', () => {
        const validBPMs = [20, 60, 90, 120, 140, 160, 180, 200, 240, 300];
        validBPMs.forEach(bpm => {
          expect(() => InputValidator.validateBPM(bpm)).not.toThrow();
        });
      });
    });

    describe('invalid inputs', () => {
      test('should throw error for BPM below minimum (19)', () => {
        expect(() => InputValidator.validateBPM(19))
          .toThrow('BPM must be between 20 and 300');
      });

      test('should throw error for BPM above maximum (301)', () => {
        expect(() => InputValidator.validateBPM(301))
          .toThrow('BPM must be between 20 and 300');
      });

      test('should throw error for negative BPM', () => {
        expect(() => InputValidator.validateBPM(-120))
          .toThrow('BPM must be between 20 and 300');
      });

      test('should throw error for zero BPM', () => {
        expect(() => InputValidator.validateBPM(0))
          .toThrow('BPM must be between 20 and 300');
      });

      test('should throw error for NaN', () => {
        expect(() => InputValidator.validateBPM(NaN))
          .toThrow('BPM must be a valid number');
      });

      test('should throw error for Infinity', () => {
        expect(() => InputValidator.validateBPM(Infinity))
          .toThrow('BPM must be a valid number');
      });

      test('should throw error for -Infinity', () => {
        expect(() => InputValidator.validateBPM(-Infinity))
          .toThrow('BPM must be a valid number');
      });
    });

    describe('type validation', () => {
      test('should throw error for string input', () => {
        expect(() => InputValidator.validateBPM('120' as any))
          .toThrow('BPM must be a number');
      });

      test('should throw error for null', () => {
        expect(() => InputValidator.validateBPM(null as any))
          .toThrow('BPM must be a number');
      });

      test('should throw error for undefined', () => {
        expect(() => InputValidator.validateBPM(undefined as any))
          .toThrow('BPM must be a number');
      });

      test('should throw error for object', () => {
        expect(() => InputValidator.validateBPM({} as any))
          .toThrow('BPM must be a number');
      });

      test('should throw error for array', () => {
        expect(() => InputValidator.validateBPM([120] as any))
          .toThrow('BPM must be a number');
      });
    });
  });

  describe('validateGain', () => {
    describe('valid inputs', () => {
      test('should accept gain of 0 (minimum boundary)', () => {
        expect(() => InputValidator.validateGain(0)).not.toThrow();
      });

      test('should accept gain of 2.0 (maximum boundary)', () => {
        expect(() => InputValidator.validateGain(2.0)).not.toThrow();
      });

      test('should accept gain of 1.0 (unity gain)', () => {
        expect(() => InputValidator.validateGain(1.0)).not.toThrow();
      });

      test('should accept decimal gain values', () => {
        expect(() => InputValidator.validateGain(0.5)).not.toThrow();
        expect(() => InputValidator.validateGain(1.5)).not.toThrow();
        expect(() => InputValidator.validateGain(0.75)).not.toThrow();
      });

      test('should accept various valid gain values', () => {
        const validGains = [0, 0.1, 0.5, 0.75, 1.0, 1.25, 1.5, 1.75, 2.0];
        validGains.forEach(gain => {
          expect(() => InputValidator.validateGain(gain)).not.toThrow();
        });
      });
    });

    describe('invalid inputs', () => {
      test('should throw error for negative gain', () => {
        expect(() => InputValidator.validateGain(-0.1))
          .toThrow('Gain must be between 0 and 2.0');
      });

      test('should throw error for gain above maximum (2.1)', () => {
        expect(() => InputValidator.validateGain(2.1))
          .toThrow('Gain must be between 0 and 2.0');
      });

      test('should throw error for very large gain values', () => {
        expect(() => InputValidator.validateGain(10))
          .toThrow('Gain must be between 0 and 2.0');
      });

      test('should throw error for NaN', () => {
        expect(() => InputValidator.validateGain(NaN))
          .toThrow('Gain must be a valid number');
      });

      test('should throw error for Infinity', () => {
        expect(() => InputValidator.validateGain(Infinity))
          .toThrow('Gain must be a valid number');
      });

      test('should throw error for -Infinity', () => {
        expect(() => InputValidator.validateGain(-Infinity))
          .toThrow('Gain must be a valid number');
      });
    });

    describe('type validation', () => {
      test('should throw error for string input', () => {
        expect(() => InputValidator.validateGain('1.5' as any))
          .toThrow('Gain must be a number');
      });

      test('should throw error for null', () => {
        expect(() => InputValidator.validateGain(null as any))
          .toThrow('Gain must be a number');
      });

      test('should throw error for undefined', () => {
        expect(() => InputValidator.validateGain(undefined as any))
          .toThrow('Gain must be a number');
      });

      test('should throw error for object', () => {
        expect(() => InputValidator.validateGain({} as any))
          .toThrow('Gain must be a number');
      });

      test('should throw error for boolean', () => {
        expect(() => InputValidator.validateGain(true as any))
          .toThrow('Gain must be a number');
      });
    });
  });

  describe('validateEuclidean', () => {
    describe('valid inputs', () => {
      test('should accept hits equal to steps', () => {
        expect(() => InputValidator.validateEuclidean(8, 8)).not.toThrow();
      });

      test('should accept hits less than steps', () => {
        expect(() => InputValidator.validateEuclidean(3, 8)).not.toThrow();
        expect(() => InputValidator.validateEuclidean(5, 16)).not.toThrow();
      });

      test('should accept zero hits', () => {
        expect(() => InputValidator.validateEuclidean(0, 8)).not.toThrow();
      });

      test('should accept common Euclidean rhythm patterns', () => {
        const validPatterns = [
          { hits: 3, steps: 8 },
          { hits: 5, steps: 8 },
          { hits: 7, steps: 16 },
          { hits: 5, steps: 12 },
          { hits: 9, steps: 16 }
        ];
        validPatterns.forEach(({ hits, steps }) => {
          expect(() => InputValidator.validateEuclidean(hits, steps)).not.toThrow();
        });
      });

      test('should accept single hit', () => {
        expect(() => InputValidator.validateEuclidean(1, 16)).not.toThrow();
      });
    });

    describe('invalid inputs', () => {
      test('should throw error when hits exceed steps', () => {
        expect(() => InputValidator.validateEuclidean(10, 8))
          .toThrow('Hits (10) cannot exceed steps (8)');
      });

      test('should throw error when hits exceed steps by 1', () => {
        expect(() => InputValidator.validateEuclidean(9, 8))
          .toThrow('Hits (9) cannot exceed steps (8)');
      });

      test('should throw error for negative hits', () => {
        expect(() => InputValidator.validateEuclidean(-1, 8))
          .toThrow('Hits must be a non-negative integer');
      });

      test('should throw error for negative steps', () => {
        expect(() => InputValidator.validateEuclidean(3, -8))
          .toThrow('Steps must be a positive integer');
      });

      test('should throw error for zero steps', () => {
        expect(() => InputValidator.validateEuclidean(0, 0))
          .toThrow('Steps must be a positive integer');
      });

      test('should throw error for decimal hits', () => {
        expect(() => InputValidator.validateEuclidean(3.5, 8))
          .toThrow('Hits must be an integer');
      });

      test('should throw error for decimal steps', () => {
        expect(() => InputValidator.validateEuclidean(3, 8.5))
          .toThrow('Steps must be an integer');
      });

      test('should throw error for NaN hits', () => {
        expect(() => InputValidator.validateEuclidean(NaN, 8))
          .toThrow('Hits must be a valid number');
      });

      test('should throw error for NaN steps', () => {
        expect(() => InputValidator.validateEuclidean(3, NaN))
          .toThrow('Steps must be a valid number');
      });

      test('should throw error for excessively large values', () => {
        expect(() => InputValidator.validateEuclidean(1000, 10000))
          .toThrow('Steps cannot exceed 256');
      });
    });

    describe('type validation', () => {
      test('should throw error for string hits', () => {
        expect(() => InputValidator.validateEuclidean('3' as any, 8))
          .toThrow('Hits must be a number');
      });

      test('should throw error for string steps', () => {
        expect(() => InputValidator.validateEuclidean(3, '8' as any))
          .toThrow('Steps must be a number');
      });

      test('should throw error for null hits', () => {
        expect(() => InputValidator.validateEuclidean(null as any, 8))
          .toThrow('Hits must be a number');
      });

      test('should throw error for undefined steps', () => {
        expect(() => InputValidator.validateEuclidean(3, undefined as any))
          .toThrow('Steps must be a number');
      });

      test('should throw error for object inputs', () => {
        expect(() => InputValidator.validateEuclidean({} as any, 8))
          .toThrow('Hits must be a number');
      });
    });
  });

  describe('validateScaleName', () => {
    describe('valid inputs', () => {
      test('should accept standard major scale', () => {
        expect(() => InputValidator.validateScaleName('major')).not.toThrow();
      });

      test('should accept standard minor scale', () => {
        expect(() => InputValidator.validateScaleName('minor')).not.toThrow();
      });

      test('should accept all modal scales', () => {
        const modes = ['dorian', 'phrygian', 'lydian', 'mixolydian', 'aeolian', 'locrian'];
        modes.forEach(mode => {
          expect(() => InputValidator.validateScaleName(mode)).not.toThrow();
        });
      });

      test('should accept pentatonic scale', () => {
        expect(() => InputValidator.validateScaleName('pentatonic')).not.toThrow();
      });

      test('should accept blues scale', () => {
        expect(() => InputValidator.validateScaleName('blues')).not.toThrow();
      });

      test('should accept chromatic scale', () => {
        expect(() => InputValidator.validateScaleName('chromatic')).not.toThrow();
      });

      test('should accept wholetone scale', () => {
        expect(() => InputValidator.validateScaleName('wholetone')).not.toThrow();
      });

      test('should accept harmonic_minor scale', () => {
        expect(() => InputValidator.validateScaleName('harmonic_minor')).not.toThrow();
      });

      test('should accept melodic_minor scale', () => {
        expect(() => InputValidator.validateScaleName('melodic_minor')).not.toThrow();
      });
    });

    describe('invalid inputs', () => {
      test('should throw error for invalid scale name', () => {
        expect(() => InputValidator.validateScaleName('invalid'))
          .toThrow('Invalid scale name: invalid');
      });

      test('should throw error for misspelled scale', () => {
        expect(() => InputValidator.validateScaleName('majer'))
          .toThrow('Invalid scale name: majer');
      });

      test('should throw error for empty string', () => {
        expect(() => InputValidator.validateScaleName(''))
          .toThrow('Scale name cannot be empty');
      });

      test('should throw error for case-sensitive mismatch', () => {
        expect(() => InputValidator.validateScaleName('Major'))
          .toThrow('Invalid scale name: Major');
      });

      test('should throw error for whitespace-only string', () => {
        expect(() => InputValidator.validateScaleName('   '))
          .toThrow('Scale name cannot be empty');
      });
    });

    describe('type validation', () => {
      test('should throw error for number input', () => {
        expect(() => InputValidator.validateScaleName(123 as any))
          .toThrow('Scale name must be a string');
      });

      test('should throw error for null', () => {
        expect(() => InputValidator.validateScaleName(null as any))
          .toThrow('Scale name must be a string');
      });

      test('should throw error for undefined', () => {
        expect(() => InputValidator.validateScaleName(undefined as any))
          .toThrow('Scale name must be a string');
      });

      test('should throw error for object', () => {
        expect(() => InputValidator.validateScaleName({} as any))
          .toThrow('Scale name must be a string');
      });

      test('should throw error for array', () => {
        expect(() => InputValidator.validateScaleName(['major'] as any))
          .toThrow('Scale name must be a string');
      });
    });

    describe('string length validation', () => {
      test('should accept reasonable scale name lengths', () => {
        expect(() => InputValidator.validateScaleName('harmonic_minor')).not.toThrow();
      });

      test('should throw error for excessively long scale names', () => {
        const longName = 'a'.repeat(101);
        expect(() => InputValidator.validateScaleName(longName))
          .toThrow('Scale name too long (max 100 characters)');
      });

      test('should accept scale names at exactly 100 characters', () => {
        const maxName = 'a'.repeat(100);
        expect(() => InputValidator.validateScaleName(maxName))
          .toThrow('Invalid scale name'); // Will fail because it's not a valid scale, but won't fail length check
      });
    });
  });

  describe('validateChordStyle', () => {
    describe('valid inputs', () => {
      test('should accept pop style', () => {
        expect(() => InputValidator.validateChordStyle('pop')).not.toThrow();
      });

      test('should accept jazz style', () => {
        expect(() => InputValidator.validateChordStyle('jazz')).not.toThrow();
      });

      test('should accept blues style', () => {
        expect(() => InputValidator.validateChordStyle('blues')).not.toThrow();
      });

      test('should accept all valid chord styles', () => {
        const validStyles = ['pop', 'jazz', 'blues', 'folk', 'rock', 'classical', 'modal', 'edm'];
        validStyles.forEach(style => {
          expect(() => InputValidator.validateChordStyle(style)).not.toThrow();
        });
      });
    });

    describe('invalid inputs', () => {
      test('should throw error for invalid chord style', () => {
        expect(() => InputValidator.validateChordStyle('invalid'))
          .toThrow('Invalid chord style: invalid');
      });

      test('should throw error for misspelled style', () => {
        expect(() => InputValidator.validateChordStyle('jaz'))
          .toThrow('Invalid chord style: jaz');
      });

      test('should throw error for empty string', () => {
        expect(() => InputValidator.validateChordStyle(''))
          .toThrow('Chord style cannot be empty');
      });

      test('should throw error for case-sensitive mismatch', () => {
        expect(() => InputValidator.validateChordStyle('Pop'))
          .toThrow('Invalid chord style: Pop');
      });

      test('should throw error for whitespace-only string', () => {
        expect(() => InputValidator.validateChordStyle('   '))
          .toThrow('Chord style cannot be empty');
      });
    });

    describe('type validation', () => {
      test('should throw error for number input', () => {
        expect(() => InputValidator.validateChordStyle(123 as any))
          .toThrow('Chord style must be a string');
      });

      test('should throw error for null', () => {
        expect(() => InputValidator.validateChordStyle(null as any))
          .toThrow('Chord style must be a string');
      });

      test('should throw error for undefined', () => {
        expect(() => InputValidator.validateChordStyle(undefined as any))
          .toThrow('Chord style must be a string');
      });

      test('should throw error for object', () => {
        expect(() => InputValidator.validateChordStyle({} as any))
          .toThrow('Chord style must be a string');
      });

      test('should throw error for boolean', () => {
        expect(() => InputValidator.validateChordStyle(false as any))
          .toThrow('Chord style must be a string');
      });
    });

    describe('string length validation', () => {
      test('should throw error for excessively long chord styles', () => {
        const longStyle = 'a'.repeat(101);
        expect(() => InputValidator.validateChordStyle(longStyle))
          .toThrow('Chord style too long (max 100 characters)');
      });
    });
  });

  describe('validateRootNote', () => {
    describe('valid inputs', () => {
      test('should accept all natural notes', () => {
        const naturalNotes = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
        naturalNotes.forEach(note => {
          expect(() => InputValidator.validateRootNote(note)).not.toThrow();
        });
      });

      test('should accept all sharp notes', () => {
        const sharpNotes = ['C#', 'D#', 'F#', 'G#', 'A#'];
        sharpNotes.forEach(note => {
          expect(() => InputValidator.validateRootNote(note)).not.toThrow();
        });
      });

      test('should accept lowercase notes (with normalization)', () => {
        expect(() => InputValidator.validateRootNote('c')).not.toThrow();
        expect(() => InputValidator.validateRootNote('f#')).not.toThrow();
      });
    });

    describe('invalid inputs', () => {
      test('should throw error for invalid note name', () => {
        expect(() => InputValidator.validateRootNote('X'))
          .toThrow('Invalid root note: X');
      });

      test('should throw error for note with flat (not supported)', () => {
        expect(() => InputValidator.validateRootNote('Db'))
          .toThrow('Invalid root note: Db');
      });

      test('should throw error for empty string', () => {
        expect(() => InputValidator.validateRootNote(''))
          .toThrow('Root note cannot be empty');
      });

      test('should throw error for multi-character invalid notes', () => {
        expect(() => InputValidator.validateRootNote('C##'))
          .toThrow('Invalid root note: C##');
      });

      test('should throw error for numbers', () => {
        expect(() => InputValidator.validateRootNote('1'))
          .toThrow('Invalid root note: 1');
      });
    });

    describe('type validation', () => {
      test('should throw error for number input', () => {
        expect(() => InputValidator.validateRootNote(123 as any))
          .toThrow('Root note must be a string');
      });

      test('should throw error for null', () => {
        expect(() => InputValidator.validateRootNote(null as any))
          .toThrow('Root note must be a string');
      });

      test('should throw error for undefined', () => {
        expect(() => InputValidator.validateRootNote(undefined as any))
          .toThrow('Root note must be a string');
      });
    });
  });

  describe('validateStringLength', () => {
    describe('valid inputs', () => {
      test('should accept string within default limit (1000)', () => {
        const validString = 'a'.repeat(500);
        expect(() => InputValidator.validateStringLength(validString, 'test')).not.toThrow();
      });

      test('should accept string at exact max length', () => {
        const validString = 'a'.repeat(1000);
        expect(() => InputValidator.validateStringLength(validString, 'test')).not.toThrow();
      });

      test('should accept empty string', () => {
        expect(() => InputValidator.validateStringLength('', 'test')).not.toThrow();
      });

      test('should accept string with custom limit', () => {
        const validString = 'a'.repeat(50);
        expect(() => InputValidator.validateStringLength(validString, 'test', 100)).not.toThrow();
      });
    });

    describe('invalid inputs', () => {
      test('should throw error for string exceeding default limit', () => {
        const longString = 'a'.repeat(1001);
        expect(() => InputValidator.validateStringLength(longString, 'test'))
          .toThrow('test too long (max 1000 UTF-16 code units, got 1001)');
      });

      test('should throw error for string exceeding custom limit', () => {
        const longString = 'a'.repeat(101);
        expect(() => InputValidator.validateStringLength(longString, 'test', 100))
          .toThrow('test too long (max 100 UTF-16 code units, got 101)');
      });

      test('should provide correct field name in error', () => {
        const longString = 'a'.repeat(1001);
        expect(() => InputValidator.validateStringLength(longString, 'pattern_code'))
          .toThrow('pattern_code too long');
      });
    });

    describe('type validation', () => {
      test('should throw error for non-string input', () => {
        expect(() => InputValidator.validateStringLength(123 as any, 'test'))
          .toThrow('test must be a string');
      });

      test('should throw error for null', () => {
        expect(() => InputValidator.validateStringLength(null as any, 'test'))
          .toThrow('test must be a string');
      });

      test('should throw error for undefined', () => {
        expect(() => InputValidator.validateStringLength(undefined as any, 'test'))
          .toThrow('test must be a string');
      });

      test('should throw error for object', () => {
        expect(() => InputValidator.validateStringLength({} as any, 'test'))
          .toThrow('test must be a string');
      });
    });
  });

  describe('validatePositiveInteger', () => {
    describe('valid inputs', () => {
      test('should accept positive integers', () => {
        expect(() => InputValidator.validatePositiveInteger(1, 'test')).not.toThrow();
        expect(() => InputValidator.validatePositiveInteger(100, 'test')).not.toThrow();
        expect(() => InputValidator.validatePositiveInteger(1000, 'test')).not.toThrow();
      });
    });

    describe('invalid inputs', () => {
      test('should throw error for zero', () => {
        expect(() => InputValidator.validatePositiveInteger(0, 'test'))
          .toThrow('test must be a positive integer');
      });

      test('should throw error for negative numbers', () => {
        expect(() => InputValidator.validatePositiveInteger(-1, 'test'))
          .toThrow('test must be a positive integer');
      });

      test('should throw error for decimal numbers', () => {
        expect(() => InputValidator.validatePositiveInteger(1.5, 'test'))
          .toThrow('test must be an integer');
      });

      test('should throw error for NaN', () => {
        expect(() => InputValidator.validatePositiveInteger(NaN, 'test'))
          .toThrow('test must be a valid number');
      });

      test('should throw error for Infinity', () => {
        expect(() => InputValidator.validatePositiveInteger(Infinity, 'test'))
          .toThrow('test must be a valid number');
      });
    });

    describe('type validation', () => {
      test('should throw error for string input', () => {
        expect(() => InputValidator.validatePositiveInteger('5' as any, 'test'))
          .toThrow('test must be a number');
      });

      test('should throw error for null', () => {
        expect(() => InputValidator.validatePositiveInteger(null as any, 'test'))
          .toThrow('test must be a number');
      });

      test('should throw error for undefined', () => {
        expect(() => InputValidator.validatePositiveInteger(undefined as any, 'test'))
          .toThrow('test must be a number');
      });
    });
  });

  describe('integration tests', () => {
    test('should validate complete music generation parameters', () => {
      expect(() => {
        InputValidator.validateBPM(120);
        InputValidator.validateRootNote('C');
        InputValidator.validateScaleName('major');
        InputValidator.validateChordStyle('pop');
      }).not.toThrow();
    });

    test('should validate Euclidean rhythm generation parameters', () => {
      expect(() => {
        InputValidator.validateEuclidean(5, 8);
        InputValidator.validateBPM(140);
      }).not.toThrow();
    });

    test('should validate complete pattern with all parameters', () => {
      expect(() => {
        InputValidator.validateStringLength('s("bd*4")', 'pattern');
        InputValidator.validateBPM(128);
        InputValidator.validateGain(0.8);
      }).not.toThrow();
    });

    test('should catch multiple validation errors independently', () => {
      expect(() => InputValidator.validateBPM(500)).toThrow();
      expect(() => InputValidator.validateGain(3.0)).toThrow();
      expect(() => InputValidator.validateEuclidean(10, 5)).toThrow();
      expect(() => InputValidator.validateScaleName('invalid')).toThrow();
      expect(() => InputValidator.validateChordStyle('invalid')).toThrow();
    });
  });

  describe('edge cases', () => {
    test('should handle boundary conditions correctly', () => {
      // BPM boundaries
      expect(() => InputValidator.validateBPM(19.999)).toThrow();
      expect(() => InputValidator.validateBPM(20.001)).not.toThrow();
      expect(() => InputValidator.validateBPM(299.999)).not.toThrow();
      expect(() => InputValidator.validateBPM(300.001)).toThrow();

      // Gain boundaries
      expect(() => InputValidator.validateGain(-0.001)).toThrow();
      expect(() => InputValidator.validateGain(0.001)).not.toThrow();
      expect(() => InputValidator.validateGain(1.999)).not.toThrow();
      expect(() => InputValidator.validateGain(2.001)).toThrow();
    });

    test('should handle floating point precision', () => {
      expect(() => InputValidator.validateBPM(120.000001)).not.toThrow();
      expect(() => InputValidator.validateGain(1.000001)).not.toThrow();
    });

    test('should handle very small numbers', () => {
      expect(() => InputValidator.validateGain(0.0001)).not.toThrow();
      expect(() => InputValidator.validateGain(Number.MIN_VALUE)).not.toThrow();
    });

    test('should handle unicode characters in string validation', () => {
      const unicodeString = '音楽パターン';
      expect(() => InputValidator.validateStringLength(unicodeString, 'test', 20)).not.toThrow();
    });

    test('should handle special characters in scale/chord validation', () => {
      expect(() => InputValidator.validateScaleName('major!')).toThrow();
      expect(() => InputValidator.validateChordStyle('pop?')).toThrow();
    });
  });
});
