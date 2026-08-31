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

/**
 * #401: the table showed the first line of nineteen of the twenty-eight
 * descriptions and dropped the rest, because the extractor read one
 * quoted literal and most descriptions concatenate several.
 *
 * The drift guard above could not catch that: it compares the README
 * against the same extractor, so both were wrong together. These
 * assertions name the expected text literally instead.
 */
describe('the table carries whole descriptions, not first lines (#401)', () => {
  const readme = readFileSync(join(ROOT, 'README.md'), 'utf-8');
  const table = readme.slice(
    readme.indexOf('<!-- TOOLS:START -->'),
    readme.indexOf('<!-- TOOLS:END -->'),
  );

  function row(tool: string): string {
    const match = new RegExp(`^\\| \`${tool}\` \\| (.*?) \\|$`, 'm').exec(table);
    expect(match).not.toBeNull();
    return match?.[1] ?? '';
  }

  it.each([
    // The dropped fragments were the ones naming each consolidated
    // tool's discriminator — exactly what the table is read for.
    ['ai_assist', 'task=jam'],
    ['playback', 'action=stop'],
    ['analyze', 'include='],
    ['history', 'action='],
    ['edit_pattern', 'mode='],
  ])('%s carries text from past its first fragment', (tool, fragment) => {
    expect(row(tool)).toContain(fragment);
  });

  it('no row ends at a concatenation seam', () => {
    // Truncation left a trailing space where the ` + ` had been.
    const rows = [...table.matchAll(/^\| `([a-z_]+)` \| (.*?) \|$/gm)];
    expect(rows.length).toBeGreaterThan(0);
    const seams = rows.filter(m => (m[2] ?? '').endsWith(' ')).map(m => m[1]);
    expect(seams).toEqual([]);
  });

  it('every tool in the table has a description', () => {
    const rows = [...table.matchAll(/^\| `([a-z_]+)` \| (.*?) \|$/gm)];
    expect(rows.filter(m => (m[2] ?? '').trim() === '').map(m => m[1])).toEqual([]);
  });
});
