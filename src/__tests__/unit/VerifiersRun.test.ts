/**
 * Every verifier either runs in CI or says why it cannot (#388).
 *
 * Three times in one day a check was present, documented, and
 * structurally unable to fire:
 *
 *   `test:sandbox` — the RCE and memory-containment checks, written
 *   because Jest cannot load @strudel/*, never wired into a workflow
 *   (#376).
 *
 *   The nightly benchmark gate — `--gate | tee`, so the pipeline's exit
 *   status was tee's and `process.exit(1)` could not fail the job. Five
 *   consecutive runs reported success while the gate was mute.
 *
 *   `verify-export-audio.ts` — written BECAUSE mocking the MediaRecorder
 *   boundary is how `audio_capture` shipped broken, and CI never ran it.
 *
 * The pattern is not carelessness about writing checks. It is that
 * writing the check feels like finishing the work, and nothing checked
 * the checkers. This does.
 */

import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.join(__dirname, '..', '..', '..');
const SCRIPTS = path.join(ROOT, 'scripts');
const WORKFLOWS = path.join(ROOT, '.github', 'workflows');

/** A verifier is a script whose job is to fail when something is wrong. */
const VERIFIERS = readdirSync(SCRIPTS).filter(f => f.startsWith('verify-') && f.endsWith('.ts'));

/**
 * Workflow text with comments stripped.
 *
 * Searching the raw file was a false pass: a COMMENT in benchmark.yml
 * mentioning "test:sandbox" satisfied the guard after I deleted the step
 * that actually ran it. A guard that a comment can satisfy is not a
 * guard — caught by reverting all three historical failures instead of
 * assuming the first one that failed proved the rest.
 */
const ALL_WORKFLOW_TEXT = readdirSync(WORKFLOWS)
  .filter(f => f.endsWith('.yml') || f.endsWith('.yaml'))
  .map(f => readFileSync(path.join(WORKFLOWS, f), 'utf8'))
  .join('\n')
  .split('\n')
  .filter(line => !/^\s*#/.test(line))
  .join('\n');

const PACKAGE = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as {
  scripts: Record<string, string>;
};

/** The npm script that runs a verifier, if one exists. */
function npmScriptFor(file: string): string | undefined {
  return Object.entries(PACKAGE.scripts).find(([, cmd]) => cmd.includes(file))?.[0];
}

describe('verifiers are wired to something that runs them (#388)', () => {
  it('finds the verifiers', () => {
    expect(VERIFIERS.length).toBeGreaterThanOrEqual(3);
  });

  it.each(VERIFIERS)('%s runs in CI, or states why it cannot', file => {
    const source = readFileSync(path.join(SCRIPTS, file), 'utf8');
    const npmScript = npmScriptFor(file);

    const referencedDirectly = ALL_WORKFLOW_TEXT.includes(file);
    const referencedByScript = npmScript !== undefined && ALL_WORKFLOW_TEXT.includes(npmScript);
    const declaredManual = /Cannot run in CI:/.test(source);

    if (referencedDirectly || referencedByScript) return;

    // The escape hatch has to be a stated reason, not silence. A script
    // that neither runs nor explains itself is the failure this guards.
    expect(declaredManual).toBe(true);
  });

  it('the benchmark gate can fail the job', () => {
    // `--gate ... | tee` made the pipeline's status tee's, so exit(1)
    // was swallowed. Nothing about the workflow looked wrong.
    const workflow = readFileSync(path.join(WORKFLOWS, 'benchmark.yml'), 'utf8');
    const gateStep = workflow.slice(workflow.indexOf('Run latency benchmark'));
    if (/\|\s*tee/.test(gateStep)) {
      expect(gateStep).toMatch(/set -o pipefail/);
    }
  });

  it('every verifier can actually fail', () => {
    // A verifier that never exits non-zero is decoration.
    for (const file of VERIFIERS) {
      const source = readFileSync(path.join(SCRIPTS, file), 'utf8');
      expect(source).toMatch(/process\.exit\(1\)/);
    }
  });
});
