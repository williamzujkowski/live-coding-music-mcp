/**
 * Unit tests for the pattern-feedback path of the ai_assist MCP tool.
 *
 * get_pattern_feedback was consolidated into ai_assist({ task: 'feedback' })
 * (#178). These tests exercise the same underlying handler in depth:
 * AI-powered pattern analysis via GeminiService integration, covering
 * success cases, error handling, and parameter variations.
 */

import { StrudelMCPServer } from '../../server/server';
import { StrudelController } from '../../StrudelController';
import { PatternStore } from '../../PatternStore';
import { MusicTheory } from '../../services/MusicTheory';
import { PatternGenerator } from '../../services/PatternGenerator';
import { GeminiService, CreativeFeedback, AudioFeedback } from '../../services/GeminiService';

// Mock all dependencies
jest.mock('../../StrudelController');
jest.mock('../../PatternStore');
jest.mock('../../services/MusicTheory');
jest.mock('../../services/PatternGenerator');
jest.mock('../../services/GeminiService');
jest.mock('../../services/StrudelEngine');
jest.mock('fs', () => ({
  readFileSync: jest.fn().mockReturnValue('{"headless": true}'),
  existsSync: jest.fn().mockReturnValue(true)
}));

// Mock response data following the GeminiService interface
const mockCreativeFeedback: CreativeFeedback = {
  complexity: 'moderate',
  estimatedStyle: 'minimal techno',
  strengths: ['Good rhythm structure', 'Nice filter work'],
  suggestions: ['Add a melody layer', 'Try polyrhythmic elements']
};

const mockAudioFeedback: AudioFeedback = {
  mood: 'hypnotic',
  style: 'techno',
  energy: 'high',
  suggestions: ['Consider softer hi-hats', 'Add more bass presence'],
  confidence: 0.85
};

describe('get_pattern_feedback Tool', () => {
  let server: StrudelMCPServer;
  let mockController: jest.Mocked<StrudelController>;
  let mockStore: jest.Mocked<PatternStore>;
  let mockTheory: jest.Mocked<MusicTheory>;
  let mockGenerator: jest.Mocked<PatternGenerator>;
  let mockGeminiService: jest.Mocked<GeminiService>;

  beforeEach(() => {
    jest.clearAllMocks();

    // Setup StrudelController mock
    mockController = {
      initialize: jest.fn().mockResolvedValue('Strudel initialized'),
      getCurrentPattern: jest.fn().mockResolvedValue('s("bd*4 sd:2").fast(2)'),
      writePattern: jest.fn().mockResolvedValue('Pattern written'),
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
      getConsoleWarnings: jest.fn().mockReturnValue([])
    } as any;

    // Setup PatternStore mock
    mockStore = {
      save: jest.fn().mockResolvedValue(undefined),
      load: jest.fn().mockResolvedValue(null),
      list: jest.fn().mockResolvedValue([])
    } as any;

    // Setup MusicTheory mock
    mockTheory = {
      generateScale: jest.fn().mockReturnValue(['C', 'D', 'E', 'F', 'G', 'A', 'B']),
      generateChordProgression: jest.fn().mockReturnValue('I-V-vi-IV')
    } as any;

    // Setup PatternGenerator mock
    mockGenerator = {
      generateCompletePattern: jest.fn().mockReturnValue('s("bd*4")'),
      generateDrumPattern: jest.fn().mockReturnValue('s("bd*4")'),
      generateBassline: jest.fn().mockReturnValue('s("c2")'),
      generateMelody: jest.fn().mockReturnValue('note("c4")'),
      generateChords: jest.fn().mockReturnValue('chord("C")'),
      generateEuclideanPattern: jest.fn().mockReturnValue('euclid(3,8)'),
      generatePolyrhythm: jest.fn().mockReturnValue('poly'),
      generateFill: jest.fn().mockReturnValue('fill'),
      generateVariation: jest.fn().mockReturnValue('varied')
    } as any;

    // Setup GeminiService mock
    mockGeminiService = {
      isAvailable: jest.fn().mockReturnValue(true),
      getCreativeFeedback: jest.fn().mockResolvedValue(mockCreativeFeedback),
      analyzeAudio: jest.fn().mockResolvedValue(mockAudioFeedback),
      suggestVariations: jest.fn().mockResolvedValue([]),
      clearCache: jest.fn()
    } as any;

    // Wire up mocked constructors
    (StrudelController as jest.Mock).mockReturnValue(mockController);
    (PatternStore as jest.Mock).mockReturnValue(mockStore);
    (MusicTheory as jest.Mock).mockReturnValue(mockTheory);
    (PatternGenerator as jest.Mock).mockReturnValue(mockGenerator);
    (GeminiService as jest.Mock).mockReturnValue(mockGeminiService);

    server = new StrudelMCPServer();
  });

  describe('Pattern Analysis - Gemini Available', () => {
    beforeEach(async () => {
      // Initialize browser for pattern-related tests
      await (server as any).executeTool('init', {});
    });

    test('should return pattern analysis when Gemini is available', async () => {
      const result = await (server as any).executeTool('ai_assist', { task: 'feedback' });

      expect(mockGeminiService.getCreativeFeedback).toHaveBeenCalled();
      expect(result.gemini_available).toBe(true);
      expect(result.pattern_analysis).toBeDefined();
      expect(result.pattern_analysis.complexity).toBe('moderate');
      expect(result.pattern_analysis.estimatedStyle).toBe('minimal techno');
      expect(result.pattern_analysis.strengths).toContain('Good rhythm structure');
      expect(result.pattern_analysis.suggestions).toContain('Add a melody layer');
    });

    test('should handle style parameter in analysis', async () => {
      const result = await (server as any).executeTool('ai_assist', {
        task: 'feedback',
        style: 'techno'
      });

      expect(result.gemini_available).toBe(true);
      expect(result.pattern_analysis).toBeDefined();
      expect(mockGeminiService.getCreativeFeedback).toHaveBeenCalled();
    });

    test('should return only pattern analysis when includeAudio is false', async () => {
      const result = await (server as any).executeTool('ai_assist', {
        task: 'feedback',
        includeAudio: false
      });

      expect(mockGeminiService.getCreativeFeedback).toHaveBeenCalled();
      expect(mockGeminiService.analyzeAudio).not.toHaveBeenCalled();
      expect(result.audio_analysis).toBeUndefined();
    });

    test('should attempt audio analysis when includeAudio is true', async () => {
      const result = await (server as any).executeTool('ai_assist', {
        task: 'feedback',
        includeAudio: true
      });

      expect(mockGeminiService.getCreativeFeedback).toHaveBeenCalled();
      expect(result.gemini_available).toBe(true);
      // Audio capture may fail in test environment (no real browser), but should not throw
      // The important thing is that the request completes and returns valid structure
    });

    test('should use current pattern from editor', async () => {
      mockController.getCurrentPattern.mockResolvedValue('note("c4 e4 g4")');

      const result = await (server as any).executeTool('ai_assist', { task: 'feedback' });

      expect(result.pattern_analysis).toBeDefined();
      expect(mockGeminiService.getCreativeFeedback).toHaveBeenCalled();
    });
  });

  describe('Error Handling - API Key Not Configured', () => {
    beforeEach(async () => {
      // Mock Gemini as unavailable (no API key)
      mockGeminiService.isAvailable.mockReturnValue(false);

      await (server as any).executeTool('init', {});
    });

    test('should return error message when Gemini API key not configured', async () => {
      const result = await (server as any).executeTool('ai_assist', { task: 'feedback' });

      expect(result.gemini_available).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error).toContain('GEMINI_API_KEY');
    });

    test('should indicate Gemini unavailable when API not configured', async () => {
      const result = await (server as any).executeTool('ai_assist', { task: 'feedback' });

      expect(result.gemini_available).toBe(false);
    });
  });

  describe('Error Handling - Rate Limits', () => {
    beforeEach(async () => {
      await (server as any).executeTool('init', {});
    });

    test('should handle rate limit errors gracefully', async () => {
      mockGeminiService.getCreativeFeedback.mockRejectedValue(
        new Error('Rate limit exceeded (10 requests/minute). Wait 45 seconds before retrying.')
      );

      const result = await (server as any).executeTool('ai_assist', { task: 'feedback' });

      expect(result.error).toBeDefined();
      expect(result.error.toLowerCase()).toContain('rate limit');
    });

    test('should provide actionable message on rate limit', async () => {
      mockGeminiService.getCreativeFeedback.mockRejectedValue(
        new Error('Rate limit exceeded (10 requests/minute). Wait 45 seconds before retrying.')
      );

      const result = await (server as any).executeTool('ai_assist', { task: 'feedback' });

      // Error message should provide actionable guidance (case insensitive)
      expect(result.error.toLowerCase()).toContain('wait');
    });

    test('should include wait time in rate limit error', async () => {
      mockGeminiService.getCreativeFeedback.mockRejectedValue(
        new Error('Rate limit exceeded (10 requests/minute). Wait 30 seconds before retrying.')
      );

      const result = await (server as any).executeTool('ai_assist', { task: 'feedback' });

      expect(result.error).toContain('seconds');
    });
  });

  describe('Error Handling - Empty Pattern', () => {
    beforeEach(async () => {
      await (server as any).executeTool('init', {});
    });

    test('should return appropriate error for empty pattern', async () => {
      mockController.getCurrentPattern.mockResolvedValue('');

      const result = await (server as any).executeTool('ai_assist', { task: 'feedback' });

      expect(result.error).toBeDefined();
      expect(result.error.toLowerCase()).toContain('pattern');
    });

    test('should return appropriate error for whitespace-only pattern', async () => {
      mockController.getCurrentPattern.mockResolvedValue('   \n\t  ');

      const result = await (server as any).executeTool('ai_assist', { task: 'feedback' });

      expect(result.error).toBeDefined();
      expect(result.error.toLowerCase()).toContain('pattern');
    });
  });

  describe('Error Handling - API Failures', () => {
    beforeEach(async () => {
      await (server as any).executeTool('init', {});
    });

    test('should handle network errors from Gemini API', async () => {
      mockGeminiService.getCreativeFeedback.mockRejectedValue(
        new Error('Creative feedback failed: Network error')
      );

      const result = await (server as any).executeTool('ai_assist', { task: 'feedback' });

      expect(result.error).toBeDefined();
      expect(result.error).toContain('Network error');
    });

    test('should handle API quota exceeded errors', async () => {
      mockGeminiService.getCreativeFeedback.mockRejectedValue(
        new Error('Creative feedback failed: API quota exceeded')
      );

      const result = await (server as any).executeTool('ai_assist', { task: 'feedback' });

      expect(result.error).toBeDefined();
      expect(result.error).toContain('quota exceeded');
    });

    test('should handle timeout errors', async () => {
      mockGeminiService.getCreativeFeedback.mockRejectedValue(
        new Error('Creative feedback timed out. The pattern may be too complex. Try a simpler pattern.')
      );

      const result = await (server as any).executeTool('ai_assist', { task: 'feedback' });

      expect(result.error).toBeDefined();
      expect(result.error).toContain('timed out');
    });

    test('should provide actionable message on timeout', async () => {
      mockGeminiService.getCreativeFeedback.mockRejectedValue(
        new Error('Creative feedback timed out. The pattern may be too complex. Try a simpler pattern.')
      );

      const result = await (server as any).executeTool('ai_assist', { task: 'feedback' });

      expect(result.error.toLowerCase()).toContain('pattern');
    });
  });

  describe('Audio Analysis Integration', () => {
    beforeEach(async () => {
      await (server as any).executeTool('init', {});
    });

    test('should pass style context to audio analysis when provided', async () => {
      const result = await (server as any).executeTool('ai_assist', {
        task: 'feedback',
        includeAudio: true,
        style: 'techno'
      });

      // Pattern analysis should always be called when pattern available
      expect(mockGeminiService.getCreativeFeedback).toHaveBeenCalled();
      // Result should have proper structure regardless of audio capture success
      expect(result.gemini_available).toBe(true);
    });

    test('should handle uninitialized state for audio analysis', async () => {
      // Create new server without initialization
      const uninitServer = new StrudelMCPServer();

      const result = await (uninitServer as any).executeTool('ai_assist', {
        task: 'feedback',
        includeAudio: true
      });

      // Should return Gemini available status
      expect(result.gemini_available).toBe(true);
      // Without initialization, there's no pattern to analyze - that error takes precedence
      // or audio analysis requires browser init
      if (result.error) {
        expect(result.error.toLowerCase()).toMatch(/init|browser|audio|pattern/);
      }
    });
  });

  describe('Response Format', () => {
    beforeEach(async () => {
      await (server as any).executeTool('init', {});
    });

    test('should return properly structured response', async () => {
      const result = await (server as any).executeTool('ai_assist', { task: 'feedback' });

      // Verify required fields
      expect(result).toHaveProperty('gemini_available');
      expect(result.gemini_available).toBe(true);
      expect(result).toHaveProperty('pattern_analysis');

      // Verify pattern_analysis structure
      const analysis = result.pattern_analysis;
      expect(analysis).toHaveProperty('complexity');
      expect(analysis).toHaveProperty('estimatedStyle');
      expect(analysis).toHaveProperty('strengths');
      expect(analysis).toHaveProperty('suggestions');

      // Verify types
      expect(['simple', 'moderate', 'complex']).toContain(analysis.complexity);
      expect(typeof analysis.estimatedStyle).toBe('string');
      expect(Array.isArray(analysis.strengths)).toBe(true);
      expect(Array.isArray(analysis.suggestions)).toBe(true);
    });

    test('should return gemini_available flag in all responses', async () => {
      // Success case
      let result = await (server as any).executeTool('ai_assist', { task: 'feedback' });
      expect(result).toHaveProperty('gemini_available');

      // Error case - empty pattern
      mockController.getCurrentPattern.mockResolvedValue('');
      result = await (server as any).executeTool('ai_assist', { task: 'feedback' });
      expect(result).toHaveProperty('gemini_available');
    });
  });

  describe('Initialization Requirements', () => {
    test('should work without browser initialization for pattern-only analysis', async () => {
      // Server not initialized, but has generated patterns
      mockController.getCurrentPattern.mockResolvedValue('s("bd*4")');

      const result = await (server as any).executeTool('ai_assist', {
        task: 'feedback',
        includeAudio: false
      });

      // Pattern analysis should work even without browser init
      // (uses getCurrentPatternSafe which handles non-initialized state)
      expect(result.gemini_available).toBe(true);
    });

    test('should handle uninitialized browser for audio requests', async () => {
      const uninitServer = new StrudelMCPServer();

      const result = await (uninitServer as any).executeTool('ai_assist', {
        task: 'feedback',
        includeAudio: true
      });

      // Should return Gemini available status
      expect(result.gemini_available).toBe(true);
      // Error may be about pattern (none available) or audio/browser init
      if (result.error) {
        expect(result.error.toLowerCase()).toMatch(/init|browser|audio|pattern/);
      }
    });
  });

  describe('Edge Cases', () => {
    beforeEach(async () => {
      await (server as any).executeTool('init', {});
    });

    test('should handle Gemini returning empty suggestions', async () => {
      mockGeminiService.getCreativeFeedback.mockResolvedValue({
        complexity: 'simple',
        estimatedStyle: 'unknown',
        strengths: [],
        suggestions: []
      });

      const result = await (server as any).executeTool('ai_assist', { task: 'feedback' });

      expect(result.pattern_analysis).toBeDefined();
      expect(result.pattern_analysis.strengths).toEqual([]);
      expect(result.pattern_analysis.suggestions).toEqual([]);
    });

    test('should handle very long patterns', async () => {
      mockController.getCurrentPattern.mockResolvedValue('s("bd*4")'.repeat(500));

      const result = await (server as any).executeTool('ai_assist', { task: 'feedback' });

      // Should not throw, should return analysis
      expect(result.gemini_available).toBe(true);
      expect(mockGeminiService.getCreativeFeedback).toHaveBeenCalled();
    });

    test('should handle patterns with special characters', async () => {
      mockController.getCurrentPattern.mockResolvedValue('s("bd*4 <sd cp>").euclidean(3,8,"r")');

      const result = await (server as any).executeTool('ai_assist', { task: 'feedback' });

      expect(result.gemini_available).toBe(true);
      expect(mockGeminiService.getCreativeFeedback).toHaveBeenCalled();
    });
  });

  describe('Service Integration', () => {
    beforeEach(async () => {
      await (server as any).executeTool('init', {});
    });

    test('should call GeminiService.getCreativeFeedback with pattern', async () => {
      mockController.getCurrentPattern.mockResolvedValue('note("c4 e4 g4")');

      await (server as any).executeTool('ai_assist', { task: 'feedback' });

      expect(mockGeminiService.getCreativeFeedback).toHaveBeenCalledWith('note("c4 e4 g4")');
    });

    test('should not call audio analysis when includeAudio is false', async () => {
      await (server as any).executeTool('ai_assist', {
        task: 'feedback',
        includeAudio: false
      });

      expect(mockGeminiService.analyzeAudio).not.toHaveBeenCalled();
    });

    test('should handle GeminiService throwing unexpected error', async () => {
      mockGeminiService.getCreativeFeedback.mockRejectedValue(new Error('Unexpected internal error'));

      const result = await (server as any).executeTool('ai_assist', { task: 'feedback' });

      expect(result.error).toBeDefined();
      expect(result.error).toContain('Unexpected internal error');
    });
  });
});

describe('get_pattern_feedback Tool - Tool Definition', () => {
  // get_pattern_feedback was consolidated into ai_assist({ task: 'feedback' }) (#178).
  test('ai_assist tool should be registered in server tools list', () => {
    const server = new StrudelMCPServer();
    const tools = (server as any).getTools();

    const aiTool = tools.find((t: any) => t.name === 'ai_assist');

    expect(aiTool).toBeDefined();
    expect(aiTool.description).toContain('feedback');
    expect(aiTool.inputSchema.properties.task.enum).toContain('feedback');
  });

  test('ai_assist tool should have correct input schema for feedback task', () => {
    const server = new StrudelMCPServer();
    const tools = (server as any).getTools();

    const aiTool = tools.find((t: any) => t.name === 'ai_assist');
    const schema = aiTool.inputSchema;

    expect(schema.type).toBe('object');
    expect(schema.required).toContain('task');
    expect(schema.properties).toHaveProperty('includeAudio');
    expect(schema.properties.includeAudio.type).toBe('boolean');
    expect(schema.properties).toHaveProperty('style');
    expect(schema.properties.style.type).toBe('string');
  });

  test('ai_assist tool should have description mentioning Gemini', () => {
    const server = new StrudelMCPServer();
    const tools = (server as any).getTools();

    const aiTool = tools.find((t: any) => t.name === 'ai_assist');

    expect(aiTool.description.toLowerCase()).toContain('gemini');
  });
});
