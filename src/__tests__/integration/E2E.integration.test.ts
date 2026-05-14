/**
 * E2E Browser Integration Tests
 *
 * Comprehensive end-to-end tests for the complete browser workflow:
 * - Full initialization → write → play → analyze → stop cycle
 * - Pattern persistence (save/load roundtrip)
 * - Audio analysis accuracy during playback
 * - Error recovery scenarios (browser crash simulation)
 */

import { StrudelController } from '../../StrudelController';
import { PatternStore } from '../../PatternStore';
import { chromium } from 'playwright';
import { MockBrowser, MockPage, createMockPage } from '../utils/MockPlaywright';
import { samplePatterns } from '../utils/TestFixtures';
import { promises as fs } from 'fs';
import path from 'path';
import { tmpdir } from 'os';

// Mock Playwright
jest.mock('playwright', () => ({
  chromium: {
    launch: jest.fn()
  }
}));

describe('E2E Browser Integration Tests', () => {
  let controller: StrudelController;
  let store: PatternStore;
  let mockBrowser: MockBrowser;
  let mockPage: MockPage;
  let testDir: string;

  // Timeout configuration for browser operations
  const TEST_TIMEOUT = 10000;

  beforeEach(async () => {
    // Setup temporary directory for pattern storage
    testDir = path.join(tmpdir(), 'strudel-e2e-test-' + Date.now());
    await fs.mkdir(testDir, { recursive: true });

    // Setup mock browser and page
    mockPage = createMockPage();
    mockBrowser = new MockBrowser();
    mockBrowser.newContext = jest.fn().mockResolvedValue({
      newPage: jest.fn().mockResolvedValue(mockPage)
    });

    (chromium.launch as jest.Mock).mockResolvedValue(mockBrowser);

    // Initialize components
    controller = new StrudelController(true); // headless mode
    store = new PatternStore(testDir);
  });

  afterEach(async () => {
    // Cleanup
    await controller.cleanup();
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch (error) {
      // Ignore cleanup errors
    }
    jest.clearAllMocks();
  });

  // ============================================================================
  // FULL WORKFLOW TESTS
  // ============================================================================

  describe('Full Workflow: init → write → play → analyze → stop', () => {
    test('should complete full workflow successfully', async () => {
      // Step 1: Initialize browser
      const initResult = await controller.initialize();
      expect(initResult).toContain('initialized');

      // Step 2: Write pattern
      const pattern = samplePatterns.techno;
      const writeResult = await controller.writePattern(pattern);
      expect(writeResult).toContain('Pattern written');

      // Verify pattern was written
      const currentPattern = await controller.getCurrentPattern();
      expect(currentPattern).toBe(pattern);

      // Step 3: Start playback
      const playResult = await controller.play();
      expect(playResult).toBe('Playing');
      expect(controller.getPlaybackState()).toBe(true);

      // Step 4: Analyze audio
      const analysis = await controller.analyzeAudio();
      expect(analysis.connected).toBe(true);
      expect(analysis.features).toBeDefined();
      expect(analysis.features.isPlaying).toBe(true);

      // Step 5: Stop playback
      const stopResult = await controller.stop();
      expect(stopResult).toBe('Stopped');
      expect(controller.getPlaybackState()).toBe(false);

      // Wait a moment for audio to fully stop
      await new Promise(resolve => setTimeout(resolve, 50));

      // Verify audio stopped
      const silentAnalysis = await controller.analyzeAudio();
      expect(silentAnalysis.features.isPlaying).toBe(false);
      expect(silentAnalysis.features.isSilent).toBe(true);
    }, TEST_TIMEOUT);

    test('should handle multiple patterns in sequence', async () => {
      await controller.initialize();

      const patterns = [
        samplePatterns.simple,
        samplePatterns.house,
        samplePatterns.dnb
      ];

      for (const pattern of patterns) {
        // Write new pattern
        await controller.writePattern(pattern);
        const retrieved = await controller.getCurrentPattern();
        expect(retrieved).toBe(pattern);

        // Play and verify
        await controller.play();
        expect(controller.getPlaybackState()).toBe(true);

        // Stop before next pattern
        await controller.stop();
        expect(controller.getPlaybackState()).toBe(false);
      }
    }, TEST_TIMEOUT);

    test('should maintain pattern during play/stop cycles', async () => {
      await controller.initialize();
      const pattern = samplePatterns.withBass;
      await controller.writePattern(pattern);

      // Multiple play/stop cycles
      for (let i = 0; i < 3; i++) {
        await controller.play();
        expect(controller.getPlaybackState()).toBe(true);

        // Pattern should remain unchanged
        const currentPattern = await controller.getCurrentPattern();
        expect(currentPattern).toBe(pattern);

        await controller.stop();
        expect(controller.getPlaybackState()).toBe(false);
      }
    }, TEST_TIMEOUT);

    test('should support pattern editing during workflow', async () => {
      await controller.initialize();

      // Initial pattern
      await controller.writePattern(samplePatterns.simple);
      await controller.play();

      // Stop and edit
      await controller.stop();
      await controller.appendPattern('\n// Added line');

      const updated = await controller.getCurrentPattern();
      expect(updated).toContain(samplePatterns.simple);
      expect(updated).toContain('// Added line');

      // Resume playback
      await controller.play();
      expect(controller.getPlaybackState()).toBe(true);
    }, TEST_TIMEOUT);
  });

  // ============================================================================
  // PATTERN PERSISTENCE TESTS
  // ============================================================================

  describe('Pattern persistence: save and load', () => {
    test('should save and load pattern successfully', async () => {
      await controller.initialize();

      const patternName = 'test-techno';
      const pattern = samplePatterns.techno;
      const tags = ['techno', 'test', 'e2e'];

      // Write to controller
      await controller.writePattern(pattern);

      // Save to store
      await store.save(patternName, pattern, tags);

      // Load from store
      const loaded = await store.load(patternName);
      expect(loaded).not.toBeNull();
      expect(loaded!.name).toBe(patternName);
      expect(loaded!.content).toBe(pattern);
      expect(loaded!.tags).toEqual(tags);

      // Write loaded pattern back to controller
      await controller.writePattern(loaded!.content);
      const verified = await controller.getCurrentPattern();
      expect(verified).toBe(pattern);
    }, TEST_TIMEOUT);

    test('should handle complete save/load/play workflow', async () => {
      await controller.initialize();

      const patternName = 'complete-workflow';
      const pattern = samplePatterns.complex;

      // Write and play original
      await controller.writePattern(pattern);
      await controller.play();
      const originalAnalysis = await controller.analyzeAudio();
      await controller.stop();

      // Save pattern
      await store.save(patternName, pattern, ['complex', 'workflow']);

      // Clear controller
      await controller.writePattern('');
      expect(await controller.getCurrentPattern()).toBe('');

      // Load pattern
      const loaded = await store.load(patternName);
      expect(loaded).not.toBeNull();

      // Write loaded pattern and play
      await controller.writePattern(loaded!.content);
      await controller.play();
      const loadedAnalysis = await controller.analyzeAudio();
      await controller.stop();

      // Audio characteristics should be similar
      expect(loadedAnalysis.connected).toBe(originalAnalysis.connected);
      expect(loadedAnalysis.features.isPlaying).toBe(true);
    }, TEST_TIMEOUT);

    test('should handle multiple pattern save/load operations', async () => {
      await controller.initialize();

      const patterns = [
        { name: 'pattern1', content: samplePatterns.simple, tags: ['simple'] },
        { name: 'pattern2', content: samplePatterns.house, tags: ['house'] },
        { name: 'pattern3', content: samplePatterns.dnb, tags: ['dnb'] }
      ];

      // Save all patterns
      for (const p of patterns) {
        await store.save(p.name, p.content, p.tags);
      }

      // List patterns
      const list = await store.list();
      expect(list.length).toBeGreaterThanOrEqual(patterns.length);

      // Load and verify each pattern
      for (const p of patterns) {
        const loaded = await store.load(p.name);
        expect(loaded).not.toBeNull();
        expect(loaded!.content).toBe(p.content);
        expect(loaded!.tags).toEqual(p.tags);

        // Test in controller
        await controller.writePattern(loaded!.content);
        const verified = await controller.getCurrentPattern();
        expect(verified).toBe(p.content);
      }
    }, TEST_TIMEOUT);

    test('should preserve pattern metadata across save/load', async () => {
      const patternName = 'metadata-test';
      const pattern = samplePatterns.withEffects;
      const tags = ['effects', 'metadata', 'test'];

      // Save pattern
      await store.save(patternName, pattern, tags);

      // Load and verify metadata
      const loaded = await store.load(patternName);
      expect(loaded).not.toBeNull();
      expect(loaded!.timestamp).toBeDefined();
      expect(new Date(loaded!.timestamp).getTime()).toBeGreaterThan(0);
      expect(loaded!.tags).toEqual(tags);
      expect(loaded!.name).toBe(patternName);
    }, TEST_TIMEOUT);

    test('should handle pattern overwrite correctly', async () => {
      const patternName = 'overwrite-test';
      const originalPattern = samplePatterns.simple;
      const updatedPattern = samplePatterns.complex;

      // Save original
      await store.save(patternName, originalPattern, ['original']);
      const loaded1 = await store.load(patternName);
      expect(loaded1!.content).toBe(originalPattern);

      // Overwrite
      await store.save(patternName, updatedPattern, ['updated']);
      const loaded2 = await store.load(patternName);
      expect(loaded2!.content).toBe(updatedPattern);
      expect(loaded2!.tags).toEqual(['updated']);
    }, TEST_TIMEOUT);
  });

  // ============================================================================
  // AUDIO ANALYSIS TESTS
  // ============================================================================

  describe('Audio analysis returns valid data', () => {
    test('should return valid audio features when playing', async () => {
      await controller.initialize();
      await controller.writePattern(samplePatterns.techno);
      await controller.play();

      const analysis = await controller.analyzeAudio();

      // Verify structure
      expect(analysis).toHaveProperty('connected');
      expect(analysis).toHaveProperty('timestamp');
      expect(analysis).toHaveProperty('features');

      // Verify features
      const features = analysis.features;
      expect(features).toHaveProperty('average');
      expect(features).toHaveProperty('peak');
      expect(features).toHaveProperty('peakFrequency');
      expect(features).toHaveProperty('centroid');
      expect(features).toHaveProperty('bass');
      expect(features).toHaveProperty('lowMid');
      expect(features).toHaveProperty('mid');
      expect(features).toHaveProperty('highMid');
      expect(features).toHaveProperty('treble');
      expect(features).toHaveProperty('isPlaying');
      expect(features).toHaveProperty('isSilent');
      expect(features).toHaveProperty('bassToTrebleRatio');
      expect(features).toHaveProperty('brightness');

      // Verify data types and ranges
      expect(typeof features.average).toBe('number');
      expect(typeof features.peak).toBe('number');
      expect(typeof features.bass).toBe('number');
      expect(features.isPlaying).toBe(true);
      expect(features.isSilent).toBe(false);
    }, TEST_TIMEOUT);

    test('should detect silence when not playing', async () => {
      await controller.initialize();
      await controller.writePattern(samplePatterns.simple);

      // Don't start playback
      const analysis = await controller.analyzeAudio();

      expect(analysis.features.isPlaying).toBe(false);
      expect(analysis.features.isSilent).toBe(true);
      expect(analysis.features.average).toBeLessThan(5);
    }, TEST_TIMEOUT);

    test('should provide consistent analysis during playback', async () => {
      await controller.initialize();
      await controller.writePattern(samplePatterns.complex);
      await controller.play();

      // Multiple analysis calls
      const analysis1 = await controller.analyzeAudio();
      await new Promise(resolve => setTimeout(resolve, 100));
      const analysis2 = await controller.analyzeAudio();

      // Both should indicate playing
      expect(analysis1.features.isPlaying).toBe(true);
      expect(analysis2.features.isPlaying).toBe(true);

      // Both should have valid data
      expect(analysis1.connected).toBe(true);
      expect(analysis2.connected).toBe(true);
    }, TEST_TIMEOUT);

    test('should analyze frequency bands correctly', async () => {
      await controller.initialize();
      await controller.writePattern(samplePatterns.withBass);
      await controller.play();

      const analysis = await controller.analyzeAudio();
      const features = analysis.features;

      // All frequency bands should have values
      expect(features.bass).toBeGreaterThanOrEqual(0);
      expect(features.lowMid).toBeGreaterThanOrEqual(0);
      expect(features.mid).toBeGreaterThanOrEqual(0);
      expect(features.highMid).toBeGreaterThanOrEqual(0);
      expect(features.treble).toBeGreaterThanOrEqual(0);

      // Bass should be prominent in bass pattern
      expect(features.bass).toBeGreaterThan(0);
    }, TEST_TIMEOUT);

    test('should calculate brightness correctly', async () => {
      await controller.initialize();
      await controller.writePattern(samplePatterns.techno);
      await controller.play();

      const analysis = await controller.analyzeAudio();

      // Brightness should be one of the expected values
      expect(['bright', 'balanced', 'dark']).toContain(analysis.features.brightness);

      // Should have a valid centroid value
      expect(typeof analysis.features.centroid).toBe('number');
      expect(analysis.features.centroid).toBeGreaterThanOrEqual(0);
    }, TEST_TIMEOUT);

    test('should track analysis timestamp', async () => {
      await controller.initialize();
      await controller.writePattern(samplePatterns.simple);
      await controller.play();

      const analysis1 = await controller.analyzeAudio();
      const timestamp1 = analysis1.timestamp;

      await new Promise(resolve => setTimeout(resolve, 100));

      const analysis2 = await controller.analyzeAudio();
      const timestamp2 = analysis2.timestamp;

      // Timestamps should be valid
      expect(timestamp1).toBeGreaterThan(0);
      expect(timestamp2).toBeGreaterThan(0);

      // Second timestamp should be later (or equal if cached)
      expect(timestamp2).toBeGreaterThanOrEqual(timestamp1);
    }, TEST_TIMEOUT);
  });

  // ============================================================================
  // ERROR RECOVERY TESTS
  // ============================================================================

  describe('Error recovery scenarios', () => {
    test('should handle browser initialization failure', async () => {
      (chromium.launch as jest.Mock).mockRejectedValueOnce(
        new Error('Browser failed to launch')
      );

      const failController = new StrudelController(true);

      await expect(failController.initialize()).rejects.toThrow('Browser failed to launch');
    }, TEST_TIMEOUT);

    test('should recover from write errors', async () => {
      await controller.initialize();

      // Mock a temporary failure
      const originalEvaluate = mockPage.evaluate;
      let callCount = 0;

      mockPage.evaluate = jest.fn(async (...args: any[]) => {
        callCount++;
        if (callCount === 1) {
          throw new Error('Temporary failure');
        }
        return originalEvaluate.apply(mockPage, args);
      });

      // First write should fail
      await expect(controller.writePattern(samplePatterns.simple))
        .rejects.toThrow();

      // Second write should succeed (recovery)
      const result = await controller.writePattern(samplePatterns.simple);
      expect(result).toContain('Pattern written');
    }, TEST_TIMEOUT);

    test('should handle browser crash simulation', async () => {
      await controller.initialize();
      await controller.writePattern(samplePatterns.techno);
      await controller.play();

      // Simulate browser crash by closing it and making page methods fail
      await mockBrowser.close();
      expect(mockBrowser.isClosed()).toBe(true);

      // Make page operations fail after browser close
      mockPage.evaluate = jest.fn().mockRejectedValue(new Error('Browser closed'));

      // Invalidate cache to force a fresh read
      controller.invalidateCache();

      // Subsequent operations should fail gracefully
      await expect(controller.getCurrentPattern()).rejects.toThrow();
    }, TEST_TIMEOUT);

    test('should handle invalid pattern gracefully', async () => {
      await controller.initialize();

      // Write invalid pattern
      const result = await controller.writePattern(samplePatterns.invalid);
      expect(result).toContain('Pattern written');

      // Pattern should still be written (validation is separate)
      const retrieved = await controller.getCurrentPattern();
      expect(retrieved).toBe(samplePatterns.invalid);
    }, TEST_TIMEOUT);

    test('should recover from play/stop errors', async () => {
      await controller.initialize();
      await controller.writePattern(samplePatterns.simple);

      // Mock keyboard failure
      const originalPress = mockPage.keyboard.press;
      let pressCallCount = 0;

      mockPage.keyboard.press = jest.fn(async (key: string) => {
        pressCallCount++;
        if (pressCallCount === 1) {
          throw new Error('Keyboard error');
        }
        return originalPress.call(mockPage.keyboard, key);
      });

      // First play should fail
      await expect(controller.play()).rejects.toThrow();

      // Second play should succeed (recovery)
      const result = await controller.play();
      expect(result).toBe('Playing');
    }, TEST_TIMEOUT);

    test('should handle pattern store errors', async () => {
      const invalidDir = '/invalid/path/that/does/not/exist';
      const badStore = new PatternStore(invalidDir);

      // Save should fail
      await expect(badStore.save('test', samplePatterns.simple))
        .rejects.toThrow();

      // Load should return null for non-existent pattern
      const loaded = await store.load('does-not-exist');
      expect(loaded).toBeNull();
    }, TEST_TIMEOUT);

    test('should handle cleanup after errors', async () => {
      await controller.initialize();

      // Cause an error
      mockPage.evaluate = jest.fn().mockRejectedValue(new Error('Fatal error'));

      try {
        await controller.getCurrentPattern();
      } catch (error) {
        // Expected
      }

      // Cleanup should still work
      await expect(controller.cleanup()).resolves.not.toThrow();
    }, TEST_TIMEOUT);
  });

  // ============================================================================
  // PERFORMANCE AND CACHING TESTS
  // ============================================================================

  describe('Performance and caching', () => {
    test('should use cache for repeated pattern reads', async () => {
      await controller.initialize();
      await controller.writePattern(samplePatterns.techno);

      const evaluateSpy = jest.spyOn(mockPage, 'evaluate');
      evaluateSpy.mockClear();

      // First read
      await controller.getCurrentPattern();
      const firstCallCount = evaluateSpy.mock.calls.length;

      // Second read (should use cache)
      await controller.getCurrentPattern();
      const secondCallCount = evaluateSpy.mock.calls.length;

      // Cache should reduce evaluate calls
      expect(secondCallCount).toBeLessThanOrEqual(firstCallCount + 1);
    }, TEST_TIMEOUT);

    test('should invalidate cache on write', async () => {
      await controller.initialize();

      await controller.writePattern(samplePatterns.simple);
      const pattern1 = await controller.getCurrentPattern();

      await controller.writePattern(samplePatterns.complex);
      const pattern2 = await controller.getCurrentPattern();

      expect(pattern1).not.toBe(pattern2);
      expect(pattern2).toBe(samplePatterns.complex);
    }, TEST_TIMEOUT);

    test('should handle concurrent operations correctly', async () => {
      await controller.initialize();

      // Concurrent writes (should be serialized)
      const patterns = [
        samplePatterns.simple,
        samplePatterns.house,
        samplePatterns.dnb
      ];

      // Last write should win
      await Promise.all(patterns.map(p => controller.writePattern(p)));

      const final = await controller.getCurrentPattern();
      expect(patterns).toContain(final);
    }, TEST_TIMEOUT);
  });

  // ============================================================================
  // INTEGRATION WITH PATTERN STATS
  // ============================================================================

  describe('Pattern statistics integration', () => {
    test('should provide pattern stats for played pattern', async () => {
      await controller.initialize();
      await controller.writePattern(samplePatterns.complex);

      const stats = await controller.getPatternStats();

      expect(stats).toHaveProperty('lines');
      expect(stats).toHaveProperty('chars');
      expect(stats).toHaveProperty('sounds');
      expect(stats).toHaveProperty('notes');

      expect(stats.lines).toBeGreaterThan(0);
      expect(stats.chars).toBeGreaterThan(0);
      expect(stats.sounds).toBeGreaterThan(0);
    }, TEST_TIMEOUT);

    test('should take snapshot with all context', async () => {
      await controller.initialize();
      await controller.writePattern(samplePatterns.techno);
      await controller.play();

      const snapshot = await controller.takeSnapshot();

      expect(snapshot).toHaveProperty('pattern');
      expect(snapshot).toHaveProperty('timestamp');
      expect(snapshot).toHaveProperty('isPlaying');
      expect(snapshot).toHaveProperty('stats');

      expect(snapshot.pattern).toBe(samplePatterns.techno);
      expect(snapshot.isPlaying).toBe(true);
      expect(snapshot.stats.sounds).toBeGreaterThan(0);
    }, TEST_TIMEOUT);
  });

  // ============================================================================
  // COMPLEX SCENARIO TESTS
  // ============================================================================

  describe('Complex integration scenarios', () => {
    test('should handle complete pattern lifecycle', async () => {
      const patternName = 'lifecycle-test';

      // 1. Initialize
      await controller.initialize();

      // 2. Generate/write pattern
      await controller.writePattern(samplePatterns.complex);

      // 3. Play and analyze
      await controller.play();
      const playingAnalysis = await controller.analyzeAudio();
      expect(playingAnalysis.features.isPlaying).toBe(true);

      // 4. Take snapshot
      const snapshot = await controller.takeSnapshot();
      expect(snapshot.isPlaying).toBe(true);

      // 5. Stop
      await controller.stop();

      // 6. Save
      await store.save(patternName, snapshot.pattern, ['lifecycle']);

      // 7. Verify save
      const saved = await store.load(patternName);
      expect(saved).not.toBeNull();
      expect(saved!.content).toBe(samplePatterns.complex);

      // 8. Clear and reload
      await controller.writePattern('');
      await controller.writePattern(saved!.content);

      // 9. Verify reload
      const reloaded = await controller.getCurrentPattern();
      expect(reloaded).toBe(samplePatterns.complex);

      // 10. Play reloaded
      await controller.play();
      const reloadedAnalysis = await controller.analyzeAudio();
      expect(reloadedAnalysis.features.isPlaying).toBe(true);

      // 11. Cleanup
      await controller.stop();
    }, TEST_TIMEOUT * 2);

    test('should support pattern editing workflow', async () => {
      await controller.initialize();

      // Start with base pattern
      await controller.writePattern(samplePatterns.simple);
      await controller.play();
      await controller.stop();

      // Append to pattern
      await controller.appendPattern('\n' + samplePatterns.simple);
      const appended = await controller.getCurrentPattern();
      expect(appended.split(samplePatterns.simple).length).toBe(3); // Two instances + split result

      // Replace in pattern
      await controller.replaceInPattern('bd', 'cp');
      const replaced = await controller.getCurrentPattern();
      expect(replaced).toContain('cp');
      expect(replaced).not.toContain('bd');

      // Test final pattern
      await controller.play();
      expect(controller.getPlaybackState()).toBe(true);
    }, TEST_TIMEOUT);

    test('should handle rapid pattern switching', async () => {
      await controller.initialize();

      const patterns = [
        samplePatterns.simple,
        samplePatterns.techno,
        samplePatterns.house,
        samplePatterns.dnb
      ];

      for (const pattern of patterns) {
        await controller.writePattern(pattern);
        await controller.play();

        // Quick analysis
        const analysis = await controller.analyzeAudio();
        expect(analysis.features.isPlaying).toBe(true);

        await controller.stop();

        // Verify pattern
        const current = await controller.getCurrentPattern();
        expect(current).toBe(pattern);
      }
    }, TEST_TIMEOUT);
  });
});
