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
  // Every file in the browser directory, not one named file. The tier
  // has had exactly one member for a while, but hard-coding that meant
  // the guard measured a file while the docs described a tier — and when
  // `test:browser` was silently pulling in six unit suites by name
  // (#376), this could not see the difference.
  const dir = join(ROOT, 'src', '__tests__', 'browser');
  let declarations = 0;
  for (const file of readdirSync(dir)) {
    if (!/\.(test|spec)\.ts$/.test(file)) continue;
    declarations += (readFileSync(join(dir, file), 'utf-8').match(/\bit[.(]/g) ?? []).length;
  }
  return { declarations };
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
    // Was >5 when the file listed 18 examples by name. It is now
    // data-driven — four `it.each` declarations over a discovered
    // corpus, generating ~36 tests (#353).
    expect(declarations).toBeGreaterThan(2);
    expect(declarations).toBeLessThan(50);
  });

  it.each(['README.md', 'CLAUDE.md'])('%s does not overstate the browser tier', file => {
    const claims = [...read(file).matchAll(/(\d+) browser[- ](?:validation )?tests?\b/g)]
      .map(m => Number(m[1]));

    expect(claims.length).toBeGreaterThan(0);
    // The declaration-count heuristic no longer bounds this usefully.
    // The browser file became data-driven in #353: it discovers the
    // corpus and uses `it.each`, so four declarations now generate ~36
    // tests. A multiplier tight enough to catch "58 against 18" is far
    // too tight against "36 against 4".
    //
    // What still holds is the direction: a documented count below the
    // declaration count is definitely wrong, and an absurdly large one
    // is too. Between those, this can no longer discriminate, and
    // pretending otherwise would be worse than saying so.
    const implausible = claims.filter(n => n > declarations * 20 || n < declarations);
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
