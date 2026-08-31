/**
 * Drift guard for the coverage figures quoted in README and CLAUDE.md (#246).
 *
 * Those numbers have gone stale three times, once understating skipped
 * tests by 2.5x. A hand-correction pass earlier this month was itself
 * stale before it merged, because other PRs landed while it was open — so
 * this is a structural problem, not a discipline one.
 *
 * Consensus chose generating them from `coverage/coverage-summary.json`,
 * but two objections raised in that vote turned out to be correct on
 * inspection, and both shape what this does:
 *
 *  - The artifact carries coverage ONLY. It has no test count and no lint
 *    warning count, so those cannot be generated from it. Counting
 *    `it(`/`test(` statically gives 1871 against an actual 2091, because
 *    `it.each([...])` expands to many tests from one declaration. So the
 *    test count is stated approximately and is not gated.
 *  - Coverage moves a little on almost every PR. An exact-match gate would
 *    fail unrelated work until someone re-ran coverage and committed a
 *    regenerated README — turning a docs check into a tax on every change.
 *
 * Hence a tolerance. Wide enough that ordinary churn passes untouched,
 * tight enough that the drift which actually happened — 86.32% documented
 * against 86.73% real, then 1709 tests against 1774 — would have been
 * caught long before it reached three releases.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..', '..', '..');
const SUMMARY = join(ROOT, 'coverage', 'coverage-summary.json');

/** Percentage points a documented figure may lag reality. */
const TOLERANCE = 2;

interface DocFigure {
  file: string;
  label: string;
  documented: number;
  actual: number;
}

function documentedFigures(total: Record<string, { pct: number }>): DocFigure[] {
  const found: DocFigure[] = [];

  for (const file of ['README.md', 'CLAUDE.md']) {
    const whole = readFileSync(join(ROOT, file), 'utf-8');

    // Only the project-level figures, delimited the way the tool-docs
    // generator delimits its table (#221). Without markers this also
    // matched per-module claims like "PatternGenerator sits at 78.4%"
    // and the tone-guide example "52% statement coverage", which are not
    // project totals and must not be gated against them.
    const text = [...whole.matchAll(/<!-- COVERAGE:START -->([\s\S]*?)<!-- COVERAGE:END -->/g)]
      .map(m => m[1])
      .join('\n');

    for (const [label, key] of [['statement', 'statements'], ['branch', 'branches']] as const) {
      // Matches "87.96% statement coverage" and "87.96% statement / 77.95% branch"
      const pattern = new RegExp(`(\\d+(?:\\.\\d+)?)%\\s+${label}`, 'g');
      for (const match of text.matchAll(pattern)) {
        found.push({
          file,
          label,
          documented: Number(match[1]),
          actual: total[key].pct,
        });
      }
    }
  }

  return found;
}

describe('documented coverage figures (#246)', () => {
  /**
   * Trust the artifact only when it describes the whole project.
   *
   * `jest --coverage <one-file>` rewrites coverage-summary.json with just
   * that file, so the totals read near 0%. Gating on that would fail the
   * build for anyone running a single test with coverage on — which is an
   * ordinary thing to do while debugging. Absent or partial, skip.
   */
  //
  // File count is not the signal: `collectCoverageFrom` is `src/**/*.ts`,
  // so a single-file run still lists every source file — just at 0%. The
  // totals are what differ. Anything this low means a partial run, not a
  // regression, because jest's own coverageThreshold (80% lines) fails
  // first on a real collapse.
  const PLAUSIBLE_FULL_RUN_PCT = 50;
  const artifactIsWholeProject = (): boolean => {
    if (!existsSync(SUMMARY)) return false;
    const parsed = JSON.parse(readFileSync(SUMMARY, 'utf-8')) as {
      total?: { statements?: { pct: number } };
    };
    return (parsed.total?.statements?.pct ?? 0) >= PLAUSIBLE_FULL_RUN_PCT;
  };
  const maybe = artifactIsWholeProject() ? it : it.skip;

  maybe('every quoted coverage figure is close to the measured one', () => {
    const total = (JSON.parse(readFileSync(SUMMARY, 'utf-8')) as {
      total: Record<string, { pct: number }>;
    }).total;

    const figures = documentedFigures(total);
    expect(figures.length).toBeGreaterThan(0);

    const drifted = figures
      .filter(f => Math.abs(f.documented - f.actual) > TOLERANCE)
      .map(f =>
        `${f.file}: documents ${String(f.documented)}% ${f.label} coverage, ` +
        `measured ${String(f.actual)}% (tolerance ${String(TOLERANCE)} points)`
      );

    expect(drifted).toEqual([]);
  });

  /**
   * Overstating is the dangerous direction — it is the failure the
   * project's tone rules single out. Flag it tightly even when it is
   * inside the churn tolerance.
   */
  maybe('no figure claims more coverage than was measured', () => {
    const total = (JSON.parse(readFileSync(SUMMARY, 'utf-8')) as {
      total: Record<string, { pct: number }>;
    }).total;

    const overstated = documentedFigures(total)
      .filter(f => f.documented > f.actual + 0.5)
      .map(f => `${f.file}: claims ${String(f.documented)}% ${f.label}, measured ${String(f.actual)}%`);

    expect(overstated).toEqual([]);
  });

  it('does not quote a test count precise enough to rot', () => {
    // "58 browser-validation tests" is exempt by being three digits; the
    // guard targets the four-digit total, which is the figure that moves
    // on every PR.
    // `it.each` makes a static count wrong (1871 declarations, 2091
    // tests), and the artifact carries no count at all — so an exact
    // figure here can only be maintained by hand, which is what failed.
    for (const file of ['README.md', 'CLAUDE.md']) {
      const text = readFileSync(join(ROOT, file), 'utf-8');
      const exact = [...text.matchAll(/\b(\d{4,})\s+(?:passing|tests? pass)/g)]
        .map(m => m[1])
        .filter(n => !text.includes(`~${n}`));

      expect({ file, exact }).toEqual({ file, exact: [] });
    }
  });
});
