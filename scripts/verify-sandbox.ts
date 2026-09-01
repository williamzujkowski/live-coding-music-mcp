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

import { existsSync, unlinkSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StrudelEngine, EVALUATOR_EXPORTS } from '../src/services/StrudelEngine.js';
import { IsolatedStrudelEngine } from '../src/services/IsolatedStrudelEngine.js';
import { IsolatedRunnerError } from '../src/services/IsolatedEngineRunner.js';
import { MusicTheory } from '../src/services/MusicTheory.js';
import { PatternGenerator } from '../src/services/PatternGenerator.js';
import { DRUM_STYLES } from '../src/services/StyleRegistry.js';

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
    // Was `s("bd").fast(100000)`, which no longer reaches the cap check:
    // it is now caught earlier, by the empty-result check below, because
    // Strudel does not actually produce 100,000 events for it. A pattern
    // that genuinely exceeds the cap is the right subject for a test
    // about the cap's wording.
    try {
      engine.queryEvents('s("bd*200000")', 0, 1);
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

  console.log('\ns("bd").fast(100000) is refused, not answered with silence (#360):');
  {
    // Strudel does not produce 100,000 events for this. It throws
    // "Maximum call stack size exceeded" internally and returns an EMPTY
    // array — and before the density guard, materializing it cost 177 MB
    // to arrive at that nothing. Whichever guard catches it, the one
    // unacceptable outcome is a successful-looking result with zero
    // events, which tells an agent its working pattern is silent.
    try {
      const events = engine.queryEvents('s("bd").fast(100000)', 0, 1);
      failures++;
      console.error(`  FAIL  reported success with ${String(events.length)} events`);
    } catch (error: unknown) {
      const message = (error as Error).message;
      if (message.includes('cap') || message.includes('sampling it found some')) {
        console.log('  ok    refused, with a reason the caller can act on');
      } else {
        failures++;
        console.error(`  FAIL  wrong error: ${message.slice(0, 90)}`);
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

  // ---------------------------------------------------------------
  // Memory containment (#307)
  //
  // The allowlist stops a pattern doing anything interesting. It does not
  // stop one doing something LARGE, and until this ran out of process a
  // large one took the whole MCP server down — every session's browser
  // state with it.
  //
  // The payload below is not the one the issue named. `new Array(5e7)` is
  // refused before execution: NewExpression is not in the allowlist at
  // all, so the issue's stated PoC was already unreachable. This one is
  // reachable today, through a documented tool, with no exotic syntax:
  // `analyze_pattern_local` evaluates and queries a cycle with no event
  // cap (unlike `query_pattern_events`, which probes first), so a mini
  // pattern of ~10^10 events allocates until V8 aborts. Confirmed
  // in-process: node dies with FatalProcessOutOfMemory and never reaches
  // the next line.
  // ---------------------------------------------------------------
  console.log('\nMemory containment (#307):');
  {
    // Deliberately the pattern that gets PAST the #360 density guard: a
    // dense region hiding in the gap between two probe windows. That is
    // the residual #360 documents rather than claims to have closed, and
    // it is the reason this containment still has to hold. The payload
    // the guard now refuses would prove nothing here.
    const OOM_PATTERN = 's("~ [bd*99999]*99999 ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~")';
    const isolated = new IsolatedStrudelEngine({ maxOldSpaceMb: 128, timeoutMs: 15000 });
    const pid = process.pid;
    try {
      await isolated.analyzePattern(OOM_PATTERN);
      failures++;
      console.error(`  FAIL  ${OOM_PATTERN} was expected to exhaust the cap and did not`);
    } catch (error: unknown) {
      if (error instanceof IsolatedRunnerError && error.kind === 'oom') {
        console.log('  ok    heap-exhausting pattern killed the child, not the server');
      } else {
        failures++;
        const detail = error instanceof Error ? error.message : String(error);
        console.error(`  FAIL  expected an out-of-heap failure, got: ${detail}`);
      }
    }

    // This line running at all is the assertion. Before the fix the
    // process was already gone by here.
    if (process.pid === pid) {
      console.log('  ok    parent survived');
    } else {
      failures++;
      console.error('  FAIL  parent did not survive');
    }

    const after = await isolated.validate('s("bd sd")');
    if (after.valid) {
      console.log('  ok    engine respawned and the next call succeeded');
    } else {
      failures++;
      console.error(`  FAIL  engine did not recover: ${after.errors.join('; ')}`);
    }
    isolated.dispose();
  }

  // ---------------------------------------------------------------
  // Query density guard (#360)
  //
  // The old guard sampled the head of the requested range and
  // extrapolated. Measured, that left two holes, and the cheaper one
  // needed no exotic syntax at all — just a leading rest:
  //
  //   s("bd*200000")   -> refused correctly
  //   s("~ bd*200000") -> OUT OF HEAP
  //
  // Both halves matter, so both are checked: the dangerous patterns must
  // be refused, and the ordinary ones must NOT be. A guard that refuses
  // everything passes the first half on its own.
  // ---------------------------------------------------------------
  console.log('\nQuery density guard (#360):');
  {
    const MUST_REFUSE: Record<string, string> = {
      'dense from the first beat': 's("[bd*99999]*99999")',
      'dense after one rest': 's("~ [bd*99999]*99999")',
      'dense after three rests': 's("~ ~ ~ [bd*99999]*99999")',
      'over the cap, front-loaded': 's("bd*200000")',
      'over the cap, behind a rest': 's("~ bd*200000")',
    };

    for (const [name, code] of Object.entries(MUST_REFUSE)) {
      const started = Date.now();
      try {
        engine.queryEvents(code, 0, 1);
        failures++;
        console.error(`  FAIL  ${name} — was accepted; this should be refused`);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        if (/above the .* cap|roughly/.test(message)) {
          console.log(`  ok    ${name} refused in ${String(Date.now() - started)}ms`);
        } else {
          failures++;
          console.error(`  FAIL  ${name} — refused for the wrong reason: ${message}`);
        }
      }
    }

    // The other half: nothing real may be refused. A false refusal is a
    // user-visible regression, and this repo ranks it worse than a slow
    // one — so the corpus and the generator are the acceptance bar.
    let accepted = 0;
    const rejected: string[] = [];

    const exampleDir = 'patterns/examples';
    for (const genre of readdirSync(exampleDir, { withFileTypes: true })) {
      if (!genre.isDirectory()) continue;
      for (const file of readdirSync(`${exampleDir}/${genre.name}`)) {
        if (!file.endsWith('.json')) continue;
        const parsed = JSON.parse(
          readFileSync(`${exampleDir}/${genre.name}/${file}`, 'utf8')
        ) as { pattern?: string };
        if (typeof parsed.pattern !== 'string') continue;
        try {
          engine.queryEvents(parsed.pattern, 0, 2);
          accepted++;
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : String(error);
          if (/above the .* cap|roughly/.test(message)) rejected.push(`${genre.name}/${file}`);
          else accepted++; // a syntax problem is a different test's business
        }
      }
    }

    const generator = new PatternGenerator();
    for (const style of DRUM_STYLES) {
      const generated = generator.generateCompletePattern(style, 'C', 120);
      try {
        engine.queryEvents(generated, 0, 2);
        accepted++;
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        if (/above the .* cap|roughly/.test(message)) rejected.push(`generated:${style}`);
        else accepted++;
      }
    }

    if (rejected.length > 0) {
      failures++;
      console.error(`  FAIL  the guard refused ${String(rejected.length)} real pattern(s): ${rejected.join(', ')}`);
    } else {
      console.log(`  ok    ${String(accepted)} real patterns (corpus + every generator style) all accepted`);
    }
  }

  // A generated fill really does span the bars it claims.
  //
  // This lives here, not in Jest, because it needs the REAL engine:
  // @strudel/core is ESM and Jest is not configured for it, so a unit
  // test can only assert the generated string. `bars` used to append
  // `.fast(N)`, which compresses the fill into 1/N of one cycle — so
  // the output occupied a single bar however large `bars` got, while
  // the schema promised a length and the handler reported one (#482).
  {
    const engine = new StrudelEngine();
    const generator = new PatternGenerator();
    const fill = generator.generateFill('techno', 4);
    const counts: number[] = [];
    for (let cycle = 0; cycle < 5; cycle++) {
      const haps = await engine.queryEvents(fill, cycle, cycle + 1);
      counts.push(Array.isArray(haps) ? haps.length : 0);
    }
    // Three bars of the figure, a busier fourth, then back to the top.
    const spans = counts[0] > 0
      && counts[1] === counts[0] && counts[2] === counts[0]
      && counts[3] > counts[0] && counts[4] === counts[0];
    if (spans) {
      console.log(`  ok    a 4-bar fill spans 4 cycles [${counts.join(', ')}]`);
    } else {
      failures++;
      console.error(`  FAIL  4-bar fill did not span 4 cycles: [${counts.join(', ')}]`);
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
