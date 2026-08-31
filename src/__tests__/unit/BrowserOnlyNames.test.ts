/**
 * Three browser-only functions were missing or mis-cased (#355).
 *
 * Each produced "references unknown identifier 'x'" — the reads-as-a-
 * typo message #232 was filed to remove and #343 extended. The
 * mechanism works; these were name bugs, which are invisible on
 * inspection because a mis-cased entry looks present.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  BROWSER_ONLY_FUNCTIONS, explainBrowserOnly, findBrowserOnlyCall,
} from '../../services/BrowserOnlyFunctions';

describe('the three names that were wrong (#355)', () => {
  it.each([
    ['setcps', 'was listed as setCps, which Strudel does not have'],
    ['useRNG', 'used by Strudel\'s own flatrave and amensister tunes'],
    ['piano', 'a method, so it failed at runtime rather than as a name'],
  ])('%s is recognised — %s', name => {
    expect(explainBrowserOnly(name)).toContain('real Strudel function');
  });

  it('.piano() is found as a chained method', () => {
    // findBrowserOnlyCall matches `.name(` as well as `name(`, which is
    // why listing it is enough for a method.
    expect(findBrowserOnlyCall('note("c3").piano()')).toBe('piano');
  });

  it('setcps is not also listed under the wrong casing', () => {
    expect(BROWSER_ONLY_FUNCTIONS.has('setCps')).toBe(false);
  });
});

describe('no entry can be silently mis-cased again (#355)', () => {
  /**
   * A mis-cased key is the failure that hid here: the entry LOOKS
   * present, the lookup is exact, and nothing complains. Strudel's own
   * naming is lowercase for transport functions and camelCase only for
   * a few known cases, so this pins the shape rather than the list.
   */
  const CAMEL_CASE_ALLOWED = new Set(['useRNG', 'initHydra', 'H', 'P5']);

  it('every transport-style name is lowercase unless explicitly allowed', () => {
    const offenders = [...BROWSER_ONLY_FUNCTIONS.keys()]
      .filter(name => name !== name.toLowerCase())
      .filter(name => !CAMEL_CASE_ALLOWED.has(name));
    expect(offenders).toEqual([]);
  });

  it('the allowlist itself is not stale — every entry is still listed', () => {
    // If someone removes initHydra, this catches the leftover exemption
    // rather than letting it sit forever.
    for (const name of CAMEL_CASE_ALLOWED) {
      expect(BROWSER_ONLY_FUNCTIONS.has(name)).toBe(true);
    }
  });

  it('no name appears twice under different casing', () => {
    const lowered = [...BROWSER_ONLY_FUNCTIONS.keys()].map(n => n.toLowerCase());
    expect(new Set(lowered).size).toBe(lowered.length);
  });
});

describe('the good message still reaches every listed name (#355)', () => {
  it('every entry produces an explanation, not a typo message', () => {
    for (const name of BROWSER_ONLY_FUNCTIONS.keys()) {
      const explanation = explainBrowserOnly(name);
      expect(explanation).toBeTruthy();
      expect(explanation).not.toContain('unknown identifier');
    }
  });

  it('a name that is not listed still returns null', () => {
    expect(explainBrowserOnly('definitelyNotAStrudelFunction')).toBeNull();
  });

  it('the source lists setcps lowercase', () => {
    // Belt and braces: the map could be built correctly while the file
    // still carries the old key in a comment someone copies.
    const source = readFileSync(
      join(__dirname, '..', '..', 'services', 'BrowserOnlyFunctions.ts'), 'utf-8');
    expect(source).toContain("['setcps', 'transport']");
  });
});
