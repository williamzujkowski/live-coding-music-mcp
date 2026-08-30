#!/usr/bin/env npx tsx
/**
 * End-to-end check for export_audio (#223).
 *
 * The interesting half of this feature runs in page context —
 * MediaRecorder, `decodeAudioData`, WAV encoding, and the CDP boundary
 * the bytes cross. None of that can be meaningfully mocked, and mocking
 * it is precisely how `audio_capture` shipped broken for its whole life:
 * its unit tests handed `stopCapture` a real `Blob` that Playwright never
 * actually delivers.
 *
 * So this drives real Chromium against real strudel.cc and inspects the
 * bytes that come out, including parsing the RIFF header rather than
 * trusting the extension. If `ffprobe` is on PATH it gets a second
 * opinion from a tool that has no stake in our being right.
 *
 * Usage:
 *   npm run test:export-audio
 */

/* eslint-disable no-console */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StrudelController } from '../src/StrudelController.js';
import { AudioCaptureService } from '../src/services/AudioCaptureService.js';
import { AudioExportService } from '../src/services/AudioExportService.js';

let failures = 0;

function check(label: string, ok: boolean, detail = ''): void {
  if (ok) {
    console.log(`  ok    ${label}${detail === '' ? '' : `  ${detail}`}`);
  } else {
    failures++;
    console.error(`  FAIL  ${label}${detail === '' ? '' : `  ${detail}`}`);
  }
}

/** Parses a RIFF/WAVE header rather than trusting the file extension. */
function readWavHeader(file: string): {
  riff: string; wave: string; audioFormat: number;
  channels: number; sampleRate: number; bitsPerSample: number; dataSize: number;
} {
  const b = readFileSync(file);
  return {
    riff: b.subarray(0, 4).toString('ascii'),
    wave: b.subarray(8, 12).toString('ascii'),
    audioFormat: b.readUInt16LE(20),
    channels: b.readUInt16LE(22),
    sampleRate: b.readUInt32LE(24),
    bitsPerSample: b.readUInt16LE(34),
    dataSize: b.readUInt32LE(40),
  };
}

async function main(): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'strudel-export-audio-'));
  const controller = new StrudelController(true);

  try {
    await controller.initialize();
    await new AudioCaptureService().injectRecorder(controller.page!);
    const service = new AudioExportService(dir);
    const page = controller.page!;

    console.log('Refuses to export before audio is connected:');
    const early = await service.exportAudio(page, { duration: 300 });
    check('errors instead of writing an empty file', early.success === false,
      `(${String(early.error).slice(0, 48)})`);

    await controller.writePattern('s("bd*4").gain(1)');
    await controller.play();
    await new Promise(resolve => setTimeout(resolve, 1000));

    console.log('\nWAV export of live audio:');
    const wav = await service.exportAudio(page, { duration: 2500, filename: 'take-01' });
    check('export succeeded', wav.success === true, String(wav.error ?? ''));
    check('wrote a file', wav.path !== undefined && existsSync(wav.path));

    if (wav.path !== undefined && existsSync(wav.path)) {
      const h = readWavHeader(wav.path);
      check('RIFF/WAVE magic', h.riff === 'RIFF' && h.wave === 'WAVE', `${h.riff}/${h.wave}`);
      check('PCM format', h.audioFormat === 1, `audioFormat=${String(h.audioFormat)}`);
      check('16-bit samples', h.bitsPerSample === 16, `bits=${String(h.bitsPerSample)}`);
      check('sane sample rate', h.sampleRate >= 8000 && h.sampleRate <= 192000, `${String(h.sampleRate)}Hz`);
      check('has channels', h.channels >= 1, `ch=${String(h.channels)}`);
      check('header data size matches file', statSync(wav.path).size === 44 + h.dataSize);
      check('contains real audio, not silence', wav.silent === false,
        `peak=${String(wav.peak?.toFixed(4))}`);

      // Second opinion from a decoder with no stake in our being right.
      try {
        const probe = execFileSync('ffprobe', [
          '-v', 'error', '-show_entries', 'stream=codec_name,sample_rate,channels',
          '-of', 'default=noprint_wrappers=1:nokey=1', wav.path,
        ], { encoding: 'utf-8' }).trim().split('\n');
        check('ffprobe decodes it', probe[0] === 'pcm_s16le', `codec=${String(probe[0])}`);
      } catch {
        console.log('  skip  ffprobe not on PATH');
      }
    }

    console.log('\nSilence detection:');
    await controller.stop();
    await new Promise(resolve => setTimeout(resolve, 700));
    const quiet = await service.exportAudio(page, { duration: 1200, filename: 'quiet' });
    check('reports silence rather than claiming success', quiet.silent === true,
      `peak=${String(quiet.peak?.toExponential(2))}`);
    check('warns the caller', (quiet.warnings ?? []).join(' ').includes('silent'));

    console.log('\nPath confinement (#224):');
    const escape = await service.exportAudio(page, { duration: 300, filename: '../../../../tmp/pwned' });
    check('stays inside the export directory', escape.path?.startsWith(dir) === true, String(escape.path));
    check('reports the sanitization', escape.sanitizedFilename === 'pwned.wav');
    check('did not write the requested path', !existsSync('/tmp/pwned.wav'));

    console.log('\nwebm passthrough:');
    await controller.play();
    await new Promise(resolve => setTimeout(resolve, 800));
    const webm = await service.exportAudio(page, { duration: 1200, format: 'webm', filename: 'raw' });
    check('export succeeded', webm.success === true, String(webm.error ?? ''));
    if (webm.path !== undefined && existsSync(webm.path)) {
      const magic = readFileSync(webm.path).subarray(0, 4).toString('hex');
      check('EBML magic', magic === '1a45dfa3', magic);
    }
    await controller.stop();
  } finally {
    await controller.cleanup().catch(() => { /* already gone */ });
    rmSync(dir, { recursive: true, force: true });
  }

  if (failures > 0) {
    console.error(`\n${String(failures)} check(s) failed.`);
    process.exit(1);
  }
  console.log('\nAll export_audio checks passed.');
}

main().catch((error: unknown) => {
  console.error('verify-export-audio crashed:', error);
  process.exit(1);
});
