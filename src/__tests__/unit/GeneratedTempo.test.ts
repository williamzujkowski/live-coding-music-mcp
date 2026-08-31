/**
 * A generated pattern plays at the tempo it was asked for (#395).
 *
 * `generateCompletePattern` emitted `setcpm(bpm)`. `setcpm` sets CYCLES
 * per minute, and everything the generator builds is one bar per cycle,
 * so that was four times too fast — `compose({ tempo: 130 })` produced
 * 520 BPM.
 *
 * Nobody caught it, across a day of measuring tempo, because two bugs
 * cancelled in the only measurement being made: the audio ran at 4x, and
 * tempo detection folds anything outside 40-200 BPM back into range, so
 * 520 folded by four to 130 and reported exactly the number requested.
 * Measured from the page's own scheduler instead:
 *
 *   generated techno @130          cps=2.167  implied 520 BPM
 *   corpus techno (setcpm(130/4))  cps=0.542  implied 130 BPM
 *
 * These tests assert the arithmetic and the structural assumption it
 * rests on. The end-to-end check is in the browser tier, because a unit
 * test on the pattern STRING cannot see what the scheduler does with it.
 */

import { PatternGenerator, BEATS_PER_CYCLE } from '../../services/PatternGenerator';
import { DRUM_STYLES } from '../../services/StyleRegistry';

const generator = new PatternGenerator();

/**
 * The tempo a pattern's own call implies, in BPM.
 *
 * Both spellings appear in the generator — `setcpm` takes cycles per
 * MINUTE, `setcps` cycles per SECOND — so asserting on the text of the
 * call would only pin whichever one a style happens to use. This
 * computes what the scheduler will actually do:
 *
 *   setcpm(x)  ->  x cycles/min   ->  x * beatsPerCycle BPM
 *   setcps(y)  ->  60y cycles/min ->  60y * beatsPerCycle BPM
 *
 * Three call sites had three different versions of the same unit error,
 * and a test that matched text would have caught only the one it was
 * written against.
 */
function impliedBpm(pattern: string): number | null {
  const match = /set(cpm|cps)\(\s*([\d./\s]+)\)/.exec(pattern);
  if (match === null) return null;

  // Arithmetic only — digits, dots and division. Never eval.
  const parts = match[2].split('/').map(part => Number(part.trim()));
  if (parts.some(n => !Number.isFinite(n) || n === 0)) return null;
  const value = parts.reduce((a, b) => a / b);

  const cyclesPerMinute = match[1] === 'cpm' ? value : value * 60;
  return cyclesPerMinute * BEATS_PER_CYCLE;
}

/** The requested BPM, as written in the call, before any division. */
function declaredNumerator(pattern: string): number | null {
  const match = /set(?:cpm|cps)\(\s*(\d+(?:\.\d+)?)/.exec(pattern);
  return match === null ? null : Number(match[1]);
}

describe('generated patterns declare the tempo they were asked for (#395)', () => {
  it.each(DRUM_STYLES)('%s plays at the tempo it was asked for', style => {
    const pattern = generator.generateCompletePattern(style, 'C', 174);
    expect(impliedBpm(pattern)).toBeCloseTo(174, 6);
    // The requested number appears verbatim in the call, so the claim
    // and the code cannot drift apart — the convention the shipped
    // examples use (#367).
    expect(declaredNumerator(pattern)).toBe(174);
  });

  it.each([60, 120, 130, 174, 200])('carries %i through unchanged', bpm => {
    expect(impliedBpm(generator.generateCompletePattern('techno', 'C', bpm))).toBeCloseTo(bpm, 6);
  });

  it('builds four beats to a cycle, which is what the divisor assumes', () => {
    // If the generator ever emits two bars per cycle, the divisor is
    // wrong and every tempo silently halves. This is the assumption
    // BEATS_PER_CYCLE rests on, asserted rather than trusted.
    const pattern = generator.generateCompletePattern('techno', 'C', 130);
    const drums = /s\("([^"]*)"\)/.exec(pattern);
    expect(drums).not.toBeNull();
    if (drums === null) return;

    // The kick layer states its own rate: `bd*4` is four to the cycle.
    const kick = /bd\*(\d+)/.exec(drums[1]);
    expect(kick).not.toBeNull();
    expect(Number(kick?.[1])).toBe(BEATS_PER_CYCLE);
  });

  it.each(['trip_hop', 'boom_bap'])('%s puts the backbeat where a four-beat bar puts it', style => {
    // The three hand-written templates don't use `bd*4` — they spell the
    // bar out as eight steps. Eight steps is only four beats if they are
    // eighth notes, and the evidence for that is where the snare lands:
    // step 5 of 8 is beat 3, the backbeat. If a cycle were two beats
    // instead, that snare would be off the beat entirely.
    //
    // intelligent_dnb is left out on purpose: its backbeat lives inside
    // a sliced break (`breaks165`), so there is no snare in the source
    // text to point at, and guessing at one would assert nothing.
    const pattern = generator.generateCompletePattern(style, 'C', 95);
    // Match on "a drum line that contains a snare", not on the position
    // being looked for — a regex that spells out `~ ~ ~ ~ sd` would make
    // the assertion below true by construction.
    const snareLine = /s\("([^"]*\bsd[^"]*)"\)/.exec(pattern);
    expect(snareLine).not.toBeNull();
    if (snareLine === null) return;

    // A comma inside mini-notation stacks parallel sequences; each one
    // spans the same cycle, so one of them is enough.
    const steps = snareLine[1].split(',')[0].trim().split(/\s+(?![^[]*\])/);
    expect(steps).toHaveLength(BEATS_PER_CYCLE * 2); // eighth notes
    expect(steps.findIndex(step => step.startsWith('sd'))).toBe(BEATS_PER_CYCLE);
  });

  it.each(DRUM_STYLES)('%s never emits the bare call that was the bug', style => {
    const pattern = generator.generateCompletePattern(style, 'C', 174);
    // `setcpm(174)` is 696 BPM; `setcps(174/60)` is the same thing
    // spelled differently; `setcps(174/60/2)` is 348.
    expect(pattern).not.toMatch(/setcpm\(\s*174\s*\)/);
    expect(pattern).not.toMatch(/setcps\(\s*174\s*\/\s*60\s*\)/);
    expect(pattern).not.toMatch(/setcps\(\s*174\s*\/\s*60\s*\/\s*2\s*\)/);
  });
});

describe('set_tempo uses the same units (#395)', () => {
  it('divides, because the tool wrote the same four-times-too-fast call', () => {
    const source = require('node:fs').readFileSync(
      require('node:path').join(__dirname, '..', '..', 'server', 'tools', 'transform.ts'),
      'utf8'
    ) as string;
    expect(source).toMatch(/setcpm\(\$\{String\(args\.bpm\)\}\/\$\{String\(BEATS_PER_CYCLE\)\}\)/);
  });
});
