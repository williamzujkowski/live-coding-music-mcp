import { chromium, Browser, Page } from 'playwright';
import * as path from 'path';
import { promises as fs } from 'fs';
import { AudioAnalyzer } from './AudioAnalyzer.js';
import { PatternValidator, ValidationResult } from './utils/PatternValidator.js';
import { ErrorRecovery } from './utils/ErrorRecovery.js';
import { Logger } from './utils/Logger.js';
import {
  AudioAnalysisResult,
  KeyAnalysis,
  TempoAnalysis,
  RhythmAnalysis,
  PatternStats,
  BrowserDiagnostics
} from './types/AudioAnalysis.js';

export class StrudelController {
  private browser: Browser | null = null;
  private _page: Page | null = null;
  public readonly analyzer: AudioAnalyzer;
  private validator: PatternValidator;
  private errorRecovery: ErrorRecovery;
  private logger: Logger;
  private isHeadless: boolean;
  private editorCache: string = '';
  private cacheTimestamp: number = 0;
  private readonly CACHE_TTL = 100; // milliseconds
  private readonly MAX_CONSOLE_MESSAGES = 1000; // Ring buffer limit
  private isPlaying: boolean = false;
  // True once the user gesture for AudioContext has been established
  // (first play-button click per session). Subsequent plays can use the
  // keyboard shortcut cleanly because AudioContext is already resumed.
  private hasEstablishedGesture: boolean = false;
  private consoleErrors: string[] = [];
  private consoleWarnings: string[] = [];

  constructor(
    headless: boolean = false,
    audioAnalysisConfig?: import('./types/AudioAnalysis.js').AudioAnalysisConfig,
  ) {
    this.isHeadless = headless;
    this.analyzer = new AudioAnalyzer(audioAnalysisConfig);
    this.validator = new PatternValidator();
    this.errorRecovery = new ErrorRecovery();
    this.logger = new Logger();
  }

  /**
   * Initializes the browser and navigates to Strudel.cc
   * @returns Success message when initialization is complete
   * @throws {Error} When browser launch or page navigation fails
   */
  async initialize(): Promise<string> {
    if (this.browser) {
      return 'Already initialized';
    }

    this.browser = await chromium.launch({
      headless: this.isHeadless,
      args: [
        '--use-fake-ui-for-media-stream',
        '--autoplay-policy=no-user-gesture-required',
        '--disable-dev-shm-usage',
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-gpu',
        '--disable-software-rasterizer'
      ],
    });

    const context = await this.browser.newContext({
      permissions: ['microphone'],
      viewport: { width: 1280, height: 720 },
      reducedMotion: 'reduce',
    });

    this._page = await context.newPage();

    // Optimize page loading
    await this._page.route('**/*', (route) => {
      const resourceType = route.request().resourceType();
      // Block unnecessary resources
      if (['image', 'font', 'media'].includes(resourceType)) {
        route.abort();
      } else {
        route.continue();
      }
    });

    await this._page.goto('https://strudel.cc/', {
      waitUntil: 'domcontentloaded', // Changed from networkidle for faster load
      timeout: 15000,
    });

    // Wait for editor element to appear
    await this._page.waitForSelector('.cm-content', { timeout: 8000 });

    // Wait for strudelMirror API to be available
    // This is the correct API exposed by strudel.cc (not __view on DOM elements)
    await this._page.waitForFunction(
      () => (window as any).strudelMirror?.editor?.dispatch,
      { timeout: 5000 }
    );

    // Set up console monitoring for runtime errors
    this.setupConsoleMonitoring();

    await this.analyzer.inject(this._page);

    return 'Strudel initialized successfully';
  }

  /**
   * Pushes a message to an array with ring buffer behavior (FIFO eviction)
   */
  private pushWithLimit(arr: string[], message: string): void {
    if (arr.length >= this.MAX_CONSOLE_MESSAGES) {
      arr.shift(); // Remove oldest entry
    }
    arr.push(message);
  }

  /**
   * Sets up console error/warning monitoring
   * Captures Strudel runtime errors that static validation can't catch
   */
  private setupConsoleMonitoring(): void {
    if (!this._page) return;

    this._page.on('console', (msg) => {
      const type = msg.type();
      const text = msg.text();

      if (type === 'error') {
        this.pushWithLimit(this.consoleErrors, text);
        this.logger.error('Strudel console error:', text);
      } else if (type === 'warning') {
        this.pushWithLimit(this.consoleWarnings, text);
        this.logger.warn('Strudel console warning:', text);
      }
    });

    this._page.on('pageerror', (error) => {
      this.pushWithLimit(this.consoleErrors, error.message);
      this.logger.error('Strudel page error:', error.message);
    });
  }

  /**
   * Writes a Strudel pattern to the editor
   * @param pattern - The pattern code to write
   * @returns Success message with pattern length
   * @throws {Error} When not initialized
   */
  async writePattern(pattern: string): Promise<string> {
    if (!this._page) throw new Error('Browser not initialized. Run init tool first.');

    // Invalidate cache before write to prevent stale reads
    this.invalidateCache();

    // Retry logic for timing edge cases
    const maxRetries = 3;
    const retryDelay = 100; // ms
    let success = false;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      // Use strudelMirror API (correct approach for strudel.cc)
      success = await this._page.evaluate((newPattern) => {
        const sm = (window as any).strudelMirror;
        if (sm?.editor?.dispatch) {
          const view = sm.editor;
          view.dispatch({
            changes: { from: 0, to: view.state.doc.length, insert: newPattern }
          });
          return true;
        }
        return false;
      }, pattern);

      if (success) {
        break;
      }

      if (attempt < maxRetries - 1) {
        this.logger.warn(`Write attempt ${attempt + 1} failed, retrying...`);
        await this._page.waitForTimeout(retryDelay);
      }
    }

    if (!success) {
      throw new Error('Failed to write pattern - editor not found or view unavailable after 3 attempts');
    }

    // Verify the write by reading back from browser (fixes cache sync issues)
    const verified = await this._page.evaluate(() => {
      const sm = (window as any).strudelMirror;
      // Use code property or editor state
      if (sm?.code) return sm.code;
      if (sm?.editor?.state?.doc) return sm.editor.state.doc.toString();
      return null;
    });

    // Update cache with verified content
    this.editorCache = verified || pattern;
    this.cacheTimestamp = Date.now();

    // Log warning if verification failed
    if (verified === null) {
      this.logger.warn('Pattern write verification failed - using input pattern for cache');
    }

    return `Pattern written (${pattern.length} chars)`;
  }

  /**
   * Retrieves the current pattern from the editor
   * @returns The current pattern text content
   * @throws {Error} When not initialized
   */
  async getCurrentPattern(): Promise<string> {
    if (!this._page) throw new Error('Browser not initialized. Run init tool first.');

    // Return cached value if still valid
    const now = Date.now();
    if (this.editorCache && (now - this.cacheTimestamp) < this.CACHE_TTL) {
      return this.editorCache;
    }

    const pattern = await this._page.evaluate(() => {
      const sm = (window as any).strudelMirror;
      // Use code property or editor state
      if (sm?.code) return sm.code;
      if (sm?.editor?.state?.doc) return sm.editor.state.doc.toString();
      return '';
    });

    // Update cache
    this.editorCache = pattern;
    this.cacheTimestamp = now;

    return pattern;
  }

  /**
   * Starts playing the current pattern
   * @returns Success message
   * @throws {Error} When not initialized
   */
  async play(): Promise<string> {
    if (!this._page) throw new Error('Browser not initialized. Run init tool first.');

    // First play per session: click the play button to establish the user
    // gesture the AudioContext needs. Slow (~3s in headless) but only once.
    // Subsequent plays: use Ctrl+Enter — AudioContext is already resumed,
    // so the keyboard shortcut resumes playback cleanly and fast.
    if (!this.hasEstablishedGesture) {
      try {
        const playButton = this._page.locator('button[title="play"]').first();
        await playButton.click({ timeout: 3000 });
        this.hasEstablishedGesture = true;
      } catch {
        await this._page.keyboard.press('ControlOrMeta+Enter');
      }
    } else {
      await this._page.keyboard.press('ControlOrMeta+Enter');
    }

    await this._page.waitForTimeout(50);

    this.isPlaying = true;
    return 'Playing';
  }

  /**
   * Stops the currently playing pattern
   * @returns Success message
   * @throws {Error} When not initialized
   */
  async stop(): Promise<string> {
    if (!this._page) throw new Error('Browser not initialized. Run init tool first.');

    // Ctrl+Period stops cleanly when AudioContext is running (i.e. after
    // a successful play). No user gesture needed — we only need one to
    // RESUME AudioContext, not to stop it. Fall back to the button click
    // if keyboard fails (e.g. editor lost focus).
    try {
      await this._page.keyboard.press('ControlOrMeta+Period');
    } catch {
      const playButton = this._page.locator('button[title="play"]').first();
      await playButton.click({ timeout: 2000 });
    }

    this.isPlaying = false;
    return 'Stopped';
  }

  /**
   * Waits for audio analyzer to connect
   * @param timeoutMs - Maximum time to wait (default 5000ms)
   * @returns True if connected, false if timeout
   */
  async waitForAudioConnection(timeoutMs: number = 5000): Promise<boolean> {
    if (!this._page) throw new Error('Browser not initialized. Run init tool first.');

    const startTime = Date.now();
    while (Date.now() - startTime < timeoutMs) {
      const isConnected = await this._page.evaluate(() => {
        return (window as any).strudelAudioAnalyzer?.isConnected || false;
      });

      if (isConnected) {
        return true;
      }

      await this._page.waitForTimeout(100);
    }

    return false;
  }

  /**
   * Analyzes the current audio output
   * @returns Audio analysis data including frequency features
   * @throws {Error} When not initialized
   */
  async analyzeAudio(): Promise<AudioAnalysisResult> {
    if (!this._page) throw new Error('Browser not initialized. Run init tool first.');

    return await this.analyzer.getAnalysis(this._page);
  }

  /**
   * Detects the musical key of the currently playing audio
   * @returns Key analysis including key, scale/mode, and confidence
   * @throws {Error} When not initialized or analyzer not connected
   */
  async detectKey(): Promise<KeyAnalysis | null> {
    if (!this._page) throw new Error('Browser not initialized. Run init tool first.');

    return await this.analyzer.detectKey(this._page);
  }

  /**
   * Detects the tempo (BPM) of the currently playing audio
   * @returns Tempo analysis including BPM, confidence, and detection method
   * @throws {Error} When not initialized or analyzer not connected
   */
  async detectTempo(): Promise<TempoAnalysis | null> {
    if (!this._page) throw new Error('Browser not initialized. Run init tool first.');

    return await this.analyzer.detectTempo(this._page);
  }

  /**
   * Analyzes the rhythm pattern of the currently playing audio
   * @returns Rhythm analysis including density, complexity, syncopation, regularity
   * @throws {Error} When not initialized
   */
  async analyzeRhythm(): Promise<RhythmAnalysis> {
    if (!this._page) throw new Error('Browser not initialized. Run init tool first.');

    return await this.analyzer.analyzeRhythm(this._page);
  }

  /**
   * Cleans up browser resources and closes the connection
   * @returns Promise that resolves when cleanup is complete
   * @example
   * const controller = new StrudelController();
   * await controller.initialize();
   * // ... use controller ...
   * await controller.cleanup();
   */
  async cleanup() {
    if (this.browser) {
      // Clear cache
      this.editorCache = '';
      this.cacheTimestamp = 0;

      // Reset gesture flag so a new session re-establishes the user gesture
      this.hasEstablishedGesture = false;
      this.isPlaying = false;

      // Close browser properly
      await this.browser.close();
      this.browser = null;
      this._page = null;
    }
  }

  /**
   * Invalidates the editor content cache
   * Forces next getCurrentPattern() call to fetch fresh content from browser
   * @example
   * controller.invalidateCache();
   * const pattern = await controller.getCurrentPattern(); // Fetches from browser
   */
  invalidateCache() {
    this.editorCache = '';
    this.cacheTimestamp = 0;
  }

  /**
   * Validates a pattern before writing it
   * @param pattern - Pattern to validate
   * @param autoFix - Automatically fix common errors
   * @returns Validation result
   */
  async validatePattern(pattern: string, autoFix: boolean = false): Promise<ValidationResult> {
    this.logger.debug('Validating pattern', { length: pattern.length });

    const result = this.validator.validate(pattern);

    if (!result.valid && autoFix) {
      const { pattern: fixedPattern, fixes } = this.validator.autoFix(pattern);

      if (fixes.length > 0) {
        this.logger.info('Auto-fixed pattern errors', { fixes });

        // Re-validate the fixed pattern
        const newResult = this.validator.validate(fixedPattern);
        return {
          ...newResult,
          suggestions: [...newResult.suggestions, ...fixes]
        };
      }
    }

    return result;
  }

  /**
   * Writes pattern with validation
   * @param pattern - Pattern to write
   * @param options - Write options
   * @returns Write result with validation info
   */
  async writePatternWithValidation(
    pattern: string,
    options: { autoFix?: boolean; skipValidation?: boolean } = {}
  ): Promise<{ result: string; validation?: ValidationResult }> {
    if (!this._page) {
      throw new Error('Browser not initialized. Run init tool first.');
    }

    // Validate unless skipped
    if (!options.skipValidation) {
      const validation = await this.validatePattern(pattern, options.autoFix);

      if (!validation.valid) {
        this.logger.warn('Pattern validation failed', {
          errors: validation.errors,
          warnings: validation.warnings
        });

        // If auto-fix is enabled, try to fix and re-validate
        if (options.autoFix) {
          const { pattern: fixedPattern } = this.validator.autoFix(pattern);
          pattern = fixedPattern;
        } else {
          return {
            result: `Validation failed: ${validation.errors.join(', ')}`,
            validation
          };
        }
      }

      if (validation.warnings.length > 0) {
        this.logger.info('Pattern warnings', { warnings: validation.warnings });
      }
    }

    // Write with error recovery
    const writeResult = await this.errorRecovery.handlePatternWrite(
      async (p) => this.writePattern(p),
      pattern
    );

    return { result: writeResult };
  }

  /**
   * Gets current playback state
   * @returns True if playing, false otherwise
   */
  getPlaybackState(): boolean {
    return this.isPlaying;
  }

  /**
   * Appends code to current pattern safely
   * @param code - Code to append
   * @returns Result message
   */
  async appendPattern(code: string): Promise<string> {
    if (!this._page) {
      throw new Error('Browser not initialized. Run init tool first.');
    }

    const current = await this.getCurrentPattern();
    const newPattern = current + '\n' + code;

    return this.writePattern(newPattern);
  }

  /**
   * Inserts code at specific line
   * @param line - Line number (0-indexed)
   * @param code - Code to insert
   * @returns Result message
   */
  async insertAtLine(line: number, code: string): Promise<string> {
    if (!this._page) {
      throw new Error('Browser not initialized. Run init tool first.');
    }

    const current = await this.getCurrentPattern();
    const lines = current.split('\n');

    if (line < 0 || line > lines.length) {
      throw new Error(`Invalid line number: ${line}. Must be between 0 and ${lines.length}`);
    }

    lines.splice(line, 0, code);
    return this.writePattern(lines.join('\n'));
  }

  /**
   * Escapes special regex characters in a string for safe use in RegExp
   * @nist si-10 "Input validation"
   * @param str - String to escape
   * @returns Escaped string safe for RegExp
   */
  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * Replaces text in pattern
   * @param search - Text to find (literal string, not regex)
   * @param replace - Replacement text
   * @returns Result message
   * @throws {Error} When browser not initialized
   */
  async replaceInPattern(search: string, replace: string): Promise<string> {
    if (!this._page) {
      throw new Error('Browser not initialized. Run init tool first.');
    }

    const current = await this.getCurrentPattern();
    // Escape regex special characters to prevent injection
    const escaped = this.escapeRegex(search);
    const newPattern = current.replace(new RegExp(escaped, 'g'), replace);

    if (current === newPattern) {
      return `No matches found for: ${search}`;
    }

    return this.writePattern(newPattern);
  }

  /**
   * Gets pattern statistics
   * @returns Pattern statistics
   */
  async getPatternStats(): Promise<PatternStats> {
    if (!this._page) {
      throw new Error('Browser not initialized. Run init tool first.');
    }

    const pattern = await this.getCurrentPattern();
    const lines = pattern.split('\n');

    return {
      lines: lines.length,
      chars: pattern.length,
      sounds: (pattern.match(/s\(/g) || []).length,
      notes: (pattern.match(/note\(/g) || []).length,
      effects: (pattern.match(/\.(room|delay|reverb|lpf|hpf|bpf)\(/g) || []).length,
      functions: (pattern.match(/\b(stack|every|sometimes|rarely|often|fast|slow)\(/g) || []).length
    };
  }

  /**
   * Takes a snapshot of the current editor state
   * @returns Snapshot data
   */
  async takeSnapshot(): Promise<{
    pattern: string;
    timestamp: string;
    isPlaying: boolean;
    stats: PatternStats;
  }> {
    if (!this._page) {
      throw new Error('Browser not initialized. Run init tool first.');
    }

    const pattern = await this.getCurrentPattern();
    const stats = await this.getPatternStats();

    return {
      pattern,
      timestamp: new Date().toISOString(),
      isPlaying: this.isPlaying,
      stats
    };
  }

  // SECURITY: executeInStrudelContext was removed in issue #56
  // It used new Function() which is equivalent to eval() and poses injection risks.
  // Pattern execution should go through writePattern() + play() which is the safe path.

  /**
   * Gets console errors captured since last clear
   * @returns Array of error messages from Strudel
   */
  getConsoleErrors(): string[] {
    return [...this.consoleErrors];
  }

  /**
   * Gets console warnings captured since last clear
   * @returns Array of warning messages from Strudel
   */
  getConsoleWarnings(): string[] {
    return [...this.consoleWarnings];
  }

  /**
   * Clears captured console errors and warnings
   */
  clearConsoleMessages(): void {
    this.consoleErrors = [];
    this.consoleWarnings = [];
  }

  /**
   * Validates pattern with runtime checking
   * Writes pattern, briefly plays to trigger evaluation, then captures errors
   * @param pattern - Pattern to validate
   * @param waitMs - How long to wait for errors (default 500ms)
   * @returns Validation result with runtime errors
   */
  async validatePatternRuntime(pattern: string, waitMs: number = 500): Promise<{
    valid: boolean;
    errors: string[];
    warnings: string[];
  }> {
    if (!this._page) {
      throw new Error('Browser not initialized. Run init tool first.');
    }

    // Clear previous errors
    this.clearConsoleMessages();

    // Write pattern
    await this.writePattern(pattern);

    // Brief play to trigger evaluation - Strudel uses lazy evaluation
    // so errors only appear when the pattern is actually executed
    try {
      await this._page.keyboard.press('ControlOrMeta+Enter');
      await this._page.waitForTimeout(Math.min(waitMs, 300));
      await this._page.keyboard.press('ControlOrMeta+Period');
    } catch (e) {
      this.logger.warn('Failed to trigger pattern evaluation', e);
    }

    // Wait for potential errors to appear
    await this._page.waitForTimeout(waitMs);

    const errors = this.getConsoleErrors();
    const warnings = this.getConsoleWarnings();

    return {
      valid: errors.length === 0,
      errors,
      warnings
    };
  }

  /**
   * Gets the current page instance
   * @returns Page instance or null if not initialized
   */
  get page(): Page | null {
    return this._page;
  }

  /**
   * Brings the browser window to the foreground
   * @returns Success message
   * @throws {Error} When browser not initialized
   */
  async showBrowser(): Promise<string> {
    if (!this._page) {
      throw new Error('Browser not initialized. Run init tool first.');
    }

    try {
      await this._page.bringToFront();
      return 'Browser window brought to foreground';
    } catch (error: any) {
      this.logger.error('Failed to show browser', error);
      throw new Error(`Failed to show browser: ${error.message}`);
    }
  }

  /**
   * Takes a screenshot of the current browser state
   * Screenshots are saved to the tmp/ directory by default
   * @param filename - Optional filename for the screenshot (saved in tmp/ if no path specified)
   * @returns Path to saved screenshot
   * @throws {Error} When browser not initialized
   */
  async takeScreenshot(filename?: string): Promise<string> {
    if (!this._page) {
      throw new Error('Browser not initialized. Run init tool first.');
    }

    try {
      // Default to tmp/ directory for screenshots
      const tmpDir = path.join(process.cwd(), 'tmp');
      await fs.mkdir(tmpDir, { recursive: true });

      // If filename has no path component, save to tmp/
      let screenshotPath: string;
      if (filename && path.dirname(filename) !== '.') {
        screenshotPath = filename;
      } else {
        const name = filename || `strudel-screenshot-${Date.now()}.png`;
        screenshotPath = path.join(tmpDir, name);
      }

      await this._page.screenshot({ path: screenshotPath, fullPage: false });
      return `Screenshot saved to ${screenshotPath}`;
    } catch (error: any) {
      this.logger.error('Failed to take screenshot', error);
      throw new Error(`Failed to take screenshot: ${error.message}`);
    }
  }

  /**
   * Gets current browser and playback status
   * @returns Status object with initialization and playback state
   */
  getStatus(): {
    initialized: boolean;
    playing: boolean;
    patternLength: number;
    cacheValid: boolean;
    errorCount: number;
    warningCount: number;
  } {
    return {
      initialized: this._page !== null,
      playing: this.isPlaying,
      patternLength: this.editorCache.length,
      cacheValid: this.editorCache.length > 0 && (Date.now() - this.cacheTimestamp) < this.CACHE_TTL,
      errorCount: this.consoleErrors.length,
      warningCount: this.consoleWarnings.length
    };
  }

  /**
   * Gets detailed browser diagnostics
   * @returns Diagnostic information
   */
  async getDiagnostics(): Promise<BrowserDiagnostics> {
    const diagnostics: BrowserDiagnostics = {
      browserConnected: this.browser !== null,
      pageLoaded: this._page !== null,
      editorReady: false,
      audioConnected: false,
      cacheStatus: {
        hasCache: this.editorCache.length > 0,
        cacheAge: this.cacheTimestamp > 0 ? Date.now() - this.cacheTimestamp : 0
      },
      errorStats: this.errorRecovery.getErrorStats()
    };

    if (this._page) {
      try {
        // Check that strudelMirror API is available
        diagnostics.editorReady = await this._page.evaluate(() => {
          const sm = (window as any).strudelMirror;
          return sm?.editor?.dispatch !== undefined;
        });

        diagnostics.audioConnected = await this._page.evaluate(() => {
          return (window as any).strudelAudioAnalyzer?.isConnected || false;
        });
      } catch (error) {
        this.logger.warn('Failed to get diagnostics', error);
      }
    }

    return diagnostics;
  }
}
