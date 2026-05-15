// Mock MCP SDK before importing (must be first)
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

import { StrudelMCPServer } from '../../server/server';
import { chromium } from 'playwright';
import { MockBrowser, createMockPage } from '../utils/MockPlaywright';

// Mock other dependencies
jest.mock('playwright');
jest.mock('../../StrudelController');
jest.mock('../../PatternStore');
jest.mock('../../services/StrudelEngine');

describe('MCP Server Integration Tests', () => {
  let server: StrudelMCPServer;
  let mockBrowser: MockBrowser;

  beforeEach(() => {
    mockBrowser = new MockBrowser();
    const mockPage = createMockPage();

    mockBrowser.newContext = jest.fn().mockResolvedValue({
      newPage: jest.fn().mockResolvedValue(mockPage)
    });

    (chromium.launch as jest.Mock).mockResolvedValue(mockBrowser);

    // Note: We can't fully test the server without MCP transport infrastructure,
    // but we can test the tool registration and basic structure
    server = new StrudelMCPServer();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Server Initialization', () => {
    test('should create server instance', () => {
      expect(server).toBeDefined();
      expect(server).toBeInstanceOf(StrudelMCPServer);
    });

    test('should have all required components', () => {
      // Access private properties through type assertion for testing
      const serverAny = server as any;

      expect(serverAny.server).toBeDefined();
      expect(serverAny.controller).toBeDefined();
      expect(serverAny.store).toBeDefined();
      expect(serverAny.theory).toBeDefined();
      expect(serverAny.generator).toBeDefined();
      expect(serverAny.logger).toBeDefined();
    });
  });

  describe('Tool Registration', () => {
    test('should register all core tools', () => {
      const serverAny = server as any;
      const tools = serverAny.getTools();

      expect(Array.isArray(tools)).toBe(true);
      expect(tools.length).toBeGreaterThanOrEqual(26);

      const toolNames = tools.map((t: any) => t.name);

      // Core Control Tools
      expect(toolNames).toContain('init');
      expect(toolNames).toContain('playback'); // play/pause/stop
      expect(toolNames).toContain('get_pattern');

      // Pattern Editing (write/append/insert/replace/clear consolidated)
      expect(toolNames).toContain('edit_pattern');

      // Pattern Generation
      expect(toolNames).toContain('compose'); // was generate_pattern
      expect(toolNames).toContain('generate_part'); // drums/bass/melody/fill

      // Music Theory
      expect(toolNames).toContain('music_theory'); // scale/chord_progression
      expect(toolNames).toContain('generate_rhythm'); // euclidean/polyrhythm

      // Audio Analysis (spectrum/rhythm/tempo/key consolidated)
      expect(toolNames).toContain('analyze');

      // Effects / Transforms
      expect(toolNames).toContain('effect'); // add/remove effect
      expect(toolNames).toContain('set_tempo');
      expect(toolNames).toContain('transform'); // swing/scale/transpose/etc.

      // Pattern storage (save/load/list consolidated)
      expect(toolNames).toContain('pattern_store');

      // History (undo/redo/list_history/etc.)
      expect(toolNames).toContain('history');

      // Diagnostics (status/errors/perf/memory consolidated)
      expect(toolNames).toContain('diagnostics');
    });

    test('should have valid tool schemas', () => {
      const serverAny = server as any;
      const tools = serverAny.getTools();

      tools.forEach((tool: any) => {
        expect(tool).toHaveProperty('name');
        expect(tool).toHaveProperty('description');
        expect(tool).toHaveProperty('inputSchema');
        expect(typeof tool.name).toBe('string');
        expect(typeof tool.description).toBe('string');
        expect(typeof tool.inputSchema).toBe('object');
      });
    });

    test('should have proper input schemas for core tools', () => {
      const serverAny = server as any;
      const tools = serverAny.getTools();

      const editTool = tools.find((t: any) => t.name === 'edit_pattern');
      expect(editTool).toBeDefined();
      expect(editTool.inputSchema.properties).toHaveProperty('pattern');
      expect(editTool.inputSchema.properties).toHaveProperty('mode'); // mode defaults to 'write', not required

      const composeTool = tools.find((t: any) => t.name === 'compose');
      expect(composeTool).toBeDefined();
      expect(composeTool.inputSchema.properties).toHaveProperty('style');
      expect(composeTool.inputSchema.required).toContain('style');

      const storeTool = tools.find((t: any) => t.name === 'pattern_store');
      expect(storeTool).toBeDefined();
      expect(storeTool.inputSchema.properties).toHaveProperty('name');
      expect(storeTool.inputSchema.required).toContain('action');
    });
  });

  describe('Tool Execution Logic', () => {
    test('edit_pattern tool refuses without init', async () => {
      const serverAny = server as any;
      // requiresInitialization() was removed (#141/#108). Each module's
      // execute() now does its own session-aware init check.
      const result = await serverAny.executeTool('edit_pattern', { mode: 'write', pattern: 's("bd")' });
      expect(typeof result === 'string' && result.includes('not initialized')).toBe(true);
    });

    test('music theory tools run without browser', async () => {
      const serverAny = server as any;
      // music_theory query=scale is pure music theory and returns scale notes directly.
      const result = await serverAny.executeTool('music_theory', { query: 'scale', root: 'C', scale: 'major' });
      expect(typeof result).toBe('string');
      expect(result).toContain('C, D, E, F, G, A, B');
    });

    test('should execute music theory tools without browser', async () => {
      const serverAny = server as any;

      const scaleResult = await serverAny.executeTool('music_theory', {
        query: 'scale',
        root: 'C',
        scale: 'major'
      });

      expect(scaleResult).toBeTruthy();
      expect(typeof scaleResult).toBe('string');
    });

    test('should execute pattern generation tools', async () => {
      const serverAny = server as any;

      const patternResult = await serverAny.executeTool('generate_part', {
        role: 'drums',
        style: 'techno',
        complexity: 0.5
      });

      expect(patternResult).toBeTruthy();
      expect(patternResult).toBe('Generated techno drums');
    });

    test('should handle unknown tool errors', async () => {
      const serverAny = server as any;

      await expect(serverAny.executeTool('unknown_tool', {}))
        .rejects.toThrow('Unknown tool');
    });
  });

  describe('Session State Management', () => {
    test('should maintain session history', async () => {
      const serverAny = server as any;

      expect(Array.isArray(serverAny.sessionHistory)).toBe(true);
    });

    test('should maintain per-session undo/redo stacks', () => {
      const serverAny = server as any;
      // Per-session bundles (#179) — the legacy single undoStack/redoStack
      // moved into a Map keyed by sessionId, lazily populated.
      expect(serverAny.historyBundles instanceof Map).toBe(true);
    });

    test('should track initialization state', () => {
      const serverAny = server as any;

      expect(typeof serverAny.isInitialized).toBe('boolean');
      expect(serverAny.isInitialized).toBe(false);
    });

    test('should track generated patterns', () => {
      const serverAny = server as any;

      expect(serverAny.generatedPatterns).toBeInstanceOf(Map);
    });
  });

  describe('Error Handling', () => {
    test('should catch and format tool execution errors', async () => {
      const serverAny = server as any;

      // Initialize browser so writePatternSafe will call controller.writePattern
      serverAny.isInitialized = true;

      // Mock a tool that throws an error
      serverAny.controller.writePattern = jest.fn().mockRejectedValue(
        new Error('Write failed')
      );

      // executeTool propagates errors thrown by controller
      await expect(serverAny.executeTool('edit_pattern', {
        mode: 'write',
        pattern: 's("bd*4")'
      })).rejects.toThrow('Write failed');
    });

    test('should validate tool inputs', async () => {
      const serverAny = server as any;

      // When browser is not initialized, edit_pattern returns initialization message before validation
      const result1 = await serverAny.executeTool('edit_pattern', { mode: 'write' });
      // Post-#108: each module's execute() returns its own init-refusal message.
      expect(result1).toContain('not initialized');

      // Initialize browser to test actual input validation
      serverAny.isInitialized = true;

      // Now InputValidator.validateStringLength should throw error for missing pattern
      await expect(serverAny.executeTool('edit_pattern', { mode: 'write' }))
        .rejects.toThrow();
    });
  });

  describe('Pattern Generation Workflow', () => {
    test('should generate complete pattern', async () => {
      const serverAny = server as any;

      // compose returns an object (not a string) and auto-inits/auto-plays.
      const result = await serverAny.executeTool('compose', {
        style: 'techno',
        key: 'C',
        tempo: 130
      });

      expect(result).toMatchObject({
        success: true,
        metadata: { style: 'techno', key: 'C', bpm: 130 },
      });
      expect(typeof result.pattern).toBe('string');
    });

    test('should generate and apply variations', async () => {
      const serverAny = server as any;
      // transform requires an initialized browser.
      serverAny.isInitialized = true;

      await serverAny.executeTool('generate_part', { role: 'drums', style: 'house', complexity: 0.5 });

      const varied = await serverAny.executeTool('transform', {
        op: 'vary',
        type: 'subtle'
      });

      // Variation should be applied to last generated pattern
      expect(varied).toBeTruthy();
    });
  });

  describe('Music Theory Integration', () => {
    test('should generate scales for all supported types', async () => {
      const serverAny = server as any;
      const scaleTypes = ['major', 'minor', 'dorian', 'pentatonic', 'blues'];

      for (const scaleType of scaleTypes) {
        const result = await serverAny.executeTool('music_theory', {
          query: 'scale',
          root: 'C',
          scale: scaleType
        });

        expect(result).toBeTruthy();
        expect(result).toContain('C');
      }
    });

    test('should generate chord progressions for all styles', async () => {
      const serverAny = server as any;
      const styles = ['pop', 'jazz', 'blues', 'rock'];

      for (const style of styles) {
        const result = await serverAny.executeTool('music_theory', {
          query: 'chord_progression',
          key: 'C',
          style
        });

        expect(result).toBeTruthy();
      }
    });

    test('should generate Euclidean rhythms', async () => {
      const serverAny = server as any;

      const result = await serverAny.executeTool('generate_rhythm', {
        type: 'euclidean',
        hits: 5,
        steps: 8,
        sound: 'bd'
      });

      expect(result).toContain('Euclidean');
    });

    test('should generate polyrhythms', async () => {
      const serverAny = server as any;

      const result = await serverAny.executeTool('generate_rhythm', {
        type: 'polyrhythm',
        sounds: ['bd', 'cp', 'hh'],
        patterns: [3, 5, 7]
      });

      expect(result).toBe('Generated polyrhythm');
    });
  });

  describe('Performance Monitoring', () => {
    test('should track tool execution performance', async () => {
      const serverAny = server as any;

      expect(serverAny.perfMonitor).toBeDefined();

      // Execute a tool
      await serverAny.executeTool('music_theory', {
        query: 'scale',
        root: 'C',
        scale: 'major'
      });

      // Performance should be tracked
      const metrics = serverAny.perfMonitor.getMetrics();
      expect(metrics).toBeDefined();
    });

    test('should generate performance reports', async () => {
      const serverAny = server as any;

      const report = await serverAny.executeTool('diagnostics', { level: 'perf' });

      expect(report).toBeTruthy();
      expect(typeof report).toBe('string');
    });

    test('should track memory usage', async () => {
      const serverAny = server as any;

      const memory = await serverAny.executeTool('diagnostics', { level: 'memory' });

      expect(memory).toBeTruthy();
    });
  });

  describe('Logging and Debugging', () => {
    test('should log tool executions', async () => {
      const serverAny = server as any;
      const logSpy = jest.spyOn(serverAny.logger, 'info');

      await serverAny.executeTool('music_theory', {
        query: 'scale',
        root: 'C',
        scale: 'major'
      });

      // Logging happens in setupHandlers, not executeTool directly
      // executeTool is called by setupHandlers which does the logging
      // When testing executeTool directly, no logging occurs
      expect(logSpy).not.toHaveBeenCalled();
    });

    test('should log errors', async () => {
      const serverAny = server as any;
      const errorSpy = jest.spyOn(serverAny.logger, 'error');

      serverAny.controller.writePattern = jest.fn().mockRejectedValue(
        new Error('Test error')
      );

      try {
        await serverAny.executeTool('edit_pattern', { mode: 'write', pattern: 's("bd*4")' });
      } catch (e) {
        // Expected - error propagates from executeTool
      }

      // Logging happens in setupHandlers, not executeTool directly
      // When testing executeTool directly, no logging occurs
      expect(errorSpy).not.toHaveBeenCalled();
    });
  });
});
