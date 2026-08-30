/**
 * Drift guard for the auto-generated README tool table (#123).
 *
 * Runs the same `generate-tool-docs.ts check` invocation CI runs, but
 * during the local Jest run. Catches drift even when CI's tool-docs
 * step is missed (e.g. forks, local PRs not yet pushed) and even when
 * the prebuild step is bypassed.
 *
 * If this test fails, run `npm run build` (or `npx tsx
 * scripts/generate-tool-docs.ts`) and commit the README change.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..', '..', '..');

describe('README tool table drift guard', () => {
  it('README tool list matches source', () => {
    expect(() =>
      execFileSync('npx', ['tsx', 'scripts/generate-tool-docs.ts', 'check'], {
        cwd: ROOT,
        stdio: 'pipe',
      }),
    ).not.toThrow();
  });

  /**
   * #221: the badge and generated table said 27 while Quick Start and the
   * troubleshooting snippet still said 26, so a user following Quick Start
   * was told their build was stale when it was fine. Every hand-written
   * count must agree with the generated one.
   */
  it('every tool count in README agrees', () => {
    const readme = readFileSync(join(ROOT, 'README.md'), 'utf-8');

    const counts: Record<string, number[]> = {
      badge: [...readme.matchAll(/tools-(\d+)-green/g)].map(m => Number(m[1])),
      featureBullet: [...readme.matchAll(/\*\*(\d+) MCP tools\*\*/g)].map(m => Number(m[1])),
      generatedTable: [...readme.matchAll(/\*\*(\d+) tools\*\* across/g)].map(m => Number(m[1])),
      generatedFooter: [...readme.matchAll(/(\d+) tools registered/g)].map(m => Number(m[1])),
      quickStart: [...readme.matchAll(/listing \*\*(\d+) tools\*\*/g)].map(m => Number(m[1])),
      troubleshooting: [...readme.matchAll(/# Should return JSON with (\d+) tools/g)].map(m => Number(m[1])),
    };

    // A mention that stopped matching would silently disable the guard,
    // so assert every pattern still finds something before comparing values.
    const missing = Object.entries(counts)
      .filter(([, found]) => found.length === 0)
      .map(([label]) => label);
    expect(missing).toEqual([]);

    // All mentions must report the same number.
    expect(Object.fromEntries(Object.entries(counts).map(([k, v]) => [k, [...new Set(v)]])))
      .toEqual(
        Object.fromEntries(Object.keys(counts).map(k => [k, [counts.generatedFooter[0]]])),
      );
  });
});
