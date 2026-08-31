/**
 * Browser-only function reporting (#232).
 *
 * The local engine builds its context from @strudel/core, /mini and
 * /tonal. strudel.cc loads considerably more, and without this the
 * missing pieces failed with errors that blamed the pattern:
 *
 *   setcpm(120)          -> "references unknown identifier 'setcpm'"
 *   s("bd").pianoroll()  -> "s(...).pianoroll is not a function"
 *   samples("github:..") -> "Invalid argument"
 *
 * `setcpm` shows why it matters: a core, very common Strudel function
 * reported as an unknown identifier reads as "you typo'd", when the truth
 * is "this validator cannot see it".
 */

import {
  BROWSER_ONLY_FUNCTIONS,
  explainBrowserOnly,
  clarifyEngineError,
  findBrowserOnlyCall,
} from '../../services/BrowserOnlyFunctions.js';

describe('explainBrowserOnly', () => {
  it('affirms the function is real before explaining the limit', () => {
    const text = explainBrowserOnly('setcpm');

    expect(text).toMatch(/real Strudel function/);
    expect(text).toMatch(/local validation cannot evaluate/);
  });

  it('points at the tool that can actually check it', () => {
    expect(explainBrowserOnly('pianoroll')).toMatch(/validate_pattern_runtime/);
  });

  it.each([
    ['setcpm', /playback/],
    ['samples', /network/],
    ['pianoroll', /canvas/],
    ['midi', /MIDI\/OSC/],
  ])('says why %s is unavailable', (name, expected) => {
    expect(explainBrowserOnly(name)).toMatch(expected);
  });

  it('returns null for a function the engine does provide', () => {
    expect(explainBrowserOnly('note')).toBeNull();
    expect(explainBrowserOnly('scale')).toBeNull();
  });
});

describe('clarifyEngineError', () => {
  it.each([
    "Pattern references unknown identifier 'setcpm'. Only Strudel functions...",
    's(...).pianoroll is not a function',
    'scope is not a function',
  ])('rewrites %p', message => {
    expect(clarifyEngineError(message)).toMatch(/real Strudel function/);
  });

  it('leaves an unrelated error untouched', () => {
    const message = 'Unexpected token )';
    expect(clarifyEngineError(message)).toBe(message);
  });

  /** A genuine typo must still read as a typo. */
  it('does not rewrite an unknown identifier that is not browser-only', () => {
    const message = "Pattern references unknown identifier 'sowndz'.";
    expect(clarifyEngineError(message)).toBe(message);
  });
});

describe('findBrowserOnlyCall', () => {
  /**
   * Needed because samples("github:...") fails as "Invalid argument" —
   * the transpiler rewrites every double-quoted string into mini(), and a
   * URL is not mini notation, so the error never names the function.
   */
  it('finds a call the error message would not mention', () => {
    expect(findBrowserOnlyCall('samples("github:tidalcycles/dirt-samples")')).toBe('samples');
  });

  it.each([
    ['bare call', 'setcpm(120)'],
    ['chained method', 's("bd").pianoroll()'],
    ['mid-expression', 'stack(s("bd"), hush())'],
  ])('finds a %s', (_label, code) => {
    expect(findBrowserOnlyCall(code)).not.toBeNull();
  });

  it('returns null for an ordinary pattern', () => {
    expect(findBrowserOnlyCall('s("bd*4").gain(0.5).lpf(200)')).toBeNull();
  });

  /** Otherwise a pattern mentioning a name in a string gets misreported. */
  it.each([
    's("midi")',
    'note("c3").s("scope")',
    's("bd").room(0.3) // samples are fine',
  ])('does not fire on %p, where the name is not called', code => {
    expect(findBrowserOnlyCall(code)).toBeNull();
  });

  it('does not fire on a longer name that merely contains one', () => {
    expect(findBrowserOnlyCall('mySamples(1)')).toBeNull();
    expect(findBrowserOnlyCall('s("bd").hushed()')).toBeNull();
  });
});

describe('the registry itself', () => {
  it('covers every function verified to fail locally', () => {
    // 'setCps' was in this list, and in the registry, and in neither
    // Strudel nor reality — the map entry was mis-cased, so the test
    // was written from the map rather than from Strudel and passed
    // while `setcps(...)` produced the exact typo message the registry
    // exists to prevent (#355).
    for (const name of ['setcpm', 'setcps', 'hush', 'samples', 'pianoroll', 'scope', 'initHydra', 'midi', 'osc', 'useRNG', 'piano']) {
      expect(BROWSER_ONLY_FUNCTIONS.has(name)).toBe(true);
    }
  });

  /** Listing a working function would send users to the browser needlessly. */
  it('does not list functions the engine provides', () => {
    for (const name of ['note', 's', 'n', 'stack', 'scale', 'transpose', 'voicing', 'sound', 'cps']) {
      expect(BROWSER_ONLY_FUNCTIONS.has(name)).toBe(false);
    }
  });
});
