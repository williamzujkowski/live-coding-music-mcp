/**
 * Locates the isolated-engine child entrypoint (#307).
 *
 * This is its own module, reached by dynamic import, for one reason:
 * `import.meta` is a **parse error** under this project's Jest setup,
 * which runs the codebase as CommonJS (there is no
 * `--experimental-vm-modules`). Any module that so much as mentions
 * `import.meta` becomes unimportable from a test, and the runner has to
 * stay testable. Tests pass an explicit child path, so they never load
 * this file. Same reason `scripts/` is the only other place using it.
 */

import { fileURLToPath } from 'node:url';
import path from 'node:path';

export interface ChildEntrypoint {
  childPath: string;
  /** True when running from TypeScript sources, which the child needs a loader for. */
  needsTsx: boolean;
}

/**
 * Resolves the child entrypoint as a sibling of this module, matching the
 * extension we are ourselves running as: `.js` from `dist/`, `.ts` under
 * `tsx`.
 *
 * @returns Absolute path to the child, and whether it needs a TS loader
 */
export function resolveChildEntrypoint(): ChildEntrypoint {
  const here = fileURLToPath(import.meta.url);
  const needsTsx = here.endsWith('.ts');
  return {
    childPath: path.join(path.dirname(here), needsTsx ? 'engineChild.ts' : 'engineChild.js'),
    needsTsx,
  };
}
