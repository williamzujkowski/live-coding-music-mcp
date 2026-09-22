#!/usr/bin/env npx tsx
/**
 * Our tempo detector against reference implementations, on the same audio.
 *
 * Plays each pattern in real Chromium, polls `detectTempo` the way an
 * agent would, then exports the WAV of that same playback and hands it
 * to `scripts/reference-tempo.py`. Both sides hear the identical audio,
 * so a disagreement is about the detectors rather than about two
 * recordings of a thing that is never twice the same.
 *
 * This exists because "our number looks about right" is not a
 * measurement. `verify-export-audio.ts` already takes a second opinion
 * from `ffprobe` on the bytes; this takes one on the tempo.
 *
 *   npm run calibrate:tempo
 *   pip install librosa aubio     # optional, see below
 *
 * WITHOUT the Python libraries it still runs and still reports what our
 * detector said — it just has nothing to compare against, and says so.
 * Nobody should have to install a scientific Python stack to work on
 * this repository.
 *
 * READING THE OUTPUT
 * ------------------
 *
 * Compare periods MODULO THE OCTAVE. An octave disagreement is not a
 * defect on either side: the octave is not in the audio, and every
 * estimator supplies it from a prior. Measured, on a click track with
 * no ambiguity in it, librosa reads a 165 BPM signal as 82.0 or 166.7
 * depending only on its own `start_bpm`, and aubio reads a 174 BPM
 * click as 87.8. Ours is centred on 120 like librosa's default.
 *
 * So `ratio 2.00` in the output means the two agree about the music and
 * differ about which pulse to call the beat. `ratio 1.20` means someone
 * is wrong.
 */

/* eslint-disable no-console */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { StrudelController } from '../src/StrudelController.js';
import { AudioCaptureService } from '../src/services/AudioCaptureService.js';
import { AudioExportService } from '../src/services/AudioExportService.js';
import { PatternGenerator } from '../src/services/PatternGenerator.js';

const ROOT = join(import.meta.dirname, '..');
/** Long enough for the reference tools to have something to work with. */
const EXPORT_MS = 12000;
const WARMUP_MS = 4000;
const POLLS = 3;
const POLL_GAP_MS = 1500;

interface Reference {
  librosa: number | null;
  librosaBeatTrack: number | null;
  aubio: number | null;
  skipped: string[];
  errors: Record<string, string>;
}

/**
 * How far apart two tempos are once the octave is taken out.
 *
 * Returns the ratio folded into [1, 2) — so 130 against 65 is 2.00 and
 * 130 against 108 is 1.20. A value near 1 or near 2 means agreement
 * about the music.
 */
function octaveRatio(a: number, b: number): number {
  if (a <= 0 || b <= 0) return 0;
  let ratio = Math.max(a, b) / Math.min(a, b);
  while (ratio >= 2) ratio /= 2;
  return ratio;
}

/** Whether two readings describe the same pulse, allowing octaves. */
function agreesModuloOctave(a: number, b: number, tolerance = 0.04): boolean {
  if (a <= 0 || b <= 0) return false;
  const ratio = octaveRatio(a, b);
  return Math.abs(ratio - 1) <= tolerance || Math.abs(ratio - 2) <= tolerance;
}

function reference(python: string, wavPath: string): Reference | null {
  try {
    const out = execFileSync(python, [join(ROOT, 'scripts', 'reference-tempo.py'), wavPath], {
      encoding: 'utf-8',
      timeout: 120000,
    }).trim();
    return JSON.parse(out.split('\n')[0]) as Reference;
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message : String(error);
    console.log(`     reference tools unavailable: ${detail.slice(0, 80)}`);
    return null;
  }
}

async function main(): Promise<void> {
  const python = process.env.CALIBRATE_PYTHON ?? 'python3';
  const dir = mkdtempSync(join(tmpdir(), 'calibrate-tempo-'));
  const generator = new PatternGenerator();
  const amen = JSON.parse(
    readFileSync(join(ROOT, 'patterns/examples/jungle/amen-break.json'), 'utf8')
  ).pattern as string;

  const cases: { name: string; declared: number; pattern: string }[] = [
    { name: 'amen-break', declared: 165, pattern: amen },
    ...['techno', 'house', 'dnb', 'trap', 'jungle', 'ambient', 'intelligent_dnb'].map(style => ({
      name: style,
      declared: 130,
      pattern: generator.generateCompletePattern(style, 'C', 130),
    })),
  ];

  const controller = new StrudelController(true);
  const rows: string[] = [];
  let compared = 0;
  let disagreed = 0;

  try {
    await controller.initialize();
    await new AudioCaptureService().injectRecorder(controller.page!);
    const exporter = new AudioExportService(dir);

    for (const testCase of cases) {
      console.log(`\n${testCase.name} (declared ${testCase.declared} BPM)`);
      try {
        await controller.writePattern(testCase.pattern);
        await controller.play();
        await new Promise(resolve => setTimeout(resolve, WARMUP_MS));

        const ours: number[] = [];
        for (let poll = 0; poll < POLLS; poll++) {
          ours.push((await controller.detectTempo()).bpm);
          if (poll < POLLS - 1) await new Promise(resolve => setTimeout(resolve, POLL_GAP_MS));
        }
        console.log(`     ours:      ${ours.join(', ')}`);

        const wav = await exporter.exportAudio(controller.page!, {
          duration: EXPORT_MS,
          filename: testCase.name,
        });
        await controller.stop();
        await new Promise(resolve => setTimeout(resolve, 500));

        if (!wav.success || wav.path === undefined || wav.silent === true) {
          console.log(`     export failed or silent: ${String(wav.error ?? 'silent')}`);
          rows.push(`${testCase.name.padEnd(18)} ${String(testCase.declared).padStart(4)}  export failed`);
          continue;
        }

        const ref = reference(python, wav.path);
        if (ref === null) {
          rows.push(`${testCase.name.padEnd(18)} ${String(testCase.declared).padStart(4)}  ${ours.join('/')}  (no reference)`);
          continue;
        }
        if (ref.skipped.length > 0) {
          console.log(`     skipped: ${ref.skipped.join(', ')} (pip install librosa aubio)`);
        }
        console.log(`     librosa:   ${String(ref.librosa)}   beat_track: ${String(ref.librosaBeatTrack)}`);
        console.log(`     aubio:     ${String(ref.aubio)}`);

        // The last poll is our settled answer; earlier ones are the
        // window still filling.
        const settled = ours[ours.length - 1];
        const refs = [ref.librosa, ref.aubio].filter((v): v is number => v !== null && v > 0);
        let verdict = 'no reference';
        if (refs.length > 0) {
          if (settled === 0) {
            verdict = `we refuse; reference hears ${refs.map(r => r.toFixed(1)).join('/')}`;
            compared++;
            disagreed++;
          } else {
            const ok = refs.some(r => agreesModuloOctave(settled, r));
            const ratios = refs.map(r => octaveRatio(settled, r).toFixed(2)).join('/');
            verdict = ok ? `agree (ratio ${ratios})` : `DISAGREE (ratio ${ratios})`;
            compared++;
            if (!ok) disagreed++;
          }
        }
        console.log(`     verdict:   ${verdict}`);
        rows.push(
          `${testCase.name.padEnd(18)} ${String(testCase.declared).padStart(4)}  ` +
          `${String(settled).padStart(4)}  ${String(ref.librosa ?? '-').padStart(7)}  ` +
          `${String(ref.aubio ?? '-').padStart(7)}   ${verdict}`
        );
      } catch (error: unknown) {
        const detail = error instanceof Error ? error.message : String(error);
        console.log(`     FAILED: ${detail}`);
        rows.push(`${testCase.name.padEnd(18)} ${String(testCase.declared).padStart(4)}  failed`);
      }
    }
  } finally {
    await controller.cleanup();
    rmSync(dir, { recursive: true, force: true });
  }

  console.log('\n\npattern            want  ours  librosa    aubio   verdict');
  console.log('-'.repeat(78));
  for (const row of rows) console.log(row);
  console.log(
    `\n${String(compared - disagreed)}/${String(compared)} agree with at least one reference, modulo octave.`
  );
  console.log(
    'An octave difference is a difference of priors, not a defect — see the header of\n' +
    'scripts/reference-tempo.py for the click-track measurement that establishes this.'
  );
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
