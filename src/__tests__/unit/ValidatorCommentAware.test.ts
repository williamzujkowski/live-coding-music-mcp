/**
 * Comments and string bodies are text, not code (#445).
 *
 * The validator scanned them as code, and it went wrong in BOTH
 * directions. Measured before this:
 *
 *   BLOCKED  s("bd*4") // sounds sad :(       Unclosed '('
 *   BLOCKED  s("bd*4") // yay :)              Unexpected closing ')'
 *   BLOCKED  s("bd*4") // try gain(10) later  Dangerous gain value: 10
 *   BLOCKED  s(" eval(x)")                    eval() is not allowed
 *   ok       s("bd").gain (10)                <- the actual target
 *   ok       eval ("x")                       <- one space
 *
 * `edit_pattern` refuses the write on a validation error, so a smiley
 * in a comment stopped the music while the rule's real target walked
 * past with an added space.
 *
 * #334 taught `checkBalancedQuotes` about comments for exactly this
 * reason and stopped there. These are the halves it did not reach.
 */

import { PatternValidator } from '../../utils/PatternValidator';

describe('valid patterns are not blocked by their own text (#445)', () => {
  const validate = (p: string) => new PatternValidator().validate(p);

  it.each([
    ['a sad smiley in a comment', 's("bd*4") // sounds sad :('],
    ['a happy smiley in a comment', 's("bd*4") // yay :)'],
    ['an unbalanced bracket in a comment', 's("bd*4") // [untested'],
    ['gain mentioned in a comment', 's("bd*4") // try gain(10) later'],
    ['eval inside a sample name', 's(" eval(x)")'],
    ['a loud gain named in a string', 's("bd").note(" gain(99) ")'],
    ['a block comment with brackets', 's("bd*4") /* try ( this ) later */'],
  ])('accepts %s', (_label, pattern) => {
    expect(validate(pattern).valid).toBe(true);
  });

  it('still catches a genuinely unbalanced pattern', () => {
    // The check must keep working on actual code.
    expect(validate('s("bd*4"').valid).toBe(false);
    expect(validate('stack(s("bd"), s("hh")').valid).toBe(false);
  });
});

describe('one space no longer evades a safety rule (#445)', () => {
  const errors = (p: string): string[] => new PatternValidator().validate(p).errors;

  it.each([
    ['s("bd").gain(10)', /Dangerous gain/],
    ['s("bd").gain (10)', /Dangerous gain/],
    ['s("bd").gain( 10 )', /Dangerous gain/],
    ['s("bd").gain(+10)', /Dangerous gain/],
    ['eval("x")', /eval\(\) or Function\(\)/],
    ['eval ("x")', /eval\(\) or Function\(\)/],
    ['Function ("x")', /eval\(\) or Function\(\)/],
    ['while (true) {}', /infinite loop/],
    ['while ( true ) {}', /infinite loop/],
  ])('%s is refused', (pattern, expected) => {
    expect(errors(pattern).join(' ')).toMatch(expected);
  });

  it('leaves ordinary gains alone', () => {
    // The rule must not start firing on music.
    expect(errors('s("bd").gain(0.8)')).toEqual([]);
    expect(errors('s("bd").gain(2)')).toEqual([]);
  });
});
