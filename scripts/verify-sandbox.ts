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
import { StrudelEngine, EVALUATOR_EXPORTS } from '../src/services/StrudelEngine.js';
import { MusicTheory } from '../src/services/MusicTheory.js';

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

/** Real Strudel functions the local engine cannot evaluate (#232). */
const BROWSER_ONLY: string[] = [
  'setcpm(120)',
  'hush()',
  's("bd").pianoroll()',
  'samples("github:tidalcycles/dirt-samples")',
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

  console.log('\nBrowser-only functions are named, not blamed on the pattern:');
  for (const code of BROWSER_ONLY) {
    const result = engine.validate(code);
    const explained = !result.valid && result.errors.join(' ').includes('real Strudel function');
    if (explained) {
      console.log(`  ok    ${code}`);
    } else {
      failures++;
      console.error(`  FAIL  ${code} — ${result.errors.join('; ').slice(0, 70)}`);
    }
  }

  console.log('\nAnalysis reports whether it actually measured (#276):');
  {
    const unevaluatable = engine.analyzePattern('setcpm(120); s("bd*4")');
    const valid = engine.analyzePattern('s("bd*4")');

    const cases: [string, boolean, string][] = [
      ['unevaluatable pattern marked not evaluated', unevaluatable.evaluated === false, ''],
      ['valid pattern marked evaluated', valid.evaluated === true, ''],
      ['valid pattern has a real event count', valid.eventsPerCycle > 0,
        `eventsPerCycle=${String(valid.eventsPerCycle)}`],
      ['failure explains itself in the caller\'s terms',
        (unevaluatable.evaluationError ?? '').includes('real Strudel function'),
        (unevaluatable.evaluationError ?? '').slice(0, 50)],
      ['static analysis still reported', unevaluatable.bpm === 120, ''],
    ];

    for (const [label, pass, detail] of cases) {
      if (pass) {
        console.log(`  ok    ${label}`);
      } else {
        failures++;
        console.error(`  FAIL  ${label} ${detail}`);
      }
    }
  }

  console.log('\nqueryEvents explains browser-only calls, like validate does (#232):');
  try {
    engine.queryEvents('setcpm(120); s("bd*4")', 0, 1);
    failures++;
    console.error('  FAIL  expected a throw');
  } catch (error: unknown) {
    const message = (error as Error).message;
    const explained = message.includes('real Strudel function');
    const notATypo = !message.includes('unknown identifier');
    if (explained && notATypo) {
      console.log('  ok    names the function instead of calling it unknown');
    } else {
      failures++;
      console.error(`  FAIL  ${message.slice(0, 80)}`);
    }
  }

  console.log('\nEvaluator exports are stripped from the context (#SANDBOX):');
  {
    const context = (engine as unknown as { context: Record<string, unknown> }).context;
    for (const name of EVALUATOR_EXPORTS) {
      if (Object.prototype.hasOwnProperty.call(context, name)) {
        failures++;
        console.error(`  FAIL  '${name}' is still reachable from a pattern`);
      }
    }
    if (Object.keys(context).length < 500) {
      failures++;
      console.error(`  FAIL  context has only ${String(Object.keys(context).length)} keys — the strip was too broad`);
    }
    console.log(`  ok    ${String(EVALUATOR_EXPORTS.length)} evaluator exports absent, ${String(Object.keys(context).length)} functions retained`);
  }

  // The transpiler rewrites DOUBLE-quoted literals into mini() calls, so
  // a payload must use single quotes to survive as executable code. A
  // check written with double quotes passes for the wrong reason.
  console.log('\nSandbox escape routes are refused (#SANDBOX):');
  const escapes: [string, string][] = [
    ['member .constructor', "note('c3').constructor"],
    ['shorthand destructure', "const { constructor } = note; note('c3')"],
    ['renamed destructure', "const { constructor: C } = note; note('c3')"],
    ['param destructure', "const f = ({ constructor: C }) => C; f(note); note('c3')"],
    ['for-of destructure', "for (const { constructor: C } of [note]) { C; } note('c3')"],
    ['nested __proto__', "const { __proto__: { constructor: C } } = note; note('c3')"],
    ['assignment pattern', "let C; ({ constructor: C } = note); note('c3')"],
    ['computed object key', "const o = { ['constructor']: 1 }; note('c3')"],
    ['evaluate()', "evaluate('1+1'); note('c3')"],
    ['evalScope()', "evalScope('1+1'); note('c3')"],
  ];
  for (const [label, code] of escapes) {
    if (engine.validate(code).valid) {
      failures++;
      console.error(`  FAIL  ${label} was ACCEPTED`);
    } else {
      console.log(`  ok    ${label} refused`);
    }
  }

  console.log('\nA refused pattern leaves the host realm untouched:');
  {
    const marker = '__verify_sandbox_probe__';
    (globalThis as unknown as Record<string, unknown>)[marker] = 'untouched';
    engine.validate(
      `const { constructor: C } = note; C('globalThis.${marker} = \\'escaped\\'')(); note('c3')`);
    engine.validate(`evaluate('globalThis.${marker} = \\'escaped\\''); note('c3')`);
    const value = (globalThis as unknown as Record<string, unknown>)[marker];
    if (value !== 'untouched') {
      failures++;
      console.error(`  FAIL  host globalThis was modified: ${String(value)}`);
    } else {
      console.log('  ok    host globalThis untouched');
    }
    delete (globalThis as unknown as Record<string, unknown>)[marker];
  }

  console.log('\nLegitimate patterns still validate:');
  for (const code of [
    's("bd*4")',
    'note("c3 e3 g3").s("piano")',
    'stack(s("bd*4"), s("hh*8")).gain(0.7)',
    'const a = s("bd*4"); a.fast(2)',
    's("bd").every(4, x => x.fast(2))',
    'n("0 2 4").scale("C:minor")',
  ]) {
    if (!engine.validate(code).valid) {
      failures++;
      console.error(`  FAIL  the fix broke a real pattern: ${code}`);
    }
  }
  console.log('  ok    6 real patterns unaffected');

  console.log('\nEvent materialization is capped before it allocates (#307):');
  {
    // queryArc builds the whole array, so a cap on its result arrives
    // after the memory is gone. A 20-character pattern reached 153 MB;
    // a slightly larger multiplier ended in V8 FatalProcessOutOfMemory,
    // which no try/catch can intercept.
    const cases: [string, number, number, boolean][] = [
      ['s("bd*4")', 0, 1, true],
      ['s("bd*16")', 0, 16, true],
      ['s("bd").fast(1000)', 0, 1, true],
      ['s("bd").fast(100000)', 0, 1, false],
      ['s("bd").fast(20000000)', 0, 1, false],
    ];
    for (const [code, from, to, shouldPass] of cases) {
      const before = process.memoryUsage().heapUsed;
      let passed: boolean;
      try {
        engine.queryEvents(code, from, to);
        passed = true;
      } catch {
        passed = false;
      }
      const grewMb = (process.memoryUsage().heapUsed - before) / 1048576;
      if (passed !== shouldPass) {
        failures++;
        console.error(`  FAIL  ${code} ${passed ? 'was allowed' : 'was refused'}, expected the opposite`);
      } else if (!shouldPass && grewMb > 50) {
        failures++;
        console.error(`  FAIL  ${code} was refused but still allocated ${grewMb.toFixed(0)} MB`);
      } else {
        console.log(`  ok    ${code.padEnd(24)} ${passed ? 'allowed' : 'refused'} (+${grewMb.toFixed(1)} MB)`);
      }
    }
  }

  console.log('\nThe refusal says what to do about it:');
  {
    try {
      engine.queryEvents('s("bd").fast(100000)', 0, 1);
      failures++;
      console.error('  FAIL  expected a refusal');
    } catch (error: unknown) {
      const message = (error as Error).message;
      if (message.includes('cap') && message.includes('fast')) {
        console.log('  ok    names the cap and the usual cause');
      } else {
        failures++;
        console.error(`  FAIL  unhelpful message: ${message.slice(0, 80)}`);
      }
    }
  }

  console.log('\nEuclidean rhythms match Strudel\'s own bjork() (#319):');
  {
    // Jest cannot import @strudel/core (ESM), so the exhaustive
    // comparison lives here, where the real module is already loaded.
    // The Jest tests pin literal values READ OUT OF STRUDEL; this
    // proves those literals were not cherry-picked.
    const strudel = await import('@strudel/core');
    const bjork = (strudel as unknown as { bjork?: (k: number, n: number) => boolean[] }).bjork;
    if (typeof bjork !== 'function') {
      console.log('  skip  @strudel/core no longer exports bjork');
    } else {
      let compared = 0;
      let mismatched = 0;
      let firstMismatch = '';
      for (let n = 1; n <= 32; n++) {
        for (let k = 1; k <= n; k++) {
          const theirs = bjork(k, n).map(x => (x ? 1 : 0)).join('');
          const mine = MusicTheory.bjorklund(k, n).map(x => (x ? 1 : 0)).join('');
          compared++;
          if (theirs !== mine) {
            mismatched++;
            if (!firstMismatch) firstMismatch = `E(${String(k)},${String(n)}) strudel=${theirs} ours=${mine}`;
          }
        }
      }
      if (mismatched > 0) {
        failures++;
        console.error(`  FAIL  ${String(mismatched)}/${String(compared)} differ, e.g. ${firstMismatch}`);
      } else {
        console.log(`  ok    ${String(compared)} (k,n) pairs up to n=32, zero differences`);
      }
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
