/**
 * Strudel functions the local engine cannot provide.
 *
 * `StrudelEngine` builds its context from @strudel/core, @strudel/mini and
 * @strudel/tonal. strudel.cc loads considerably more: sample loaders that
 * fetch over the network, transport controls that need a running
 * scheduler, MIDI/OSC bridges, and the visualisers, which draw to a
 * canvas.
 *
 * Without this list those all fail with errors that blame the pattern:
 *
 *   setcpm(120)          -> "references unknown identifier 'setcpm'"
 *   s("bd").pianoroll()  -> "s(...).pianoroll is not a function"
 *   samples("github:..") -> "Invalid argument"
 *
 * `setcpm` is the one that shows why this matters — it is a core, very
 * common Strudel function, and telling someone it is an unknown
 * identifier reads as "you typo'd" when the truth is "this validator
 * cannot see it". Local and browser validation disagreeing about the same
 * pattern is bad; disagreeing *and* misattributing the cause is worse.
 *
 * Every name here was verified to fail locally before being listed (#232).
 *
 * @module services/BrowserOnlyFunctions
 */

/** Why a given function is unavailable locally. */
export type UnavailableReason = 'transport' | 'loader' | 'visual' | 'io';

/** Functions that exist on strudel.cc but not in the local engine. */
export const BROWSER_ONLY_FUNCTIONS: ReadonlyMap<string, UnavailableReason> = new Map([
  // Transport: need a running scheduler, which the local engine has no
  // equivalent of — it builds patterns, it does not play them.
  ['setcpm', 'transport'],
  // Lowercase. It was listed as 'setCps', which Strudel does not have,
  // so `setcps(170/60)` fell through to "references unknown identifier
  // 'setcps'" — the reads-as-a-typo message #232 exists to remove. The
  // mechanism was fine; the key was mis-cased, which is invisible on
  // inspection because the entry looks present (#355).
  ['setcps', 'transport'],
  ['getcps', 'transport'],
  ['hush', 'transport'],
  // Siblings of hush and setcpm, and just as absent locally. Without
  // them, panic() and getcpm() produced the "references unknown
  // identifier — reads as a typo" message that #232 was filed to
  // remove (#343).
  ['panic', 'transport'],
  ['getcpm', 'transport'],
  ['all', 'transport'],
  // Used by two of Strudel's own flagship tunes (flatrave, amensister),
  // so anyone pasting a real pattern in hits it immediately.
  ['useRNG', 'transport'],

  // Loaders: fetch sample banks over the network at evaluation time.
  ['samples', 'loader'],
  // An instrument shortcut, not a free identifier — it fails as
  // "note(...).piano is not a function" rather than as an unknown
  // name, so the allowlist never saw it. findBrowserOnlyCall matches
  // `.name(` as well as `name(`, so listing it is enough (#355).
  ['piano', 'loader'],

  // Visualisers: draw to a canvas.
  ['pianoroll', 'visual'],
  ['scope', 'visual'],
  ['punchcard', 'visual'],
  ['spiral', 'visual'],
  ['wordfall', 'visual'],
  ['animate', 'visual'],
  ['initHydra', 'visual'],
  ['H', 'visual'],
  ['P5', 'visual'],

  // Bridges to hardware or other processes.
  ['midi', 'io'],
  ['osc', 'io'],
]);

const REASON_TEXT: Record<UnavailableReason, string> = {
  transport: 'controls playback, which the local engine does not run',
  loader: 'loads samples over the network',
  visual: 'draws to a canvas',
  io: 'bridges to MIDI/OSC hardware',
};

/**
 * Explains that a function is real but unavailable locally.
 *
 * @param name - Function the pattern referenced
 * @returns An explanation, or null when the name is not browser-only
 */
export function explainBrowserOnly(name: string): string | null {
  const reason = BROWSER_ONLY_FUNCTIONS.get(name);
  if (reason === undefined) return null;

  return (
    `'${name}' is a real Strudel function, but it ${REASON_TEXT[reason]}, ` +
    'so local validation cannot evaluate it. The pattern may be perfectly ' +
    'valid — check it in the browser with validate_pattern_runtime, or ' +
    'remove this call to validate the rest locally.'
  );
}

/**
 * Finds a browser-only function called in pattern source.
 *
 * Error-message matching is not enough on its own. `samples("github:...")`
 * fails as "Invalid argument", because the transpiler rewrites every
 * double-quoted string into a `mini()` call and a URL is not mini
 * notation — so the failure never mentions `samples` at all. Scanning the
 * source catches those too.
 *
 * @param code - Strudel pattern source
 * @returns The first browser-only function called, or null
 */
export function findBrowserOnlyCall(code: string): string | null {
  // Comments are not calls.
  //
  // The regex only guarded the single character before the name, so a
  // mention inside a comment matched. This is consulted on the ERROR
  // path, so the effect was misattribution rather than false
  // rejection — but it fired ahead of the real diagnosis: an
  // unterminated string with `samples("x")` in a trailing comment was
  // reported as "samples loads over the network" instead of as the
  // syntax error it is (#343).
  const withoutComments = code
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ');

  for (const name of BROWSER_ONLY_FUNCTIONS.keys()) {
    // Called as a function or chained as a method, not merely mentioned
    // inside a string.
    const called = new RegExp(`(^|[^\\w$."'])${name}\\s*\\(|\\.${name}\\s*\\(`);
    if (called.test(withoutComments)) return name;
  }
  return null;
}

/**
 * Rewrites an engine error when a browser-only function caused it.
 *
 * Handles both shapes the failure takes: an allowlist rejection for a
 * bare call, and a "not a function" runtime error for a method call.
 *
 * @param message - The original error
 * @returns A clearer message, or the original when nothing applies
 */
export function clarifyEngineError(message: string): string {
  const patterns = [
    /unknown identifier '([A-Za-z_$][\w$]*)'/,
    /\.\.\.\)\.([A-Za-z_$][\w$]*) is not a function/,
    /([A-Za-z_$][\w$]*) is not a function/,
  ];

  for (const pattern of patterns) {
    const found = pattern.exec(message);
    if (found === null) continue;
    const explanation = explainBrowserOnly(found[1]);
    if (explanation !== null) return explanation;
  }

  return message;
}
