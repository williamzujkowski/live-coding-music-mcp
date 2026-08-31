/**
 * Drift guard for the countable claims in README and CLAUDE.md (#246 follow-up).
 *
 * DocsCoverageDrift already guards the coverage percentages, but it does
 * so from `coverage/coverage-summary.json` — which CI never produces
 * (`test:nocov` runs without `--coverage`, and `coverage/` is
 * gitignored), so those assertions silently no-op on a fresh checkout.
 * It also deliberately exempts three-digit numbers.
 *
 * Both gaps showed. "58 browser tests" sat in both files across five
 * commits and was never true — the browser file has had 18 `it(`
 * declarations since it was written. The number was almost certainly
 * copied from "58 deprecated tool aliases" in the same sentence. And
 * "26 tools" stayed put while two more were added.
 *
 * Everything here is computed from the source tree, so it runs in CI
 * with no artifact.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..', '..', '..');
const read = (f: string) => readFileSync(join(ROOT, f), 'utf-8');

/** Tool definitions across the domain modules, plus `init` in server.ts. */
function actualToolCount(): number {
  const toolsDir = join(ROOT, 'src', 'server', 'tools');
  let count = 0;
  for (const file of readdirSync(toolsDir).filter(f => f.endsWith('.ts'))) {
    count += (readFileSync(join(toolsDir, file), 'utf-8')
      .match(/^\s+name: '[a-z_]+',$/gm) ?? []).length;
  }
  count += (readFileSync(join(ROOT, 'src', 'server', 'server.ts'), 'utf-8')
    .match(/name: 'init'/g) ?? []).length;
  return count;
}

/**
 * Browser tests: `it(` declarations, plus the extra rows a `forEach`
 * over the example files generates. Counted the same way a reader would
 * have to count them.
 */
function actualBrowserTestCount(): { declarations: number } {
  const file = join(ROOT, 'src', '__tests__', 'browser', 'ExampleValidation.browser.test.ts');
  return { declarations: (readFileSync(file, 'utf-8').match(/\bit\(/g) ?? []).length };
}

describe('documented tool count (#246)', () => {
  const actual = actualToolCount();

  it('is a plausible count, so a broken matcher fails loudly', () => {
    expect(actual).toBeGreaterThan(20);
    expect(actual).toBeLessThan(60);
  });

  it.each(['README.md', 'CLAUDE.md'])('%s quotes the real tool count', file => {
    const text = read(file);
    const claims = [...text.matchAll(/\*{0,2}(\d+) tools?\b/g)]
      .map(m => Number(m[1]))
      // "58 deprecated tool aliases" is a historical fact about v4.0.0,
      // not a claim about what is registered now.
      .filter(n => n !== 58);

    expect(claims.length).toBeGreaterThan(0);
    const wrong = claims.filter(n => n !== actual);
    expect(wrong).toEqual([]);
  });
});

describe('documented browser test count (#246)', () => {
  const { declarations } = actualBrowserTestCount();

  it('the browser file has the declarations we think it has', () => {
    expect(declarations).toBeGreaterThan(5);
    expect(declarations).toBeLessThan(50);
  });

  it.each(['README.md', 'CLAUDE.md'])('%s does not overstate the browser tier', file => {
    const claims = [...read(file).matchAll(/(\d+) browser[- ](?:validation )?tests?\b/g)]
      .map(m => Number(m[1]));

    expect(claims.length).toBeGreaterThan(0);
    // The forEach over example files expands one declaration into many,
    // so the real total exceeds the declaration count — but it cannot
    // plausibly exceed a generous multiple of it. "58" against 18
    // declarations failed this; the true figure is 31.
    const implausible = claims.filter(n => n > declarations * 2.5 || n < declarations);
    expect(implausible).toEqual([]);
  });
});

describe('documented APIs exist (#309)', () => {
  it('no code example calls ErrorRecovery.withRetry, which never existed', () => {
    // CLAUDE.md showed `ErrorRecovery.withRetry(op, {maxRetries, baseDelay})`
    // as the canonical retry pattern for several releases. `grep -rn
    // withRetry src` returns zero hits for that name.
    const src = readdirSync(join(ROOT, 'src', 'utils')).includes('ErrorRecovery.ts')
      ? read('src/utils/ErrorRecovery.ts') : '';
    const documented = read('CLAUDE.md') + read('README.md');

    for (const name of ['withRetry']) {
      if (documented.includes(`ErrorRecovery.${name}(`) || documented.includes(`recovery.${name}(`)) {
        expect(src).toContain(`${name}(`);
      }
    }
    // And the method the docs now point at must be real.
    expect(src).toContain('executeWithRetry(');
  });
});
