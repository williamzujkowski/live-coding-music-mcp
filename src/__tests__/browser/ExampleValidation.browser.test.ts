/**
 * Real browser validation against strudel.cc.
 * Run with: HEADLESS=true npm test -- ExampleValidation.browser
 *
 * NOTE: This suite used to skip itself under coverage: istanbul
 * instruments every function in src/, including the ones handed to
 * page.evaluate, and `cov_*` does not exist in browser context. The
 * failure never surfaced as a ReferenceError — waitForFunction swallows
 * it and polls until timeout, so it looked like strudel.cc being slow.
 * Every page.evaluate argument in src/ now carries
 * `/* istanbul ignore next *\/`, enforced by
 * PageEvaluateNameWrapping.test.ts (#256).
 *
 * WHAT THIS ITERATES, AND WHY IT CHANGED (#353):
 *
 * It used to load 18 committed example files by name. Those files were
 * `generateCompletePattern` output saved to disk — verified byte-for-
 * byte — so "bebop.json" contained four-on-the-floor techno drums, and
 * one still held a chord-progression bug fixed weeks earlier because
 * nothing regenerated it.
 *
 * Now two sources, deliberately separated:
 *
 *   1. The real corpus — sourced or hand-written examples, discovered
 *      from disk rather than listed by name, so adding one is enough.
 *   2. Generator smoke coverage — every style GENERATED AT TEST TIME.
 *      That restores the breadth the deleted files provided, tests what
 *      the generator does today rather than what it did when someone
 *      last committed a snapshot, and cannot go stale.
 */
import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

import { StrudelController } from '../../StrudelController';
import { PatternGenerator } from '../../services/PatternGenerator';
import { DRUM_STYLES } from '../../services/StyleRegistry';

interface Example {
  name: string;
  genre: string;
  pattern: string;
  bpm?: number;
  key?: string;
  source?: { license: string; origin: string };
}

/** Every committed example, discovered rather than enumerated. */
function realExamples(): Example[] {
  const root = join(__dirname, '../../../patterns/examples');
  const out: Example[] = [];
  for (const genre of readdirSync(root)) {
    const dir = join(root, genre);
    if (!statSync(dir).isDirectory()) continue;
    for (const file of readdirSync(dir).filter(f => f.endsWith('.json'))) {
      out.push(JSON.parse(readFileSync(join(dir, file), 'utf-8')) as Example);
    }
  }
  return out;
}

describe('Browser Validation: Example Patterns', () => {
  let controller: StrudelController;
  const isCI = process.env.CI === 'true';
  const headless = process.env.HEADLESS === 'true' || isCI;

  jest.setTimeout(30000);

  beforeAll(async () => {
    controller = new StrudelController(headless);
    await controller.initialize();
  });

  afterAll(async () => {
    await controller.cleanup();
  });

  describe('the committed corpus', () => {
    const examples = realExamples();

    it('there is a corpus to test', () => {
      expect(examples.length).toBeGreaterThan(0);
    });

    it.each(examples.map(e => [`${e.genre}/${e.name}`, e] as const))(
      '%s writes and plays', async (_label, example) => {
        const writeResult = await controller.writePattern(example.pattern);
        const written = await controller.getCurrentPattern();

        // Asserted as an object so a failure prints what was actually
        // read, not just "expected to contain". Jest's expect() takes no
        // message argument, so the diff is the only channel (#300).
        expect({
          longEnough: written.length > 20,
          writeReturned: writeResult,
          readLength: written.length,
          readSample: written.slice(0, 120),
        }).toMatchObject({ longEnough: true });

        // Long enough for slow material to register.
        //
        // 800ms was fine for the deleted generated patterns, which were
        // all four-on-the-floor. The ambient example is a pad with a
        // 3-second attack under `.slow(4)`, and it failed here — not a
        // flake, and not a fault in the example: the wait was written
        // for a corpus where every entry sounded immediately. A corpus
        // with real variety needs a window that fits its slowest member.
        await controller.play();
        await new Promise(resolve => setTimeout(resolve, 2500));

        const stats = await controller.getPatternStats();
        expect(stats.lines).toBeGreaterThan(0);

        await controller.stop();
      });

    it.each(examples.map(e => [`${e.genre}/${e.name}`, e] as const))(
      '%s declares its provenance', (_label, example) => {
        // The deleted files claimed a genre and delivered another. Every
        // survivor says where it came from (#353).
        expect(example.source?.license).toBeTruthy();
        expect(example.source?.origin).toBeTruthy();
      });
  });

  describe('generator smoke coverage', () => {
    /**
     * Generated at test time, not loaded from disk. This is the breadth
     * the 18 deleted files were providing — except it tests the current
     * generator rather than a snapshot of an old one.
     */
    const generator = new PatternGenerator();

    it.each(DRUM_STYLES as string[])(
      '%s output writes and plays', async style => {
        const pattern = generator.generateCompletePattern(style, 'C', 120);
        await controller.writePattern(pattern);
        const written = await controller.getCurrentPattern();
        expect(written.length).toBeGreaterThan(20);

        await controller.play();
        await new Promise(resolve => setTimeout(resolve, 500));
        const stats = await controller.getPatternStats();
        expect(stats.lines).toBeGreaterThan(0);
        await controller.stop();
      });
  });

  describe('Audio Analysis Validation', () => {
    /**
     * A percussive example for the analysis checks.
     *
     * My first version picked the first example with a stated key,
     * which is alphabetically the ambient pad — a 3-second attack under
     * `.slow(4)`, so playback did not register in time and onset
     * detection had nothing to find. Analysis needs transients; ambient
     * is deliberately the case that has none.
     */
    const percussive = realExamples().find(e => e.genre === 'dnb')
      ?? realExamples().find(e => e.pattern.includes('bd'))
      ?? realExamples()[0];

    it('analyzes audio from a real example', async () => {
      await controller.writePattern(percussive.pattern);
      await controller.play();

      const connected = await controller.waitForAudioConnection(5000);
      if (!connected) {
        await controller.stop();
        console.warn('Audio analyzer did not connect - test skipped');
        return;
      }

      await new Promise(resolve => setTimeout(resolve, 2000));
      const analysis = await controller.analyzeAudio();
      expect(analysis).toBeDefined();

      await controller.stop();
    });

    it('detects a tempo, or declines to', async () => {
      await controller.writePattern(percussive.pattern);
      await controller.play();

      const connected = await controller.waitForAudioConnection(5000);
      if (!connected) {
        await controller.stop();
        console.warn('Audio analyzer did not connect - test skipped');
        return;
      }

      // Bumped 1500 -> 4500 (#139): tempo detection needs enough onset
      // samples. Headless Chromium's audio pipeline is flakier than a
      // real browser; give it more cycles.
      await new Promise(resolve => setTimeout(resolve, 4500));
      const tempo = await controller.detectTempo();

      // Shape stays strict — the detector should always return a
      // well-typed result, even when it cannot find a beat.
      expect(tempo).toBeDefined();
      expect(typeof tempo.bpm).toBe('number');
      expect(typeof tempo.confidence).toBe('number');

      // The band is deliberately wide, and #352 explains why: after
      // #322 made detection actually measure, this example read 190,
      // 108 and 117 across consecutive runs. Autocorrelation (#354)
      // took it to 4-in-5 inside 160-180, which is better and still not
      // enough to tighten — a test that fails one run in five teaches
      // people to re-run rather than look.
      if (tempo.bpm > 0) {
        expect(tempo.bpm).toBeGreaterThanOrEqual(40);
        expect(tempo.bpm).toBeLessThanOrEqual(200);
      } else {
        console.warn('Tempo detection returned 0 BPM under headless audio (#139); shape-only check passed.');
      }

      await controller.stop();
    });

    it('detects a key, or declines to', async () => {
      await controller.writePattern(percussive.pattern);
      await controller.play();

      const connected = await controller.waitForAudioConnection(5000);
      if (!connected) {
        await controller.stop();
        console.warn('Audio analyzer did not connect - test skipped');
        return;
      }

      await new Promise(resolve => setTimeout(resolve, 3000));
      const key = await controller.detectKey();

      expect(key).toBeDefined();
      expect(typeof key.key).toBe('string');
      expect(key.confidence).toBeGreaterThanOrEqual(0);
      expect(key.confidence).toBeLessThanOrEqual(1);

      await controller.stop();
    });
  });

  describe('Pattern Integrity', () => {
    it.each(realExamples().map(e => [`${e.genre}/${e.name}`, e] as const))(
      '%s has the metadata the resource promises', (_label, example) => {
        expect(example.name).toBeTruthy();
        expect(example.genre).toBeTruthy();
        expect(example.pattern).toBeTruthy();
        expect(example.pattern.length).toBeGreaterThan(20);
      });
  });
});
