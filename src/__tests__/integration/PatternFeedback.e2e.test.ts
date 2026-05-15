/**
 * E2E Tests for MCP Tools with Gemini Integration
 *
 * Tests the complete flow:
 * 1. Initialize MCP server
 * 2. Generate patterns with compose tool
 * 3. Get AI feedback via get_pattern_feedback tool
 * 4. Verify response structure and timing
 *
 * Two test modes:
 * - Mocked Gemini: Runs in CI, uses mock responses
 * - Real Gemini: Requires GEMINI_API_KEY, skipped if not available
 */

// Mock all dependencies before imports
jest.mock('@modelcontextprotocol/sdk/server/index.js', () => ({
  Server: jest.fn().mockImplementation(() => ({
    setRequestHandler: jest.fn(),
    connect: jest.fn(),
  })),
}));

jest.mock('@modelcontextprotocol/sdk/server/stdio.js', () => ({
  StdioServerTransport: jest.fn(),
}));

jest.mock('@modelcontextprotocol/sdk/types.js', () => ({
  CallToolRequestSchema: {},
  ListToolsRequestSchema: {},
}));

// Mock StrudelController to avoid browser initialization
jest.mock('../../StrudelController');
jest.mock('../../PatternStore');
jest.mock('../../services/GeminiService');
jest.mock('../../services/AudioCaptureService');
jest.mock('../../services/SessionManager');
jest.mock('../../services/StrudelEngine');

// Mock filesystem
jest.mock('fs', () => ({
  readFileSync: jest.fn().mockReturnValue('{"headless": true}'),
  existsSync: jest.fn().mockReturnValue(true),
}));

import { StrudelMCPServer } from '../../server/server';
import { StrudelController } from '../../StrudelController';
import { PatternStore } from '../../PatternStore';
import { GeminiService, CreativeFeedback, AudioFeedback } from '../../services/GeminiService';

// Test timeouts
const E2E_TIMEOUT = 30000;
const MOCKED_TEST_TIMEOUT = 10000;

// Mock response data
const mockTechnoFeedback: CreativeFeedback = {
  complexity: 'moderate',
  estimatedStyle: 'techno',
  strengths: ['Strong four-on-the-floor kick', 'Clean layering'],
  suggestions: ['Add filter sweeps', 'Try a breakdown section']
};

const mockAmbientFeedback: CreativeFeedback = {
  complexity: 'simple',
  estimatedStyle: 'ambient',
  strengths: ['Good use of space', 'Subtle textures'],
  suggestions: ['Add reverb tails', 'Experiment with longer notes']
};

const mockJazzFeedback: CreativeFeedback = {
  complexity: 'complex',
  estimatedStyle: 'jazz',
  strengths: ['Interesting chord voicings', 'Good rhythmic complexity'],
  suggestions: ['Add walking bass', 'Try some chromaticism']
};

const mockAudioFeedback: AudioFeedback = {
  mood: 'energetic',
  style: 'techno',
  energy: 'high',
  suggestions: ['Good energy'],
  confidence: 0.85
};

describe('Pattern Feedback E2E Tests - Mocked Gemini (CI Compatible)', () => {
  let server: StrudelMCPServer;
  let mockController: jest.Mocked<StrudelController>;
  let mockGeminiService: jest.Mocked<GeminiService>;
  let currentPattern: string = '';

  beforeEach(() => {
    jest.clearAllMocks();
    currentPattern = '';

    // Setup StrudelController mock
    mockController = {
      initialize: jest.fn().mockResolvedValue('Strudel initialized'),
      getCurrentPattern: jest.fn().mockImplementation(() => Promise.resolve(currentPattern)),
      writePattern: jest.fn().mockImplementation((pattern: string) => {
        currentPattern = pattern;
        return Promise.resolve('Pattern written');
      }),
      play: jest.fn().mockResolvedValue('Playing'),
      stop: jest.fn().mockResolvedValue('Stopped'),
      analyzeAudio: jest.fn().mockResolvedValue({
        connected: true,
        features: {
          bass: 0.6,
          mid: 0.5,
          treble: 0.4,
          isPlaying: true,
          isSilent: false
        }
      }),
      detectKey: jest.fn().mockResolvedValue({ key: 'C', scale: 'minor', confidence: 0.8 }),
      detectTempo: jest.fn().mockResolvedValue({ bpm: 128, confidence: 0.9, method: 'autocorrelation' }),
      validatePattern: jest.fn().mockResolvedValue({ valid: true, errors: [], warnings: [], suggestions: [] }),
      validatePatternRuntime: jest.fn().mockResolvedValue({ valid: true, errors: [], warnings: [] }),
      showBrowser: jest.fn().mockResolvedValue('Browser shown'),
      takeScreenshot: jest.fn().mockResolvedValue('Screenshot saved'),
      getStatus: jest.fn().mockReturnValue({
        initialized: true,
        playing: false,
        patternLength: 25,
        cacheValid: true,
        errorCount: 0,
        warningCount: 0
      }),
      getDiagnostics: jest.fn().mockResolvedValue({ browserConnected: true }),
      getConsoleErrors: jest.fn().mockReturnValue([]),
      getConsoleWarnings: jest.fn().mockReturnValue([]),
      cleanup: jest.fn().mockResolvedValue(undefined),
      page: null
    } as any;

    // Setup GeminiService mock
    mockGeminiService = {
      isAvailable: jest.fn().mockReturnValue(true),
      getCreativeFeedback: jest.fn().mockResolvedValue(mockTechnoFeedback),
      analyzeAudio: jest.fn().mockResolvedValue(mockAudioFeedback),
      suggestVariations: jest.fn().mockResolvedValue([]),
      clearCache: jest.fn()
    } as any;

    // Setup PatternStore mock
    const mockStore = {
      save: jest.fn().mockResolvedValue(undefined),
      load: jest.fn().mockResolvedValue(null),
      list: jest.fn().mockResolvedValue([])
    };

    // Wire up mocked constructors
    (StrudelController as jest.Mock).mockReturnValue(mockController);
    (PatternStore as jest.Mock).mockReturnValue(mockStore);
    (GeminiService as jest.Mock).mockReturnValue(mockGeminiService);

    server = new StrudelMCPServer();
  });

  // ===========================================================================
  // COMPOSE TOOL WITH get_feedback: true
  // ===========================================================================

  describe('compose tool with get_feedback: true', () => {
    it('should generate pattern and return feedback', async () => {
      const serverAny = server as any;

      const result = await serverAny.executeTool('compose', {
        style: 'techno',
        get_feedback: true
      });

      // Verify successful compose
      expect(result.success).toBe(true);
      expect(result.pattern).toBeDefined();
      expect(result.metadata.style).toBe('techno');

      // Verify feedback was requested and returned
      expect(mockGeminiService.getCreativeFeedback).toHaveBeenCalled();
      expect(result.feedback).toBeDefined();
      expect(result.feedback.complexity).toBe('moderate');
      expect(result.feedback.estimatedStyle).toBe('techno');
      expect(Array.isArray(result.feedback.strengths)).toBe(true);
      expect(Array.isArray(result.feedback.suggestions)).toBe(true);
    }, MOCKED_TEST_TIMEOUT);

    it('should include feedback info in message when available', async () => {
      const serverAny = server as any;

      const result = await serverAny.executeTool('compose', {
        style: 'techno',
        get_feedback: true
      });

      expect(result.message).toContain('feedback');
      expect(result.message).toContain('techno');
    }, MOCKED_TEST_TIMEOUT);

    it('should work with different styles (ambient)', async () => {
      const serverAny = server as any;
      mockGeminiService.getCreativeFeedback.mockResolvedValue(mockAmbientFeedback);

      const result = await serverAny.executeTool('compose', {
        style: 'ambient',
        tempo: 80,
        get_feedback: true
      });

      expect(result.success).toBe(true);
      expect(result.metadata.style).toBe('ambient');
      expect(result.feedback.estimatedStyle).toBe('ambient');
      expect(result.feedback.complexity).toBe('simple');
    }, MOCKED_TEST_TIMEOUT);

    it('should work with different styles (jazz)', async () => {
      const serverAny = server as any;
      mockGeminiService.getCreativeFeedback.mockResolvedValue(mockJazzFeedback);

      const result = await serverAny.executeTool('compose', {
        style: 'jazz',
        key: 'D',  // Root note only (not Dm)
        get_feedback: true
      });

      expect(result.success).toBe(true);
      expect(result.metadata.style).toBe('jazz');
      expect(result.feedback.estimatedStyle).toBe('jazz');
      expect(result.feedback.complexity).toBe('complex');
    }, MOCKED_TEST_TIMEOUT);

    it('should preserve all metadata fields', async () => {
      const serverAny = server as any;

      const result = await serverAny.executeTool('compose', {
        style: 'house',
        key: 'A',  // Root note only (not Am)
        tempo: 125,
        get_feedback: true
      });

      expect(result.metadata).toEqual({
        style: 'house',
        bpm: 125,
        key: 'A'
      });
    }, MOCKED_TEST_TIMEOUT);
  });

  // ===========================================================================
  // COMPOSE TOOL WITH get_feedback: false
  // ===========================================================================

  describe('compose tool with get_feedback: false', () => {
    it('should generate pattern without calling Gemini', async () => {
      const serverAny = server as any;

      const result = await serverAny.executeTool('compose', {
        style: 'techno',
        get_feedback: false
      });

      // Verify successful compose
      expect(result.success).toBe(true);
      expect(result.pattern).toBeDefined();

      // Verify Gemini was NOT called
      expect(mockGeminiService.getCreativeFeedback).not.toHaveBeenCalled();
      expect(result.feedback).toBeUndefined();
    }, MOCKED_TEST_TIMEOUT);

    it('should default to no feedback when get_feedback not specified', async () => {
      const serverAny = server as any;

      const result = await serverAny.executeTool('compose', {
        style: 'house'
      });

      expect(result.success).toBe(true);
      // Default is get_feedback: false
      expect(mockGeminiService.getCreativeFeedback).not.toHaveBeenCalled();
      expect(result.feedback).toBeUndefined();
    }, MOCKED_TEST_TIMEOUT);

    it('should still write pattern to controller without feedback', async () => {
      const serverAny = server as any;

      await serverAny.executeTool('compose', {
        style: 'dnb',
        get_feedback: false
      });

      // Pattern should have been written
      expect(mockController.writePattern).toHaveBeenCalled();
      expect(currentPattern).toBeTruthy();
    }, MOCKED_TEST_TIMEOUT);
  });

  // ===========================================================================
  // GET_PATTERN_FEEDBACK TOOL DIRECTLY
  // ===========================================================================

  describe('get_pattern_feedback tool directly', () => {
    beforeEach(async () => {
      // Initialize the server so there's a pattern
      const serverAny = server as any;
      await serverAny.executeTool('init', {});
    });

    it('should return feedback for current pattern', async () => {
      const serverAny = server as any;

      // First write a pattern
      await serverAny.executeTool('edit_pattern', { mode: 'write', pattern: 's("bd*4 sd:2").fast(2)' });

      // Get feedback
      const result = await serverAny.executeTool('ai_assist', { task: 'feedback' });

      expect(result.gemini_available).toBe(true);
      expect(result.pattern_analysis).toBeDefined();
      expect(result.pattern_analysis.complexity).toBeDefined();
      expect(result.pattern_analysis.estimatedStyle).toBeDefined();
      expect(Array.isArray(result.pattern_analysis.strengths)).toBe(true);
      expect(Array.isArray(result.pattern_analysis.suggestions)).toBe(true);
    }, MOCKED_TEST_TIMEOUT);

    it('should pass pattern to GeminiService', async () => {
      const serverAny = server as any;
      const testPattern = 'note("c4 e4 g4").s("piano")';

      await serverAny.executeTool('edit_pattern', { mode: 'write', pattern: testPattern });
      await serverAny.executeTool('ai_assist', { task: 'feedback' });

      expect(mockGeminiService.getCreativeFeedback).toHaveBeenCalledWith(testPattern);
    }, MOCKED_TEST_TIMEOUT);

    it('should handle style hint parameter', async () => {
      const serverAny = server as any;

      await serverAny.executeTool('edit_pattern', { mode: 'write', pattern: 's("bd*4")' });
      const result = await serverAny.executeTool('ai_assist', {
        task: 'feedback',
        style: 'techno'
      });

      expect(result.gemini_available).toBe(true);
      expect(result.pattern_analysis).toBeDefined();
    }, MOCKED_TEST_TIMEOUT);

    it('should handle empty pattern error', async () => {
      const serverAny = server as any;

      // Don't write any pattern (currentPattern is '')
      const result = await serverAny.executeTool('ai_assist', { task: 'feedback' });

      expect(result.error).toBeDefined();
      expect(result.error.toLowerCase()).toContain('pattern');
    }, MOCKED_TEST_TIMEOUT);
  });

  // ===========================================================================
  // ERROR HANDLING - GEMINI UNAVAILABLE
  // ===========================================================================

  describe('error handling when Gemini unavailable', () => {
    beforeEach(() => {
      mockGeminiService.isAvailable.mockReturnValue(false);
    });

    it('compose should succeed but note feedback unavailable', async () => {
      const serverAny = server as any;

      const result = await serverAny.executeTool('compose', {
        style: 'techno',
        get_feedback: true
      });

      // Compose should still succeed
      expect(result.success).toBe(true);
      expect(result.pattern).toBeDefined();

      // But message should mention unavailability
      expect(result.message).toContain('GEMINI_API_KEY');
      expect(result.feedback).toBeUndefined();
    }, MOCKED_TEST_TIMEOUT);

    it('get_pattern_feedback should return proper error', async () => {
      const serverAny = server as any;
      await serverAny.executeTool('init', {});

      const result = await serverAny.executeTool('ai_assist', { task: 'feedback' });

      expect(result.gemini_available).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error).toContain('GEMINI_API_KEY');
    }, MOCKED_TEST_TIMEOUT);
  });

  // ===========================================================================
  // ERROR HANDLING - API FAILURES
  // ===========================================================================

  describe('error handling for API failures', () => {
    it('compose should succeed even if feedback fails', async () => {
      const serverAny = server as any;
      mockGeminiService.getCreativeFeedback.mockRejectedValue(
        new Error('API quota exceeded')
      );

      const result = await serverAny.executeTool('compose', {
        style: 'techno',
        get_feedback: true
      });

      // Compose should still succeed
      expect(result.success).toBe(true);
      expect(result.pattern).toBeDefined();
      expect(result.message).toContain('unavailable');
    }, MOCKED_TEST_TIMEOUT);

    it('get_pattern_feedback should handle rate limits gracefully', async () => {
      const serverAny = server as any;
      await serverAny.executeTool('init', {});
      await serverAny.executeTool('edit_pattern', { mode: 'write', pattern: 's("bd*4")' });

      mockGeminiService.getCreativeFeedback.mockRejectedValue(
        new Error('Rate limit exceeded')
      );

      const result = await serverAny.executeTool('ai_assist', { task: 'feedback' });

      expect(result.gemini_available).toBe(true);
      expect(result.error).toBeDefined();
      expect(result.error.toLowerCase()).toContain('rate limit');
    }, MOCKED_TEST_TIMEOUT);

    it('get_pattern_feedback should handle network errors', async () => {
      const serverAny = server as any;
      await serverAny.executeTool('init', {});
      await serverAny.executeTool('edit_pattern', { mode: 'write', pattern: 's("bd*4")' });

      mockGeminiService.getCreativeFeedback.mockRejectedValue(
        new Error('Network error')
      );

      const result = await serverAny.executeTool('ai_assist', { task: 'feedback' });

      expect(result.error).toBeDefined();
      expect(result.error).toContain('Network error');
    }, MOCKED_TEST_TIMEOUT);
  });

  // ===========================================================================
  // RESPONSE FORMAT VERIFICATION
  // ===========================================================================

  describe('response format verification', () => {
    it('compose with feedback should match expected structure', async () => {
      const serverAny = server as any;

      const result = await serverAny.executeTool('compose', {
        style: 'techno',
        key: 'C',
        tempo: 130,
        get_feedback: true
      });

      // Verify structure
      expect(result).toEqual(expect.objectContaining({
        success: true,
        pattern: expect.any(String),
        metadata: {
          style: 'techno',
          bpm: 130,
          key: 'C'
        },
        status: expect.stringMatching(/playing|ready/),
        message: expect.any(String),
        feedback: {
          complexity: expect.stringMatching(/simple|moderate|complex/),
          estimatedStyle: expect.any(String),
          strengths: expect.any(Array),
          suggestions: expect.any(Array)
        }
      }));
    }, MOCKED_TEST_TIMEOUT);

    it('get_pattern_feedback should match expected structure', async () => {
      const serverAny = server as any;
      await serverAny.executeTool('init', {});
      await serverAny.executeTool('edit_pattern', { mode: 'write', pattern: 's("bd*4")' });

      const result = await serverAny.executeTool('ai_assist', { task: 'feedback' });

      expect(result).toEqual(expect.objectContaining({
        gemini_available: true,
        pattern_analysis: {
          complexity: expect.stringMatching(/simple|moderate|complex/),
          estimatedStyle: expect.any(String),
          strengths: expect.any(Array),
          suggestions: expect.any(Array)
        }
      }));
    }, MOCKED_TEST_TIMEOUT);

    it('compose without feedback should have minimal structure', async () => {
      const serverAny = server as any;

      const result = await serverAny.executeTool('compose', {
        style: 'dnb',
        get_feedback: false
      });

      expect(result.success).toBe(true);
      expect(result.pattern).toBeDefined();
      expect(result.metadata).toBeDefined();
      expect(result.status).toBeDefined();
      expect(result.message).toBeDefined();
      expect(result.feedback).toBeUndefined();
    }, MOCKED_TEST_TIMEOUT);
  });

  // ===========================================================================
  // DIFFERENT PATTERN STYLES
  // ===========================================================================

  describe('different pattern styles', () => {
    const testStyles = [
      { style: 'techno', feedback: mockTechnoFeedback },
      { style: 'house', feedback: mockTechnoFeedback },
      { style: 'dnb', feedback: mockTechnoFeedback },
      { style: 'ambient', feedback: mockAmbientFeedback },
      { style: 'trap', feedback: mockTechnoFeedback },
      { style: 'jungle', feedback: mockTechnoFeedback },
      { style: 'jazz', feedback: mockJazzFeedback }
    ];

    testStyles.forEach(({ style, feedback }) => {
      it(`should handle ${style} style correctly`, async () => {
        const serverAny = server as any;
        mockGeminiService.getCreativeFeedback.mockResolvedValue(feedback);

        const result = await serverAny.executeTool('compose', {
          style,
          get_feedback: true
        });

        expect(result.success).toBe(true);
        expect(result.metadata.style).toBe(style);
        expect(result.feedback).toBeDefined();
      }, MOCKED_TEST_TIMEOUT);
    });
  });

  // ===========================================================================
  // PATTERN PERSISTENCE
  // ===========================================================================

  describe('pattern persistence across operations', () => {
    it('should preserve pattern from compose when getting feedback', async () => {
      const serverAny = server as any;

      // Compose a pattern
      await serverAny.executeTool('compose', {
        style: 'techno',
        get_feedback: false
      });

      // Get feedback on the composed pattern
      const feedbackResult = await serverAny.executeTool('ai_assist', { task: 'feedback' });

      expect(feedbackResult.gemini_available).toBe(true);
      expect(feedbackResult.pattern_analysis).toBeDefined();
      expect(mockGeminiService.getCreativeFeedback).toHaveBeenCalled();
    }, MOCKED_TEST_TIMEOUT);

    it('should use updated pattern after write', async () => {
      const serverAny = server as any;
      await serverAny.executeTool('init', {});

      const pattern1 = 's("bd*4")';
      const pattern2 = 'note("c4 e4 g4")';

      await serverAny.executeTool('edit_pattern', { mode: 'write', pattern: pattern1 });
      await serverAny.executeTool('ai_assist', { task: 'feedback' });
      expect(mockGeminiService.getCreativeFeedback).toHaveBeenCalledWith(pattern1);

      mockGeminiService.getCreativeFeedback.mockClear();

      await serverAny.executeTool('edit_pattern', { mode: 'write', pattern: pattern2 });
      await serverAny.executeTool('ai_assist', { task: 'feedback' });
      expect(mockGeminiService.getCreativeFeedback).toHaveBeenCalledWith(pattern2);
    }, MOCKED_TEST_TIMEOUT);
  });
});

// ===========================================================================
// REAL GEMINI TESTS (Skip if no API key)
// ===========================================================================

describe('Pattern Feedback E2E Tests - Real Gemini (Requires API Key)', () => {
  const hasApiKey = !!process.env.GEMINI_API_KEY;

  // Skip all tests if no API key
  const conditionalIt = hasApiKey ? it : it.skip;

  let performanceMetrics: { operation: string; durationMs: number }[] = [];

  beforeAll(() => {
    performanceMetrics = [];
  });

  afterAll(() => {
    // Log performance metrics
    if (performanceMetrics.length > 0) {
      console.log('\n--- Performance Metrics ---');
      performanceMetrics.forEach(m => {
        console.log(`${m.operation}: ${m.durationMs}ms`);
      });
      console.log('---------------------------\n');
    }
  });

  conditionalIt('should get real feedback from Gemini for techno pattern', async () => {
    // Reset modules to get real GeminiService
    jest.resetModules();
    const { GeminiService: RealGeminiService } = await import('../../services/GeminiService');

    const geminiService = new RealGeminiService();

    if (!geminiService.isAvailable()) {
      console.log('Skipping - GEMINI_API_KEY not configured');
      return;
    }

    const testPattern = `stack(
      s("bd*4, ~ cp ~ cp, hh*8"),
      note("c2 c2 c2 c2").s("sawtooth")
    ).gain(0.8)`;

    const startTime = Date.now();
    const feedback = await geminiService.getCreativeFeedback(testPattern);
    const duration = Date.now() - startTime;

    performanceMetrics.push({ operation: 'getCreativeFeedback (techno)', durationMs: duration });

    // Verify response structure
    expect(feedback.complexity).toMatch(/simple|moderate|complex/);
    expect(typeof feedback.estimatedStyle).toBe('string');
    expect(feedback.estimatedStyle.length).toBeGreaterThan(0);
    expect(Array.isArray(feedback.strengths)).toBe(true);
    expect(Array.isArray(feedback.suggestions)).toBe(true);

    // Performance check
    expect(duration).toBeLessThan(10000);

    console.log(`Real Gemini response for techno: ${feedback.estimatedStyle}, ${feedback.complexity}`);
  }, E2E_TIMEOUT);

  conditionalIt('should get real feedback from Gemini for ambient pattern', async () => {
    jest.resetModules();
    const { GeminiService: RealGeminiService } = await import('../../services/GeminiService');

    const geminiService = new RealGeminiService();

    if (!geminiService.isAvailable()) {
      console.log('Skipping - GEMINI_API_KEY not configured');
      return;
    }

    const testPattern = `note("<c4 e4 g4 b4>*4")
      .s("triangle")
      .delay(0.5)
      .room(0.8)
      .gain(0.4)`;

    const startTime = Date.now();
    const feedback = await geminiService.getCreativeFeedback(testPattern);
    const duration = Date.now() - startTime;

    performanceMetrics.push({ operation: 'getCreativeFeedback (ambient)', durationMs: duration });

    expect(feedback.complexity).toMatch(/simple|moderate|complex/);
    expect(typeof feedback.estimatedStyle).toBe('string');
    expect(duration).toBeLessThan(10000);

    console.log(`Real Gemini response for ambient: ${feedback.estimatedStyle}, ${feedback.complexity}`);
  }, E2E_TIMEOUT);

  conditionalIt('should get real feedback from Gemini for jazz pattern', async () => {
    jest.resetModules();
    const { GeminiService: RealGeminiService } = await import('../../services/GeminiService');

    const geminiService = new RealGeminiService();

    if (!geminiService.isAvailable()) {
      console.log('Skipping - GEMINI_API_KEY not configured');
      return;
    }

    const testPattern = `stack(
      note("c3 e3 g3 b3, f3 a3 c4 e4")
        .s("piano")
        .struct("1 ~ [1 ~] ~"),
      note("c2 f2 g2 c2").s("upright")
    ).swing(0.3)`;

    const startTime = Date.now();
    const feedback = await geminiService.getCreativeFeedback(testPattern);
    const duration = Date.now() - startTime;

    performanceMetrics.push({ operation: 'getCreativeFeedback (jazz)', durationMs: duration });

    expect(feedback.complexity).toMatch(/simple|moderate|complex/);
    expect(typeof feedback.estimatedStyle).toBe('string');
    expect(duration).toBeLessThan(10000);

    console.log(`Real Gemini response for jazz: ${feedback.estimatedStyle}, ${feedback.complexity}`);
  }, E2E_TIMEOUT);

  conditionalIt('should handle rate limiting gracefully', async () => {
    jest.resetModules();
    const { GeminiService: RealGeminiService } = await import('../../services/GeminiService');

    const geminiService = new RealGeminiService();

    if (!geminiService.isAvailable()) {
      console.log('Skipping - GEMINI_API_KEY not configured');
      return;
    }

    // Make rapid requests to test rate limiting
    const patterns = [
      's("bd*4")',
      's("hh*8")',
      's("cp*2")'
    ];

    const results = [];
    for (const pattern of patterns) {
      try {
        const feedback = await geminiService.getCreativeFeedback(pattern);
        results.push({ success: true, feedback });
      } catch (error: any) {
        results.push({ success: false, error: error.message });
      }
    }

    // At least first request should succeed
    expect(results[0].success).toBe(true);
    console.log(`Rate limit test: ${results.filter(r => r.success).length}/${results.length} succeeded`);
  }, E2E_TIMEOUT);
});

// ===========================================================================
// PERFORMANCE TESTING
// ===========================================================================

describe('Performance Testing - Compose + Feedback', () => {
  let server: StrudelMCPServer;
  let mockController: jest.Mocked<StrudelController>;
  let mockGeminiService: jest.Mocked<GeminiService>;
  let currentPattern: string = '';

  beforeEach(() => {
    jest.clearAllMocks();
    currentPattern = '';

    mockController = {
      initialize: jest.fn().mockResolvedValue('Strudel initialized'),
      getCurrentPattern: jest.fn().mockImplementation(() => Promise.resolve(currentPattern)),
      writePattern: jest.fn().mockImplementation((pattern: string) => {
        currentPattern = pattern;
        return Promise.resolve('Pattern written');
      }),
      play: jest.fn().mockResolvedValue('Playing'),
      stop: jest.fn().mockResolvedValue('Stopped'),
      cleanup: jest.fn().mockResolvedValue(undefined),
      page: null
    } as any;

    mockGeminiService = {
      isAvailable: jest.fn().mockReturnValue(true),
      getCreativeFeedback: jest.fn().mockImplementation(async () => {
        // Simulate API latency
        await new Promise(resolve => setTimeout(resolve, 50));
        return {
          complexity: 'moderate',
          estimatedStyle: 'techno',
          strengths: ['Good rhythm'],
          suggestions: ['Add more']
        };
      }),
      analyzeAudio: jest.fn(),
      suggestVariations: jest.fn(),
      clearCache: jest.fn()
    } as any;

    (StrudelController as jest.Mock).mockReturnValue(mockController);
    (GeminiService as jest.Mock).mockReturnValue(mockGeminiService);

    server = new StrudelMCPServer();
  });

  it('should complete compose + feedback within acceptable time', async () => {
    const serverAny = server as any;

    const startTime = Date.now();
    const result = await serverAny.executeTool('compose', {
      style: 'techno',
      get_feedback: true
    });
    const duration = Date.now() - startTime;

    expect(result.success).toBe(true);
    expect(result.feedback).toBeDefined();

    // With mocked Gemini (50ms latency), total should be <500ms
    expect(duration).toBeLessThan(500);

    console.log(`Compose + feedback (mocked) completed in ${duration}ms`);
  }, MOCKED_TEST_TIMEOUT);

  it('should complete compose without feedback faster', async () => {
    const serverAny = server as any;

    const withFeedbackStart = Date.now();
    await serverAny.executeTool('compose', {
      style: 'techno',
      get_feedback: true
    });
    const withFeedbackDuration = Date.now() - withFeedbackStart;

    const withoutFeedbackStart = Date.now();
    await serverAny.executeTool('compose', {
      style: 'techno',
      get_feedback: false
    });
    const withoutFeedbackDuration = Date.now() - withoutFeedbackStart;

    // Without feedback should be faster
    expect(withoutFeedbackDuration).toBeLessThan(withFeedbackDuration);

    console.log(`With feedback: ${withFeedbackDuration}ms, Without: ${withoutFeedbackDuration}ms`);
  }, MOCKED_TEST_TIMEOUT);

  it('should measure feedback latency independently', async () => {
    const serverAny = server as any;
    await serverAny.executeTool('init', {});
    await serverAny.executeTool('edit_pattern', { mode: 'write', pattern: 's("bd*4")' });

    const startTime = Date.now();
    await serverAny.executeTool('ai_assist', { task: 'feedback' });
    const duration = Date.now() - startTime;

    // Feedback alone with mocked API should be fast
    expect(duration).toBeLessThan(200);

    console.log(`get_pattern_feedback (mocked) completed in ${duration}ms`);
  }, MOCKED_TEST_TIMEOUT);
});

// ===========================================================================
// FULL MCP FLOW INTEGRATION
// ===========================================================================

describe('Full MCP Flow Integration', () => {
  let server: StrudelMCPServer;
  let mockController: jest.Mocked<StrudelController>;
  let mockGeminiService: jest.Mocked<GeminiService>;
  let currentPattern: string = '';

  beforeEach(() => {
    jest.clearAllMocks();
    currentPattern = '';

    mockController = {
      initialize: jest.fn().mockResolvedValue('Strudel initialized'),
      getCurrentPattern: jest.fn().mockImplementation(() => Promise.resolve(currentPattern)),
      writePattern: jest.fn().mockImplementation((pattern: string) => {
        currentPattern = pattern;
        return Promise.resolve('Pattern written');
      }),
      play: jest.fn().mockResolvedValue('Playing'),
      stop: jest.fn().mockResolvedValue('Stopped'),
      cleanup: jest.fn().mockResolvedValue(undefined),
      page: null
    } as any;

    mockGeminiService = {
      isAvailable: jest.fn().mockReturnValue(true),
      getCreativeFeedback: jest.fn().mockResolvedValue({
        complexity: 'moderate',
        estimatedStyle: 'techno',
        strengths: ['Good flow'],
        suggestions: ['Try variations']
      }),
      analyzeAudio: jest.fn(),
      suggestVariations: jest.fn(),
      clearCache: jest.fn()
    } as any;

    (StrudelController as jest.Mock).mockReturnValue(mockController);
    (GeminiService as jest.Mock).mockReturnValue(mockGeminiService);

    server = new StrudelMCPServer();
  });

  it('should complete full workflow: init -> compose -> feedback -> analyze', async () => {
    const serverAny = server as any;

    // Step 1: Initialize
    const initResult = await serverAny.executeTool('init', {});
    expect(initResult).toContain('initialized');

    // Step 2: Compose with feedback
    const composeResult = await serverAny.executeTool('compose', {
      style: 'techno',
      key: 'A',  // Root note only (not Am)
      tempo: 128,
      auto_play: false,
      get_feedback: true
    });

    expect(composeResult.success).toBe(true);
    expect(composeResult.feedback).toBeDefined();
    expect(composeResult.metadata).toEqual({
      style: 'techno',
      bpm: 128,
      key: 'A'
    });

    // Step 3: Get additional feedback
    const feedbackResult = await serverAny.executeTool('ai_assist', { task: 'feedback' });

    expect(feedbackResult.gemini_available).toBe(true);
    expect(feedbackResult.pattern_analysis).toBeDefined();

    // Step 4: Verify pattern is correct
    const pattern = await serverAny.executeTool('get_pattern', {});
    expect(pattern).toBeDefined();
    expect(pattern.length).toBeGreaterThan(0);
  }, MOCKED_TEST_TIMEOUT);

  it('should handle workflow with multiple pattern generations', async () => {
    const serverAny = server as any;

    const styles = ['techno', 'house', 'ambient'];
    const results = [];

    for (const style of styles) {
      const result = await serverAny.executeTool('compose', {
        style,
        get_feedback: true
      });

      results.push({
        style,
        success: result.success,
        hasFeedback: !!result.feedback
      });
    }

    // All should succeed
    results.forEach(r => {
      expect(r.success).toBe(true);
      expect(r.hasFeedback).toBe(true);
    });

    // Gemini should have been called for each
    expect(mockGeminiService.getCreativeFeedback).toHaveBeenCalledTimes(3);
  }, MOCKED_TEST_TIMEOUT);

  it('should maintain consistent state across operations', async () => {
    const serverAny = server as any;

    // Compose a pattern
    await serverAny.executeTool('compose', {
      style: 'dnb',
      tempo: 174,
      get_feedback: false
    });

    // Get feedback for the composed pattern
    const feedback = await serverAny.executeTool('ai_assist', { task: 'feedback' });

    expect(feedback.gemini_available).toBe(true);
    expect(feedback.pattern_analysis).toBeDefined();

    // Gemini should be called with the current pattern
    expect(mockGeminiService.getCreativeFeedback).toHaveBeenCalled();
  }, MOCKED_TEST_TIMEOUT);

  it('should track pattern through init -> write -> play -> feedback cycle', async () => {
    const serverAny = server as any;

    // Initialize
    await serverAny.executeTool('init', {});

    // Write a pattern
    const testPattern = 's("bd*4 sd:2 hh*8")';
    await serverAny.executeTool('edit_pattern', { mode: 'write', pattern: testPattern });

    // Play
    await serverAny.executeTool('playback', { action: 'play' });
    expect(mockController.play).toHaveBeenCalled();

    // Get feedback
    const feedback = await serverAny.executeTool('ai_assist', { task: 'feedback' });
    expect(feedback.gemini_available).toBe(true);
    expect(mockGeminiService.getCreativeFeedback).toHaveBeenCalledWith(testPattern);
  }, MOCKED_TEST_TIMEOUT);
});

// ===========================================================================
// EDGE CASES
// ===========================================================================

describe('Edge Cases and Error Boundaries', () => {
  let server: StrudelMCPServer;
  let mockController: jest.Mocked<StrudelController>;
  let mockGeminiService: jest.Mocked<GeminiService>;
  let currentPattern: string = '';

  beforeEach(() => {
    jest.clearAllMocks();
    currentPattern = '';

    mockController = {
      initialize: jest.fn().mockResolvedValue('Strudel initialized'),
      getCurrentPattern: jest.fn().mockImplementation(() => Promise.resolve(currentPattern)),
      writePattern: jest.fn().mockImplementation((pattern: string) => {
        currentPattern = pattern;
        return Promise.resolve('Pattern written');
      }),
      play: jest.fn().mockResolvedValue('Playing'),
      stop: jest.fn().mockResolvedValue('Stopped'),
      cleanup: jest.fn().mockResolvedValue(undefined),
      page: null
    } as any;

    mockGeminiService = {
      isAvailable: jest.fn().mockReturnValue(true),
      getCreativeFeedback: jest.fn().mockResolvedValue({
        complexity: 'moderate',
        estimatedStyle: 'unknown',
        strengths: [],
        suggestions: []
      }),
      analyzeAudio: jest.fn(),
      suggestVariations: jest.fn(),
      clearCache: jest.fn()
    } as any;

    (StrudelController as jest.Mock).mockReturnValue(mockController);
    (GeminiService as jest.Mock).mockReturnValue(mockGeminiService);

    server = new StrudelMCPServer();
  });

  it('should handle Gemini returning empty arrays', async () => {
    const serverAny = server as any;

    const result = await serverAny.executeTool('compose', {
      style: 'experimental',
      get_feedback: true
    });

    expect(result.success).toBe(true);
    expect(result.feedback).toBeDefined();
    expect(result.feedback.strengths).toEqual([]);
    expect(result.feedback.suggestions).toEqual([]);
  }, MOCKED_TEST_TIMEOUT);

  it('should handle very long patterns without crashing', async () => {
    const serverAny = server as any;
    await serverAny.executeTool('init', {});

    const longPattern = 's("bd*4")' + '.sometimes(x => x.fast(2))'.repeat(100);
    await serverAny.executeTool('edit_pattern', { mode: 'write', pattern: longPattern });

    const result = await serverAny.executeTool('ai_assist', { task: 'feedback' });

    expect(result.gemini_available).toBe(true);
    expect(mockGeminiService.getCreativeFeedback).toHaveBeenCalled();
  }, MOCKED_TEST_TIMEOUT);

  it('should handle special characters in patterns', async () => {
    const serverAny = server as any;
    await serverAny.executeTool('init', {});

    const specialPattern = 's("bd*4 <sd cp>").euclidean(3,8,"r").gain(0.5)';
    await serverAny.executeTool('edit_pattern', { mode: 'write', pattern: specialPattern });

    const result = await serverAny.executeTool('ai_assist', { task: 'feedback' });

    expect(result.gemini_available).toBe(true);
    expect(mockGeminiService.getCreativeFeedback).toHaveBeenCalledWith(specialPattern);
  }, MOCKED_TEST_TIMEOUT);

  it('should handle unicode in patterns', async () => {
    const serverAny = server as any;
    await serverAny.executeTool('init', {});

    const unicodePattern = 's("bd*4") // Test with unicode: \u{1F3B5}';
    await serverAny.executeTool('edit_pattern', { mode: 'write', pattern: unicodePattern });

    const result = await serverAny.executeTool('ai_assist', { task: 'feedback' });

    expect(result.gemini_available).toBe(true);
  }, MOCKED_TEST_TIMEOUT);

  it('should handle concurrent feedback requests', async () => {
    const serverAny = server as any;
    await serverAny.executeTool('init', {});
    await serverAny.executeTool('edit_pattern', { mode: 'write', pattern: 's("bd*4")' });

    // Make multiple concurrent requests
    const results = await Promise.all([
      serverAny.executeTool('ai_assist', { task: 'feedback' }),
      serverAny.executeTool('ai_assist', { task: 'feedback' }),
      serverAny.executeTool('ai_assist', { task: 'feedback' })
    ]);

    // All should succeed
    results.forEach(result => {
      expect(result.gemini_available).toBe(true);
      expect(result.pattern_analysis).toBeDefined();
    });
  }, MOCKED_TEST_TIMEOUT);
});
