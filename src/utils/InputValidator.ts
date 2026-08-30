/**
 * InputValidator - Comprehensive parameter validation for Strudel MCP Server
 *
 * Provides robust validation for all user inputs to prevent:
 * - Invalid musical parameters (BPM, gain, etc.)
 * - Speaker damage from excessive gain values
 * - Mathematically invalid patterns (e.g., Euclidean rhythms)
 * - Security issues from malformed inputs
 *
 * All methods throw descriptive errors for invalid inputs.
 */
export class InputValidator {
  // Valid scale names from MusicTheory service
  private static readonly VALID_SCALES = [
    'major', 'minor', 'dorian', 'phrygian', 'lydian', 'mixolydian',
    'aeolian', 'locrian', 'pentatonic', 'blues', 'chromatic',
    'wholetone', 'harmonic_minor', 'melodic_minor'
  ];

  // Valid chord progression styles from MusicTheory service
  private static readonly VALID_CHORD_STYLES = [
    'pop', 'jazz', 'blues', 'folk', 'rock', 'classical', 'modal', 'edm'
  ];

  // Valid root notes (12-tone chromatic scale)
  private static readonly VALID_ROOT_NOTES = [
    'C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'
  ];

  /**
   * Validates BPM (Beats Per Minute) is within acceptable range
   *
   * @param bpm - Tempo in beats per minute
   * @throws {Error} When BPM is not a number, not finite, or outside 20-300 range
   *
   * @example
   * InputValidator.validateBPM(120); // ✓ Valid
   * InputValidator.validateBPM(19);  // ✗ Throws: BPM must be between 20 and 300
   */
  static validateBPM(bpm: number): void {
    if (typeof bpm !== 'number') {
      throw new Error('BPM must be a number');
    }

    if (isNaN(bpm) || !isFinite(bpm)) {
      throw new Error('BPM must be a valid number');
    }

    if (bpm < 20 || bpm > 300) {
      throw new Error(`BPM must be between 20 and 300, got ${bpm}`);
    }
  }

  /**
   * Validates gain is within safe range to prevent speaker damage
   *
   * @param gain - Audio gain multiplier (0 = silence, 1 = unity, 2 = max safe)
   * @throws {Error} When gain is not a number, not finite, or outside 0-2.0 range
   *
   * @example
   * InputValidator.validateGain(1.0);  // ✓ Valid (unity gain)
   * InputValidator.validateGain(10);   // ✗ Throws: Gain must be between 0 and 2.0
   */
  static validateGain(gain: number): void {
    if (typeof gain !== 'number') {
      throw new Error('Gain must be a number');
    }

    if (isNaN(gain) || !isFinite(gain)) {
      throw new Error('Gain must be a valid number');
    }

    if (gain < 0 || gain > 2.0) {
      throw new Error(`Gain must be between 0 and 2.0, got ${gain}`);
    }
  }

  /**
   * Validates Euclidean rhythm parameters are mathematically valid
   *
   * Euclidean rhythms distribute hits evenly across steps.
   * Example: 3 hits in 8 steps = "X..X..X." pattern
   *
   * @param hits - Number of beats/hits (must be <= steps)
   * @param steps - Total number of steps in the pattern
   * @throws {Error} When hits > steps or parameters are not valid integers
   *
   * @example
   * InputValidator.validateEuclidean(3, 8);   // ✓ Valid
   * InputValidator.validateEuclidean(10, 8);  // ✗ Throws: Hits cannot exceed steps
   */
  static validateEuclidean(hits: number, steps: number): void {
    // Validate hits
    if (typeof hits !== 'number') {
      throw new Error('Hits must be a number');
    }

    if (isNaN(hits) || !isFinite(hits)) {
      throw new Error('Hits must be a valid number');
    }

    if (!Number.isInteger(hits)) {
      throw new Error('Hits must be an integer');
    }

    if (hits < 0) {
      throw new Error('Hits must be a non-negative integer');
    }

    // Validate steps
    if (typeof steps !== 'number') {
      throw new Error('Steps must be a number');
    }

    if (isNaN(steps) || !isFinite(steps)) {
      throw new Error('Steps must be a valid number');
    }

    if (!Number.isInteger(steps)) {
      throw new Error('Steps must be an integer');
    }

    if (steps <= 0) {
      throw new Error('Steps must be a positive integer');
    }

    if (steps > 256) {
      throw new Error(`Steps cannot exceed 256, got ${steps}`);
    }

    // Validate relationship
    if (hits > steps) {
      throw new Error(`Hits (${hits}) cannot exceed steps (${steps})`);
    }
  }

  /**
   * Validates musical scale name is supported by MusicTheory service
   *
   * @param name - Scale name (must be lowercase)
   * @throws {Error} When scale name is invalid or not a string
   *
   * Supported scales:
   * - major, minor, pentatonic, blues
   * - Modes: dorian, phrygian, lydian, mixolydian, aeolian, locrian
   * - Special: chromatic, wholetone, harmonic_minor, melodic_minor
   *
   * @example
   * InputValidator.validateScaleName('major');   // ✓ Valid
   * InputValidator.validateScaleName('Major');   // ✗ Throws: Invalid scale (case-sensitive)
   */
  static validateScaleName(name: string): void {
    if (typeof name !== 'string') {
      throw new Error('Scale name must be a string');
    }

    const trimmed = name.trim();
    if (trimmed.length === 0) {
      throw new Error('Scale name cannot be empty');
    }

    if (trimmed.length > 100) {
      throw new Error('Scale name too long (max 100 characters)');
    }

    if (!this.VALID_SCALES.includes(trimmed)) {
      throw new Error(`Invalid scale name: ${name}`);
    }
  }

  /**
   * Validates chord progression style is supported by MusicTheory service
   *
   * @param style - Chord style (must be lowercase)
   * @throws {Error} When chord style is invalid or not a string
   *
   * Supported styles: pop, jazz, blues, folk, rock, classical, modal, edm
   *
   * @example
   * InputValidator.validateChordStyle('jazz');   // ✓ Valid
   * InputValidator.validateChordStyle('Jazz');   // ✗ Throws: Invalid chord style
   */
  static validateChordStyle(style: string): void {
    if (typeof style !== 'string') {
      throw new Error('Chord style must be a string');
    }

    const trimmed = style.trim();
    if (trimmed.length === 0) {
      throw new Error('Chord style cannot be empty');
    }

    if (trimmed.length > 100) {
      throw new Error('Chord style too long (max 100 characters)');
    }

    if (!this.VALID_CHORD_STYLES.includes(trimmed)) {
      throw new Error(`Invalid chord style: ${style}`);
    }
  }

  /**
   * Validates musical root note is a valid chromatic note
   *
   * @param note - Root note (A-G with optional #, case insensitive)
   * @throws {Error} When note is invalid or not a string
   *
   * Valid notes: C, C#, D, D#, E, F, F#, G, G#, A, A#, B
   *
   * @example
   * InputValidator.validateRootNote('C');    // ✓ Valid
   * InputValidator.validateRootNote('f#');   // ✓ Valid (normalized to F#)
   * InputValidator.validateRootNote('X');    // ✗ Throws: Invalid root note
   */
  static validateRootNote(note: string): void {
    if (typeof note !== 'string') {
      throw new Error('Root note must be a string');
    }

    const trimmed = note.trim();
    if (trimmed.length === 0) {
      throw new Error('Root note cannot be empty');
    }

    if (trimmed.length > 10) {
      throw new Error(`Root note too long (max 10 characters, got ${trimmed.length})`);
    }

    const normalized = trimmed.toUpperCase();
    if (!this.VALID_ROOT_NOTES.includes(normalized)) {
      throw new Error(`Invalid root note: ${note}. Valid notes: ${this.VALID_ROOT_NOTES.join(', ')}`);
    }
  }

  /**
   * Validates that a value is a plain JavaScript-style identifier.
   *
   * Use this wherever a caller-supplied name is interpolated into a
   * RegExp or into generated pattern source. `effect({action:"remove"})`
   * built `new RegExp(`\\.${args.effect}\\(...`)` from a raw argument,
   * so `effect: "(a+)+Z"` against a crafted pattern blocked the event
   * loop for 25 seconds — the server stops answering stdio entirely (#236).
   *
   * @param value - Value to validate
   * @param fieldName - Field name for the error message
   * @throws {Error} When the value is not a plain identifier
   *
   * @example
   * InputValidator.validateIdentifier('lpf', 'effect');       // ✓ Valid
   * InputValidator.validateIdentifier('(a+)+Z', 'effect');    // ✗ Throws
   *
   * @nist si-10 "Information input validation"
   */
  static validateIdentifier(value: unknown, fieldName: string): void {
    if (typeof value !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
      throw new Error(
        `Invalid ${fieldName}: ${String(value)}. ` +
        'Must be a plain identifier (letters, digits and underscore, not starting with a digit).'
      );
    }
  }

  /**
   * Validates string length to prevent resource exhaustion
   *
   * @param str - String to validate
   * @param fieldName - Field name for error messages
   * @param maxLength - Maximum allowed length (default: 1000)
   * @param allowEmpty - Whether to allow empty strings (default: false for identifiers, true for content)
   * @throws {Error} When string exceeds maximum length or is not a string
   *
   * @example
   * InputValidator.validateStringLength('hello', 'pattern', 100);  // ✓ Valid
   * InputValidator.validateStringLength('x'.repeat(1001), 'pattern');  // ✗ Throws
   * InputValidator.validateStringLength('', 'pattern', 1000, true);  // ✓ Valid (clearing pattern)
   * InputValidator.validateStringLength('', 'name', 1000, false);  // ✗ Throws
   */
  static validateStringLength(str: string, fieldName: string, maxLength: number = 1000, allowEmpty: boolean = true): void {
    if (typeof str !== 'string') {
      throw new Error(`${fieldName} must be a string`);
    }

    if (!allowEmpty && str.trim().length === 0) {
      throw new Error(`${fieldName} cannot be empty`);
    }

    if (str.length > maxLength) {
      throw new Error(`${fieldName} too long (max ${maxLength} characters, got ${str.length})`);
    }
  }

  /**
   * Validates a value is within 0-1 range (normalized/ratio value)
   *
   * Used for parameters like complexity, swing amount, humanize amount, etc.
   * that represent normalized ratios or percentages.
   *
   * @param value - Number to validate
   * @param fieldName - Field name for error messages
   * @throws {Error} When value is not in 0-1 range
   *
   * @example
   * InputValidator.validateNormalizedValue(0.5, 'complexity');  // ✓ Valid
   * InputValidator.validateNormalizedValue(1.5, 'complexity');  // ✗ Throws
   */
  static validateNormalizedValue(value: number, fieldName: string): void {
    if (typeof value !== 'number') {
      throw new Error(`${fieldName} must be a number`);
    }

    if (isNaN(value) || !isFinite(value)) {
      throw new Error(`${fieldName} must be a valid number`);
    }

    if (value < 0 || value > 1.0) {
      throw new Error(`${fieldName} must be between 0 and 1.0, got ${value}`);
    }
  }

  /**
   * Validates a value is a positive integer (> 0)
   *
   * @param value - Number to validate
   * @param fieldName - Field name for error messages
   * @throws {Error} When value is not a positive integer
   *
   * @example
   * InputValidator.validatePositiveInteger(5, 'count');    // ✓ Valid
   * InputValidator.validatePositiveInteger(0, 'count');    // ✗ Throws: must be positive
   * InputValidator.validatePositiveInteger(1.5, 'count');  // ✗ Throws: must be integer
   */
  static validatePositiveInteger(value: number, fieldName: string): void {
    if (typeof value !== 'number') {
      throw new Error(`${fieldName} must be a number`);
    }

    if (isNaN(value) || !isFinite(value)) {
      throw new Error(`${fieldName} must be a valid number`);
    }

    if (!Number.isInteger(value)) {
      throw new Error(`${fieldName} must be an integer`);
    }

    if (value <= 0) {
      throw new Error(`${fieldName} must be a positive integer`);
    }
  }
}
