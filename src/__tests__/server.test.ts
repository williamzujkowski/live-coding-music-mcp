/**
 * Core Tests for StrudelMCPServer
 *
 * Tests tool execution paths, state management, and error handling
 * to increase coverage from 35% to 70%+
 */

import { StrudelMCPServer } from '../server/server';
import { StrudelController } from '../StrudelController';
import { PatternStore } from '../PatternStore';
import { MusicTheory } from '../services/MusicTheory';
import { PatternGenerator } from '../services/PatternGenerator';
import { GeminiService } from '../services/GeminiService';
import { AudioCaptureService } from '../services/AudioCaptureService';
import { SessionManager } from '../services/SessionManager';

// Mock all dependencies
jest.mock('../StrudelController');
jest.mock('../PatternStore');
jest.mock('../services/MusicTheory');
jest.mock('../services/PatternGenerator');
jest.mock('../services/GeminiService');
jest.mock('../services/AudioCaptureService');
jest.mock('../services/SessionManager');
jest.mock('../services/StrudelEngine');
jest.mock('fs', () => ({
  readFileSync: jest.fn().mockReturnValue('{"headless": true}'),
  existsSync: jest.fn().mockReturnValue(true)
}));

describe('StrudelMCPServer', () => {
  let server: StrudelMCPServer;
  let mockController: jest.Mocked<StrudelController>;
  let mockStore: jest.Mocked<PatternStore>;
  let mockTheory: jest.Mocked<MusicTheory>;
  let mockGenerator: jest.Mocked<PatternGenerator>;
  let mockGeminiService: jest.Mocked<GeminiService>;
  let mockSessionManager: jest.Mocked<SessionManager>;

  beforeEach(() => {
    // Setup mocks
    mockController = {
      initialize: jest.fn().mockResolvedValue('Strudel initialized'),
      getCurrentPattern: jest.fn().mockResolvedValue('s("bd*4")'),
      writePattern: jest.fn().mockResolvedValue('Pattern written: 7 chars'),
      play: jest.fn().mockResolvedValue('Playing'),
      stop: jest.fn().mockResolvedValue('Stopped'),
      analyzeAudio: jest.fn().mockResolvedValue({
        connected: true,
        features: {
          bass: 0.5,
          mid: 0.5,
          treble: 0.5,
          isPlaying: true,
          isSilent: false
        }
      }),
      detectKey: jest.fn().mockResolvedValue({
        key: 'C',
        scale: 'major',
        confidence: 0.85,
        alternatives: []
      }),
      detectTempo: jest.fn().mockResolvedValue({
        bpm: 120,
        confidence: 0.85,
        method: 'autocorrelation'
      }),
      analyzeRhythm: jest.fn().mockResolvedValue({
        pattern: 'four-on-the-floor',
        complexity: 0.3,
        density: 4,
        syncopation: 0.1,
        onsets: [0, 0.25, 0.5, 0.75],
        isRegular: true
      }),
      analyzer: {
        detectTempo: jest.fn().mockResolvedValue({
          bpm: 120,
          confidence: 0.85,
          method: 'autocorrelation'
        })
      },
      validatePatternRuntime: jest.fn().mockResolvedValue({
        valid: true,
        errors: [],
        warnings: []
      }),
      validatePattern: jest.fn().mockResolvedValue({
        valid: true,
        errors: [],
        warnings: [],
        suggestions: []
      }),
      showBrowser: jest.fn().mockResolvedValue('Browser window brought to foreground'),
      takeScreenshot: jest.fn().mockResolvedValue('Screenshot saved to strudel-screenshot.png'),
      getStatus: jest.fn().mockReturnValue({
        initialized: true,
        playing: false,
        patternLength: 10,
        cacheValid: true,
        errorCount: 0,
        warningCount: 0
      }),
      getDiagnostics: jest.fn().mockResolvedValue({
        browserConnected: true,
        pageLoaded: true,
        editorReady: true,
        audioConnected: false,
        cacheStatus: { hasCache: true, cacheAge: 100 },
        errorStats: {}
      }),
      getConsoleErrors: jest.fn().mockReturnValue([]),
      getConsoleWarnings: jest.fn().mockReturnValue([]),
      page: {}
    } as any;

    mockStore = {
      save: jest.fn().mockResolvedValue(undefined),
      load: jest.fn().mockResolvedValue({
        name: 'test-pattern',
        content: 's("bd cp")',
        tags: ['test'],
        timestamp: new Date().toISOString()
      }),
      list: jest.fn().mockResolvedValue([
        {
          name: 'pattern1',
          tags: ['techno'],
          timestamp: new Date().toISOString()
        }
      ])
    } as any;

    mockTheory = {
      generateScale: jest.fn().mockReturnValue(['C', 'D', 'E', 'F', 'G', 'A', 'B']),
      generateChordProgression: jest.fn().mockReturnValue('I-V-vi-IV'),
      getNote: jest.fn().mockImplementation((key: string, semitones: number) => {
        const notes = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
        const rootIndex = notes.indexOf(key.toUpperCase());
        const targetIndex = (rootIndex + semitones + 12) % 12;
        return notes[targetIndex];
      })
    } as any;

    mockGenerator = {
      generateCompletePattern: jest.fn().mockReturnValue('s("bd*4 cp*2")'),
      generateDrumPattern: jest.fn().mockReturnValue('s("bd*4")'),
      generateBassline: jest.fn().mockReturnValue('s("c2 e2 g2")'),
      generateMelody: jest.fn().mockReturnValue('note("c4 d4 e4")'),
      generateChords: jest.fn().mockReturnValue('s("C Em Am F")'),
      generateEuclideanPattern: jest.fn().mockReturnValue('s("bd").euclidean(3, 8)'),
      generatePolyrhythm: jest.fn().mockReturnValue('s("bd").euclidean(3, 8)'),
      generateFill: jest.fn().mockReturnValue('s("bd*16")'),
      generateVariation: jest.fn().mockReturnValue('s("bd*4 cp*2").fast(2)')
    } as any;

    mockGeminiService = {
      isAvailable: jest.fn().mockReturnValue(false),
      getCreativeFeedback: jest.fn().mockResolvedValue({
        complexity: 'moderate',
        estimatedStyle: 'techno',
        strengths: ['Good rhythm', 'Interesting sounds'],
        suggestions: ['Add reverb', 'Try variation']
      }),
      analyzeAudio: jest.fn().mockResolvedValue({
        mood: 'energetic',
        style: 'techno',
        energy: 'high',
        suggestions: ['Great energy'],
        confidence: 0.85
      }),
      suggestVariations: jest.fn().mockResolvedValue([]),
      clearCache: jest.fn()
    } as any;

    mockSessionManager = {
      createSession: jest.fn().mockResolvedValue(mockController),
      destroySession: jest.fn().mockResolvedValue(undefined),
      getSession: jest.fn().mockReturnValue(undefined),
      getDefaultSession: jest.fn().mockReturnValue(undefined),
      setDefaultSession: jest.fn(),
      listSessions: jest.fn().mockReturnValue([]),
      getSessionsInfo: jest.fn().mockReturnValue([]),
      getDefaultSessionId: jest.fn().mockReturnValue('default'),
      getSessionCount: jest.fn().mockReturnValue(0),
      getMaxSessions: jest.fn().mockReturnValue(5),
      destroyAll: jest.fn().mockResolvedValue(undefined),
      isBrowserRunning: jest.fn().mockReturnValue(false)
    } as any;

    // Mock constructors
    (StrudelController as jest.Mock).mockReturnValue(mockController);
    (PatternStore as jest.Mock).mockReturnValue(mockStore);
    (MusicTheory as jest.Mock).mockReturnValue(mockTheory);
    (PatternGenerator as jest.Mock).mockReturnValue(mockGenerator);
    (GeminiService as jest.Mock).mockReturnValue(mockGeminiService);
    (SessionManager as jest.Mock).mockReturnValue(mockSessionManager);

    server = new StrudelMCPServer();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Core Control Tools', () => {
    describe('init', () => {
      test('should initialize controller', async () => {
        const result = await (server as any).executeTool('init', {});

        expect(mockController.initialize).toHaveBeenCalled();
        expect(result).toContain('initialized');
      });

    });

    describe('edit_pattern write', () => {
      beforeEach(async () => {
        await (server as any).executeTool('init', {});
      });

      test('should write pattern', async () => {
        const result = await (server as any).executeTool('edit_pattern', { mode: 'write', pattern: 's("bd*4")' });

        expect(mockController.writePattern).toHaveBeenCalledWith('s("bd*4")');
        expect(result).toContain('Pattern written');
      });

      test('should validate pattern length', async () => {
        const longPattern = 'a'.repeat(10001);

        await expect(
          (server as any).executeTool('edit_pattern', { mode: 'write', pattern: longPattern })
        ).rejects.toThrow('pattern too long');
      });

      test('should save to undo stack', async () => {
        await (server as any).executeTool('edit_pattern', { mode: 'write', pattern: 's("bd*4")' });

        const undoResult = await (server as any).executeTool('history', { action: 'undo' });
        expect(undoResult).toBe('Undone');
      });

      test('should require initialization for write', async () => {
        const uninitServer = new StrudelMCPServer();
        const result = await (uninitServer as any).executeTool('edit_pattern', { mode: 'write', pattern: 's("bd*4")' });

        expect(result).toContain('not initialized');
      });
    });

    describe('edit_pattern append', () => {
      beforeEach(async () => {
        await (server as any).executeTool('init', {});
      });

      test('should append to current pattern', async () => {
        mockController.getCurrentPattern.mockResolvedValue('s("bd*4")');

        await (server as any).executeTool('edit_pattern', { mode: 'append', code: 's("cp*2")' });

        expect(mockController.writePattern).toHaveBeenCalledWith('s("bd*4")\ns("cp*2")');
      });

      test('should validate code length', async () => {
        const longCode = 'a'.repeat(10001);

        await expect(
          (server as any).executeTool('edit_pattern', { mode: 'append', code: longCode })
        ).rejects.toThrow('code too long');
      });
    });

    describe('edit_pattern insert', () => {
      beforeEach(async () => {
        await (server as any).executeTool('init', {});
      });

      test('should insert at specific line', async () => {
        mockController.getCurrentPattern.mockResolvedValue('line1\nline3');

        await (server as any).executeTool('edit_pattern', { mode: 'insert', position: 1, code: 'line2' });

        expect(mockController.writePattern).toHaveBeenCalledWith('line1\nline2\nline3');
      });

      test('should validate position is positive integer', async () => {
        await expect(
          (server as any).executeTool('edit_pattern', { mode: 'insert', position: -1, code: 'test' })
        ).rejects.toThrow();
      });

      test('should validate position is integer', async () => {
        await expect(
          (server as any).executeTool('edit_pattern', { mode: 'insert', position: 1.5, code: 'test' })
        ).rejects.toThrow('integer');
      });
    });

    describe('edit_pattern replace', () => {
      beforeEach(async () => {
        await (server as any).executeTool('init', {});
      });

      test('should replace text in pattern', async () => {
        mockController.getCurrentPattern.mockResolvedValue('s("bd*4")');

        await (server as any).executeTool('edit_pattern', { mode: 'replace', search: 'bd', replace: 'cp' });

        expect(mockController.writePattern).toHaveBeenCalledWith('s("cp*4")');
      });

      test('should validate search string', async () => {
        const longSearch = 'a'.repeat(1001);

        await expect(
          (server as any).executeTool('edit_pattern', { mode: 'replace', search: longSearch, replace: 'test' })
        ).rejects.toThrow();
      });
    });

    describe('playback play/pause/stop', () => {
      beforeEach(async () => {
        await (server as any).executeTool('init', {});
      });

      test('should start playback', async () => {
        const result = await (server as any).executeTool('playback', { action: 'play' });

        expect(mockController.play).toHaveBeenCalled();
        expect(result).toBe('Playing');
      });

      test('should stop playback with stop', async () => {
        const result = await (server as any).executeTool('playback', { action: 'stop' });

        expect(mockController.stop).toHaveBeenCalled();
        expect(result).toBe('Stopped');
      });

      test('should stop playback with pause', async () => {
        const result = await (server as any).executeTool('playback', { action: 'pause' });

        expect(mockController.stop).toHaveBeenCalled();
        expect(result).toBe('Stopped');
      });
    });

    describe('edit_pattern clear', () => {
      beforeEach(async () => {
        await (server as any).executeTool('init', {});
      });

      test('should clear editor', async () => {
        await (server as any).executeTool('edit_pattern', { mode: 'clear' });

        expect(mockController.writePattern).toHaveBeenCalledWith('');
      });
    });

    describe('get_pattern', () => {
      beforeEach(async () => {
        await (server as any).executeTool('init', {});
      });

      test('should get current pattern', async () => {
        mockController.getCurrentPattern.mockResolvedValue('s("bd*4")');

        const result = await (server as any).executeTool('get_pattern', {});

        expect(result).toBe('s("bd*4")');
      });
    });
  });

  describe('Pattern Generation Tools', () => {
    describe('compose', () => {
      test('should generate pattern with auto-init', async () => {
        const result = await (server as any).executeTool('compose', {
          style: 'techno'
        });

        expect(mockGenerator.generateCompletePattern).toHaveBeenCalledWith('techno', 'C', 130);
        expect(result.success).toBe(true);
        expect(result.metadata.style).toBe('techno');
      });

      test('should validate style', async () => {
        await expect(
          (server as any).executeTool('compose', { style: '' })
        ).rejects.toThrow('cannot be empty');
      });

      test('should validate BPM when provided', async () => {
        await expect(
          (server as any).executeTool('compose', { style: 'techno', tempo: 500 })
        ).rejects.toThrow('BPM');
      });

      test('should validate key when provided', async () => {
        await expect(
          (server as any).executeTool('compose', { style: 'techno', key: 'X' })
        ).rejects.toThrow('Invalid root note');
      });

      test('should use default values', async () => {
        await (server as any).executeTool('compose', { style: 'house' });

        expect(mockGenerator.generateCompletePattern).toHaveBeenCalledWith('house', 'C', 125);
      });
    });

    describe('generate_part drums', () => {
      test('should generate drums', async () => {
        await (server as any).executeTool('generate_part', { role: 'drums', style: 'techno' });

        expect(mockGenerator.generateDrumPattern).toHaveBeenCalledWith('techno', 0.5);
      });

      test('should validate complexity range', async () => {
        await expect(
          (server as any).executeTool('generate_part', { role: 'drums', style: 'techno', complexity: 1.5 })
        ).rejects.toThrow('between 0 and 1');
      });

      test('should use provided complexity', async () => {
        await (server as any).executeTool('generate_part', {
          role: 'drums',
          style: 'techno',
          complexity: 0.8
        });

        expect(mockGenerator.generateDrumPattern).toHaveBeenCalledWith('techno', 0.8);
      });
    });

    describe('generate_part bass', () => {
      test('should generate bassline', async () => {
        const result = await (server as any).executeTool('generate_part', {
          role: 'bass',
          key: 'C',
          style: 'acid'
        });

        expect(mockGenerator.generateBassline).toHaveBeenCalledWith('C', 'acid');
        expect(result).toContain('Generated acid bassline in C');
      });

      test('should validate key', async () => {
        await expect(
          (server as any).executeTool('generate_part', { role: 'bass', key: 'X', style: 'acid' })
        ).rejects.toThrow('Invalid root note');
      });
    });

    describe('generate_part melody', () => {
      test('should generate melody', async () => {
        await (server as any).executeTool('generate_part', {
          role: 'melody',
          root: 'C',
          scale: 'major',
          length: 16
        });

        expect(mockTheory.generateScale).toHaveBeenCalledWith('C', 'major');
        expect(mockGenerator.generateMelody).toHaveBeenCalledWith(
          ['C', 'D', 'E', 'F', 'G', 'A', 'B'],
          16
        );
      });

      test('should use default length', async () => {
        await (server as any).executeTool('generate_part', {
          role: 'melody',
          root: 'D',
          scale: 'minor'
        });

        expect(mockGenerator.generateMelody).toHaveBeenCalledWith(expect.any(Array), 8);
      });

      test('should validate length is positive', async () => {
        await expect(
          (server as any).executeTool('generate_part', {
            role: 'melody',
            root: 'C',
            scale: 'major',
            length: 0
          })
        ).rejects.toThrow('positive');
      });
    });

    describe('music_theory scale', () => {
      test('should return scale notes', async () => {
        const result = await (server as any).executeTool('music_theory', {
          query: 'scale',
          root: 'C',
          scale: 'major'
        });

        expect(result).toContain('C major scale');
        expect(result).toContain('C, D, E, F, G, A, B');
      });

      test('should validate scale name', async () => {
        await expect(
          (server as any).executeTool('music_theory', { query: 'scale', root: 'C', scale: 'invalid' })
        ).rejects.toThrow('Invalid scale name');
      });
    });

    describe('music_theory chord_progression', () => {
      test('should generate chord progression', async () => {
        const result = await (server as any).executeTool('music_theory', {
          query: 'chord_progression',
          key: 'C',
          style: 'pop'
        });

        expect(mockTheory.generateChordProgression).toHaveBeenCalledWith('C', 'pop');
        expect(result).toContain('Generated pop progression in C');
      });

      test('should validate chord style', async () => {
        await expect(
          (server as any).executeTool('music_theory', {
            query: 'chord_progression',
            key: 'C',
            style: 'invalid'
          })
        ).rejects.toThrow('Invalid chord style');
      });
    });

    describe('generate_rhythm euclidean', () => {
      test('should generate euclidean pattern', async () => {
        const result = await (server as any).executeTool('generate_rhythm', {
          type: 'euclidean',
          hits: 3,
          steps: 8,
          sound: 'bd'
        });

        expect(mockGenerator.generateEuclideanPattern).toHaveBeenCalledWith(3, 8, 'bd');
        expect(result).toContain('Euclidean rhythm (3/8)');
      });

      test('should use default sound', async () => {
        await (server as any).executeTool('generate_rhythm', { type: 'euclidean', hits: 5, steps: 16 });

        expect(mockGenerator.generateEuclideanPattern).toHaveBeenCalledWith(5, 16, 'bd');
      });

      test('should validate hits <= steps', async () => {
        await expect(
          (server as any).executeTool('generate_rhythm', { type: 'euclidean', hits: 10, steps: 8 })
        ).rejects.toThrow('cannot exceed steps');
      });
    });

    describe('generate_rhythm polyrhythm', () => {
      test('should generate polyrhythm', async () => {
        await (server as any).executeTool('generate_rhythm', {
          type: 'polyrhythm',
          sounds: ['bd', 'cp', 'hh'],
          patterns: [3, 5, 7]
        });

        expect(mockGenerator.generatePolyrhythm).toHaveBeenCalledWith(
          ['bd', 'cp', 'hh'],
          [3, 5, 7]
        );
      });

      test('should validate pattern numbers are positive', async () => {
        await expect(
          (server as any).executeTool('generate_rhythm', {
            type: 'polyrhythm',
            sounds: ['bd'],
            patterns: [0]
          })
        ).rejects.toThrow('positive');
      });
    });

    describe('generate_part fill', () => {
      test('should generate fill', async () => {
        const result = await (server as any).executeTool('generate_part', {
          role: 'fill',
          style: 'techno',
          bars: 2
        });

        expect(mockGenerator.generateFill).toHaveBeenCalledWith('techno', 2);
        expect(result).toContain('2 bar fill');
      });

      test('should use default bars', async () => {
        await (server as any).executeTool('generate_part', { role: 'fill', style: 'house' });

        expect(mockGenerator.generateFill).toHaveBeenCalledWith('house', 1);
      });
    });
  });

  describe('Pattern Manipulation Tools', () => {
    beforeEach(async () => {
      await (server as any).executeTool('init', {});
    });

    describe('transform transpose', () => {
      test('should transpose pattern', async () => {
        mockController.getCurrentPattern.mockResolvedValue('note("c4 d4 e4")');

        const result = await (server as any).executeTool('transform', { op: 'transpose', semitones: 5 });

        expect(result).toContain('Transposed 5 semitones');
      });

      test('should accept negative semitones', async () => {
        const result = await (server as any).executeTool('transform', { op: 'transpose', semitones: -3 });

        expect(result).toContain('Transposed -3 semitones');
      });

      test('should validate semitones is integer', async () => {
        await expect(
          (server as any).executeTool('transform', { op: 'transpose', semitones: 2.5 })
        ).rejects.toThrow('integer');
      });
    });

    describe('transform reverse', () => {
      test('should add reverse modifier', async () => {
        mockController.getCurrentPattern.mockResolvedValue('s("bd*4")');

        await (server as any).executeTool('transform', { op: 'reverse' });

        expect(mockController.writePattern).toHaveBeenCalledWith('s("bd*4").rev');
      });
    });

    describe('transform stretch', () => {
      test('should add slow modifier', async () => {
        mockController.getCurrentPattern.mockResolvedValue('s("bd*4")');

        await (server as any).executeTool('transform', { op: 'stretch', factor: 2 });

        expect(mockController.writePattern).toHaveBeenCalledWith('s("bd*4").slow(2)');
      });

      test('should validate factor is positive', async () => {
        await expect(
          (server as any).executeTool('transform', { op: 'stretch', factor: -1 })
        ).rejects.toThrow();
      });
    });

    describe('transform humanize', () => {
      test('should add humanize effect', async () => {
        mockController.getCurrentPattern.mockResolvedValue('s("bd*4")');

        const result = await (server as any).executeTool('transform', { op: 'humanize', amount: 0.05 });

        expect(mockController.writePattern).toHaveBeenCalled();
        expect(result).toBe('Added human timing');
      });

      test('should use default amount', async () => {
        const result = await (server as any).executeTool('transform', { op: 'humanize' });

        expect(result).toBe('Added human timing');
      });
    });

    describe('transform vary', () => {
      test('should generate variation', async () => {
        mockController.getCurrentPattern.mockResolvedValue('s("bd*4")');

        const result = await (server as any).executeTool('transform', {
          op: 'vary',
          type: 'extreme'
        });

        expect(mockGenerator.generateVariation).toHaveBeenCalledWith('s("bd*4")', 'extreme');
        expect(result).toContain('extreme variation');
      });

      test('should use default type', async () => {
        await (server as any).executeTool('transform', { op: 'vary' });

        expect(mockGenerator.generateVariation).toHaveBeenCalledWith(expect.any(String), 'subtle');
      });
    });
  });

  describe('Effects and Tempo Tools', () => {
    beforeEach(async () => {
      await (server as any).executeTool('init', {});
    });

    describe('effect add', () => {
      test('should add effect with params', async () => {
        mockController.getCurrentPattern.mockResolvedValue('s("bd*4")');

        const result = await (server as any).executeTool('effect', {
          action: 'add',
          effect: 'reverb',
          params: '0.5'
        });

        expect(mockController.writePattern).toHaveBeenCalledWith('s("bd*4").reverb(0.5)');
        expect(result).toContain('Added reverb effect');
      });

      test('should add effect without params', async () => {
        mockController.getCurrentPattern.mockResolvedValue('s("bd*4")');

        await (server as any).executeTool('effect', { action: 'add', effect: 'distortion' });

        expect(mockController.writePattern).toHaveBeenCalledWith('s("bd*4").distortion()');
      });
    });

    describe('transform swing', () => {
      test('should add swing', async () => {
        mockController.getCurrentPattern.mockResolvedValue('s("bd*4")');

        const result = await (server as any).executeTool('transform', { op: 'swing', amount: 0.6 });

        expect(mockController.writePattern).toHaveBeenCalledWith('s("bd*4").swing(0.6)');
        expect(result).toContain('Added swing: 0.6');
      });

      test('should validate amount range', async () => {
        await expect(
          (server as any).executeTool('transform', { op: 'swing', amount: 1.5 })
        ).rejects.toThrow('between 0 and 1');
      });
    });

    describe('set_tempo', () => {
      test('should set tempo', async () => {
        mockController.getCurrentPattern.mockResolvedValue('s("bd*4")');

        const result = await (server as any).executeTool('set_tempo', { bpm: 140 });

        expect(mockController.writePattern).toHaveBeenCalledWith('setcpm(140)\ns("bd*4")');
        expect(result).toContain('Set tempo to 140 BPM');
      });

      test('should validate BPM range', async () => {
        await expect(
          (server as any).executeTool('set_tempo', { bpm: 500 })
        ).rejects.toThrow('BPM must be between');
      });
    });
  });

  describe('Audio Analysis Tools', () => {
    beforeEach(async () => {
      await (server as any).executeTool('init', {});
    });

    describe('analyze', () => {
      test('should analyze audio', async () => {
        const result = await (server as any).executeTool('analyze', {});

        expect(mockController.analyzeAudio).toHaveBeenCalled();
        expect(result.connected).toBe(true);
      });

      test('should require initialization', async () => {
        const uninitServer = new StrudelMCPServer();
        const result = await (uninitServer as any).executeTool('analyze', {});

        expect(result).toContain('not initialized');
      });
    });

    describe('analyze spectrum', () => {
      test('should return spectrum features', async () => {
        const result = await (server as any).executeTool('analyze', { include: ['spectrum'] });

        expect(result.spectrum).toHaveProperty('bass');
        expect(result.spectrum).toHaveProperty('mid');
        expect(result.spectrum).toHaveProperty('treble');
      });
    });

    describe('analyze rhythm', () => {
      test('should return rhythm analysis', async () => {
        const result = await (server as any).executeTool('analyze', { include: ['rhythm'] });

        expect(result.rhythm).toHaveProperty('complexity');
        expect(result.rhythm).toHaveProperty('density');
        expect(result.rhythm).toHaveProperty('syncopation');
        expect(result.rhythm).toHaveProperty('onsets');
        expect(result.rhythm).toHaveProperty('isRegular');
      });
    });

    describe('analyze tempo', () => {
      test('should detect tempo successfully', async () => {
        const result = await (server as any).executeTool('analyze', { include: ['tempo'] });

        expect(result.tempo.bpm).toBe(120);
        expect(result.tempo.confidence).toBe(0.85);
        expect(result.tempo.method).toBe('autocorrelation');
        expect(result.tempo.message).toContain('120 BPM');
      });

      test('should handle no tempo detected', async () => {
        mockController.detectTempo.mockResolvedValue({ bpm: 0, confidence: 0 });

        const result = await (server as any).executeTool('analyze', { include: ['tempo'] });

        expect(result.tempo.bpm).toBe(0);
        expect(result.tempo.message).toContain('No tempo detected');
      });

      test('should handle null tempo result', async () => {
        mockController.detectTempo.mockResolvedValue(null);

        const result = await (server as any).executeTool('analyze', { include: ['tempo'] });

        expect(result.tempo.bpm).toBe(0);
        expect(result.tempo.message).toContain('No tempo detected');
      });

      test('should handle detection error', async () => {
        mockController.detectTempo.mockRejectedValue(new Error('Detection failed'));

        const result = await (server as any).executeTool('analyze', { include: ['tempo'] });

        expect(result.tempo.bpm).toBe(0);
        expect(result.tempo.error).toContain('Detection failed');
      });

      test('should require initialization', async () => {
        const uninitServer = new StrudelMCPServer();
        const result = await (uninitServer as any).executeTool('analyze', { include: ['tempo'] });

        expect(result).toContain('not initialized');
      });
    });

    describe('analyze key', () => {
      test('should detect key successfully', async () => {
        const result = await (server as any).executeTool('analyze', { include: ['key'] });

        expect(result.key.key).toBe('C');
        expect(result.key.scale).toBe('major');
        expect(result.key.confidence).toBe(0.85);
      });

      test('should handle no key detected', async () => {
        mockController.detectKey.mockResolvedValue({ key: 'Unknown', scale: 'unknown', confidence: 0.05 });

        const result = await (server as any).executeTool('analyze', { include: ['key'] });

        expect(result.key.key).toBe('Unknown');
        expect(result.key.message).toContain('No clear key detected');
      });

      test('should handle detection error', async () => {
        mockController.detectKey.mockRejectedValue(new Error('Key detection failed'));

        const result = await (server as any).executeTool('analyze', { include: ['key'] });

        expect(result.key.key).toBe('Unknown');
        expect(result.key.error).toContain('Key detection failed');
      });

      test('should include alternatives when available', async () => {
        mockController.detectKey.mockResolvedValue({
          key: 'C',
          scale: 'major',
          confidence: 0.75,
          alternatives: [{ key: 'A', scale: 'minor', confidence: 0.65 }]
        });

        const result = await (server as any).executeTool('analyze', { include: ['key'] });

        expect(result.key.alternatives).toBeDefined();
        expect(result.key.alternatives[0].key).toBe('A');
      });

      test('should require initialization', async () => {
        const uninitServer = new StrudelMCPServer();
        const result = await (uninitServer as any).executeTool('analyze', { include: ['key'] });

        expect(result).toContain('not initialized');
      });
    });
  });

  describe('Session Management Tools', () => {
    beforeEach(async () => {
      await (server as any).executeTool('init', {});
    });

    describe('pattern_store save', () => {
      test('should save pattern', async () => {
        mockController.getCurrentPattern.mockResolvedValue('s("bd*4")');

        const result = await (server as any).executeTool('pattern_store', {
          action: 'save',
          name: 'my-pattern',
          tags: ['techno', 'drums']
        });

        expect(mockStore.save).toHaveBeenCalledWith(
          'my-pattern',
          's("bd*4")',
          ['techno', 'drums']
        );
        expect(result).toContain('Pattern saved as "my-pattern"');
      });

      test('should handle empty pattern', async () => {
        mockController.getCurrentPattern.mockResolvedValue('');

        const result = await (server as any).executeTool('pattern_store', { action: 'save', name: 'test' });

        expect(result).toBe('No pattern to save');
      });

      test('should validate name length', async () => {
        const longName = 'a'.repeat(256);

        await expect(
          (server as any).executeTool('pattern_store', { action: 'save', name: longName })
        ).rejects.toThrow();
      });
    });

    describe('pattern_store load', () => {
      test('should load pattern', async () => {
        const result = await (server as any).executeTool('pattern_store', { action: 'load', name: 'test-pattern' });

        expect(mockStore.load).toHaveBeenCalledWith('test-pattern');
        expect(mockController.writePattern).toHaveBeenCalledWith('s("bd cp")');
        expect(result).toContain('Loaded pattern "test-pattern"');
      });

      test('should handle pattern not found', async () => {
        mockStore.load.mockResolvedValue(null);

        const result = await (server as any).executeTool('pattern_store', { action: 'load', name: 'nonexistent' });

        expect(result).toContain('not found');
      });
    });

    describe('pattern_store list', () => {
      test('should list patterns', async () => {
        const result = await (server as any).executeTool('pattern_store', { action: 'list' });

        expect(mockStore.list).toHaveBeenCalledWith(undefined);
        expect(result).toContain('pattern1');
      });

      test('should filter by tag', async () => {
        await (server as any).executeTool('pattern_store', { action: 'list', tag: 'techno' });

        expect(mockStore.list).toHaveBeenCalledWith('techno');
      });

      test('should handle empty list', async () => {
        mockStore.list.mockResolvedValue([]);

        const result = await (server as any).executeTool('pattern_store', { action: 'list' });

        expect(result).toContain('No patterns found');
      });
    });

    describe('history undo', () => {
      test('should undo changes', async () => {
        // First make a change
        await (server as any).executeTool('edit_pattern', { mode: 'write', pattern: 's("bd*4")' });
        mockController.getCurrentPattern.mockResolvedValue('s("bd*4")');

        const result = await (server as any).executeTool('history', { action: 'undo' });

        expect(result).toBe('Undone');
      });

      test('should handle empty undo stack', async () => {
        const result = await (server as any).executeTool('history', { action: 'undo' });

        expect(result).toBe('Nothing to undo');
      });

      test('should require initialization', async () => {
        const uninitServer = new StrudelMCPServer();
        const result = await (uninitServer as any).executeTool('history', { action: 'undo' });

        expect(result).toContain('not initialized');
      });
    });

    describe('history redo', () => {
      test('should redo changes', async () => {
        // Setup: write, undo, then redo
        await (server as any).executeTool('edit_pattern', { mode: 'write', pattern: 's("bd*4")' });
        await (server as any).executeTool('history', { action: 'undo' });

        const result = await (server as any).executeTool('history', { action: 'redo' });

        expect(result).toBe('Redone');
      });

      test('should handle empty redo stack', async () => {
        const result = await (server as any).executeTool('history', { action: 'redo' });

        expect(result).toBe('Nothing to redo');
      });
    });
  });

  describe('Performance Monitoring Tools', () => {
    describe('diagnostics perf', () => {
      test('should return performance report', async () => {
        const result = await (server as any).executeTool('diagnostics', { level: 'perf' });

        expect(result).toContain('Bottlenecks');
      });
    });

    describe('diagnostics memory', () => {
      test('should return memory usage', async () => {
        const result = await (server as any).executeTool('diagnostics', { level: 'memory' });

        // Result depends on PerformanceMonitor implementation
        expect(result).toBeDefined();
      });
    });
  });

  describe('Pattern Validation', () => {
    beforeEach(async () => {
      await (server as any).executeTool('init', {});
    });

    test('should validate valid pattern', async () => {
      const result = await (server as any).executeTool('validate_pattern_runtime', {
        pattern: 's("bd*4")',
        waitMs: 500
      });

      expect(result).toContain('Pattern valid');
      expect(mockController.validatePatternRuntime).toHaveBeenCalledWith('s("bd*4")', 500);
    });

    test('should detect invalid pattern', async () => {
      mockController.validatePatternRuntime.mockResolvedValue({
        valid: false,
        errors: ['Syntax error'],
        warnings: ['Missing semicolon']
      });

      const result = await (server as any).executeTool('validate_pattern_runtime', {
        pattern: 's("bd*4)'
      });

      expect(result).toContain('runtime errors');
      expect(result).toContain('Syntax error');
    });

    test('should use default waitMs', async () => {
      await (server as any).executeTool('validate_pattern_runtime', {
        pattern: 's("bd*4")'
      });

      expect(mockController.validatePatternRuntime).toHaveBeenCalledWith('s("bd*4")', 500);
    });

    test('should require initialization', async () => {
      const uninitServer = new StrudelMCPServer();
      const result = await (uninitServer as any).executeTool('validate_pattern_runtime', {
        pattern: 's("bd*4")'
      });

      expect(result).toContain('not initialized');
    });
  });

  describe('Error Handling', () => {
    test('should handle unknown tool', async () => {
      await expect(
        (server as any).executeTool('unknown_tool', {})
      ).rejects.toThrow('Unknown tool');
    });

    test('should require initialization for browser tools', async () => {
      const uninitServer = new StrudelMCPServer();

      const result = await (uninitServer as any).executeTool('playback', { action: 'play' });

      expect(result).toContain('not initialized');
    });

    test('should handle controller errors gracefully', async () => {
      await (server as any).executeTool('init', {});
      mockController.play.mockRejectedValue(new Error('Playback failed'));

      await expect(
        (server as any).executeTool('playback', { action: 'play' })
      ).rejects.toThrow('Playback failed');
    });
  });

  describe('State Management', () => {
    beforeEach(async () => {
      await (server as any).executeTool('init', {});
    });

    test('should maintain undo/redo stack', async () => {
      // Write pattern 1
      await (server as any).executeTool('edit_pattern', { mode: 'write', pattern: 's("bd*4")' });

      // Write pattern 2
      mockController.getCurrentPattern.mockResolvedValue('s("bd*4")');
      await (server as any).executeTool('edit_pattern', { mode: 'write', pattern: 's("cp*2")' });

      // Undo should restore pattern 1
      const undoResult = await (server as any).executeTool('history', { action: 'undo' });
      expect(undoResult).toBe('Undone');

      // Redo should restore pattern 2
      const redoResult = await (server as any).executeTool('history', { action: 'redo' });
      expect(redoResult).toBe('Redone');
    });

    test('should clear redo stack on new write', async () => {
      await (server as any).executeTool('edit_pattern', { mode: 'write', pattern: 's("bd*4")' });
      await (server as any).executeTool('history', { action: 'undo' });

      // New write should clear redo stack
      await (server as any).executeTool('edit_pattern', { mode: 'write', pattern: 's("cp*2")' });

      const redoResult = await (server as any).executeTool('history', { action: 'redo' });
      expect(redoResult).toBe('Nothing to redo');
    });
  });

  describe('Tool Integration', () => {
    test('should chain operations correctly', async () => {
      await (server as any).executeTool('init', {});

      // Generate pattern
      await (server as any).executeTool('compose', { style: 'techno' });

      // Add effect
      mockController.getCurrentPattern.mockResolvedValue('s("bd*4")');
      await (server as any).executeTool('effect', { action: 'add', effect: 'reverb', params: '0.5' });

      // Save
      const saveResult = await (server as any).executeTool('pattern_store', {
        action: 'save',
        name: 'techno-reverb',
        tags: ['techno']
      });

      expect(saveResult).toContain('Pattern saved');
    });
  });

  // UX Tools Tests - Issue #37, #38, #39, #40, #42
  describe('UX Tools', () => {
    describe('Browser Control (#37)', () => {
      test('show_browser should bring window to foreground', async () => {
        await (server as any).executeTool('init', {});
        const result = await (server as any).executeTool('browser_window', { action: 'show' });
        expect(result).toContain('foreground');
        expect(mockController.showBrowser).toHaveBeenCalled();
      });

      test('show_browser should require initialization', async () => {
        const result = await (server as any).executeTool('browser_window', { action: 'show' });
        expect(result).toContain('not initialized');
      });

      test('screenshot should save browser state', async () => {
        await (server as any).executeTool('init', {});
        const result = await (server as any).executeTool('browser_window', { action: 'screenshot', filename: 'test.png' });
        expect(result).toContain('Screenshot');
        expect(mockController.takeScreenshot).toHaveBeenCalledWith('test.png');
      });

      test('screenshot should require initialization', async () => {
        const result = await (server as any).executeTool('browser_window', { action: 'screenshot' });
        expect(result).toContain('not initialized');
      });
    });

    describe('Status & Diagnostics (#39)', () => {
      test('status should return current state', async () => {
        const result = await (server as any).executeTool('diagnostics', { level: 'status' });
        expect(result).toHaveProperty('initialized');
        expect(result).toHaveProperty('playing');
        expect(result).toHaveProperty('errorCount');
      });

      test('diagnostics should return detailed info when initialized', async () => {
        await (server as any).executeTool('init', {});
        const result = await (server as any).executeTool('diagnostics', {});
        expect(result).toHaveProperty('browserConnected');
        expect(result).toHaveProperty('editorReady');
        expect(result).toHaveProperty('cacheStatus');
      });

      test('diagnostics should indicate not initialized', async () => {
        const result = await (server as any).executeTool('diagnostics', {});
        expect(result.initialized).toBe(false);
        expect(result.message).toContain('not initialized');
      });

      test('show_errors should display captured errors', async () => {
        mockController.getConsoleErrors.mockReturnValue(['Error 1', 'Error 2']);
        mockController.getConsoleWarnings.mockReturnValue(['Warning 1']);

        const result = await (server as any).executeTool('diagnostics', { level: 'errors' });
        expect(result).toContain('Errors');
        expect(result).toContain('Error 1');
        expect(result).toContain('Warning 1');
      });

      test('show_errors should indicate no errors when empty', async () => {
        mockController.getConsoleErrors.mockReturnValue([]);
        mockController.getConsoleWarnings.mockReturnValue([]);

        const result = await (server as any).executeTool('diagnostics', { level: 'errors' });
        expect(result).toContain('No errors');
      });
    });

    describe('Auto-play (#38)', () => {
      test('write with auto_play should start playback', async () => {
        await (server as any).executeTool('init', {});
        const result = await (server as any).executeTool('edit_pattern', {
          mode: 'write',
          pattern: 's("bd*4")',
          auto_play: true
        });
        expect(result).toContain('Playing');
        expect(mockController.play).toHaveBeenCalled();
      });

      test('write without auto_play should not start playback', async () => {
        await (server as any).executeTool('init', {});
        mockController.play.mockClear();
        const result = await (server as any).executeTool('edit_pattern', {
          mode: 'write',
          pattern: 's("bd*4")',
          auto_play: false
        });
        expect(result).not.toContain('Playing');
        expect(mockController.play).not.toHaveBeenCalled();
      });

      test('compose with auto_play should start playback', async () => {
        await (server as any).executeTool('init', {});
        mockController.play.mockClear();
        const result = await (server as any).executeTool('compose', {
          style: 'techno',
          auto_play: true
        });
        expect(result.status).toBe('playing');
        expect(mockController.play).toHaveBeenCalled();
      });
    });

    describe('Pattern Validation (#40)', () => {
      test('write with validate=false should skip validation', async () => {
        await (server as any).executeTool('init', {});
        mockController.validatePattern.mockClear();

        await (server as any).executeTool('edit_pattern', {
          mode: 'write',
          pattern: 's("bd*4")',
          validate: false
        });

        expect(mockController.validatePattern).not.toHaveBeenCalled();
      });

      test('write should validate by default', async () => {
        await (server as any).executeTool('init', {});
        mockController.validatePattern.mockClear();

        await (server as any).executeTool('edit_pattern', { mode: 'write', pattern: 's("bd*4")' });

        expect(mockController.validatePattern).toHaveBeenCalled();
      });

      test('write should return validation errors', async () => {
        await (server as any).executeTool('init', {});
        mockController.validatePattern.mockResolvedValue({
          valid: false,
          errors: ['Syntax error'],
          warnings: [],
          suggestions: ['Check syntax']
        });

        const result = await (server as any).executeTool('edit_pattern', { mode: 'write', pattern: 'invalid{' });

        expect(result.success).toBe(false);
        expect(result.errors).toContain('Syntax error');
      });
    });

    describe('Compose Workflow (#42)', () => {
      test('compose should auto-initialize and generate pattern', async () => {
        const result = await (server as any).executeTool('compose', {
          style: 'techno'
        });

        expect(result.success).toBe(true);
        expect(result.metadata.style).toBe('techno');
        expect(result.status).toBe('playing');
        expect(mockController.initialize).toHaveBeenCalled();
        expect(mockController.writePattern).toHaveBeenCalled();
        expect(mockController.play).toHaveBeenCalled();
      });

      test('compose should respect auto_play=false', async () => {
        mockController.play.mockClear();
        const result = await (server as any).executeTool('compose', {
          style: 'ambient',
          auto_play: false
        });

        expect(result.success).toBe(true);
        expect(result.status).toBe('ready');
        expect(mockController.play).not.toHaveBeenCalled();
      });

      test('compose should use custom tempo and key', async () => {
        const result = await (server as any).executeTool('compose', {
          style: 'house',
          tempo: 128,
          key: 'A'
        });

        expect(result.success).toBe(true);
        expect(result.metadata.bpm).toBe(128);
        expect(result.metadata.key).toBe('A');
      });

      test('compose should use genre-appropriate default tempo', async () => {
        const result = await (server as any).executeTool('compose', {
          style: 'dnb'
        });

        expect(result.success).toBe(true);
        expect(result.metadata.bpm).toBe(174); // DnB default
      });

      test('compose with get_feedback should include AI feedback when available', async () => {
        mockGeminiService.isAvailable.mockReturnValue(true);

        const result = await (server as any).executeTool('compose', {
          style: 'techno',
          get_feedback: true
        });

        expect(result.success).toBe(true);
        expect(result.feedback).toBeDefined();
        expect(result.feedback.complexity).toBe('moderate');
        expect(result.feedback.estimatedStyle).toBe('techno');
        expect(result.message).toContain('AI feedback');
        expect(mockGeminiService.getCreativeFeedback).toHaveBeenCalled();
      });

      test('compose with get_feedback should note when Gemini unavailable', async () => {
        mockGeminiService.isAvailable.mockReturnValue(false);

        const result = await (server as any).executeTool('compose', {
          style: 'house',
          get_feedback: true
        });

        expect(result.success).toBe(true);
        expect(result.feedback).toBeUndefined();
        expect(result.message).toContain('GEMINI_API_KEY');
        expect(mockGeminiService.getCreativeFeedback).not.toHaveBeenCalled();
      });

      test('compose with get_feedback should handle feedback errors gracefully', async () => {
        mockGeminiService.isAvailable.mockReturnValue(true);
        mockGeminiService.getCreativeFeedback.mockRejectedValue(new Error('API error'));

        const result = await (server as any).executeTool('compose', {
          style: 'ambient',
          get_feedback: true
        });

        expect(result.success).toBe(true);
        expect(result.feedback).toBeUndefined();
        expect(result.message).toContain('AI feedback unavailable');
      });

      test('compose without get_feedback should not call Gemini', async () => {
        mockGeminiService.isAvailable.mockReturnValue(true);

        const result = await (server as any).executeTool('compose', {
          style: 'jazz'
        });

        expect(result.success).toBe(true);
        expect(result.feedback).toBeUndefined();
        expect(mockGeminiService.getCreativeFeedback).not.toHaveBeenCalled();
      });
    });

    describe('Pattern History (#41)', () => {
      test('list_history should return empty message when no history', async () => {
        const newServer = new StrudelMCPServer();
        const result = await (newServer as any).executeTool('history', { action: 'list' });

        expect(result).toContain('No pattern history yet');
      });

      test('list_history should show pattern history after edits', async () => {
        await (server as any).executeTool('init', {});
        mockController.getCurrentPattern.mockResolvedValue('s("bd*4")');

        // Make some edits to build history
        await (server as any).executeTool('edit_pattern', { mode: 'write', pattern: 's("bd*4")' });
        await (server as any).executeTool('edit_pattern', { mode: 'write', pattern: 's("hh*8")' });

        const result = await (server as any).executeTool('history', { action: 'list' });

        expect(result.count).toBeGreaterThan(0);
        expect(result.entries).toBeDefined();
        expect(result.entries.length).toBeGreaterThan(0);
        expect(result.entries[0].id).toBeDefined();
        expect(result.entries[0].preview).toBeDefined();
        expect(result.entries[0].timestamp).toBeDefined();
      });

      test('list_history should respect limit parameter', async () => {
        await (server as any).executeTool('init', {});
        mockController.getCurrentPattern.mockResolvedValue('s("bd*4")');

        // Make several edits
        for (let i = 0; i < 5; i++) {
          await (server as any).executeTool('edit_pattern', { mode: 'write', pattern: `s("bd*${i}")` });
        }

        const result = await (server as any).executeTool('history', { action: 'list', limit: 2 });

        expect(result.entries.length).toBe(2);
      });

      test('restore_history should restore pattern by ID', async () => {
        await (server as any).executeTool('init', {});
        mockController.getCurrentPattern.mockResolvedValue('s("bd*4")');

        // Make an edit to create history
        await (server as any).executeTool('edit_pattern', { mode: 'write', pattern: 's("cp*2")' });

        // Get the history
        const history = await (server as any).executeTool('history', { action: 'list' });
        const firstEntry = history.entries[history.entries.length - 1];

        // Restore from history
        const result = await (server as any).executeTool('history', {
          action: 'restore',
          id: firstEntry.id
        });

        expect(result).toContain('Restored pattern from history');
        expect(mockController.writePattern).toHaveBeenCalled();
      });

      test('restore_history should return error for invalid ID', async () => {
        await (server as any).executeTool('init', {});

        const result = await (server as any).executeTool('history', {
          action: 'restore',
          id: 99999
        });

        expect(result).toContain('not found');
      });

      test('restore_history should require initialization', async () => {
        const uninitServer = new StrudelMCPServer();
        const result = await (uninitServer as any).executeTool('history', {
          action: 'restore',
          id: 1
        });

        expect(result).toContain('not initialized');
      });

      test('compare_patterns should show diff between two patterns', async () => {
        await (server as any).executeTool('init', {});
        mockController.getCurrentPattern
          .mockResolvedValueOnce('s("bd*4")')
          .mockResolvedValueOnce('s("hh*8")');

        // Make edits to create history
        await (server as any).executeTool('edit_pattern', { mode: 'write', pattern: 's("bd*4")' });
        await (server as any).executeTool('edit_pattern', { mode: 'write', pattern: 's("hh*8")' });

        // Get history IDs
        const history = await (server as any).executeTool('history', { action: 'list' });
        const id1 = history.entries[history.entries.length - 1].id;

        // Compare with current
        const result = await (server as any).executeTool('history', {
          action: 'compare',
          id1: id1
        });

        expect(result.diff).toBeDefined();
        expect(result.summary).toBeDefined();
        expect(result.summary.charsDiff).toBeDefined();
      });

      test('compare_patterns should return error for invalid ID', async () => {
        await (server as any).executeTool('init', {});

        const result = await (server as any).executeTool('history', {
          action: 'compare',
          id1: 99999
        });

        expect(result).toContain('not found');
      });
    });

    describe('Audio Capture Tools (#72)', () => {
      let mockAudioCaptureService: jest.Mocked<AudioCaptureService>;

      beforeEach(() => {
        // Setup mock AudioCaptureService
        mockAudioCaptureService = {
          injectRecorder: jest.fn().mockResolvedValue(undefined),
          startCapture: jest.fn().mockResolvedValue(undefined),
          stopCapture: jest.fn().mockResolvedValue({
            blob: new Blob(['test audio data'], { type: 'audio/webm' }),
            duration: 5000,
            format: 'audio/webm;codecs=opus',
            timestamp: Date.now()
          }),
          captureForDuration: jest.fn().mockResolvedValue({
            blob: new Blob(['test audio data'], { type: 'audio/webm' }),
            duration: 5000,
            format: 'audio/webm;codecs=opus',
            timestamp: Date.now()
          }),
          isCapturing: jest.fn().mockReturnValue(false),
          getElapsedTime: jest.fn().mockReturnValue(0),
          isConnected: jest.fn().mockResolvedValue(true),
          clearChunks: jest.fn().mockResolvedValue(undefined),
          getMimeType: jest.fn().mockReturnValue('audio/webm;codecs=opus')
        } as any;

        (AudioCaptureService as jest.Mock).mockImplementation(() => mockAudioCaptureService);
      });

      test('start_audio_capture should require initialization', async () => {
        const uninitServer = new StrudelMCPServer();
        const result = await (uninitServer as any).executeTool('audio_capture', { action: 'start' });

        expect(result.success).toBe(false);
        expect(result.message).toContain('not initialized');
      });

      test('start_audio_capture should start capture when initialized', async () => {
        await (server as any).executeTool('init', {});
        const result = await (server as any).executeTool('audio_capture', { action: 'start' });

        expect(result.success).toBe(true);
        expect(result.message).toContain('Audio capture started');
        expect(result.format).toBe('webm');
      });

      test('start_audio_capture should use custom format', async () => {
        await (server as any).executeTool('init', {});
        const result = await (server as any).executeTool('audio_capture', {
          action: 'start',
          format: 'opus'
        });

        expect(result.success).toBe(true);
        expect(result.format).toBe('opus');
      });

      test('start_audio_capture should fail if capture already in progress', async () => {
        await (server as any).executeTool('init', {});
        mockAudioCaptureService.isCapturing.mockReturnValue(true);

        const result = await (server as any).executeTool('audio_capture', { action: 'start' });

        expect(result.success).toBe(false);
        expect(result.message).toContain('already in progress');
      });

      test('stop_audio_capture should require initialization', async () => {
        const uninitServer = new StrudelMCPServer();
        const result = await (uninitServer as any).executeTool('audio_capture', { action: 'stop' });

        expect(result.success).toBe(false);
        expect(result.message).toContain('not initialized');
      });

      test('stop_audio_capture should return encoded audio', async () => {
        await (server as any).executeTool('init', {});
        // Start capture first
        await (server as any).executeTool('audio_capture', { action: 'start' });
        mockAudioCaptureService.isCapturing.mockReturnValue(true);

        const result = await (server as any).executeTool('audio_capture', { action: 'stop' });

        expect(result.success).toBe(true);
        expect(result.audio).toBeDefined();
        expect(result.duration).toBe(5000);
        expect(result.format).toBe('audio/webm;codecs=opus');
      });

      test('stop_audio_capture should fail if no capture in progress', async () => {
        await (server as any).executeTool('init', {});
        mockAudioCaptureService.isCapturing.mockReturnValue(false);

        const result = await (server as any).executeTool('audio_capture', { action: 'stop' });

        expect(result.success).toBe(false);
        expect(result.message).toContain('No audio capture in progress');
      });

      test('capture_audio_sample should require initialization', async () => {
        const uninitServer = new StrudelMCPServer();
        const result = await (uninitServer as any).executeTool('audio_capture', { action: 'sample' });

        expect(result.success).toBe(false);
        expect(result.message).toContain('not initialized');
      });

      test('capture_audio_sample should capture with default duration', async () => {
        await (server as any).executeTool('init', {});
        const result = await (server as any).executeTool('audio_capture', { action: 'sample' });

        expect(result.success).toBe(true);
        expect(result.audio).toBeDefined();
        expect(result.duration).toBe(5000);
        expect(mockAudioCaptureService.captureForDuration).toHaveBeenCalledWith(
          expect.anything(),
          5000
        );
      });

      test('capture_audio_sample should capture with custom duration', async () => {
        await (server as any).executeTool('init', {});
        const result = await (server as any).executeTool('audio_capture', {
          action: 'sample',
          duration: 3000
        });

        expect(result.success).toBe(true);
        expect(mockAudioCaptureService.captureForDuration).toHaveBeenCalledWith(
          expect.anything(),
          3000
        );
      });

      test('capture_audio_sample should validate duration range', async () => {
        await (server as any).executeTool('init', {});

        // Too short
        const resultShort = await (server as any).executeTool('audio_capture', {
          action: 'sample',
          duration: 50
        });
        expect(resultShort.success).toBe(false);
        expect(resultShort.message).toContain('Duration must be between');

        // Too long
        const resultLong = await (server as any).executeTool('audio_capture', {
          action: 'sample',
          duration: 120000
        });
        expect(resultLong.success).toBe(false);
        expect(resultLong.message).toContain('Duration must be between');
      });

      test('capture_audio_sample should fail if capture already in progress', async () => {
        await (server as any).executeTool('init', {});
        mockAudioCaptureService.isCapturing.mockReturnValue(true);

        const result = await (server as any).executeTool('audio_capture', { action: 'sample' });

        expect(result.success).toBe(false);
        expect(result.message).toContain('already in progress');
      });

      test('start_audio_capture should handle errors gracefully', async () => {
        await (server as any).executeTool('init', {});
        mockAudioCaptureService.startCapture.mockRejectedValue(new Error('Audio not connected'));

        const result = await (server as any).executeTool('audio_capture', { action: 'start' });

        expect(result.success).toBe(false);
        expect(result.message).toContain('Failed to start audio capture');
      });

      test('stop_audio_capture should handle errors gracefully', async () => {
        await (server as any).executeTool('init', {});
        mockAudioCaptureService.isCapturing.mockReturnValue(true);
        mockAudioCaptureService.stopCapture.mockRejectedValue(new Error('No data captured'));

        const result = await (server as any).executeTool('audio_capture', { action: 'stop' });

        expect(result.success).toBe(false);
        expect(result.message).toContain('Failed to stop audio capture');
      });

      test('capture_audio_sample should handle errors gracefully', async () => {
        await (server as any).executeTool('init', {});
        mockAudioCaptureService.captureForDuration.mockRejectedValue(new Error('Capture failed'));

        const result = await (server as any).executeTool('audio_capture', { action: 'sample' });

        expect(result.success).toBe(false);
        expect(result.message).toContain('Failed to capture audio sample');
      });
    });

    describe('Multi-Session Management (#75)', () => {
      test('create_session should create a new session', async () => {
        const result = await (server as any).executeTool('session', { action: 'create', session_id: 'test-session' });

        expect(mockSessionManager.createSession).toHaveBeenCalledWith('test-session');
        expect(result.success).toBe(true);
        expect(result.session_id).toBe('test-session');
      });

      test('create_session should handle errors', async () => {
        mockSessionManager.createSession.mockRejectedValue(new Error('Session already exists'));

        const result = await (server as any).executeTool('session', { action: 'create', session_id: 'duplicate' });

        expect(result.success).toBe(false);
        expect(result.error).toContain('Session already exists');
      });

      test('destroy_session should destroy a session', async () => {
        const result = await (server as any).executeTool('session', { action: 'destroy', session_id: 'test-session' });

        expect(mockSessionManager.destroySession).toHaveBeenCalledWith('test-session');
        expect(result.success).toBe(true);
      });

      test('destroy_session should handle errors', async () => {
        mockSessionManager.destroySession.mockRejectedValue(new Error('Session not found'));

        const result = await (server as any).executeTool('session', { action: 'destroy', session_id: 'nonexistent' });

        expect(result.success).toBe(false);
        expect(result.error).toContain('Session not found');
      });

      test('list_sessions should return session info', async () => {
        mockSessionManager.getSessionsInfo.mockReturnValue([
          {
            id: 'session1',
            created: new Date('2024-01-01'),
            lastActivity: new Date('2024-01-01'),
            isPlaying: false
          }
        ]);

        const result = await (server as any).executeTool('session', { action: 'list' });

        expect(result.count).toBe(1);
        expect(result.sessions).toHaveLength(1);
        expect(result.sessions[0].id).toBe('session1');
      });

      test('list_sessions should indicate default session', async () => {
        mockSessionManager.getSessionsInfo.mockReturnValue([
          {
            id: 'default',
            created: new Date(),
            lastActivity: new Date(),
            isPlaying: true
          }
        ]);

        const result = await (server as any).executeTool('session', { action: 'list' });

        expect(result.default_session).toBe('default');
        expect(result.sessions[0].is_default).toBe(true);
      });

      test('switch_session should change default session', async () => {
        const result = await (server as any).executeTool('session', { action: 'switch', session_id: 'new-default' });

        expect(mockSessionManager.setDefaultSession).toHaveBeenCalledWith('new-default');
        expect(result.success).toBe(true);
        expect(result.default_session).toBe('new-default');
      });

      test('switch_session should handle errors', async () => {
        mockSessionManager.setDefaultSession.mockImplementation(() => {
          throw new Error('Session not found');
        });

        const result = await (server as any).executeTool('session', { action: 'switch', session_id: 'nonexistent' });

        expect(result.success).toBe(false);
        expect(result.error).toContain('Session not found');
      });
    });


    // Shift Mood Tool (#80)
    describe('Shift Mood Tool (#80)', () => {
      test('shift_mood should handle empty pattern', async () => {
        await (server as any).executeTool('init', {});
        mockController.getCurrentPattern.mockResolvedValue('');

        const result = await (server as any).executeTool('shape', {
          dimension: 'mood',
          target_mood: 'dark'
        });

        expect(result.success).toBe(false);
        expect(result.error).toContain('No pattern');
      });

      test('shift_mood should transform pattern to dark mood', async () => {
        await (server as any).executeTool('init', {});
        mockController.getCurrentPattern.mockResolvedValue('s("bd*4")');

        const result = await (server as any).executeTool('shape', {
          dimension: 'mood',
          target_mood: 'dark'
        });

        expect(result.success).toBe(true);
        expect(result.target_mood).toBe('dark');
        expect(result.applied_effects).toBeDefined();
        expect(result.applied_effects.length).toBeGreaterThan(0);
        expect(mockController.writePattern).toHaveBeenCalled();
        expect(mockController.play).toHaveBeenCalled();
      });

      test('shift_mood should transform pattern to euphoric mood', async () => {
        await (server as any).executeTool('init', {});
        mockController.getCurrentPattern.mockResolvedValue('note("c4 e4 g4")');

        const result = await (server as any).executeTool('shape', {
          dimension: 'mood',
          target_mood: 'euphoric',
          intensity: 0.8
        });

        expect(result.success).toBe(true);
        expect(result.target_mood).toBe('euphoric');
        expect(result.intensity).toBe(0.8);
      });

      test('shift_mood should handle all valid moods', async () => {
        await (server as any).executeTool('init', {});
        mockController.getCurrentPattern.mockResolvedValue('s("bd cp")');

        const validMoods = ['dark', 'euphoric', 'melancholic', 'aggressive', 'dreamy', 'peaceful', 'energetic'];

        for (const mood of validMoods) {
          const result = await (server as any).executeTool('shape', {
            dimension: 'mood',
            target_mood: mood
          });
          expect(result.success).toBe(true);
          expect(result.target_mood).toBe(mood);
        }
      });

      test('shift_mood should reject invalid mood', async () => {
        await (server as any).executeTool('init', {});
        mockController.getCurrentPattern.mockResolvedValue('s("bd*4")');

        const result = await (server as any).executeTool('shape', {
          dimension: 'mood',
          target_mood: 'invalid_mood'
        });

        expect(result.success).toBe(false);
        expect(result.error).toContain('Unknown mood');
      });

      test('shift_mood should respect auto_play=false', async () => {
        await (server as any).executeTool('init', {});
        mockController.getCurrentPattern.mockResolvedValue('s("bd*4")');
        mockController.play.mockClear();

        const result = await (server as any).executeTool('shape', {
          dimension: 'mood',
          target_mood: 'peaceful',
          auto_play: false
        });

        expect(result.success).toBe(true);
        expect(mockController.play).not.toHaveBeenCalled();
      });

      test('shift_mood should use default intensity 0.5', async () => {
        await (server as any).executeTool('init', {});
        mockController.getCurrentPattern.mockResolvedValue('s("bd*4")');

        const result = await (server as any).executeTool('shape', {
          dimension: 'mood',
          target_mood: 'melancholic'
        });

        expect(result.success).toBe(true);
        expect(result.intensity).toBe(0.5);
      });

      test('shift_mood should reject out of range intensity', async () => {
        await (server as any).executeTool('init', {});
        mockController.getCurrentPattern.mockResolvedValue('s("bd*4")');

        const result = await (server as any).executeTool('shape', {
          dimension: 'mood',
          target_mood: 'aggressive',
          intensity: 1.5
        });

        expect(result.success).toBe(false);
        expect(result.error).toContain('between 0 and 1');
      });

      test('shift_mood should apply multiple effects based on profile', async () => {
        await (server as any).executeTool('init', {});
        mockController.getCurrentPattern.mockResolvedValue('s("bd*4")');

        const result = await (server as any).executeTool('shape', {
          dimension: 'mood',
          target_mood: 'dreamy',
          intensity: 1.0
        });

        expect(result.success).toBe(true);
        expect(result.applied_effects).toBeDefined();
        expect(result.applied_effects.length).toBeGreaterThanOrEqual(3);
      });
    });

    // AI Collaborative Jamming Tests (#82)
    describe('Jam With Tool (#82)', () => {
      test('jam_with should fail with invalid layer type', async () => {
        await (server as any).executeTool('init', {});
        mockController.getCurrentPattern.mockResolvedValue('s("bd*4")');

        const result = await (server as any).executeTool('ai_assist', {
          task: 'jam',
          layer: 'invalid'
        });

        expect(result.success).toBe(false);
        expect(result.message).toContain('Invalid layer type');
      });

      test('jam_with should fail with no pattern', async () => {
        await (server as any).executeTool('init', {});
        mockController.getCurrentPattern.mockResolvedValue('');

        const result = await (server as any).executeTool('ai_assist', {
          task: 'jam',
          layer: 'drums'
        });

        expect(result.success).toBe(false);
        expect(result.message).toContain('No pattern to jam with');
      });

      test('jam_with should add drums layer to pattern', async () => {
        await (server as any).executeTool('init', {});
        mockController.getCurrentPattern.mockResolvedValue('note("c3 d3 e3").s("sine")');

        const result = await (server as any).executeTool('ai_assist', {
          task: 'jam',
          layer: 'drums'
        });

        expect(result.success).toBe(true);
        expect(result.layer).toBe('drums');
        expect(result.newLayer).toBeDefined();
        expect(mockController.writePattern).toHaveBeenCalled();
      });

      test('jam_with should add bass layer to pattern', async () => {
        await (server as any).executeTool('init', {});
        mockController.getCurrentPattern.mockResolvedValue('s("bd*4")');

        const result = await (server as any).executeTool('ai_assist', {
          task: 'jam',
          layer: 'bass'
        });

        expect(result.success).toBe(true);
        expect(result.layer).toBe('bass');
        expect(result.newLayer).toBeDefined();
      });

      test('jam_with should add melody layer to pattern', async () => {
        await (server as any).executeTool('init', {});
        mockController.getCurrentPattern.mockResolvedValue('s("bd*4")');

        const result = await (server as any).executeTool('ai_assist', {
          task: 'jam',
          layer: 'melody'
        });

        expect(result.success).toBe(true);
        expect(result.layer).toBe('melody');
      });

      test('jam_with should add pad layer to pattern', async () => {
        await (server as any).executeTool('init', {});
        mockController.getCurrentPattern.mockResolvedValue('s("bd*4")');

        const result = await (server as any).executeTool('ai_assist', {
          task: 'jam',
          layer: 'pad'
        });

        expect(result.success).toBe(true);
        expect(result.layer).toBe('pad');
      });

      test('jam_with should add texture layer to pattern', async () => {
        await (server as any).executeTool('init', {});
        mockController.getCurrentPattern.mockResolvedValue('s("bd*4")');

        const result = await (server as any).executeTool('ai_assist', {
          task: 'jam',
          layer: 'texture'
        });

        expect(result.success).toBe(true);
        expect(result.layer).toBe('texture');
      });

      test('jam_with should detect tempo from setcpm', async () => {
        await (server as any).executeTool('init', {});
        mockController.getCurrentPattern.mockResolvedValue('setcpm(140)\ns("bd*4")');

        const result = await (server as any).executeTool('ai_assist', {
          task: 'jam',
          layer: 'bass'
        });

        expect(result.success).toBe(true);
        expect(result.detected.tempo).toBe(140);
      });

      test('jam_with should detect key from note patterns', async () => {
        await (server as any).executeTool('init', {});
        mockController.getCurrentPattern.mockResolvedValue('note("a3 c4 e4").s("sine")');

        const result = await (server as any).executeTool('ai_assist', {
          task: 'jam',
          layer: 'bass'
        });

        expect(result.success).toBe(true);
        expect(['A', 'C', 'E']).toContain(result.detected.key);
      });

      test('jam_with should detect existing layers', async () => {
        await (server as any).executeTool('init', {});
        mockController.getCurrentPattern.mockResolvedValue('s("bd*4, hh*8")');

        const result = await (server as any).executeTool('ai_assist', {
          task: 'jam',
          layer: 'bass'
        });

        expect(result.success).toBe(true);
        expect(result.detected.existingLayers).toContain('drums');
      });

      test('jam_with should accept style_hint parameter', async () => {
        await (server as any).executeTool('init', {});
        mockController.getCurrentPattern.mockResolvedValue('s("bd*4")');

        const result = await (server as any).executeTool('ai_assist', {
          task: 'jam',
          layer: 'melody',
          style_hint: 'jazz'
        });

        expect(result.success).toBe(true);
        expect(result.message).toContain('jazz');
      });

      test('jam_with should auto-play by default', async () => {
        await (server as any).executeTool('init', {});
        mockController.getCurrentPattern.mockResolvedValue('s("bd*4")');

        await (server as any).executeTool('ai_assist', {
          task: 'jam',
          layer: 'drums'
        });

        expect(mockController.play).toHaveBeenCalled();
      });

      test('jam_with should not auto-play when disabled', async () => {
        await (server as any).executeTool('init', {});
        mockController.getCurrentPattern.mockResolvedValue('s("bd*4")');
        mockController.play.mockClear();

        await (server as any).executeTool('ai_assist', {
          task: 'jam',
          layer: 'drums',
          auto_play: false
        });

        expect(mockController.play).not.toHaveBeenCalled();
      });

      test('jam_with should merge into existing stack()', async () => {
        await (server as any).executeTool('init', {});
        mockController.getCurrentPattern.mockResolvedValue('stack(\n  s("bd*4"),\n  s("hh*8")\n)');

        const result = await (server as any).executeTool('ai_assist', {
          task: 'jam',
          layer: 'bass'
        });

        expect(result.success).toBe(true);
        expect(mockController.writePattern).toHaveBeenCalledWith(
          expect.stringContaining('Jam bass layer')
        );
      });

      test('jam_with should wrap non-stack pattern in stack()', async () => {
        await (server as any).executeTool('init', {});
        mockController.getCurrentPattern.mockResolvedValue('s("bd*4")');

        await (server as any).executeTool('ai_assist', {
          task: 'jam',
          layer: 'bass'
        });

        expect(mockController.writePattern).toHaveBeenCalledWith(
          expect.stringContaining('stack(')
        );
      });

      test('jam_with should preserve tempo prefix when wrapping', async () => {
        await (server as any).executeTool('init', {});
        mockController.getCurrentPattern.mockResolvedValue('setcpm(140)\ns("bd*4")');

        await (server as any).executeTool('ai_assist', {
          task: 'jam',
          layer: 'bass'
        });

        const writtenPattern = mockController.writePattern.mock.calls[0][0];
        expect(writtenPattern.startsWith('setcpm(140)')).toBe(true);
      });
    });
  });
});
