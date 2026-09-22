/**
 * Dumps `_onsetHistory` from real headless playback, one snapshot per
 * poll, so tempo-detection work can be iterated offline.
 *
 * Iterating a tempo bug against the browser is slow and the audio is
 * never twice the same, which is how three confident and wrong
 * diagnoses got filed on #370 before one measured. Capture once, then
 * replay the captured onsets through `tempoFromOnsets` as many times as
 * it takes — offline replay reproduces the live reading exactly, which
 * is the property that makes this worth having.
 *
 * Fixtures in `src/__tests__/fixtures/` were produced with this.
 *
 *   npx tsx scripts/capture-onsets.ts out.json
 *   WARMUP_MS=1200 POLL_GAP_MS=1200 npx tsx scripts/capture-onsets.ts short.json
 *
 * A short warmup is not a lesser run. It is how the sparse-style
 * readings in #419 were reproduced: the median fallback only answers
 * while there are too few onsets for autocorrelation, so a generous
 * warmup hides the branch entirely.
 */
import { writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { StrudelController } from '../src/StrudelController.js';
import { PatternGenerator } from '../src/services/PatternGenerator.js';

const ROOT = join(import.meta.dirname, '..');
const OUT = process.argv[2] ?? 'capture.json';
const POLLS = 4;
const WARMUP_MS = Number(process.env.WARMUP_MS ?? 5000);
const POLL_GAP_MS = Number(process.env.POLL_GAP_MS ?? 2500);

interface Snapshot {
  poll: number;
  bpm: number;
  confidence: number;
  alternatives?: unknown;
  onsets: { t: number; strength: number }[];
}
interface Case {
  label: string;
  declaredBpm: number;
  pattern: string;
  snapshots: Snapshot[];
}

function amenBreak(): string {
  const raw = JSON.parse(
    readFileSync(join(ROOT, 'patterns/examples/jungle/amen-break.json'), 'utf8')
  );
  return raw.pattern as string;
}

async function main(): Promise<void> {
  const gen = new PatternGenerator();
  const cases: Array<{ label: string; declaredBpm: number; pattern: string }> = [
    { label: 'amen-break', declaredBpm: 165, pattern: amenBreak() },
    { label: 'gen/ambient', declaredBpm: 130, pattern: gen.generateCompletePattern('ambient', 'C', 130) },
    { label: 'gen/jungle', declaredBpm: 130, pattern: gen.generateCompletePattern('jungle', 'C', 130) },
    { label: 'gen/techno', declaredBpm: 130, pattern: gen.generateCompletePattern('techno', 'C', 130) },
    { label: 'gen/house', declaredBpm: 130, pattern: gen.generateCompletePattern('house', 'C', 130) },
    { label: 'gen/dnb', declaredBpm: 130, pattern: gen.generateCompletePattern('dnb', 'C', 130) },
    { label: 'gen/trap', declaredBpm: 130, pattern: gen.generateCompletePattern('trap', 'C', 130) },
    { label: 'gen/experimental', declaredBpm: 130, pattern: gen.generateCompletePattern('experimental', 'C', 130) },
    { label: 'gen/intelligent_dnb', declaredBpm: 130, pattern: gen.generateCompletePattern('intelligent_dnb', 'C', 130) },
  ];

  const controller = new StrudelController(true);
  await controller.initialize();
  const results: Case[] = [];

  for (const c of cases) {
    process.stderr.write(`\n=== ${c.label} (want ${c.declaredBpm}) ===\n`);
    const snapshots: Snapshot[] = [];
    try {
      await controller.writePattern(c.pattern);
      await controller.play();
      await new Promise(r => setTimeout(r, WARMUP_MS));

      for (let poll = 1; poll <= POLLS; poll++) {
        const tempo: any = await controller.detectTempo();
        const history = (controller.analyzer as any)._onsetHistory as { t: number; strength: number }[];
        const base = history.length > 0 ? history[0].t : 0;
        snapshots.push({
          poll,
          bpm: tempo.bpm,
          confidence: tempo.confidence,
          alternatives: tempo.alternatives,
          onsets: history.map(o => ({ t: o.t - base, strength: o.strength })),
        });
        process.stderr.write(`  poll ${poll}: bpm=${tempo.bpm} conf=${tempo.confidence?.toFixed?.(3)} onsets=${history.length}\n`);
        if (poll < POLLS) await new Promise(r => setTimeout(r, POLL_GAP_MS));
      }
      await controller.stop();
    } catch (error: any) {
      process.stderr.write(`  FAILED: ${error.message}\n`);
    }
    results.push({ ...c, snapshots });
  }

  await controller.cleanup();
  writeFileSync(OUT, JSON.stringify(results, null, 1));
  process.stderr.write(`\nwrote ${OUT}\n`);
}

main().catch((e) => { console.error(e); process.exit(1); });
