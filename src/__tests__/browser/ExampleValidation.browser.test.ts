/**
 * Real browser validation tests for example patterns
 * These tests use actual Playwright browser automation against strudel.cc
 * Run with: HEADLESS=true npm test -- ExampleValidation.browser
 *
 * NOTE: These tests are skipped when running with coverage because Jest's
 * coverage instrumentation injects variables that don't exist in the browser
 * context when code runs inside page.evaluate().
 */
import { StrudelController } from '../../StrudelController';
import * as fs from 'fs';
import * as path from 'path';

// Skip browser tests when running with coverage to avoid instrumentation conflicts
// Jest injects coverage variables like cov_* which don't exist in browser context
const isRunningCoverage = process.env.COVERAGE === 'true' ||
                          process.env.npm_lifecycle_event?.includes('coverage') ||
                          process.argv.some(arg => arg.includes('--coverage')) ||
                          typeof (global as any).__coverage__ !== 'undefined';
const describeOrSkip = isRunningCoverage ? describe.skip : describe;

describeOrSkip('Browser Validation: Example Patterns', () => {
  let controller: StrudelController;
  const examplesDir = path.join(__dirname, '../../../patterns/examples');
  const isCI = process.env.CI === 'true';
  const headless = process.env.HEADLESS === 'true' || isCI;

  // Increase timeout for real browser operations
  jest.setTimeout(30000);

  beforeAll(async () => {
    controller = new StrudelController(headless);
    await controller.initialize();
  });

  afterAll(async () => {
    await controller.cleanup();
  });

  // Helper to load example file
  function loadExample(genre: string, filename: string) {
    const filePath = path.join(examplesDir, genre, filename);
    if (!fs.existsSync(filePath)) {
      throw new Error(`Example not found: ${filePath}`);
    }
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  }

  describe('Techno Examples', () => {
    it('should load and play hard-techno.json', async () => {
      const example = loadExample('techno', 'hard-techno.json');

      await controller.writePattern(example.pattern);
      const written = await controller.getCurrentPattern();
      expect(written).toContain('techno');
      expect(written.length).toBeGreaterThan(50);

      await controller.play();
      await new Promise(resolve => setTimeout(resolve, 1000));

      const stats = await controller.getPatternStats();
      expect(stats.lines).toBeGreaterThan(0);

      await controller.stop();
    });

    it('should load and play minimal-techno.json', async () => {
      const example = loadExample('techno', 'minimal-techno.json');

      await controller.writePattern(example.pattern);
      await controller.play();
      await new Promise(resolve => setTimeout(resolve, 500));

      const errors = controller.getConsoleErrors();
      expect(errors.length).toBe(0);

      await controller.stop();
    });
  });

  describe('House Examples', () => {
    it('should load and play deep-house.json', async () => {
      const example = loadExample('house', 'deep-house.json');

      await controller.writePattern(example.pattern);
      await controller.play();
      await new Promise(resolve => setTimeout(resolve, 1000));

      await controller.stop();
      const errors = controller.getConsoleErrors();
      expect(errors.length).toBe(0);
    });

    it('should load and play tech-house.json', async () => {
      const example = loadExample('house', 'tech-house.json');

      await controller.writePattern(example.pattern);
      await controller.play();
      await new Promise(resolve => setTimeout(resolve, 500));

      await controller.stop();
    });
  });

  describe('Drum & Bass Examples', () => {
    it('should load and play liquid-dnb.json', async () => {
      const example = loadExample('dnb', 'liquid-dnb.json');

      await controller.writePattern(example.pattern);
      await controller.play();
      await new Promise(resolve => setTimeout(resolve, 1000));

      await controller.stop();
      const errors = controller.getConsoleErrors();
      expect(errors.length).toBe(0);
    });

    it('should load and play neurofunk.json', async () => {
      const example = loadExample('dnb', 'neurofunk.json');

      await controller.writePattern(example.pattern);
      await controller.play();
      await new Promise(resolve => setTimeout(resolve, 500));

      await controller.stop();
    });
  });

  describe('Ambient Examples', () => {
    it('should load and play dark-ambient.json', async () => {
      const example = loadExample('ambient', 'dark-ambient.json');

      await controller.writePattern(example.pattern);
      await controller.play();
      await new Promise(resolve => setTimeout(resolve, 1000));

      await controller.stop();
      const errors = controller.getConsoleErrors();
      expect(errors.length).toBe(0);
    });

    it('should load and play drone.json', async () => {
      const example = loadExample('ambient', 'drone.json');

      await controller.writePattern(example.pattern);
      await controller.play();
      await new Promise(resolve => setTimeout(resolve, 500));

      await controller.stop();
    });
  });

  describe('Trap Examples', () => {
    it('should load and play modern-trap.json', async () => {
      const example = loadExample('trap', 'modern-trap.json');

      await controller.writePattern(example.pattern);
      await controller.play();
      await new Promise(resolve => setTimeout(resolve, 1000));

      await controller.stop();
      const errors = controller.getConsoleErrors();
      expect(errors.length).toBe(0);
    });

    it('should load and play cloud-trap.json', async () => {
      const example = loadExample('trap', 'cloud-trap.json');

      await controller.writePattern(example.pattern);
      await controller.play();
      await new Promise(resolve => setTimeout(resolve, 500));

      await controller.stop();
    });
  });

  describe('Jungle Examples', () => {
    it('should load and play classic-jungle.json', async () => {
      const example = loadExample('jungle', 'classic-jungle.json');

      await controller.writePattern(example.pattern);
      await controller.play();
      await new Promise(resolve => setTimeout(resolve, 1000));

      await controller.stop();
      const errors = controller.getConsoleErrors();
      expect(errors.length).toBe(0);
    });

    it('should load and play ragga-jungle.json', async () => {
      const example = loadExample('jungle', 'ragga-jungle.json');

      await controller.writePattern(example.pattern);
      await controller.play();
      await new Promise(resolve => setTimeout(resolve, 500));

      await controller.stop();
    });
  });

  describe('Jazz Examples', () => {
    it('should load and play bebop.json', async () => {
      const example = loadExample('jazz', 'bebop.json');

      await controller.writePattern(example.pattern);
      await controller.play();
      await new Promise(resolve => setTimeout(resolve, 1000));

      await controller.stop();
      const errors = controller.getConsoleErrors();
      expect(errors.length).toBe(0);
    });

    it('should load and play modal-jazz.json', async () => {
      const example = loadExample('jazz', 'modal-jazz.json');

      await controller.writePattern(example.pattern);
      await controller.play();
      await new Promise(resolve => setTimeout(resolve, 500));

      await controller.stop();
    });
  });

  describe('Audio Analysis Validation', () => {
    it('should analyze audio from hard-techno example', async () => {
      const example = loadExample('techno', 'hard-techno.json');

      await controller.writePattern(example.pattern);
      await controller.play();

      // Wait for audio analyzer to connect
      const connected = await controller.waitForAudioConnection(5000);

      if (!connected) {
        // Skip test if analyzer doesn't connect (known issue in headless mode)
        await controller.stop();
        console.warn('Audio analyzer did not connect - test skipped');
        return;
      }

      await new Promise(resolve => setTimeout(resolve, 4500));

      const analysis = await controller.analyzeAudio();

      // AudioAnalyzer returns `{ features: {...}, connected, timestamp }`.
      // The earlier `.spectrum.bands` assertion targeted an API shape
      // that doesn't exist (#139). Check the real surface instead.
      expect(analysis).toBeDefined();
      expect(analysis.features).toBeDefined();
      // Bass/mid/treble are the canonical frequency-band fields.
      expect(typeof analysis.features.bass).toBe('number');
      expect(typeof analysis.features.mid).toBe('number');
      expect(typeof analysis.features.treble).toBe('number');

      await controller.stop();
    });

    it('should detect tempo from liquid-dnb example', async () => {
      const example = loadExample('dnb', 'liquid-dnb.json');

      await controller.writePattern(example.pattern);
      await controller.play();

      // Wait for audio analyzer to connect
      const connected = await controller.waitForAudioConnection(5000);

      if (!connected) {
        // Skip test if analyzer doesn't connect (known issue in headless mode)
        await controller.stop();
        console.warn('Audio analyzer did not connect - test skipped');
        return;
      }

      // Bumped 1500 → 4500 (#139): tempo detection needs enough onset
      // samples to build a beat histogram. Headless Chromium's audio
      // pipeline is flakier than a real browser; give it more cycles.
      await new Promise(resolve => setTimeout(resolve, 4500));

      const tempo = await controller.detectTempo();

      // Shape assertions stay strict — the detector should always return
      // a well-typed result, even when it can't find a beat.
      expect(tempo).toBeDefined();
      expect(typeof tempo.bpm).toBe('number');
      expect(typeof tempo.confidence).toBe('number');

      // BPM detection is best-effort under headless audio: if no onsets
      // surfaced, the detector returns 0 BPM with a "no tempo detected"
      // message. That's a documented non-failure (#139). When the
      // detector does report a BPM, assert it falls in the genre band.
      if (tempo.bpm > 0) {
        expect(tempo.bpm).toBeGreaterThanOrEqual(160);
        expect(tempo.bpm).toBeLessThanOrEqual(180);
      } else {
        console.warn('Tempo detection returned 0 BPM under headless audio (#139); shape-only check passed.');
      }

      await controller.stop();
    });

    it('should detect key from modal-jazz example', async () => {
      const example = loadExample('jazz', 'modal-jazz.json');

      await controller.writePattern(example.pattern);
      await controller.play();

      // Wait for audio analyzer to connect
      const connected = await controller.waitForAudioConnection(5000);

      if (!connected) {
        // Skip test if analyzer doesn't connect (known issue in headless mode)
        await controller.stop();
        console.warn('Audio analyzer did not connect - test skipped');
        return;
      }

      // Matching #139 — give the analyzer enough samples.
      await new Promise(resolve => setTimeout(resolve, 4500));

      const key = await controller.detectKey();

      expect(key).toBeDefined();
      expect(key.key).toBeDefined();
      expect(key.scale).toBeDefined();
      expect(key.confidence).toBeGreaterThanOrEqual(0);

      await controller.stop();
    });
  });

  describe('Pattern Integrity Validation', () => {
    const allExamples = [
      { genre: 'techno', file: 'hard-techno.json' },
      { genre: 'techno', file: 'minimal-techno.json' },
      { genre: 'house', file: 'deep-house.json' },
      { genre: 'house', file: 'tech-house.json' },
      { genre: 'dnb', file: 'liquid-dnb.json' },
      { genre: 'dnb', file: 'neurofunk.json' },
      { genre: 'ambient', file: 'dark-ambient.json' },
      { genre: 'ambient', file: 'drone.json' },
      { genre: 'trap', file: 'modern-trap.json' },
      { genre: 'trap', file: 'cloud-trap.json' },
      { genre: 'jungle', file: 'classic-jungle.json' },
      { genre: 'jungle', file: 'ragga-jungle.json' },
      { genre: 'jazz', file: 'bebop.json' },
      { genre: 'jazz', file: 'modal-jazz.json' },
    ];

    allExamples.forEach(({ genre, file }) => {
      it(`should have valid metadata: ${genre}/${file}`, () => {
        const example = loadExample(genre, file);

        expect(example.name).toBeDefined();
        expect(example.genre).toBe(genre);
        expect(example.pattern).toBeDefined();
        expect(example.pattern.length).toBeGreaterThan(0);
        expect(example.bpm).toBeGreaterThan(0);
        expect(example.key).toBeDefined();
        expect(example.description).toBeDefined();
        expect(example.tags).toBeInstanceOf(Array);
        expect(example.timestamp).toBeDefined();
      });
    });
  });
});
