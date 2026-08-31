/**
 * Latency benchmark harness — measures the operations documented in
 * CLAUDE.md's "Performance Characteristics" table.
 *
 * Runs each operation N times against a real Playwright-backed
 * StrudelController, reports median + p95, and optionally fails if any
 * p95 exceeds 1.5× the documented target.
 *
 * Usage:
 *   tsx src/__tests__/benchmarks/latency.benchmark.ts [--runs=50] [--gate]
 *
 * Output:
 *   - Markdown summary on stdout
 *   - JSON report at benchmarks/results/latest.json (if --out= not given)
 *   - Non-zero exit if --gate and any p95 > 1.5× target
 */

import { StrudelController } from '../../StrudelController.js';
import { IsolatedStrudelEngine } from '../../services/IsolatedStrudelEngine.js';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

interface Target {
  name: string;
  targetP95Ms: number;
  runs?: number;
}

interface OpResult {
  name: string;
  targetP95Ms: number;
  runs: number;
  samplesMs: number[];
  medianMs: number;
  p95Ms: number;
  minMs: number;
  maxMs: number;
  passed: boolean;
}

// Documented targets from CLAUDE.md. Keep this table in sync when targets change.
const TARGETS: Target[] = [
  { name: 'init', targetP95Ms: 2000, runs: 5 },                   // 1.5–2s documented; small N (expensive)
  { name: 'writePattern', targetP95Ms: 80 },                       // <80ms documented
  { name: 'getCurrentPattern.uncached', targetP95Ms: 200, runs: 20 },
  { name: 'getCurrentPattern.cached', targetP95Ms: 15 },
  { name: 'play', targetP95Ms: 150 },
  { name: 'stop', targetP95Ms: 150 },
  { name: 'getAnalysis', targetP95Ms: 15 },
  { name: 'detectTempo', targetP95Ms: 100 },
  { name: 'detectKey', targetP95Ms: 100 },
  // #307 moved local-engine evaluation into a forked child. The whole
  // argument for a PERSISTENT child rather than a fork per call rests on
  // the warm number, so it is gated. Measured here under tsx (which the
  // child pays a loader cost for); from dist it is faster, never slower.
  { name: 'localEngine.coldStart', targetP95Ms: 500, runs: 3 },
  { name: 'localEngine.warmCall', targetP95Ms: 5, runs: 40 },
];

const GATE_MULTIPLIER = 1.5;

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[mid - 1] + s[mid]) / 2 : s[mid];
}

function percentile(xs: number[], p: number): number {
  const s = [...xs].sort((a, b) => a - b);
  const idx = Math.ceil((p / 100) * s.length) - 1;
  return s[Math.max(0, Math.min(idx, s.length - 1))];
}

async function time<T>(fn: () => Promise<T>): Promise<{ ms: number; value: T }> {
  const t0 = performance.now();
  const value = await fn();
  return { ms: performance.now() - t0, value };
}

function parseArgs() {
  const args = process.argv.slice(2);
  const runs = Number((args.find(a => a.startsWith('--runs='))?.split('=')[1]) ?? 50);
  const gate = args.includes('--gate');
  const out = args.find(a => a.startsWith('--out='))?.split('=')[1] ?? 'benchmarks/results/latest.json';
  return { runs, gate, out };
}

async function main() {
  const { runs: defaultRuns, gate, out } = parseArgs();

  console.log(`# Strudel MCP — latency benchmark`);
  console.log(`runs per op (default): ${defaultRuns}`);
  console.log(`gate: ${gate ? `FAIL if p95 > ${GATE_MULTIPLIER}× target` : 'off'}`);
  console.log();

  const results: OpResult[] = [];

  // Local engine first: it needs no browser, so it still reports on a
  // machine where Playwright is unavailable.
  const coldTarget = TARGETS.find(t => t.name === 'localEngine.coldStart')!;
  const coldSamples: number[] = [];
  for (let i = 0; i < (coldTarget.runs ?? 3); i++) {
    const engine = new IsolatedStrudelEngine();
    const r = await time(() => engine.validate('s("bd*4")'));
    coldSamples.push(r.ms);
    engine.dispose();
  }
  results.push(summarize(coldTarget, coldSamples));

  const warmEngine = new IsolatedStrudelEngine();
  await warmEngine.validate('s("bd")'); // pay the fork before measuring
  const warmTarget = TARGETS.find(t => t.name === 'localEngine.warmCall')!;
  const warmSamples = await measure(warmTarget.runs ?? 40, () =>
    warmEngine.validate('setcpm(120)\nstack(s("bd*4"), s("hh*8"))'));
  results.push(summarize(warmTarget, warmSamples));
  warmEngine.dispose();

  // init is measured separately — each run destroys and recreates the browser
  const initTarget = TARGETS.find(t => t.name === 'init')!;
  const initRuns = initTarget.runs ?? 5;
  const initSamples: number[] = [];
  for (let i = 0; i < initRuns; i++) {
    const controller = new StrudelController(true); // headless for CI
    const r = await time(() => controller.initialize());
    initSamples.push(r.ms);
    await controller.cleanup();
  }
  results.push(summarize(initTarget, initSamples));

  // All other ops share a single browser instance.
  const controller = new StrudelController(true);
  await controller.initialize();

  try {
    // Seed a pattern so play/analysis have something to do.
    const pattern = `setcpm(120)\nstack(s("bd*4"), s("~ cp ~ cp"), s("hh*8").gain(0.5))`;
    await controller.writePattern(pattern);
    await controller.play();
    await new Promise(r => setTimeout(r, 2000)); // let audio warm up

    // writePattern
    const writeTarget = TARGETS.find(t => t.name === 'writePattern')!;
    const writeSamples = await measure(writeTarget.runs ?? defaultRuns,
      () => controller.writePattern(pattern));
    results.push(summarize(writeTarget, writeSamples));

    // getCurrentPattern uncached (invalidate between calls)
    const uncachedTarget = TARGETS.find(t => t.name === 'getCurrentPattern.uncached')!;
    const uncachedSamples = await measure(uncachedTarget.runs ?? 20, async () => {
      controller.invalidateCache();
      return controller.getCurrentPattern();
    });
    results.push(summarize(uncachedTarget, uncachedSamples));

    // getCurrentPattern cached (back-to-back reads within TTL)
    await controller.getCurrentPattern();
    const cachedTarget = TARGETS.find(t => t.name === 'getCurrentPattern.cached')!;
    const cachedSamples = await measure(cachedTarget.runs ?? defaultRuns,
      () => controller.getCurrentPattern());
    results.push(summarize(cachedTarget, cachedSamples));

    // play / stop — alternate
    const playTarget = TARGETS.find(t => t.name === 'play')!;
    const stopTarget = TARGETS.find(t => t.name === 'stop')!;
    const playSamples: number[] = [];
    const stopSamples: number[] = [];
    const alternations = Math.min(defaultRuns, 10); // play/stop churn is expensive
    for (let i = 0; i < alternations; i++) {
      const s = await time(() => controller.stop());
      stopSamples.push(s.ms);
      const p = await time(() => controller.play());
      playSamples.push(p.ms);
    }
    results.push(summarize(playTarget, playSamples));
    results.push(summarize(stopTarget, stopSamples));

    // Make sure audio is flowing again for analysis ops
    await new Promise(r => setTimeout(r, 1500));

    const analysisTarget = TARGETS.find(t => t.name === 'getAnalysis')!;
    const analysisSamples = await measure(analysisTarget.runs ?? defaultRuns,
      () => controller.analyzeAudio());
    results.push(summarize(analysisTarget, analysisSamples));

    const tempoTarget = TARGETS.find(t => t.name === 'detectTempo')!;
    const tempoSamples = await measure(tempoTarget.runs ?? defaultRuns,
      () => controller.detectTempo());
    results.push(summarize(tempoTarget, tempoSamples));

    const keyTarget = TARGETS.find(t => t.name === 'detectKey')!;
    const keySamples = await measure(keyTarget.runs ?? defaultRuns,
      () => controller.detectKey());
    results.push(summarize(keyTarget, keySamples));
  } finally {
    await controller.cleanup();
  }

  // Report
  report(results);

  // Persist
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify({
    timestamp: new Date().toISOString(),
    gateMultiplier: GATE_MULTIPLIER,
    results,
  }, null, 2));
  console.log(`\nJSON report: ${out}`);

  if (gate) {
    const failed = results.filter(r => !r.passed);
    if (failed.length > 0) {
      console.error(`\nGATE FAILED: ${failed.length} operation(s) exceeded ${GATE_MULTIPLIER}× target.`);
      for (const r of failed) {
        console.error(`  ${r.name}: p95=${r.p95Ms.toFixed(1)}ms > gate=${(r.targetP95Ms * GATE_MULTIPLIER).toFixed(1)}ms`);
      }
      process.exit(1);
    }
    console.log(`\nGATE PASSED: all operations within ${GATE_MULTIPLIER}× target.`);
  }
}

async function measure(runs: number, fn: () => Promise<unknown>): Promise<number[]> {
  const samples: number[] = [];
  for (let i = 0; i < runs; i++) {
    const r = await time(fn);
    samples.push(r.ms);
  }
  return samples;
}

function summarize(target: Target, samples: number[]): OpResult {
  const p95Ms = percentile(samples, 95);
  return {
    name: target.name,
    targetP95Ms: target.targetP95Ms,
    runs: samples.length,
    samplesMs: samples,
    medianMs: median(samples),
    p95Ms,
    minMs: Math.min(...samples),
    maxMs: Math.max(...samples),
    passed: p95Ms <= target.targetP95Ms * GATE_MULTIPLIER,
  };
}

function report(results: OpResult[]) {
  console.log('\n| operation | runs | median | p95 | target | gate (1.5×) | status |');
  console.log('|---|---:|---:|---:|---:|---:|:---:|');
  for (const r of results) {
    const status = r.passed ? 'pass' : 'FAIL';
    console.log(`| \`${r.name}\` | ${r.runs} | ${r.medianMs.toFixed(1)}ms | ${r.p95Ms.toFixed(1)}ms | ${r.targetP95Ms}ms | ${(r.targetP95Ms * GATE_MULTIPLIER).toFixed(0)}ms | ${status} |`);
  }
}

main().catch(err => {
  console.error('Benchmark failed:', err);
  process.exit(2);
});
