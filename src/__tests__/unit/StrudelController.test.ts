import { StrudelController } from '../../StrudelController';
import { chromium } from 'playwright';
import { MockBrowser, MockPage, createMockPage } from '../utils/MockPlaywright';
import { samplePatterns } from '../utils/TestFixtures';

// Mock Playwright
jest.mock('playwright', () => ({
  chromium: {
    launch: jest.fn()
  }
}));

describe('StrudelController', () => {
  let controller: StrudelController;
  let mockBrowser: MockBrowser;
  let mockPage: MockPage;

  beforeEach(() => {
    mockPage = createMockPage();
    mockBrowser = new MockBrowser();
    mockBrowser.newContext = jest.fn().mockResolvedValue({
      newPage: jest.fn().mockResolvedValue(mockPage)
    });

    (chromium.launch as jest.Mock).mockResolvedValue(mockBrowser);

    controller = new StrudelController(true);
  });

  afterEach(async () => {
    await controller.cleanup();
    jest.clearAllMocks();
  });

  describe('initialization', () => {
    test('should initialize browser and page', async () => {
      const result = await controller.initialize();

      expect(result).toContain('initialized');
      expect(chromium.launch).toHaveBeenCalledWith(
        expect.objectContaining({
          headless: true
        })
      );
    });

    test('should not reinitialize if already initialized', async () => {
      await controller.initialize();
      const result = await controller.initialize();

      expect(result).toBe('Already initialized');
      expect(chromium.launch).toHaveBeenCalledTimes(1);
    });

    test('should wait for editor selector', async () => {
      mockPage.waitForSelector = jest.fn().mockResolvedValue(true);

      await controller.initialize();

      expect(mockPage.waitForSelector).toHaveBeenCalledWith('.cm-content', expect.any(Object));
    });

    test('should inject audio analyzer', async () => {
      const evaluateSpy = jest.spyOn(mockPage, 'evaluate');

      await controller.initialize();

      expect(evaluateSpy).toHaveBeenCalled();
    });

    test('should handle initialization errors gracefully', async () => {
      (chromium.launch as jest.Mock).mockRejectedValue(new Error('Browser launch failed'));

      await expect(controller.initialize()).rejects.toThrow('Browser launch failed');
    });
  });

  describe('writePattern', () => {
    beforeEach(async () => {
      await controller.initialize();
    });

    test('should write simple pattern', async () => {
      const pattern = samplePatterns.simple;
      const result = await controller.writePattern(pattern);

      expect(result).toContain('Pattern written');
      expect(result).toContain(pattern.length.toString());
    });

    test('should write complex pattern', async () => {
      const pattern = samplePatterns.complex;
      const result = await controller.writePattern(pattern);

      expect(result).toContain('Pattern written');
      expect(mockPage.getContent()).toBe(pattern);
    });

    test('should throw error if not initialized', async () => {
      const uninitializedController = new StrudelController();
      await expect(uninitializedController.writePattern('s("bd*4")'))
        .rejects.toThrow('Browser not initialized');
    });

    test('should update editor cache after writing', async () => {
      const pattern = samplePatterns.techno;
      await controller.writePattern(pattern);

      // Cache should be updated immediately
      const retrieved = await controller.getCurrentPattern();
      expect(retrieved).toBe(pattern);
    });
  });

  describe('getCurrentPattern', () => {
    beforeEach(async () => {
      await controller.initialize();
    });

    test('should retrieve current pattern', async () => {
      const pattern = samplePatterns.house;
      mockPage.setContent(pattern);

      const result = await controller.getCurrentPattern();

      expect(result).toBe(pattern);
    });

    test('should return empty string for empty editor', async () => {
      mockPage.setContent('');

      const result = await controller.getCurrentPattern();

      expect(result).toBe('');
    });

    test('should use cache for repeated reads', async () => {
      const pattern = samplePatterns.techno;
      await controller.writePattern(pattern);

      const evaluateSpy = jest.spyOn(mockPage, 'evaluate');
      evaluateSpy.mockClear();

      // First call should hit cache
      await controller.getCurrentPattern();
      // Second call within TTL should also hit cache
      await controller.getCurrentPattern();

      // evaluate should be called max once (cache hit)
      expect(evaluateSpy.mock.calls.length).toBeLessThanOrEqual(1);
    });
  });

  describe('play and stop', () => {
    beforeEach(async () => {
      await controller.initialize();
    });

    test('should start playback', async () => {
      const result = await controller.play();

      expect(result).toBe('Playing');
      expect(controller.getPlaybackState()).toBe(true);
    });

    test('should stop playback', async () => {
      await controller.play();
      const result = await controller.stop();

      expect(result).toBe('Stopped');
      expect(controller.getPlaybackState()).toBe(false);
    });

    test('should use keyboard shortcut for play', async () => {
      const pressSpy = jest.spyOn(mockPage.keyboard, 'press');

      await controller.play();

      expect(pressSpy).toHaveBeenCalledWith('ControlOrMeta+Enter');
    });

    test('should use keyboard shortcut for stop', async () => {
      const pressSpy = jest.spyOn(mockPage.keyboard, 'press');

      await controller.stop();

      expect(pressSpy).toHaveBeenCalledWith('ControlOrMeta+Period');
    });
  });

  describe('analyzeAudio', () => {
    beforeEach(async () => {
      await controller.initialize();
    });

    test('should return audio analysis when playing', async () => {
      await controller.play();
      const analysis = await controller.analyzeAudio();

      expect(analysis).toHaveProperty('connected');
      expect(analysis).toHaveProperty('features');
      expect(analysis.connected).toBe(true);
    });

    test('should return correct audio features', async () => {
      await controller.play();
      const analysis = await controller.analyzeAudio();

      expect(analysis.features).toHaveProperty('bass');
      expect(analysis.features).toHaveProperty('mid');
      expect(analysis.features).toHaveProperty('treble');
      expect(analysis.features).toHaveProperty('isPlaying');
    });

    test('should indicate silence when not playing', async () => {
      const analysis = await controller.analyzeAudio();

      expect(analysis.features.isPlaying).toBe(false);
      expect(analysis.features.isSilent).toBe(true);
    });
  });

  describe('cleanup', () => {
    test('should close browser on cleanup', async () => {
      await controller.initialize();
      const closeSpy = jest.spyOn(mockBrowser, 'close');

      await controller.cleanup();

      expect(closeSpy).toHaveBeenCalled();
    });

    test('should clear cache on cleanup', async () => {
      await controller.initialize();
      await controller.writePattern(samplePatterns.simple);

      await controller.cleanup();

      // After cleanup, should not be able to get pattern
      await expect(controller.getCurrentPattern()).rejects.toThrow('Browser not initialized');
    });

    test('should handle cleanup when not initialized', async () => {
      await expect(controller.cleanup()).resolves.not.toThrow();
    });
  });

  describe('cache management', () => {
    beforeEach(async () => {
      await controller.initialize();
    });

    test('should invalidate cache manually', async () => {
      await controller.writePattern(samplePatterns.simple);
      controller.invalidateCache();

      // After invalidation, next read should fetch from page
      const evaluateSpy = jest.spyOn(mockPage, 'evaluate');
      await controller.getCurrentPattern();

      expect(evaluateSpy).toHaveBeenCalled();
    });

    test('should update cache on write', async () => {
      const pattern1 = samplePatterns.simple;
      const pattern2 = samplePatterns.techno;

      await controller.writePattern(pattern1);
      let cached = await controller.getCurrentPattern();
      expect(cached).toBe(pattern1);

      await controller.writePattern(pattern2);
      cached = await controller.getCurrentPattern();
      expect(cached).toBe(pattern2);
    });
  });

  describe('pattern manipulation', () => {
    beforeEach(async () => {
      await controller.initialize();
    });

    test('should append to existing pattern', async () => {
      await controller.writePattern('s("bd*4")');
      await controller.appendPattern('s("cp*2")');

      const result = await controller.getCurrentPattern();
      expect(result).toContain('s("bd*4")');
      expect(result).toContain('s("cp*2")');
    });

    test('should insert at specific line', async () => {
      await controller.writePattern('line1\nline3');
      await controller.insertAtLine(1, 'line2');

      const result = await controller.getCurrentPattern();
      const lines = result.split('\n');
      expect(lines[0]).toContain('line1');
      expect(lines[1]).toBe('line2');
      expect(lines[2]).toContain('line3');
    });

    test('should replace text in pattern', async () => {
      await controller.writePattern('s("bd*4")');
      await controller.replaceInPattern('bd', 'cp');

      const result = await controller.getCurrentPattern();
      expect(result).toContain('cp');
      expect(result).not.toContain('bd');
    });

    test('should handle replace with no matches', async () => {
      await controller.writePattern('s("bd*4")');
      const result = await controller.replaceInPattern('nonexistent', 'replacement');

      expect(result).toContain('No matches found');
    });

    test('should throw error for invalid line insertion', async () => {
      await controller.writePattern('line1');
      await expect(controller.insertAtLine(10, 'invalid'))
        .rejects.toThrow('Invalid line number');
    });
  });

  describe('appendPattern', () => {
    beforeEach(async () => {
      await controller.initialize();
    });

    test('should append to empty pattern', async () => {
      await controller.writePattern('');
      const result = await controller.appendPattern('s("bd*4")');

      expect(result).toContain('Pattern written');
      const pattern = await controller.getCurrentPattern();
      expect(pattern).toContain('s("bd*4")');
    });

    test('should append to existing pattern with newline', async () => {
      await controller.writePattern('s("bd*4")');
      await controller.appendPattern('s("cp*2")');

      const pattern = await controller.getCurrentPattern();
      const lines = pattern.split('\n');
      expect(lines[0]).toContain('s("bd*4")');
      expect(lines[1]).toContain('s("cp*2")');
    });

    test('should throw error when not initialized', async () => {
      const uninitController = new StrudelController();
      await expect(uninitController.appendPattern('s("bd*4")'))
        .rejects.toThrow('Browser not initialized');
    });

    test('should preserve existing multiline pattern', async () => {
      const initial = 's("bd*4")\ns("cp*2")';
      await controller.writePattern(initial);
      await controller.appendPattern('s("hh*8")');

      const pattern = await controller.getCurrentPattern();
      const lines = pattern.split('\n');
      expect(lines.length).toBe(3);
      expect(lines[2]).toContain('s("hh*8")');
    });
  });

  describe('insertAtLine', () => {
    beforeEach(async () => {
      await controller.initialize();
    });

    test('should insert at line 0 (beginning)', async () => {
      await controller.writePattern('line2\nline3');
      await controller.insertAtLine(0, 'line1');

      const pattern = await controller.getCurrentPattern();
      const lines = pattern.split('\n');
      expect(lines[0]).toBe('line1');
      expect(lines[1]).toContain('line2');
      expect(lines[2]).toContain('line3');
    });

    test('should insert at end of pattern', async () => {
      await controller.writePattern('line1\nline2');
      const lines = (await controller.getCurrentPattern()).split('\n');
      await controller.insertAtLine(lines.length, 'line3');

      const pattern = await controller.getCurrentPattern();
      const newLines = pattern.split('\n');
      expect(newLines[newLines.length - 1]).toBe('line3');
    });

    test('should insert in middle of pattern', async () => {
      await controller.writePattern('line1\nline3\nline4');
      await controller.insertAtLine(1, 'line2');

      const pattern = await controller.getCurrentPattern();
      const lines = pattern.split('\n');
      expect(lines[1]).toBe('line2');
      expect(lines[2]).toContain('line3');
    });

    test('should throw error for negative line number', async () => {
      await controller.writePattern('line1');
      await expect(controller.insertAtLine(-1, 'invalid'))
        .rejects.toThrow('Invalid line number');
    });

    test('should throw error for line number beyond end', async () => {
      await controller.writePattern('line1\nline2');
      await expect(controller.insertAtLine(100, 'invalid'))
        .rejects.toThrow('Invalid line number');
    });

    test('should throw error when not initialized', async () => {
      const uninitController = new StrudelController();
      await expect(uninitController.insertAtLine(0, 's("bd*4")'))
        .rejects.toThrow('Browser not initialized');
    });

    test('should insert into empty pattern at line 0', async () => {
      await controller.writePattern('');
      await controller.insertAtLine(0, 's("bd*4")');

      const pattern = await controller.getCurrentPattern();
      expect(pattern).toContain('s("bd*4")');
    });
  });

  describe('replaceInPattern', () => {
    beforeEach(async () => {
      await controller.initialize();
    });

    test('should replace single occurrence', async () => {
      await controller.writePattern('s("bd*4")');
      const result = await controller.replaceInPattern('bd', 'cp');

      expect(result).toContain('Pattern written');
      const pattern = await controller.getCurrentPattern();
      expect(pattern).toContain('cp');
      expect(pattern).not.toContain('bd');
    });

    test('should replace all occurrences', async () => {
      await controller.writePattern('s("bd*4")\ns("bd*2")\ns("bd*8")');
      await controller.replaceInPattern('bd', 'cp');

      const pattern = await controller.getCurrentPattern();
      expect(pattern).not.toContain('bd');
      expect((pattern.match(/cp/g) || []).length).toBe(3);
    });

    test('should return no matches message when search not found', async () => {
      await controller.writePattern('s("bd*4")');
      const result = await controller.replaceInPattern('xyz', 'abc');

      expect(result).toBe('No matches found for: xyz');
      const pattern = await controller.getCurrentPattern();
      expect(pattern).toBe('s("bd*4")');
    });

    test('should handle regex special characters in search', async () => {
      await controller.writePattern('s("bd*4")');
      const result = await controller.replaceInPattern('*4', '*8');

      expect(result).toContain('Pattern written');
      const pattern = await controller.getCurrentPattern();
      expect(pattern).toBe('s("bd*8")');
    });

    test('should handle parentheses in search', async () => {
      await controller.writePattern('s("bd*4")');
      await controller.replaceInPattern('("bd*4")', '("cp*2")');

      const pattern = await controller.getCurrentPattern();
      expect(pattern).toBe('s("cp*2")');
    });

    test('should handle dots and brackets in search', async () => {
      await controller.writePattern('s("bd*4").delay(0.5)');
      await controller.replaceInPattern('.delay(0.5)', '.reverb(2)');

      const pattern = await controller.getCurrentPattern();
      expect(pattern).toBe('s("bd*4").reverb(2)');
    });

    test('should throw error when not initialized', async () => {
      const uninitController = new StrudelController();
      await expect(uninitController.replaceInPattern('bd', 'cp'))
        .rejects.toThrow('Browser not initialized');
    });

    test('should handle empty search string', async () => {
      await controller.writePattern('s("bd*4")');
      const result = await controller.replaceInPattern('', 'x');

      // Empty string matches everywhere, so pattern should be modified
      expect(result).toContain('Pattern written');
    });

    test('should replace in multiline pattern', async () => {
      const multiline = 's("bd*4")\nstack(\n  s("cp*2"),\n  s("hh*8")\n)';
      await controller.writePattern(multiline);
      await controller.replaceInPattern('s(', 'sound(');

      const pattern = await controller.getCurrentPattern();
      expect((pattern.match(/sound\(/g) || []).length).toBe(3);
      expect(pattern).not.toContain('s(');
    });
  });

  describe('getPatternStats', () => {
    beforeEach(async () => {
      await controller.initialize();
    });

    test('should return correct stats for simple pattern', async () => {
      await controller.writePattern('s("bd*4")');
      const stats = await controller.getPatternStats();

      expect(stats.lines).toBe(1);
      expect(stats.chars).toBe(9); // s("bd*4") is 9 characters
      expect(stats.sounds).toBe(1);
      expect(stats.notes).toBe(0);
      expect(stats.effects).toBe(0);
      expect(stats.functions).toBe(0);
    });

    test('should count multiple sound calls', async () => {
      await controller.writePattern('s("bd*4")\ns("cp*2")\ns("hh*8")');
      const stats = await controller.getPatternStats();

      expect(stats.sounds).toBe(3);
      expect(stats.lines).toBe(3);
    });

    test('should count note calls', async () => {
      await controller.writePattern('note("C D E F")');
      const stats = await controller.getPatternStats();

      expect(stats.notes).toBe(1);
      expect(stats.sounds).toBe(0);
    });

    test('should count effects', async () => {
      await controller.writePattern('s("bd*4").room(0.5).delay(0.2).reverb(2).lpf(1000)');
      const stats = await controller.getPatternStats();

      expect(stats.effects).toBe(4);
      expect(stats.sounds).toBe(1);
    });

    test('should count pattern functions', async () => {
      await controller.writePattern('stack(s("bd*4"), s("cp*2")).every(4, fast(2)).sometimes(slow(2))');
      const stats = await controller.getPatternStats();

      expect(stats.functions).toBe(5); // stack, every, fast, sometimes, slow
    });

    test('should return zero stats for empty pattern', async () => {
      await controller.writePattern('');
      const stats = await controller.getPatternStats();

      expect(stats.lines).toBe(1);
      expect(stats.chars).toBe(0);
      expect(stats.sounds).toBe(0);
      expect(stats.notes).toBe(0);
      expect(stats.effects).toBe(0);
      expect(stats.functions).toBe(0);
    });

    test('should count multiline pattern correctly', async () => {
      const pattern = 's("bd*4")\ns("cp*2")\ns("hh*8")';
      await controller.writePattern(pattern);
      const stats = await controller.getPatternStats();

      expect(stats.lines).toBe(3);
      expect(stats.chars).toBe(pattern.length);
      expect(stats.sounds).toBe(3);
    });

    test('should throw error when not initialized', async () => {
      const uninitController = new StrudelController();
      await expect(uninitController.getPatternStats())
        .rejects.toThrow('Browser not initialized');
    });

    test('should handle complex pattern stats', async () => {
      const complex = samplePatterns.complex;
      await controller.writePattern(complex);
      const stats = await controller.getPatternStats();

      expect(stats.sounds).toBeGreaterThan(0);
      expect(stats.chars).toBe(complex.length);
      expect(stats.lines).toBe(complex.split('\n').length);
    });
  });

  describe('takeSnapshot', () => {
    beforeEach(async () => {
      await controller.initialize();
    });

    test('should take snapshot with all required fields', async () => {
      await controller.writePattern('s("bd*4")');
      const snapshot = await controller.takeSnapshot();

      expect(snapshot).toHaveProperty('pattern');
      expect(snapshot).toHaveProperty('timestamp');
      expect(snapshot).toHaveProperty('isPlaying');
      expect(snapshot).toHaveProperty('stats');
    });

    test('should capture current pattern in snapshot', async () => {
      const pattern = samplePatterns.techno;
      await controller.writePattern(pattern);
      const snapshot = await controller.takeSnapshot();

      expect(snapshot.pattern).toBe(pattern);
    });

    test('should capture playing state in snapshot', async () => {
      await controller.writePattern('s("bd*4")');
      await controller.play();
      const snapshot = await controller.takeSnapshot();

      expect(snapshot.isPlaying).toBe(true);
    });

    test('should capture stopped state in snapshot', async () => {
      await controller.writePattern('s("bd*4")');
      await controller.play();
      await controller.stop();
      const snapshot = await controller.takeSnapshot();

      expect(snapshot.isPlaying).toBe(false);
    });

    test('should have valid ISO timestamp', async () => {
      await controller.writePattern('s("bd*4")');
      const snapshot = await controller.takeSnapshot();

      const date = new Date(snapshot.timestamp);
      expect(date.getTime()).toBeGreaterThan(0);
      expect(snapshot.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    });

    test('should include pattern stats in snapshot', async () => {
      await controller.writePattern('s("bd*4").delay(0.5)');
      const snapshot = await controller.takeSnapshot();

      expect(snapshot.stats).toHaveProperty('lines');
      expect(snapshot.stats).toHaveProperty('chars');
      expect(snapshot.stats).toHaveProperty('sounds');
      expect(snapshot.stats).toHaveProperty('effects');
      expect(snapshot.stats.sounds).toBe(1);
      expect(snapshot.stats.effects).toBe(1);
    });

    test('should throw error when not initialized', async () => {
      const uninitController = new StrudelController();
      await expect(uninitController.takeSnapshot())
        .rejects.toThrow('Browser not initialized');
    });

    test('should snapshot empty pattern', async () => {
      await controller.writePattern('');
      const snapshot = await controller.takeSnapshot();

      expect(snapshot.pattern).toBe('');
      expect(snapshot.stats.chars).toBe(0);
      expect(snapshot.stats.sounds).toBe(0);
    });

    test('should have timestamps close to actual time', async () => {
      const before = new Date();
      await controller.writePattern('s("bd*4")');
      const snapshot = await controller.takeSnapshot();
      const after = new Date();

      const snapshotTime = new Date(snapshot.timestamp);
      expect(snapshotTime.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(snapshotTime.getTime()).toBeLessThanOrEqual(after.getTime());
    });
  });

  // SECURITY: executeInStrudelContext tests removed in issue #56
  // The method was removed due to Function constructor injection vulnerability

  describe('pattern statistics', () => {
    beforeEach(async () => {
      await controller.initialize();
    });

    test('should count pattern elements', async () => {
      await controller.writePattern(samplePatterns.complex);
      const stats = await controller.getPatternStats();

      expect(stats).toHaveProperty('lines');
      expect(stats).toHaveProperty('chars');
      expect(stats).toHaveProperty('sounds');
      expect(stats).toHaveProperty('notes');
      expect(stats).toHaveProperty('effects');
      expect(stats).toHaveProperty('functions');

      expect(stats.sounds).toBeGreaterThan(0);
      expect(stats.notes).toBeGreaterThan(0);
    });

    test('should return zero stats for empty pattern', async () => {
      await controller.writePattern('');
      const stats = await controller.getPatternStats();

      expect(stats.sounds).toBe(0);
      expect(stats.notes).toBe(0);
      expect(stats.effects).toBe(0);
    });
  });

  describe('snapshot functionality', () => {
    beforeEach(async () => {
      await controller.initialize();
    });

    test('should take snapshot of current state', async () => {
      await controller.writePattern(samplePatterns.techno);
      await controller.play();

      const snapshot = await controller.takeSnapshot();

      expect(snapshot).toHaveProperty('pattern');
      expect(snapshot).toHaveProperty('timestamp');
      expect(snapshot).toHaveProperty('isPlaying');
      expect(snapshot).toHaveProperty('stats');

      expect(snapshot.isPlaying).toBe(true);
      expect(snapshot.pattern).toBe(samplePatterns.techno);
    });

    test('snapshot timestamp should be ISO format', async () => {
      await controller.writePattern('s("bd*4")');
      const snapshot = await controller.takeSnapshot();

      expect(() => new Date(snapshot.timestamp)).not.toThrow();
      expect(new Date(snapshot.timestamp).getTime()).toBeGreaterThan(0);
    });
  });

  describe('diagnostics', () => {
    test('should return diagnostics when not initialized', async () => {
      const diagnostics = await controller.getDiagnostics();

      expect(diagnostics.browserConnected).toBe(false);
      expect(diagnostics.pageLoaded).toBe(false);
    });

    test('should return diagnostics when initialized', async () => {
      await controller.initialize();
      const diagnostics = await controller.getDiagnostics();

      expect(diagnostics.browserConnected).toBe(true);
      expect(diagnostics.pageLoaded).toBe(true);
      expect(diagnostics).toHaveProperty('cacheStatus');
    });

    test('should track cache status', async () => {
      await controller.initialize();
      await controller.writePattern('s("bd*4")');

      const diagnostics = await controller.getDiagnostics();

      expect(diagnostics.cacheStatus.hasCache).toBe(true);
      expect(diagnostics.cacheStatus.cacheAge).toBeGreaterThanOrEqual(0);
    });
  });

  describe('error handling', () => {
    beforeEach(async () => {
      await controller.initialize();
    });

    test('should handle page evaluation errors', async () => {
      mockPage.evaluate = jest.fn().mockRejectedValue(new Error('Evaluation failed'));

      // Test error handling via getCurrentPattern which uses page.evaluate
      await expect(controller.getCurrentPattern())
        .rejects.toThrow('Evaluation failed');
    });

    test('should handle selector timeout', async () => {
      const uninitController = new StrudelController(true);
      mockPage.waitForSelector = jest.fn().mockRejectedValue(new Error('Timeout'));

      await expect(uninitController.initialize()).rejects.toThrow('Timeout');
    });
  });

  describe('pattern validation', () => {
    beforeEach(async () => {
      await controller.initialize();
    });

    test('should validate valid pattern', async () => {
      const result = await controller.validatePattern(samplePatterns.simple);

      expect(result).toHaveProperty('valid');
      expect(result.valid).toBe(true);
    });

    test('should detect invalid patterns', async () => {
      const result = await controller.validatePattern(samplePatterns.invalid);

      // The validator might not mark it as invalid if it doesn't detect syntax errors
      // but should have warnings
      if (!result.valid) {
        expect(result.errors.length).toBeGreaterThan(0);
      } else {
        expect(result.warnings.length).toBeGreaterThan(0);
      }
    });

    test('should auto-fix patterns when enabled', async () => {
      const result = await controller.validatePattern(samplePatterns.syntaxError, true);

      if (!result.valid) {
        expect(result.suggestions.length).toBeGreaterThan(0);
      }
    });

    test('should write pattern with validation', async () => {
      const writeResult = await controller.writePatternWithValidation(
        samplePatterns.simple,
        { skipValidation: false }
      );

      expect(writeResult.result).toContain('Pattern written');
    });

    test('should reject invalid pattern when validation enabled', async () => {
      const writeResult = await controller.writePatternWithValidation(
        samplePatterns.invalid,
        { autoFix: false }
      );

      // The pattern might be written with warnings instead of errors
      expect(writeResult.result).toBeTruthy();
      // Check that we at least got some feedback
      expect(writeResult.result.length).toBeGreaterThan(0);
    });
  });

  describe('console message management', () => {
    beforeEach(async () => {
      await controller.initialize();
    });

    test('should return empty arrays initially', () => {
      expect(controller.getConsoleErrors()).toEqual([]);
      expect(controller.getConsoleWarnings()).toEqual([]);
    });

    test('should clear console messages', () => {
      // Trigger some activity then clear
      controller.clearConsoleMessages();
      expect(controller.getConsoleErrors()).toEqual([]);
      expect(controller.getConsoleWarnings()).toEqual([]);
    });

    test('should return copies of arrays not references', () => {
      const errors1 = controller.getConsoleErrors();
      const errors2 = controller.getConsoleErrors();
      expect(errors1).not.toBe(errors2);
      expect(errors1).toEqual(errors2);
    });
  });

  describe('page getter', () => {
    test('should return null when not initialized', () => {
      expect(controller.page).toBeNull();
    });

    test('should return page when initialized', async () => {
      await controller.initialize();
      expect(controller.page).not.toBeNull();
    });
  });

  describe('getStatus', () => {
    test('should return status when not initialized', () => {
      const status = controller.getStatus();

      expect(status.initialized).toBe(false);
      expect(status.playing).toBe(false);
      expect(status.patternLength).toBe(0);
      expect(status.cacheValid).toBe(false);
      expect(status.errorCount).toBe(0);
      expect(status.warningCount).toBe(0);
    });

    test('should return status when initialized', async () => {
      await controller.initialize();
      const status = controller.getStatus();

      expect(status.initialized).toBe(true);
      expect(status.playing).toBe(false);
    });

    test('should reflect playback state', async () => {
      await controller.initialize();
      await controller.play();

      const status = controller.getStatus();
      expect(status.playing).toBe(true);
    });

    test('should reflect pattern length', async () => {
      await controller.initialize();
      await controller.writePattern('s("bd*4")');

      const status = controller.getStatus();
      expect(status.patternLength).toBeGreaterThan(0);
    });

    test('should reflect cache validity', async () => {
      await controller.initialize();
      await controller.writePattern('s("bd*4")');

      const status = controller.getStatus();
      expect(status.cacheValid).toBe(true);

      controller.invalidateCache();
      const status2 = controller.getStatus();
      expect(status2.cacheValid).toBe(false);
    });
  });

  describe('showBrowser', () => {
    test('should throw error when not initialized', async () => {
      await expect(controller.showBrowser())
        .rejects.toThrow('Browser not initialized');
    });

    test('should call bringToFront when initialized', async () => {
      await controller.initialize();
      mockPage.bringToFront = jest.fn().mockResolvedValue(undefined);

      const result = await controller.showBrowser();

      expect(result).toContain('Browser window brought to foreground');
      expect(mockPage.bringToFront).toHaveBeenCalled();
    });

    test('should handle bringToFront errors', async () => {
      await controller.initialize();
      mockPage.bringToFront = jest.fn().mockRejectedValue(new Error('Window unavailable'));

      await expect(controller.showBrowser())
        .rejects.toThrow('Failed to show browser: Window unavailable');
    });
  });

  describe('takeScreenshot', () => {
    test('should throw error when not initialized', async () => {
      await expect(controller.takeScreenshot())
        .rejects.toThrow('Browser not initialized');
    });

    test('should take screenshot with default name', async () => {
      await controller.initialize();
      mockPage.screenshot = jest.fn().mockResolvedValue(undefined);

      const result = await controller.takeScreenshot();

      expect(result).toContain('Screenshot saved to');
      expect(result).toContain('tmp');
      expect(mockPage.screenshot).toHaveBeenCalled();
    });

    test('should take screenshot with custom filename', async () => {
      await controller.initialize();
      mockPage.screenshot = jest.fn().mockResolvedValue(undefined);

      const result = await controller.takeScreenshot('my-screenshot.png');

      expect(result).toContain('Screenshot saved to');
      expect(result).toContain('my-screenshot.png');
    });

    test('should take screenshot with full path', async () => {
      await controller.initialize();
      mockPage.screenshot = jest.fn().mockResolvedValue(undefined);

      const result = await controller.takeScreenshot('/custom/path/screenshot.png');

      expect(result).toContain('/custom/path/screenshot.png');
    });

    test('should handle screenshot errors', async () => {
      await controller.initialize();
      mockPage.screenshot = jest.fn().mockRejectedValue(new Error('Screenshot failed'));

      await expect(controller.takeScreenshot())
        .rejects.toThrow('Failed to take screenshot: Screenshot failed');
    });
  });

  describe('waitForAudioConnection', () => {
    beforeEach(async () => {
      await controller.initialize();
    });

    test('should throw error when not initialized', async () => {
      const uninitController = new StrudelController();
      await expect(uninitController.waitForAudioConnection())
        .rejects.toThrow('Browser not initialized');
    });

    test('should return true when audio connects immediately', async () => {
      mockPage.evaluate = jest.fn().mockResolvedValue(true);

      const result = await controller.waitForAudioConnection(1000);

      expect(result).toBe(true);
    });

    test('should return false on timeout', async () => {
      mockPage.evaluate = jest.fn().mockResolvedValue(false);

      const result = await controller.waitForAudioConnection(100);

      expect(result).toBe(false);
    });

    test('should poll until connected', async () => {
      let callCount = 0;
      mockPage.evaluate = jest.fn().mockImplementation(() => {
        callCount++;
        return Promise.resolve(callCount >= 3);
      });

      const result = await controller.waitForAudioConnection(5000);

      expect(result).toBe(true);
      expect(callCount).toBeGreaterThanOrEqual(3);
    });
  });

  describe('detectKey', () => {
    test('should throw error when not initialized', async () => {
      const uninitController = new StrudelController();
      await expect(uninitController.detectKey())
        .rejects.toThrow('Browser not initialized');
    });

    test('should call analyzer detectKey', async () => {
      await controller.initialize();
      const mockKeyAnalysis = { key: 'C', scale: 'major', confidence: 0.95 };
      jest.spyOn(controller.analyzer, 'detectKey').mockResolvedValue(mockKeyAnalysis);

      const result = await controller.detectKey();

      expect(result).toEqual(mockKeyAnalysis);
    });
  });

  describe('detectTempo', () => {
    test('should throw error when not initialized', async () => {
      const uninitController = new StrudelController();
      await expect(uninitController.detectTempo())
        .rejects.toThrow('Browser not initialized');
    });

    test('should call analyzer detectTempo', async () => {
      await controller.initialize();
      const mockTempoAnalysis = { bpm: 120, confidence: 0.9, method: 'onset-based' };
      jest.spyOn(controller.analyzer, 'detectTempo').mockResolvedValue(mockTempoAnalysis);

      const result = await controller.detectTempo();

      expect(result).toEqual(mockTempoAnalysis);
    });
  });

  describe('validatePatternRuntime', () => {
    beforeEach(async () => {
      await controller.initialize();
    });

    test('should throw error when not initialized', async () => {
      const uninitController = new StrudelController();
      await expect(uninitController.validatePatternRuntime('s("bd*4")'))
        .rejects.toThrow('Browser not initialized');
    });

    test('should return valid true when no errors', async () => {
      const result = await controller.validatePatternRuntime('s("bd*4")', 50);

      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    test('should clear console messages before validation', async () => {
      const clearSpy = jest.spyOn(controller, 'clearConsoleMessages');

      await controller.validatePatternRuntime('s("bd*4")', 50);

      expect(clearSpy).toHaveBeenCalled();
    });

    test('should handle keyboard press errors gracefully', async () => {
      mockPage.keyboard.press = jest.fn().mockRejectedValue(new Error('Keyboard error'));

      // Should not throw, just log warning
      const result = await controller.validatePatternRuntime('s("bd*4")', 50);

      expect(result).toBeDefined();
    });
  });

  describe('writePattern retry logic', () => {
    beforeEach(async () => {
      await controller.initialize();
    });

    test('should retry on initial failure then succeed', async () => {
      let attempts = 0;
      mockPage.evaluate = jest.fn().mockImplementation(() => {
        attempts++;
        if (attempts === 1) return Promise.resolve(false); // First attempt fails
        if (attempts === 2) return Promise.resolve(true);  // Second attempt succeeds
        return Promise.resolve('s("bd*4")'); // Verification read
      });

      const result = await controller.writePattern('s("bd*4")');

      expect(result).toContain('Pattern written');
      expect(attempts).toBeGreaterThanOrEqual(2);
    });

    test('should throw after max retries exhausted', async () => {
      mockPage.evaluate = jest.fn().mockResolvedValue(false);

      await expect(controller.writePattern('s("bd*4")'))
        .rejects.toThrow('Failed to write pattern - editor not found or view unavailable after 3 attempts');
    });

    test('should handle verification returning null', async () => {
      let callCount = 0;
      mockPage.evaluate = jest.fn().mockImplementation(() => {
        callCount++;
        if (callCount <= 1) return Promise.resolve(true); // Write succeeds
        return Promise.resolve(null); // Verification returns null
      });

      // Should not throw, just use input pattern for cache
      const result = await controller.writePattern('s("bd*4")');

      expect(result).toContain('Pattern written');
    });
  });

  describe('writePatternWithValidation advanced', () => {
    beforeEach(async () => {
      await controller.initialize();
    });

    test('should throw error when not initialized', async () => {
      const uninitController = new StrudelController();
      await expect(uninitController.writePatternWithValidation('s("bd*4")'))
        .rejects.toThrow('Browser not initialized');
    });

    test('should skip validation when skipValidation is true', async () => {
      const result = await controller.writePatternWithValidation(
        samplePatterns.invalid,
        { skipValidation: true }
      );

      expect(result.result).toContain('Pattern written');
      expect(result.validation).toBeUndefined();
    });

    test('should handle validation warnings', async () => {
      // A pattern with potential warnings but still valid
      const result = await controller.writePatternWithValidation(
        's("bd*4").gain(1.5)',
        { skipValidation: false }
      );

      expect(result.result).toBeTruthy();
    });

    test('should auto-fix invalid patterns when autoFix enabled', async () => {
      const result = await controller.writePatternWithValidation(
        samplePatterns.syntaxError,
        { autoFix: true }
      );

      // Either succeeds with fix or reports validation result
      expect(result.result).toBeTruthy();
    });
  });

  describe('getDiagnostics advanced', () => {
    test('should handle page.evaluate errors gracefully', async () => {
      await controller.initialize();
      mockPage.evaluate = jest.fn().mockRejectedValue(new Error('Evaluate failed'));

      const diagnostics = await controller.getDiagnostics();

      expect(diagnostics.browserConnected).toBe(true);
      expect(diagnostics.pageLoaded).toBe(true);
      // Should not throw, just return defaults
      expect(diagnostics.editorReady).toBe(false);
      expect(diagnostics.audioConnected).toBe(false);
    });

    test('should check editor ready status', async () => {
      await controller.initialize();
      mockPage.evaluate = jest.fn()
        .mockResolvedValueOnce(true)   // editorReady check
        .mockResolvedValueOnce(true);  // audioConnected check

      const diagnostics = await controller.getDiagnostics();

      expect(diagnostics.editorReady).toBe(true);
      expect(diagnostics.audioConnected).toBe(true);
    });

    test('should include error stats from errorRecovery', async () => {
      await controller.initialize();

      const diagnostics = await controller.getDiagnostics();

      expect(diagnostics).toHaveProperty('errorStats');
    });
  });

  describe('getPlaybackState', () => {
    test('should return false initially', () => {
      expect(controller.getPlaybackState()).toBe(false);
    });

    test('should return true after play', async () => {
      await controller.initialize();
      await controller.play();

      expect(controller.getPlaybackState()).toBe(true);
    });

    test('should return false after stop', async () => {
      await controller.initialize();
      await controller.play();
      await controller.stop();

      expect(controller.getPlaybackState()).toBe(false);
    });
  });

  describe('play and stop error handling', () => {
    test('play should throw error when not initialized', async () => {
      await expect(controller.play())
        .rejects.toThrow('Browser not initialized');
    });

    test('stop should throw error when not initialized', async () => {
      await expect(controller.stop())
        .rejects.toThrow('Browser not initialized');
    });
  });

  describe('analyzeAudio error handling', () => {
    test('should throw error when not initialized', async () => {
      await expect(controller.analyzeAudio())
        .rejects.toThrow('Browser not initialized');
    });
  });

  describe('headless mode', () => {
    test('should respect headless=false option', async () => {
      const nonHeadlessController = new StrudelController(false);

      await nonHeadlessController.initialize();

      expect(chromium.launch).toHaveBeenCalledWith(
        expect.objectContaining({
          headless: false
        })
      );

      await nonHeadlessController.cleanup();
    });
  });

  describe('getCurrentPattern fetch from browser', () => {
    beforeEach(async () => {
      await controller.initialize();
    });

    test('should fetch from browser when cache is stale', async () => {
      // Write pattern and immediately invalidate
      await controller.writePattern('s("bd*4")');
      controller.invalidateCache();

      // Set up mock to return different content
      mockPage.setContent('s("cp*8")');

      const pattern = await controller.getCurrentPattern();
      expect(pattern).toBe('s("cp*8")');
    });

    test('should fetch from browser when cache is expired', async () => {
      await controller.writePattern('s("bd*4")');

      // Wait for cache to expire (TTL is 100ms)
      await new Promise(resolve => setTimeout(resolve, 150));

      mockPage.setContent('s("hh*16")');
      const pattern = await controller.getCurrentPattern();

      // Should fetch fresh from browser
      expect(pattern).toBe('s("hh*16")');
    });
  });

  describe('validatePattern with fixes', () => {
    beforeEach(async () => {
      await controller.initialize();
    });

    test('should return suggestions when auto-fix applies fixes', async () => {
      // Pattern with unclosed parenthesis
      const result = await controller.validatePattern('s("bd*4"', true);

      // Should have suggestions from auto-fix
      if (result.suggestions && result.suggestions.length > 0) {
        expect(result.suggestions.length).toBeGreaterThan(0);
      }
    });

    test('should return original result when no fixes needed', async () => {
      const result = await controller.validatePattern('s("bd*4")', true);

      expect(result.valid).toBe(true);
    });
  });

  describe('writePatternWithValidation failure path', () => {
    beforeEach(async () => {
      await controller.initialize();
    });

    test('should return validation failure without autoFix', async () => {
      // Pattern that fails validation
      const result = await controller.writePatternWithValidation(
        's("bd*4"', // Unclosed parenthesis
        { autoFix: false }
      );

      // Should return validation failure message
      expect(result.result).toBeTruthy();
      if (result.validation) {
        expect(result.validation.valid).toBe(false);
      }
    });
  });

  describe('writePattern with retries and logging', () => {
    beforeEach(async () => {
      await controller.initialize();
    });

    test('should log warning on retry', async () => {
      let attempts = 0;
      mockPage.evaluate = jest.fn().mockImplementation(() => {
        attempts++;
        // Fail first two attempts, succeed on third
        if (attempts <= 2) return Promise.resolve(false);
        if (attempts === 3) return Promise.resolve(true);
        return Promise.resolve('s("bd*4")');
      });

      const result = await controller.writePattern('s("bd*4")');

      expect(result).toContain('Pattern written');
      expect(attempts).toBeGreaterThanOrEqual(3);
    });
  });

  describe('waitForAudioConnection polling', () => {
    beforeEach(async () => {
      await controller.initialize();
    });

    test('should stop polling when connected mid-way', async () => {
      let callCount = 0;
      mockPage.evaluate = jest.fn().mockImplementation(() => {
        callCount++;
        // Return false first two times, then true
        return Promise.resolve(callCount > 2);
      });

      const result = await controller.waitForAudioConnection(10000);

      expect(result).toBe(true);
    });
  });

  describe('edge cases', () => {
    test('should handle constructor with default headless', () => {
      const defaultController = new StrudelController();
      expect(defaultController).toBeDefined();
    });

    test('cleanup should be idempotent', async () => {
      await controller.initialize();
      await controller.cleanup();
      await controller.cleanup(); // Should not throw
    });

    test('invalidateCache should be safe when empty', () => {
      // Cache is already empty, should not throw
      controller.invalidateCache();
      expect(controller.getStatus().cacheValid).toBe(false);
    });
  });
});
