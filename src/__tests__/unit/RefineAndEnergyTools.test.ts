/**
 * Unit tests for the refine and set_energy MCP tools (#78, #81)
 *
 * Tests pattern refinement with directional commands and energy level adjustments.
 * Covers tempo, gain, cutoff, reverb modifications, and energy-based pattern changes.
 */

import { StrudelMCPServer } from '../../server/server';
import { StrudelController } from '../../StrudelController';
import { PatternStore } from '../../PatternStore';
import { MusicTheory } from '../../services/MusicTheory';
import { PatternGenerator } from '../../services/PatternGenerator';
import { GeminiService, CreativeFeedback } from '../../services/GeminiService';

// Mock all dependencies
jest.mock('../../StrudelController');
jest.mock('../../PatternStore');
jest.mock('../../services/MusicTheory');
jest.mock('../../services/PatternGenerator');
jest.mock('../../services/GeminiService');
jest.mock('../../services/StrudelEngine', () => ({
  StrudelEngine: jest.fn().mockImplementation(() => ({
    validate: jest.fn().mockReturnValue({ valid: true, errors: [] }),
    analyzePattern: jest.fn().mockReturnValue({ complexity: 'moderate' }),
    queryEvents: jest.fn().mockReturnValue([]),
    transpile: jest.fn().mockReturnValue({ success: true, output: '' })
  }))
}));
jest.mock('fs', () => ({
  readFileSync: jest.fn().mockReturnValue('{"headless": true}'),
  existsSync: jest.fn().mockReturnValue(true)
}));

describe('refine Tool (#78)', () => {
  let server: StrudelMCPServer;
  let mockController: jest.Mocked<StrudelController>;
  let mockGeminiService: jest.Mocked<GeminiService>;

  beforeEach(() => {
    jest.clearAllMocks();

    // Setup StrudelController mock
    mockController = {
      initialize: jest.fn().mockResolvedValue('Strudel initialized'),
      getCurrentPattern: jest.fn().mockResolvedValue('s("bd*4 sd:2").gain(0.8)'),
      writePattern: jest.fn().mockResolvedValue('Pattern written'),
      play: jest.fn().mockResolvedValue('Playing'),
      stop: jest.fn().mockResolvedValue('Stopped'),
      analyzeAudio: jest.fn().mockResolvedValue({ connected: true }),
      detectKey: jest.fn().mockResolvedValue({ key: 'C', scale: 'minor', confidence: 0.8 }),
      detectTempo: jest.fn().mockResolvedValue({ bpm: 128, confidence: 0.9, method: 'autocorrelation' }),
      validatePattern: jest.fn().mockResolvedValue({ valid: true, errors: [], warnings: [], suggestions: [] }),
      validatePatternRuntime: jest.fn().mockResolvedValue({ valid: true, errors: [], warnings: [] }),
      showBrowser: jest.fn().mockResolvedValue('Browser shown'),
      takeScreenshot: jest.fn().mockResolvedValue('Screenshot saved'),
      getStatus: jest.fn().mockReturnValue({ initialized: true, playing: false }),
      getDiagnostics: jest.fn().mockResolvedValue({ browserConnected: true }),
      getConsoleErrors: jest.fn().mockReturnValue([]),
      getConsoleWarnings: jest.fn().mockReturnValue([]),
      cleanup: jest.fn().mockResolvedValue(undefined)
    } as any;

    // Setup GeminiService mock
    mockGeminiService = {
      isAvailable: jest.fn().mockReturnValue(false),
      getCreativeFeedback: jest.fn().mockResolvedValue({
        complexity: 'moderate',
        estimatedStyle: 'techno',
        strengths: [],
        suggestions: ['Try adding more variation']
      } as CreativeFeedback),
      analyzeAudio: jest.fn().mockResolvedValue(null),
      suggestVariations: jest.fn().mockResolvedValue([]),
      clearCache: jest.fn(),
      modifyPatternWithNLP: jest.fn().mockResolvedValue('modified pattern'),
      jamWithPattern: jest.fn().mockResolvedValue({ layer: 'drums', code: 's("bd*4")' })
    } as any;

    // Wire up mocked constructors
    (StrudelController as jest.Mock).mockReturnValue(mockController);
    (PatternStore as jest.Mock).mockReturnValue({
      save: jest.fn().mockResolvedValue(undefined),
      load: jest.fn().mockResolvedValue(null),
      list: jest.fn().mockResolvedValue([])
    });
    (MusicTheory as jest.Mock).mockReturnValue({
      generateScale: jest.fn().mockReturnValue(['C', 'D', 'E', 'F', 'G', 'A', 'B']),
      generateChordProgression: jest.fn().mockReturnValue('I-V-vi-IV')
    });
    (PatternGenerator as jest.Mock).mockReturnValue({
      generateCompletePattern: jest.fn().mockReturnValue('s("bd*4")'),
      generateDrumPattern: jest.fn().mockReturnValue('s("bd*4")'),
      generateBassline: jest.fn().mockReturnValue('s("c2")'),
      generateMelody: jest.fn().mockReturnValue('note("c4")'),
      generateChords: jest.fn().mockReturnValue('chord("C")'),
      generateEuclideanPattern: jest.fn().mockReturnValue('euclid(3,8)'),
      generatePolyrhythm: jest.fn().mockReturnValue('poly'),
      generateFill: jest.fn().mockReturnValue('fill'),
      generateVariation: jest.fn().mockReturnValue('varied')
    });
    (GeminiService as jest.Mock).mockReturnValue(mockGeminiService);

    server = new StrudelMCPServer();
  });

  describe('Tempo Adjustments', () => {
    beforeEach(async () => {
      // Initialize the browser so getCurrentPatternSafe works
      await (server as any).executeTool('init', {});
    });

    test('should apply faster refinement with .fast(1.1)', async () => {
      mockController.getCurrentPattern.mockResolvedValue('s("bd*4")');

      const result = await (server as any).executeTool('shape', { dimension: 'refine', direction: 'faster' });

      expect(result.success).toBe(true);
      expect(result.direction).toBe('faster');
      expect(result.applied).toBe('.fast(1.1)');
      expect(mockController.writePattern).toHaveBeenCalledWith('s("bd*4").fast(1.1)');
    });

    test('should apply slower refinement with .slow(1.1)', async () => {
      mockController.getCurrentPattern.mockResolvedValue('s("bd*4")');

      const result = await (server as any).executeTool('shape', { dimension: 'refine', direction: 'slower' });

      expect(result.success).toBe(true);
      expect(result.direction).toBe('slower');
      expect(result.applied).toBe('.slow(1.1)');
      expect(mockController.writePattern).toHaveBeenCalledWith('s("bd*4").slow(1.1)');
    });
  });

  describe('Gain Adjustments', () => {
    beforeEach(async () => {
      await (server as any).executeTool('init', {});
    });

    test('should apply louder refinement with .gain(1.1)', async () => {
      mockController.getCurrentPattern.mockResolvedValue('s("bd*4")');

      const result = await (server as any).executeTool('shape', { dimension: 'refine', direction: 'louder' });

      expect(result.success).toBe(true);
      expect(result.direction).toBe('louder');
      expect(result.applied).toBe('.gain(1.1)');
      expect(mockController.writePattern).toHaveBeenCalledWith('s("bd*4").gain(1.1)');
    });

    test('should apply quieter refinement with .gain(0.9)', async () => {
      mockController.getCurrentPattern.mockResolvedValue('s("bd*4")');

      const result = await (server as any).executeTool('shape', { dimension: 'refine', direction: 'quieter' });

      expect(result.success).toBe(true);
      expect(result.direction).toBe('quieter');
      expect(result.applied).toBe('.gain(0.9)');
      expect(mockController.writePattern).toHaveBeenCalledWith('s("bd*4").gain(0.9)');
    });
  });

  describe('Filter Adjustments', () => {
    beforeEach(async () => {
      await (server as any).executeTool('init', {});
    });

    test('should apply brighter refinement with .lpf(2000)', async () => {
      mockController.getCurrentPattern.mockResolvedValue('s("bd*4")');

      const result = await (server as any).executeTool('shape', { dimension: 'refine', direction: 'brighter' });

      expect(result.success).toBe(true);
      expect(result.direction).toBe('brighter');
      expect(result.applied).toBe('.lpf(2000)');
      expect(mockController.writePattern).toHaveBeenCalledWith('s("bd*4").lpf(2000)');
    });

    test('should apply darker refinement with .lpf(800)', async () => {
      mockController.getCurrentPattern.mockResolvedValue('s("bd*4")');

      const result = await (server as any).executeTool('shape', { dimension: 'refine', direction: 'darker' });

      expect(result.success).toBe(true);
      expect(result.direction).toBe('darker');
      expect(result.applied).toBe('.lpf(800)');
      expect(mockController.writePattern).toHaveBeenCalledWith('s("bd*4").lpf(800)');
    });
  });

  describe('Reverb Adjustments', () => {
    beforeEach(async () => {
      await (server as any).executeTool('init', {});
    });

    test('should apply more reverb with .room(0.5)', async () => {
      mockController.getCurrentPattern.mockResolvedValue('s("bd*4")');

      const result = await (server as any).executeTool('shape', { dimension: 'refine', direction: 'more reverb' });

      expect(result.success).toBe(true);
      expect(result.direction).toBe('more reverb');
      expect(result.applied).toBe('.room(0.5)');
      expect(mockController.writePattern).toHaveBeenCalledWith('s("bd*4").room(0.5)');
    });

    test('should apply drier refinement with .room(0.1)', async () => {
      mockController.getCurrentPattern.mockResolvedValue('s("bd*4")');

      const result = await (server as any).executeTool('shape', { dimension: 'refine', direction: 'drier' });

      expect(result.success).toBe(true);
      expect(result.direction).toBe('drier');
      expect(result.applied).toBe('.room(0.1)');
      expect(mockController.writePattern).toHaveBeenCalledWith('s("bd*4").room(0.1)');
    });
  });

  describe('Unknown Directions', () => {
    beforeEach(async () => {
      await (server as any).executeTool('init', {});
    });

    test('should return error for unknown direction', async () => {
      mockController.getCurrentPattern.mockResolvedValue('s("bd*4")');

      const result = await (server as any).executeTool('shape', { dimension: 'refine', direction: 'make it groovy' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Unknown refinement direction');
      expect(result.error).toContain('Supported');
    });

    test('should list supported directions in error message', async () => {
      mockController.getCurrentPattern.mockResolvedValue('s("bd*4")');

      const result = await (server as any).executeTool('shape', { dimension: 'refine', direction: 'something random' });

      expect(result.error).toContain('faster');
      expect(result.error).toContain('slower');
      expect(result.error).toContain('louder');
      expect(result.error).toContain('quieter');
    });
  });

  describe('Auto-play Behavior', () => {
    beforeEach(async () => {
      await (server as any).executeTool('init', {});
    });

    test('should auto-play after refinement when initialized', async () => {
      mockController.getCurrentPattern.mockResolvedValue('s("bd*4")');

      await (server as any).executeTool('shape', { dimension: 'refine', direction: 'faster' });

      expect(mockController.play).toHaveBeenCalled();
    });
  });

  describe('Error Cases', () => {
    beforeEach(async () => {
      await (server as any).executeTool('init', {});
    });

    test('should return error for empty pattern', async () => {
      mockController.getCurrentPattern.mockResolvedValue('');

      const result = await (server as any).executeTool('shape', { dimension: 'refine', direction: 'faster' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('No pattern');
    });

    test('should return error for whitespace-only pattern', async () => {
      mockController.getCurrentPattern.mockResolvedValue('   \n\t  ');

      const result = await (server as any).executeTool('shape', { dimension: 'refine', direction: 'faster' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('No pattern');
    });

    test('should handle case-insensitive directions', async () => {
      mockController.getCurrentPattern.mockResolvedValue('s("bd*4")');

      const result = await (server as any).executeTool('shape', { dimension: 'refine', direction: 'FASTER' });

      expect(result.success).toBe(true);
      expect(result.direction).toBe('faster');
    });
  });
});

describe('set_energy Tool (#81)', () => {
  let server: StrudelMCPServer;
  let mockController: jest.Mocked<StrudelController>;

  beforeEach(() => {
    jest.clearAllMocks();

    // Setup StrudelController mock
    mockController = {
      initialize: jest.fn().mockResolvedValue('Strudel initialized'),
      getCurrentPattern: jest.fn().mockResolvedValue('s("bd*4").gain(0.8)'),
      writePattern: jest.fn().mockResolvedValue('Pattern written'),
      play: jest.fn().mockResolvedValue('Playing'),
      stop: jest.fn().mockResolvedValue('Stopped'),
      analyzeAudio: jest.fn().mockResolvedValue({ connected: true }),
      detectKey: jest.fn().mockResolvedValue({ key: 'C', scale: 'minor', confidence: 0.8 }),
      detectTempo: jest.fn().mockResolvedValue({ bpm: 128, confidence: 0.9, method: 'autocorrelation' }),
      validatePattern: jest.fn().mockResolvedValue({ valid: true, errors: [], warnings: [], suggestions: [] }),
      validatePatternRuntime: jest.fn().mockResolvedValue({ valid: true, errors: [], warnings: [] }),
      showBrowser: jest.fn().mockResolvedValue('Browser shown'),
      takeScreenshot: jest.fn().mockResolvedValue('Screenshot saved'),
      getStatus: jest.fn().mockReturnValue({ initialized: true, playing: false }),
      getDiagnostics: jest.fn().mockResolvedValue({ browserConnected: true }),
      getConsoleErrors: jest.fn().mockReturnValue([]),
      getConsoleWarnings: jest.fn().mockReturnValue([]),
      cleanup: jest.fn().mockResolvedValue(undefined)
    } as any;

    // Wire up mocked constructors
    (StrudelController as jest.Mock).mockReturnValue(mockController);
    (PatternStore as jest.Mock).mockReturnValue({
      save: jest.fn().mockResolvedValue(undefined),
      load: jest.fn().mockResolvedValue(null),
      list: jest.fn().mockResolvedValue([])
    });
    (MusicTheory as jest.Mock).mockReturnValue({
      generateScale: jest.fn().mockReturnValue(['C', 'D', 'E', 'F', 'G', 'A', 'B']),
      generateChordProgression: jest.fn().mockReturnValue('I-V-vi-IV')
    });
    (PatternGenerator as jest.Mock).mockReturnValue({
      generateCompletePattern: jest.fn().mockReturnValue('s("bd*4")'),
      generateDrumPattern: jest.fn().mockReturnValue('s("bd*4")'),
      generateBassline: jest.fn().mockReturnValue('s("c2")'),
      generateMelody: jest.fn().mockReturnValue('note("c4")'),
      generateChords: jest.fn().mockReturnValue('chord("C")'),
      generateEuclideanPattern: jest.fn().mockReturnValue('euclid(3,8)'),
      generatePolyrhythm: jest.fn().mockReturnValue('poly'),
      generateFill: jest.fn().mockReturnValue('fill'),
      generateVariation: jest.fn().mockReturnValue('varied')
    });
    (GeminiService as jest.Mock).mockReturnValue({
      isAvailable: jest.fn().mockReturnValue(false),
      getCreativeFeedback: jest.fn().mockResolvedValue({
        complexity: 'moderate',
        estimatedStyle: 'techno',
        strengths: [],
        suggestions: []
      }),
      analyzeAudio: jest.fn().mockResolvedValue(null),
      suggestVariations: jest.fn().mockResolvedValue([]),
      clearCache: jest.fn(),
      modifyPatternWithNLP: jest.fn().mockResolvedValue('modified'),
      jamWithPattern: jest.fn().mockResolvedValue({ layer: 'drums', code: 's("bd*4")' })
    });

    server = new StrudelMCPServer();
  });

  describe('Energy Level 0 (Minimal/Ambient)', () => {
    beforeEach(async () => {
      await (server as any).executeTool('init', {});
    });

    test('should apply minimal/ambient settings at level 0', async () => {
      mockController.getCurrentPattern.mockResolvedValue('s("bd*4")');

      const result = await (server as any).executeTool('shape', { dimension: 'energy', level: 0 });

      expect(result.success).toBe(true);
      expect(result.level).toBe(0);
      expect(result.description).toBe('minimal/ambient');
    });

    test('should add slow modifier for minimal energy', async () => {
      mockController.getCurrentPattern.mockResolvedValue('s("bd*4")');

      await (server as any).executeTool('shape', { dimension: 'energy', level: 0 });

      // Should have .slow(4) for level 0
      expect(mockController.writePattern).toHaveBeenCalledWith(expect.stringContaining('.slow(4)'));
    });

    test('should add high reverb for minimal energy', async () => {
      mockController.getCurrentPattern.mockResolvedValue('s("bd*4")');

      await (server as any).executeTool('shape', { dimension: 'energy', level: 0 });

      expect(mockController.writePattern).toHaveBeenCalledWith(expect.stringContaining('.room(0.5)'));
    });
  });

  describe('Energy Level 5 (Normal)', () => {
    beforeEach(async () => {
      await (server as any).executeTool('init', {});
    });

    test('should apply normal settings at level 5', async () => {
      mockController.getCurrentPattern.mockResolvedValue('s("bd*4")');

      const result = await (server as any).executeTool('shape', { dimension: 'energy', level: 5 });

      expect(result.success).toBe(true);
      expect(result.level).toBe(5);
      expect(result.description).toBe('normal');
    });

    test('should not add density modifier at normal level', async () => {
      mockController.getCurrentPattern.mockResolvedValue('s("bd*4")');

      await (server as any).executeTool('shape', { dimension: 'energy', level: 5 });

      // Should just add room but no fast/slow
      expect(mockController.writePattern).toHaveBeenCalledWith('s("bd*4").room(0.1)');
    });
  });

  describe('Energy Level 10 (Maximum)', () => {
    beforeEach(async () => {
      await (server as any).executeTool('init', {});
    });

    test('should apply maximum settings at level 10', async () => {
      mockController.getCurrentPattern.mockResolvedValue('s("bd*4")');

      const result = await (server as any).executeTool('shape', { dimension: 'energy', level: 10 });

      expect(result.success).toBe(true);
      expect(result.level).toBe(10);
      expect(result.description).toBe('maximum');
    });

    test('should add fast(2) for maximum energy', async () => {
      mockController.getCurrentPattern.mockResolvedValue('s("bd*4")');

      await (server as any).executeTool('shape', { dimension: 'energy', level: 10 });

      expect(mockController.writePattern).toHaveBeenCalledWith(expect.stringContaining('.fast(2)'));
    });

    test('should add minimal reverb for dry/punchy sound', async () => {
      mockController.getCurrentPattern.mockResolvedValue('s("bd*4")');

      await (server as any).executeTool('shape', { dimension: 'energy', level: 10 });

      expect(mockController.writePattern).toHaveBeenCalledWith(expect.stringContaining('.room(0.01)'));
    });
  });

  describe('Validation', () => {
    beforeEach(async () => {
      await (server as any).executeTool('init', {});
    });

    test('should reject energy level below 0', async () => {
      const result = await (server as any).executeTool('shape', { dimension: 'energy', level: -1 });

      expect(result.success).toBe(false);
      expect(result.error).toContain('integer from 0 to 10');
    });

    test('should reject energy level above 10', async () => {
      const result = await (server as any).executeTool('shape', { dimension: 'energy', level: 11 });

      expect(result.success).toBe(false);
      expect(result.error).toContain('integer from 0 to 10');
    });

    test('should reject non-integer energy level', async () => {
      const result = await (server as any).executeTool('shape', { dimension: 'energy', level: 5.5 });

      expect(result.success).toBe(false);
      expect(result.error).toContain('integer');
    });

    test('should accept all valid levels 0-10', async () => {
      mockController.getCurrentPattern.mockResolvedValue('s("bd*4")');

      for (let level = 0; level <= 10; level++) {
        const result = await (server as any).executeTool('shape', { dimension: 'energy', level });
        expect(result.success).toBe(true);
        expect(result.level).toBe(level);
      }
    });
  });

  describe('Error Cases', () => {
    beforeEach(async () => {
      await (server as any).executeTool('init', {});
    });

    test('should return error for empty pattern', async () => {
      mockController.getCurrentPattern.mockResolvedValue('');

      const result = await (server as any).executeTool('shape', { dimension: 'energy', level: 5 });

      expect(result.success).toBe(false);
      expect(result.error).toContain('No pattern');
    });

    test('should return error for whitespace-only pattern', async () => {
      mockController.getCurrentPattern.mockResolvedValue('   \n\t  ');

      const result = await (server as any).executeTool('shape', { dimension: 'energy', level: 5 });

      expect(result.success).toBe(false);
      expect(result.error).toContain('No pattern');
    });
  });

  describe('Auto-play Behavior', () => {
    beforeEach(async () => {
      await (server as any).executeTool('init', {});
    });

    test('should auto-play after setting energy when initialized', async () => {
      mockController.getCurrentPattern.mockResolvedValue('s("bd*4")');

      await (server as any).executeTool('shape', { dimension: 'energy', level: 7 });

      expect(mockController.play).toHaveBeenCalled();
    });
  });

  describe('Energy Level Descriptions', () => {
    beforeEach(async () => {
      await (server as any).executeTool('init', {});
    });

    const levelDescriptions: Record<number, string> = {
      0: 'minimal/ambient',
      1: 'very sparse',
      2: 'sparse',
      3: 'light',
      4: 'relaxed',
      5: 'normal',
      6: 'moderate',
      7: 'driving',
      8: 'intense',
      9: 'very intense',
      10: 'maximum'
    };

    test('should return correct description for each energy level', async () => {
      mockController.getCurrentPattern.mockResolvedValue('s("bd*4")');

      for (const [level, description] of Object.entries(levelDescriptions)) {
        const result = await (server as any).executeTool('shape', { dimension: 'energy', level: parseInt(level) });
        expect(result.description).toBe(description);
      }
    });
  });
});

describe('Tool Definitions', () => {
  // refine and set_energy were consolidated into shape({ dimension }) (#178).
  test('shape tool should be registered in server tools list', () => {
    const server = new StrudelMCPServer();
    const tools = (server as any).getTools();

    const shapeTool = tools.find((t: any) => t.name === 'shape');

    expect(shapeTool).toBeDefined();
    expect(shapeTool.description).toContain('refine');
    expect(shapeTool.description).toContain('energy');
    expect(shapeTool.inputSchema.required).toContain('dimension');
  });

  test('shape tool should expose refine and energy dimensions', () => {
    const server = new StrudelMCPServer();
    const tools = (server as any).getTools();

    const shapeTool = tools.find((t: any) => t.name === 'shape');
    const schema = shapeTool.inputSchema;

    expect(schema.type).toBe('object');
    expect(schema.properties).toHaveProperty('dimension');
    expect(schema.properties.dimension.enum).toContain('refine');
    expect(schema.properties.dimension.enum).toContain('energy');
    expect(schema.properties).toHaveProperty('direction');
    expect(schema.properties.direction.type).toBe('string');
    expect(schema.properties).toHaveProperty('level');
    expect(schema.properties.level.type).toBe('number');
  });
});
