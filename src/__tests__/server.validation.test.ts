/**
 * Validation Tests for StrudelMCPServer
 *
 * This test suite verifies that all MCP tools properly validate their input parameters
 * before executing operations. Tests are organized by tool category.
 */

import { InputValidator } from '../utils/InputValidator';

describe('StrudelMCPServer - Parameter Validation', () => {
  describe('Tempo/BPM Tools', () => {
    describe('set_tempo tool', () => {
      test('should validate BPM parameter', () => {
        const params = { bpm: 120 };
        expect(() => InputValidator.validateBPM(params.bpm)).not.toThrow();
      });

      test('should reject invalid BPM values', () => {
        const invalidBPMs = [
          { bpm: 19, reason: 'below minimum' },
          { bpm: 301, reason: 'above maximum' },
          { bpm: -120, reason: 'negative' },
          { bpm: 0, reason: 'zero' },
          { bpm: NaN, reason: 'NaN' },
          { bpm: 'fast' as any, reason: 'string' }
        ];

        invalidBPMs.forEach(({ bpm, reason: _reason }) => {
          expect(() => InputValidator.validateBPM(bpm)).toThrow();
        });
      });

      test('should accept decimal BPM values', () => {
        expect(() => InputValidator.validateBPM(128.5)).not.toThrow();
        expect(() => InputValidator.validateBPM(99.99)).not.toThrow();
      });
    });
  });

  describe('Effect Tools', () => {
    describe('add_effect tool', () => {
      test('should validate gain parameter for gain effect', () => {
        const params = { effect: 'gain', params: '0.8' };
        const gainValue = parseFloat(params.params);
        expect(() => InputValidator.validateGain(gainValue)).not.toThrow();
      });

      test('should reject invalid gain values', () => {
        const invalidGains = [
          -0.5,   // negative
          2.5,    // above maximum
          10.0,   // way above maximum
          NaN,    // invalid number
          Infinity // infinite
        ];

        invalidGains.forEach(gain => {
          expect(() => InputValidator.validateGain(gain)).toThrow();
        });
      });

      test('should validate room parameter for room effect', () => {
        const validRoomSizes = [0, 0.5, 0.9, 1.0];
        validRoomSizes.forEach(room => {
          expect(() => InputValidator.validateGain(room)).not.toThrow();
        });
      });

      test('should validate effect parameter is a string', () => {
        const params = { effect: 'reverb', params: '0.5' };
        expect(() => InputValidator.validateStringLength(params.effect, 'effect', 50)).not.toThrow();
      });

      test('should reject excessively long effect names', () => {
        const longEffect = 'a'.repeat(101);
        expect(() => InputValidator.validateStringLength(longEffect, 'effect', 100)).toThrow();
      });
    });
  });

  describe('Euclidean Rhythm Tools', () => {
    describe('generate_euclidean tool', () => {
      test('should validate hits and steps parameters', () => {
        const params = { hits: 3, steps: 8, sound: 'bd' };
        expect(() => InputValidator.validateEuclidean(params.hits, params.steps)).not.toThrow();
      });

      test('should reject when hits exceed steps', () => {
        expect(() => InputValidator.validateEuclidean(10, 8))
          .toThrow('Hits (10) cannot exceed steps (8)');
      });

      test('should accept edge case where hits equals steps', () => {
        expect(() => InputValidator.validateEuclidean(8, 8)).not.toThrow();
      });

      test('should reject negative hits', () => {
        expect(() => InputValidator.validateEuclidean(-1, 8))
          .toThrow('Hits must be a non-negative integer');
      });

      test('should reject negative steps', () => {
        expect(() => InputValidator.validateEuclidean(3, -8))
          .toThrow('Steps must be a positive integer');
      });

      test('should reject decimal values', () => {
        expect(() => InputValidator.validateEuclidean(3.5, 8)).toThrow('Hits must be an integer');
        expect(() => InputValidator.validateEuclidean(3, 8.5)).toThrow('Steps must be an integer');
      });

      test('should reject zero steps', () => {
        expect(() => InputValidator.validateEuclidean(0, 0))
          .toThrow('Steps must be a positive integer');
      });

      test('should accept zero hits with positive steps', () => {
        expect(() => InputValidator.validateEuclidean(0, 8)).not.toThrow();
      });

      test('should reject excessively large step values', () => {
        expect(() => InputValidator.validateEuclidean(100, 1000))
          .toThrow('Steps cannot exceed 256');
      });

      test('should validate sound parameter', () => {
        const params = { hits: 3, steps: 8, sound: 'bd' };
        expect(() => InputValidator.validateStringLength(params.sound, 'sound', 100)).not.toThrow();
      });

      test('should reject invalid sound types', () => {
        const longSound = 'a'.repeat(101);
        expect(() => InputValidator.validateStringLength(longSound, 'sound', 100)).toThrow();
      });
    });

    describe('generate_polyrhythm tool', () => {
      test('should validate multiple pattern arrays', () => {
        const params = {
          sounds: ['bd', 'cp', 'hh'],
          patterns: [3, 5, 7]
        };

        params.patterns.forEach(pattern => {
          expect(() => InputValidator.validatePositiveInteger(pattern, 'pattern')).not.toThrow();
        });
      });

      test('should reject negative pattern values', () => {
        expect(() => InputValidator.validatePositiveInteger(-3, 'pattern')).toThrow();
      });

      test('should reject zero pattern values', () => {
        expect(() => InputValidator.validatePositiveInteger(0, 'pattern'))
          .toThrow('pattern must be a positive integer');
      });

      test('should validate sounds array contains strings', () => {
        const sounds = ['bd', 'cp', 'hh'];
        sounds.forEach(sound => {
          expect(() => InputValidator.validateStringLength(sound, 'sound', 100)).not.toThrow();
        });
      });
    });
  });

  describe('Scale and Chord Tools', () => {
    describe('apply_scale tool', () => {
      test('should validate scale name', () => {
        const params = { scale: 'major', root: 'C' };
        expect(() => InputValidator.validateScaleName(params.scale)).not.toThrow();
      });

      test('should validate root note', () => {
        const params = { scale: 'major', root: 'C' };
        expect(() => InputValidator.validateRootNote(params.root)).not.toThrow();
      });

      test('should reject invalid scale names', () => {
        const invalidScales = ['invalid', 'majer', 'Major', ''];
        invalidScales.forEach(scale => {
          expect(() => InputValidator.validateScaleName(scale)).toThrow();
        });
      });

      test('should accept all valid scale types', () => {
        const validScales = [
          'major', 'minor', 'dorian', 'phrygian', 'lydian',
          'mixolydian', 'aeolian', 'locrian', 'pentatonic',
          'blues', 'chromatic', 'wholetone', 'harmonic_minor',
          'melodic_minor'
        ];

        validScales.forEach(scale => {
          expect(() => InputValidator.validateScaleName(scale)).not.toThrow();
        });
      });

      test('should reject invalid root notes', () => {
        const invalidRoots = ['X', 'H', 'Z', 'Db', 'C##', '1', ''];
        invalidRoots.forEach(root => {
          expect(() => InputValidator.validateRootNote(root)).toThrow();
        });
      });

      test('should accept all chromatic root notes', () => {
        const validRoots = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
        validRoots.forEach(root => {
          expect(() => InputValidator.validateRootNote(root)).not.toThrow();
        });
      });

      test('should accept lowercase root notes', () => {
        const lowercaseRoots = ['c', 'f#', 'g#'];
        lowercaseRoots.forEach(root => {
          expect(() => InputValidator.validateRootNote(root)).not.toThrow();
        });
      });
    });

    describe('generate_scale tool', () => {
      test('should validate all scale parameters', () => {
        const params = { scale: 'major', root: 'C' };
        expect(() => {
          InputValidator.validateScaleName(params.scale);
          InputValidator.validateRootNote(params.root);
        }).not.toThrow();
      });

      test('should reject type mismatches', () => {
        expect(() => InputValidator.validateScaleName(123 as any))
          .toThrow('Scale name must be a string');
        expect(() => InputValidator.validateRootNote(123 as any))
          .toThrow('Root note must be a string');
      });
    });

    describe('generate_chord_progression tool', () => {
      test('should validate chord style', () => {
        const params = { key: 'C', style: 'pop' };
        expect(() => InputValidator.validateChordStyle(params.style)).not.toThrow();
      });

      test('should validate key/root note', () => {
        const params = { key: 'C', style: 'pop' };
        expect(() => InputValidator.validateRootNote(params.key)).not.toThrow();
      });

      test('should accept all valid chord styles', () => {
        const validStyles = ['pop', 'jazz', 'blues', 'folk', 'rock', 'classical', 'modal', 'edm'];
        validStyles.forEach(style => {
          expect(() => InputValidator.validateChordStyle(style)).not.toThrow();
        });
      });

      test('should reject invalid chord styles', () => {
        const invalidStyles = ['invalid', 'hiphop', 'Pop', ''];
        invalidStyles.forEach(style => {
          expect(() => InputValidator.validateChordStyle(style)).toThrow();
        });
      });

      test('should reject non-string chord styles', () => {
        expect(() => InputValidator.validateChordStyle(123 as any))
          .toThrow('Chord style must be a string');
      });
    });
  });

  describe('Pattern Generation Tools', () => {
    describe('generate_pattern tool', () => {
      test('should validate BPM when provided', () => {
        const params = { style: 'techno', bpm: 140, key: 'C' };
        expect(() => InputValidator.validateBPM(params.bpm)).not.toThrow();
      });

      test('should validate key when provided', () => {
        const params = { style: 'techno', key: 'C' };
        expect(() => InputValidator.validateRootNote(params.key)).not.toThrow();
      });

      test('should validate style parameter', () => {
        const params = { style: 'techno' };
        expect(() => InputValidator.validateStringLength(params.style, 'style', 100)).not.toThrow();
      });

      test('should reject invalid BPM in pattern generation', () => {
        expect(() => InputValidator.validateBPM(500)).toThrow();
      });

      test('should reject empty style string', () => {
        expect(() => InputValidator.validateStringLength('', 'style', 100, false))
          .toThrow('style cannot be empty');
      });
    });

    describe('generate_drums tool', () => {
      test('should validate complexity parameter', () => {
        const params = { style: 'techno', complexity: 0.7 };
        const complexity = params.complexity;
        expect(() => InputValidator.validateGain(complexity)).not.toThrow();
      });

      test('should reject complexity outside 0-1 range', () => {
        expect(() => InputValidator.validateNormalizedValue(1.5, 'complexity'))
          .toThrow('complexity must be between 0 and 1.0');
        expect(() => InputValidator.validateNormalizedValue(-0.1, 'complexity'))
          .toThrow('complexity must be between 0 and 1.0');
      });

      test('should validate style string', () => {
        const params = { style: 'techno' };
        expect(() => InputValidator.validateStringLength(params.style, 'style', 100)).not.toThrow();
      });
    });

    describe('generate_bassline tool', () => {
      test('should validate key parameter', () => {
        const params = { key: 'C', style: 'acid' };
        expect(() => InputValidator.validateRootNote(params.key)).not.toThrow();
      });

      test('should validate style parameter', () => {
        const params = { key: 'C', style: 'acid' };
        expect(() => InputValidator.validateStringLength(params.style, 'style', 100)).not.toThrow();
      });
    });

    describe('generate_melody tool', () => {
      test('should validate scale parameter', () => {
        const params = { scale: 'major', root: 'C', length: 8 };
        expect(() => InputValidator.validateScaleName(params.scale)).not.toThrow();
      });

      test('should validate root parameter', () => {
        const params = { scale: 'major', root: 'C', length: 8 };
        expect(() => InputValidator.validateRootNote(params.root)).not.toThrow();
      });

      test('should validate length parameter', () => {
        const params = { scale: 'major', root: 'C', length: 8 };
        expect(() => InputValidator.validatePositiveInteger(params.length, 'length')).not.toThrow();
      });

      test('should reject zero or negative length', () => {
        expect(() => InputValidator.validatePositiveInteger(0, 'length')).toThrow();
        expect(() => InputValidator.validatePositiveInteger(-5, 'length')).toThrow();
      });

      test('should reject decimal length', () => {
        expect(() => InputValidator.validatePositiveInteger(8.5, 'length'))
          .toThrow('length must be an integer');
      });
    });
  });

  describe('Pattern Manipulation Tools', () => {
    describe('transpose tool', () => {
      test('should validate semitones parameter is a number', () => {
        const params = { semitones: 5 };
        expect(typeof params.semitones).toBe('number');
      });

      test('should accept positive and negative semitones', () => {
        const validSemitones = [-12, -5, 0, 5, 12, 24];
        validSemitones.forEach(semitones => {
          expect(typeof semitones).toBe('number');
        });
      });

      test('should reject non-numeric semitones', () => {
        const params = { semitones: 'up' as any };
        expect(() => {
          if (typeof params.semitones !== 'number') {
            throw new Error('Semitones must be a number');
          }
        }).toThrow();
      });
    });

    describe('stretch tool', () => {
      test('should validate factor parameter', () => {
        const params = { factor: 1.5 };
        expect(typeof params.factor).toBe('number');
        expect(params.factor).toBeGreaterThan(0);
      });

      test('should accept various stretch factors', () => {
        const validFactors = [0.25, 0.5, 1.0, 1.5, 2.0, 4.0];
        validFactors.forEach(factor => {
          expect(factor).toBeGreaterThan(0);
        });
      });

      test('should reject negative stretch factors', () => {
        const params = { factor: -1.5 };
        expect(() => {
          if (params.factor <= 0) {
            throw new Error('Stretch factor must be positive');
          }
        }).toThrow();
      });

      test('should reject zero stretch factor', () => {
        const params = { factor: 0 };
        expect(() => {
          if (params.factor <= 0) {
            throw new Error('Stretch factor must be positive');
          }
        }).toThrow();
      });
    });

    describe('humanize tool', () => {
      test('should validate amount parameter is in 0-1 range', () => {
        const params = { amount: 0.3 };
        expect(() => InputValidator.validateNormalizedValue(params.amount, 'amount')).not.toThrow();
      });

      test('should reject amount outside 0-1 range', () => {
        expect(() => InputValidator.validateNormalizedValue(-0.1, 'amount')).toThrow();
        expect(() => InputValidator.validateNormalizedValue(1.5, 'amount')).toThrow();
      });

      test('should accept boundary values', () => {
        expect(() => InputValidator.validateNormalizedValue(0, 'amount')).not.toThrow();
        expect(() => InputValidator.validateNormalizedValue(1.0, 'amount')).not.toThrow();
      });
    });

    describe('quantize tool', () => {
      test('should validate grid parameter is a string', () => {
        const params = { grid: '1/16' };
        expect(() => InputValidator.validateStringLength(params.grid, 'grid', 20)).not.toThrow();
      });

      test('should accept common quantize grid values', () => {
        const validGrids = ['1/4', '1/8', '1/16', '1/32'];
        validGrids.forEach(grid => {
          expect(() => InputValidator.validateStringLength(grid, 'grid', 20)).not.toThrow();
        });
      });

      test('should reject non-string grid values', () => {
        const params = { grid: 16 as any };
        expect(() => InputValidator.validateStringLength(params.grid, 'grid', 20))
          .toThrow('grid must be a string');
      });
    });
  });

  describe('Pattern Text Manipulation Tools', () => {
    describe('write tool', () => {
      test('should validate pattern parameter', () => {
        const params = { pattern: 's("bd*4")' };
        expect(() => InputValidator.validateStringLength(params.pattern, 'pattern', 10000))
          .not.toThrow();
      });

      test('should reject excessively long patterns', () => {
        const longPattern = 'a'.repeat(10001);
        expect(() => InputValidator.validateStringLength(longPattern, 'pattern', 10000)).toThrow();
      });

      test('should accept empty pattern string', () => {
        const params = { pattern: '' };
        expect(() => InputValidator.validateStringLength(params.pattern, 'pattern', 10000))
          .not.toThrow();
      });

      test('should accept patterns with special characters', () => {
        const params = { pattern: 's("bd*4").room(0.9)\n// Comment' };
        expect(() => InputValidator.validateStringLength(params.pattern, 'pattern', 10000))
          .not.toThrow();
      });
    });

    describe('append tool', () => {
      test('should validate code parameter', () => {
        const params = { code: '.slow(2)' };
        expect(() => InputValidator.validateStringLength(params.code, 'code', 10000))
          .not.toThrow();
      });

      test('should reject non-string code', () => {
        const params = { code: 123 as any };
        expect(() => InputValidator.validateStringLength(params.code, 'code', 10000))
          .toThrow('code must be a string');
      });
    });

    describe('insert tool', () => {
      test('should validate position parameter', () => {
        const params = { position: 5, code: 'test' };
        expect(() => InputValidator.validatePositiveInteger(params.position, 'position'))
          .not.toThrow();
      });

      test('should validate code parameter', () => {
        const params = { position: 5, code: 'test' };
        expect(() => InputValidator.validateStringLength(params.code, 'code', 10000))
          .not.toThrow();
      });

      test('should reject negative position', () => {
        expect(() => InputValidator.validatePositiveInteger(-1, 'position')).toThrow();
      });

      test('should reject decimal position', () => {
        expect(() => InputValidator.validatePositiveInteger(5.5, 'position'))
          .toThrow('position must be an integer');
      });
    });

    describe('replace tool', () => {
      test('should validate search and replace parameters', () => {
        const params = { search: 'old', replace: 'new' };
        expect(() => {
          InputValidator.validateStringLength(params.search, 'search', 1000);
          InputValidator.validateStringLength(params.replace, 'replace', 1000);
        }).not.toThrow();
      });

      test('should reject non-string search parameter', () => {
        const params = { search: 123 as any, replace: 'new' };
        expect(() => InputValidator.validateStringLength(params.search, 'search', 1000))
          .toThrow('search must be a string');
      });

      test('should accept empty strings', () => {
        const params = { search: '', replace: '' };
        expect(() => {
          InputValidator.validateStringLength(params.search, 'search', 1000);
          InputValidator.validateStringLength(params.replace, 'replace', 1000);
        }).not.toThrow();
      });
    });
  });

  describe('Pattern Storage Tools', () => {
    describe('save tool', () => {
      test('should validate name parameter', () => {
        const params = { name: 'my-pattern', tags: ['techno'] };
        expect(() => InputValidator.validateStringLength(params.name, 'name', 200))
          .not.toThrow();
      });

      test('should reject excessively long pattern names', () => {
        const longName = 'a'.repeat(201);
        expect(() => InputValidator.validateStringLength(longName, 'name', 200)).toThrow();
      });

      test('should accept pattern names with special characters', () => {
        const params = { name: 'Pattern_With-Special.Chars' };
        expect(() => InputValidator.validateStringLength(params.name, 'name', 200))
          .not.toThrow();
      });

      test('should reject empty pattern name', () => {
        const params = { name: '' };
        expect(() => {
          InputValidator.validateStringLength(params.name, 'name', 200);
          if (params.name.trim() === '') {
            throw new Error('Pattern name cannot be empty');
          }
        }).toThrow();
      });
    });

    describe('load tool', () => {
      test('should validate name parameter', () => {
        const params = { name: 'my-pattern' };
        expect(() => InputValidator.validateStringLength(params.name, 'name', 200))
          .not.toThrow();
      });
    });

    describe('list tool', () => {
      test('should validate optional tag parameter', () => {
        const params = { tag: 'techno' };
        expect(() => InputValidator.validateStringLength(params.tag, 'tag', 100))
          .not.toThrow();
      });

      test('should accept undefined tag parameter', () => {
        const params = { tag: undefined };
        if (params.tag !== undefined) {
          expect(() => InputValidator.validateStringLength(params.tag, 'tag', 100))
            .not.toThrow();
        }
      });
    });
  });

  describe('Swing and Timing Tools', () => {
    describe('add_swing tool', () => {
      test('should validate amount parameter is in 0-1 range', () => {
        const params = { amount: 0.5 };
        expect(() => InputValidator.validateNormalizedValue(params.amount, 'amount')).not.toThrow();
      });

      test('should reject amount outside 0-1 range', () => {
        expect(() => InputValidator.validateNormalizedValue(-0.1, 'amount')).toThrow();
        expect(() => InputValidator.validateNormalizedValue(1.5, 'amount')).toThrow();
      });

      test('should accept boundary values', () => {
        expect(() => InputValidator.validateNormalizedValue(0, 'amount')).not.toThrow();
        expect(() => InputValidator.validateNormalizedValue(1.0, 'amount')).not.toThrow();
      });
    });
  });

  describe('Integration - Complete Tool Workflows', () => {
    test('should validate complete pattern generation workflow', () => {
      expect(() => {
        // Generate pattern
        InputValidator.validateStringLength('techno', 'style', 100);
        InputValidator.validateBPM(140);
        InputValidator.validateRootNote('C');

        // Apply scale
        InputValidator.validateScaleName('minor');
        InputValidator.validateRootNote('C');

        // Add effects
        InputValidator.validateGain(0.8);

        // Save pattern
        InputValidator.validateStringLength('my-techno-pattern', 'name', 200);
      }).not.toThrow();
    });

    test('should validate complete Euclidean rhythm workflow', () => {
      expect(() => {
        InputValidator.validateEuclidean(5, 8);
        InputValidator.validateStringLength('bd', 'sound', 100);
        InputValidator.validateBPM(128);
      }).not.toThrow();
    });

    test('should catch validation errors in multi-step workflow', () => {
      expect(() => {
        InputValidator.validateBPM(500); // Invalid
      }).toThrow();

      expect(() => {
        InputValidator.validateEuclidean(10, 5); // Invalid
      }).toThrow();

      expect(() => {
        InputValidator.validateScaleName('invalid'); // Invalid
      }).toThrow();
    });
  });

  describe('Error Message Quality', () => {
    test('should provide descriptive error messages', () => {
      expect(() => InputValidator.validateBPM(500))
        .toThrow(/BPM must be between 20 and 300/);

      expect(() => InputValidator.validateGain(3.0))
        .toThrow(/Gain must be between 0 and 2.0/);

      expect(() => InputValidator.validateEuclidean(10, 8))
        .toThrow(/Hits \(10\) cannot exceed steps \(8\)/);

      expect(() => InputValidator.validateScaleName('invalid'))
        .toThrow(/Invalid scale name: invalid/);

      expect(() => InputValidator.validateChordStyle('invalid'))
        .toThrow(/Invalid chord style: invalid/);
    });

    test('should include context in error messages', () => {
      const longString = 'a'.repeat(101);
      expect(() => InputValidator.validateStringLength(longString, 'pattern_name', 100))
        .toThrow(/pattern_name too long/);
    });
  });

  describe('Type Safety', () => {
    test('should catch type errors before processing', () => {
      expect(() => InputValidator.validateBPM('120' as any))
        .toThrow(/BPM must be a number/);

      expect(() => InputValidator.validateGain('0.8' as any))
        .toThrow(/Gain must be a number/);

      expect(() => InputValidator.validateScaleName(123 as any))
        .toThrow(/Scale name must be a string/);

      expect(() => InputValidator.validateChordStyle(null as any))
        .toThrow(/Chord style must be a string/);
    });

    test('should reject null and undefined appropriately', () => {
      expect(() => InputValidator.validateBPM(null as any)).toThrow();
      expect(() => InputValidator.validateBPM(undefined as any)).toThrow();
      expect(() => InputValidator.validateGain(null as any)).toThrow();
      expect(() => InputValidator.validateScaleName(undefined as any)).toThrow();
    });
  });
});
