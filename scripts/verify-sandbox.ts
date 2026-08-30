#!/usr/bin/env npx tsx
/**
 * End-to-end containment check for the local pattern engine (#229).
 *
 * `StrudelEngine` imports @strudel/core as ESM, which this repo's Jest
 * setup cannot load — every case in `StrudelEngine.test.ts` therefore runs
 * against the canned mock in `src/services/__mocks__/`, not the real
 * engine. That is exactly the kind of gap that let the RCE live: the unit
 * tier structurally could not see it.
 *
 * This script runs the real engine. Each attack must be refused and each
 * legitimate pattern must survive; a single failure exits non-zero.
 *
 * Usage:
 *   npm run test:sandbox
 */

/* eslint-disable no-console */

import { existsSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StrudelEngine } from '../src/services/StrudelEngine.js';

// A pattern that escaped the sandbox would create this file.
const MARKER = join(tmpdir(), 'strudel-sandbox-escape-marker');

/** Patterns that must never execute. */
const ATTACKS: Record<string, string> = {
  'dynamic import (original PoC)':
    `import('fs').then(fs=>fs.writeFileSync(${JSON.stringify(MARKER)},'x')); s('bd')`,
  'Function ctor via host function':
    `mini.constructor.constructor('return process')(); s('bd')`,
  'Function ctor via computed access':
    `mini['constructor']['constructor']('return process')(); s('bd')`,
  'computed key built at runtime':
    `const k='cons'+'tructor'; mini[k][k]('return process')(); s('bd')`,
  'direct process reference': `process.env.HOME; s('bd')`,
  'require': `require('child_process').execSync('id'); s('bd')`,
  'globalThis': `globalThis.process.exit(1); s('bd')`,
  'eval': `eval('1+1'); s('bd')`,
  'runaway loop (DoS)': `while(true){}; s('bd')`,
};

/** Patterns that must keep working. */
const LEGITIMATE: string[] = [
  's("bd hh sd hh")',
  'note("c3 e3 g3").s("sawtooth").lpf(800)',
  'stack(s("bd*4"), s("~ sd")).slow(2)',
  's("bd*4").gain(0.8).room(0.3)',
  'const x = 4; s("bd*4").fast(x)',
  's("bd").every(4, x => x.fast(2))',
  'seq(s("bd"), s("sd")).cpm(120)',
  'note("c a f e").sometimesBy(0.3, x => x.speed(2))',
  // @strudel/tonal is loaded into the context (#232); these used to fail
  // with "n(...).scale is not a function" while the browser accepted them.
  'n("0 2 4").scale("C:minor")',
  'note("c e g").transpose(2)',
  'n("0 2 4").scale("C:major").voicing()',
];

async function main(): Promise<void> {
  // A dynamic import that escapes settles asynchronously; don't let the
  // rejection abort the run before we can report it.
  process.on('unhandledRejection', () => {});

  if (existsSync(MARKER)) unlinkSync(MARKER);

  const engine = new StrudelEngine();
  let failures = 0;

  console.log('Attacks (all must be refused):');
  for (const [name, code] of Object.entries(ATTACKS)) {
    const result = engine.validate(code);
    if (result.valid) {
      failures++;
      console.error(`  FAIL  ${name} — engine reported this as VALID`);
    } else {
      console.log(`  ok    ${name}`);
    }
  }

  // Give an escaped async write a chance to land before checking.
  await new Promise(resolve => setTimeout(resolve, 750));
  if (existsSync(MARKER)) {
    failures++;
    console.error(`  FAIL  sandbox escaped: ${MARKER} was written`);
    unlinkSync(MARKER);
  } else {
    console.log('  ok    no file written by any attack');
  }

  console.log('\nLegitimate patterns (all must stay valid):');
  for (const code of LEGITIMATE) {
    const result = engine.validate(code);
    if (result.valid) {
      console.log(`  ok    ${code}`);
    } else {
      failures++;
      console.error(`  FAIL  ${code} — ${result.errors.join('; ')}`);
    }
  }

  if (failures > 0) {
    console.error(`\n${String(failures)} check(s) failed.`);
    process.exit(1);
  }
  console.log('\nAll sandbox containment checks passed.');
}

main().catch((error: unknown) => {
  console.error('verify-sandbox crashed:', error);
  process.exit(1);
});
