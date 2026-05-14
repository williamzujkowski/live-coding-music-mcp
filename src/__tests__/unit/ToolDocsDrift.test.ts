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
import { join } from 'node:path';

describe('README tool table drift guard', () => {
  it('README tool list matches source', () => {
    const root = join(__dirname, '..', '..', '..');
    expect(() =>
      execFileSync('npx', ['tsx', 'scripts/generate-tool-docs.ts', 'check'], {
        cwd: root,
        stdio: 'pipe',
      }),
    ).not.toThrow();
  });
});
