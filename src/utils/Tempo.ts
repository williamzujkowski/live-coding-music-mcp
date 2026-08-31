/**
 * Tempo units, in one place.
 *
 * Strudel's tempo calls count CYCLES, not beats: `setcpm(n)` is n cycles
 * per minute, `setcps(y)` is y cycles per second. Every pattern this
 * project generates or imports is one bar of 4/4 per cycle, so a beat is
 * a quarter of a cycle and the conversion is a factor of four.
 *
 * That factor was wrong in five places before anyone measured it (#395,
 * #397): three writers with three different divisors, and two readers
 * with two different regexes. It lives here now so the next call site
 * inherits the decision instead of re-deriving it.
 */

/**
 * Beats in one bar: the meter. Everything here is 4/4, and MIDI import
 * lays other meters onto 4/4 bars rather than honouring them (#336).
 */
export const BEATS_PER_BAR = 4;

/**
 * Bars in one cycle: this project's convention, not Strudel's rule.
 *
 * Strudel lets a cycle be any length. Everything generated or imported
 * here puts one bar in it — the generator's drum line is `s("bd*4, ...")`,
 * the hand-written templates spell out eight eighth-notes with the snare
 * on the backbeat, and `renderBars` wraps each bar so one cycle plays
 * one bar.
 *
 * This is the assumption that was wrong three different ways before
 * anyone measured it: one writer assumed one beat per cycle, another two
 * bars, a third got it right. Named separately from the meter because
 * they are separate claims that happen to multiply to four.
 */
export const BARS_PER_CYCLE = 1;

/**
 * Beats in one cycle — the tempo conversion factor.
 *
 * The tests assert the structure this rests on, so changing the bar
 * fails loudly rather than silently rescaling every tempo.
 */
export const BEATS_PER_CYCLE = BEATS_PER_BAR * BARS_PER_CYCLE;

/**
 * A tempo call and its arguments.
 *
 * `setcpm` and `setcps` only. The old `ai.ts` parser also accepted
 * `setbpm`, and a cross-model reviewer called dropping it a silent
 * regression — but `@strudel/core` binds `setCps`/`setcps` and
 * `setCpm`/`setcpm` and nothing else; `setbpm` appears only as a
 * keyword token in `@strudel/mini`'s grammar table. A pattern calling
 * it does not run, so reading a tempo out of it would be inventing one.
 * `StrudelEngineHelpers` had already excluded it on purpose; this makes
 * that one decision instead of two. (`mergeLayerIntoPattern` still
 * matches `setbpm` when it hunts for a tempo prefix — harmless, since
 * it only decides where to splice, but it is the last reference left.)
 *
 * `(?<![\w$.])` so `resetcpm(120)` and `x.setcps(2)` are not tempo
 * calls. Only digits, dots and `/` inside: this parses pattern text
 * that arrived as a tool argument, and it never evaluates it.
 */
const TEMPO_CALL = /(?<![\w$.])set(cpm|cps)\s*\(\s*(\d+(?:\.\d+)?(?:\s*\/\s*\d+(?:\.\d+)?)*)\s*\)/i;

/** Line and block comments, so a commented-out call is not read as one. */
const COMMENTS = /\/\*[\s\S]*?\*\/|\/\/[^\n]*/g;

/**
 * The BPM a pattern's tempo call declares, or undefined when it has none.
 *
 * For a divided call this is the NUMERATOR — the number the author wrote
 * — because that is the convention the shipped examples and the
 * generator both follow: `setcpm(130/4)` means "130 BPM in 4/4", and the
 * divisor is the beats-per-cycle conversion, not part of the tempo. Same
 * for `setcps(174/60/4)`.
 *
 * The undivided forms are not symmetric, and deliberately so:
 *
 *   `setcpm(120)`  ->  120.  A bare cycles-per-minute number is what
 *                      hand-written patterns mean by their tempo, and
 *                      #341 already settled this.
 *   `setcps(2)`    ->  480.  Nobody writing cycles per SECOND means BPM
 *                      by it — `setcps(2)` is two cycles a second, and
 *                      returning 2 as a tempo would be nonsense.
 *
 * Never eval — see `TEMPO_CALL`.
 */
export function declaredBpm(code: string): number | undefined {
  const parts = tempoParts(code);
  if (parts === null) return undefined;
  // A divided call states its author's number first.
  if (parts.values.length > 1) return parts.values[0];
  // An undivided one has to be read in its own unit. `cpm` hands back a
  // number a person would recognise as their tempo; `cps` does not, so
  // it converts.
  return parts.unit === 'cps' ? convert(parts) : parts.values[0];
}

/**
 * The BPM a pattern's tempo call implies, or undefined when it has none.
 *
 * Works the arithmetic through and converts, so it answers the question
 * `declaredBpm` does not: for a correctly written pattern the two agree,
 * and for the four-times-too-fast calls #395 fixed this one is four
 * times larger. That gap is the whole bug, and a test that only reads
 * the numerator cannot see it.
 *
 * **The tempo call only.** `.slow(2)` and `.fast(2)` rescale time and
 * are not accounted for here — the shipped corpus pairs `setcpm(174/2)`
 * with `.slow(2)` and plays at 174, which this reports as 348. Use it
 * on patterns whose timing lives entirely in the tempo call, which is
 * everything this project generates. `declaredBpm` is the right answer
 * for a pattern someone else wrote.
 */
export function impliedBpm(code: string): number | undefined {
  const parts = tempoParts(code);
  if (parts === null) return undefined;
  return convert(parts);
}

/** Work a parsed call through its arithmetic and into beats per minute. */
function convert(parts: { unit: string; values: number[] }): number {
  const value = parts.values.reduce((a, b) => a / b);
  const cyclesPerMinute = parts.unit === 'cps' ? value * 60 : value;
  return cyclesPerMinute * BEATS_PER_CYCLE;
}

/**
 * Split a tempo call into its unit and its operands.
 *
 * Comments are stripped first. A parser that reads the first `setcpm` in
 * the text will read a commented-out one, and "tempo taken from the
 * wrong place" is the entire subject of #395 and #397 — this file does
 * not get to repeat it.
 *
 * A zero anywhere rejects the whole call, divisor or numerator alike. A
 * zero divisor is nonsense; a zero numerator is a stopped transport,
 * which is not a tempo any caller here can use, and handing back 0 would
 * only push the problem into `validateBPM` further down.
 */
function tempoParts(code: string): { unit: string; values: number[] } | null {
  const match = TEMPO_CALL.exec(code.replace(COMMENTS, ' '));
  if (match === null) return null;
  const values = match[2].split('/').map(part => Number.parseFloat(part.trim()));
  if (values.some(n => !Number.isFinite(n) || n === 0)) return null;
  return { unit: match[1].toLowerCase(), values };
}
