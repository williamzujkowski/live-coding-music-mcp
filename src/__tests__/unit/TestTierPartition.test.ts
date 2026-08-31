/**
 * The two test tiers must partition the suite set (#376).
 *
 * `test:fast` ignored anything matching `browser` and `test:browser`
 * selected anything matching `browser`. That is a path regex matching on
 * NAME, not location, so six unit suites — 77 tests — were excluded from
 * the tier CI runs and swept into the tier CI skips:
 *
 *   BrowserInitRetry  BrowserLaunchSingleFlight  BrowserOnlyFunctions
 *   BrowserOnlyNames  BrowserWindowConsolidation  SilenceAndBrowserOnly
 *
 * They never gated a pull request, and they were absent from the
 * coverage figure. `BrowserOnlyNames` is itself a structural guard, so a
 * guard was being guarded by nothing.
 *
 * This asserts the property that broke: every test file belongs to
 * exactly one tier, and the two together are all of them.
 */

import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.join(__dirname, '..', '..', '..');
const PACKAGE = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as {
  scripts: Record<string, string>;
};

/** Every test file in the repo, as a path relative to the root. */
function allTestFiles(dir = path.join(ROOT, 'src', '__tests__'), acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) allTestFiles(full, acc);
    else if (/\.(test|spec)\.ts$/.test(entry.name)) acc.push(path.relative(ROOT, full));
  }
  return acc;
}

/** The pattern text a script passes to jest, verbatim. */
function patternTextOf(script: string, flag: string): string {
  const match = new RegExp(`${flag}=(?:"([^"]+)"|(\\S+))`).exec(PACKAGE.scripts[script]);
  if (match === null) throw new Error(`no ${flag} in scripts.${script}: ${PACKAGE.scripts[script]}`);
  return match[1] ?? match[2];
}

const FILES = allTestFiles();
const FAST_IGNORE_TEXT = patternTextOf('test:fast', '--testPathIgnorePatterns');
const FAST_IGNORES = new RegExp(FAST_IGNORE_TEXT);
const BROWSER_SELECTS = new RegExp(patternTextOf('test:browser', '--testPathPattern'));

describe('test tiers partition the suite set (#376)', () => {
  it('finds the test files', () => {
    expect(FILES.length).toBeGreaterThan(50);
  });

  it.each(FILES)('%s runs in exactly one tier', file => {
    const inFast = !FAST_IGNORES.test(file);
    const inBrowser = BROWSER_SELECTS.test(file);
    // Exactly one, so nothing is skipped everywhere and nothing runs twice.
    expect(inFast !== inBrowser).toBe(true);
  });

  it('puts every browser-directory suite in the browser tier and nothing else', () => {
    const selected = FILES.filter(f => BROWSER_SELECTS.test(f));
    expect(selected.length).toBeGreaterThan(0);
    for (const file of selected) {
      expect(file.replace(/\\/g, '/')).toContain('__tests__/browser/');
    }
  });

  it('does not exclude a unit suite for having "Browser" in its name', () => {
    // The specific regression. These are ordinary unit tests.
    for (const name of [
      'BrowserInitRetry', 'BrowserLaunchSingleFlight', 'BrowserOnlyFunctions',
      'BrowserOnlyNames', 'BrowserWindowConsolidation', 'SilenceAndBrowserOnly',
    ]) {
      const file = FILES.find(f => f.includes(name));
      expect(file).toBeDefined();
      if (file === undefined) continue;
      expect(FAST_IGNORES.test(file)).toBe(false);
    }
  });

  it('uses the same pattern in CI as in the fast script', () => {
    // CI passes its own --testPathIgnorePatterns; if it drifts from the
    // script, the tier CI runs is not the tier anyone tested locally.
    const workflow = readFileSync(path.join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf8');
    const inCi = /--testPathIgnorePatterns="([^"]+)"/.exec(workflow);
    expect(inCi).not.toBeNull();
    // Compared as the raw text both are written as. `RegExp.source`
    // escapes the slashes, so comparing against it fails on a pattern
    // that is character-for-character identical.
    expect(inCi?.[1]).toBe(FAST_IGNORE_TEXT);
  });
});
