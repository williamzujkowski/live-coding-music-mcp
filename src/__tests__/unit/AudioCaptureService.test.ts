/**
 * Unit tests for AudioCaptureService
 *
 * Tests the audio capture functionality using mocked Playwright page.
 * Verifies:
 * - Recorder injection
 * - Start/stop capture lifecycle
 * - Duration-based capture
 * - State management
 * - Error handling
 */

import { AudioCaptureService, AudioCaptureConfig, AudioCaptureResult } from '../../services/AudioCaptureService';
import { Page } from 'playwright';

// Mock Page for testing
const createMockPage = (overrides: Partial<{
  isConnected: boolean;
  isCapturing: boolean;
  captureResult: Partial<AudioCaptureResult>;
  startError: string | null;
  stopError: string | null;
  notInitialized: boolean;
}> = {}): Page => {
  const state = {
    isConnected: overrides.isConnected ?? true,
    isCapturing: overrides.isCapturing ?? false,
    captureResult: overrides.captureResult ?? {
      blob: new Blob(['test audio data'], { type: 'audio/webm;codecs=opus' }),
      duration: 5000,
      format: 'audio/webm;codecs=opus'
    },
    startError: overrides.startError ?? null,
    stopError: overrides.stopError ?? null,
    notInitialized: overrides.notInitialized ?? false
  };

  return {
    evaluate: jest.fn().mockImplementation(async (fn: Function, ..._args: any[]) => {
      // Simulate different behaviors based on the function being called
      const fnStr = fn.toString();

      // Check for injection
      if (fnStr.includes('strudelAudioCapture =')) {
        return undefined;
      }

      // Check for startCapture
      if (fnStr.includes('startCapture()')) {
        if (state.notInitialized) {
          return { success: false, error: 'Audio capture not initialized. Call injectRecorder first.' };
        }
        if (!state.isConnected) {
          return { success: false, error: 'Audio capture not connected. Play a pattern first to initialize audio.' };
        }
        if (state.isCapturing) {
          return { success: false, error: 'Capture already in progress.' };
        }
        if (state.startError) {
          return { success: false, error: state.startError };
        }
        state.isCapturing = true;
        return { success: true };
      }

      // Check for stopCapture
      if (fnStr.includes('stopCapture()')) {
        if (state.notInitialized) {
          return { success: false, error: 'Audio capture not initialized.' };
        }
        if (!state.isCapturing) {
          return { success: false, error: 'No capture in progress.' };
        }
        if (state.stopError) {
          return { success: false, error: state.stopError };
        }
        state.isCapturing = false;
        return {
          success: true,
          ...state.captureResult
        };
      }

      // Check for isConnected
      if (fnStr.includes('isConnected')) {
        if (state.notInitialized) {
          return false;
        }
        return state.isConnected;
      }

      // Check for clearChunks
      if (fnStr.includes('chunks = []')) {
        return undefined;
      }

      return undefined;
    })
  } as unknown as Page;
};

describe('AudioCaptureService', () => {
  let service: AudioCaptureService;

  beforeEach(() => {
    service = new AudioCaptureService();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  // ============================================================================
  // INJECTION TESTS
  // ============================================================================

  describe('injectRecorder', () => {
    it('should inject recorder code into page', async () => {
      const page = createMockPage();

      await service.injectRecorder(page);

      expect(page.evaluate).toHaveBeenCalled();
    });

    it('should not throw on successful injection', async () => {
      const page = createMockPage();

      await expect(service.injectRecorder(page)).resolves.not.toThrow();
    });
  });

  // ============================================================================
  // START CAPTURE TESTS
  // ============================================================================

  describe('startCapture', () => {
    it('should start capture successfully', async () => {
      const page = createMockPage();

      await service.injectRecorder(page);
      await expect(service.startCapture(page)).resolves.not.toThrow();
    });

    it('should set isCapturing to true', async () => {
      const page = createMockPage();

      await service.injectRecorder(page);
      await service.startCapture(page);

      expect(service.isCapturing()).toBe(true);
    });

    it('should throw if not initialized', async () => {
      const page = createMockPage({ notInitialized: true });

      await expect(service.startCapture(page)).rejects.toThrow('not initialized');
    });

    it('should throw if not connected', async () => {
      const page = createMockPage({ isConnected: false });

      await service.injectRecorder(page);
      await expect(service.startCapture(page)).rejects.toThrow('not connected');
    });

    it('should throw if already capturing', async () => {
      const page = createMockPage({ isCapturing: true });

      await service.injectRecorder(page);
      await expect(service.startCapture(page)).rejects.toThrow('already in progress');
    });
  });

  // ============================================================================
  // STOP CAPTURE TESTS
  // ============================================================================

  describe('stopCapture', () => {
    it('should stop capture and return result', async () => {
      const page = createMockPage();

      await service.injectRecorder(page);
      await service.startCapture(page);
      const result = await service.stopCapture(page);

      expect(result).toHaveProperty('blob');
      expect(result).toHaveProperty('duration');
      expect(result).toHaveProperty('format');
      expect(result).toHaveProperty('timestamp');
    });

    it('should set isCapturing to false after stop', async () => {
      const page = createMockPage();

      await service.injectRecorder(page);
      await service.startCapture(page);
      await service.stopCapture(page);

      expect(service.isCapturing()).toBe(false);
    });

    it('should throw if not initialized', async () => {
      const page = createMockPage({ notInitialized: true });

      await expect(service.stopCapture(page)).rejects.toThrow('not initialized');
    });

    it('should throw if no capture in progress', async () => {
      const page = createMockPage({ isCapturing: false });

      await service.injectRecorder(page);
      await expect(service.stopCapture(page)).rejects.toThrow('No capture in progress');
    });

    it('should return correct format in result', async () => {
      const page = createMockPage();

      await service.injectRecorder(page);
      await service.startCapture(page);
      const result = await service.stopCapture(page);

      expect(result.format).toBe('audio/webm;codecs=opus');
    });
  });

  // ============================================================================
  // DURATION CAPTURE TESTS
  // ============================================================================

  describe('captureForDuration', () => {
    it('should capture for specified duration', async () => {
      jest.useRealTimers(); // Use real timers for this test
      const page = createMockPage();
      const duration = 100; // Short duration for testing

      await service.injectRecorder(page);
      const result = await service.captureForDuration(page, duration);

      expect(result).toHaveProperty('blob');
      expect(result).toHaveProperty('duration');
    });

    it('should use default duration configuration', () => {
      // Test that the service has a default duration defined
      const serviceAny = service as any;
      expect(serviceAny.DEFAULT_DURATION_MS).toBe(5000);
    });

    it('should start and stop capture during duration capture', async () => {
      jest.useRealTimers(); // Use real timers for this test
      const page = createMockPage();

      await service.injectRecorder(page);

      // Should not be capturing before
      expect(service.isCapturing()).toBe(false);

      const capturePromise = service.captureForDuration(page, 50);

      // Small delay to let async start complete
      await new Promise(resolve => setTimeout(resolve, 10));

      // Should be capturing during
      expect(service.isCapturing()).toBe(true);

      await capturePromise;

      // Should not be capturing after
      expect(service.isCapturing()).toBe(false);
    });

    it('should return result with all required fields', async () => {
      jest.useRealTimers();
      const page = createMockPage();

      await service.injectRecorder(page);
      const result = await service.captureForDuration(page, 50);

      expect(result).toHaveProperty('blob');
      expect(result).toHaveProperty('duration');
      expect(result).toHaveProperty('format');
      expect(result).toHaveProperty('timestamp');
      expect(result.format).toBe('audio/webm;codecs=opus');
    });
  });

  // ============================================================================
  // STATE MANAGEMENT TESTS
  // ============================================================================

  describe('isCapturing', () => {
    it('should return false initially', () => {
      expect(service.isCapturing()).toBe(false);
    });

    it('should return true while capturing', async () => {
      const page = createMockPage();

      await service.injectRecorder(page);
      await service.startCapture(page);

      expect(service.isCapturing()).toBe(true);
    });

    it('should return false after stopping', async () => {
      const page = createMockPage();

      await service.injectRecorder(page);
      await service.startCapture(page);
      await service.stopCapture(page);

      expect(service.isCapturing()).toBe(false);
    });
  });

  describe('getElapsedTime', () => {
    it('should return 0 when not capturing', () => {
      expect(service.getElapsedTime()).toBe(0);
    });

    it('should return elapsed time while capturing', async () => {
      jest.useRealTimers(); // Need real timers for this test
      const page = createMockPage();

      await service.injectRecorder(page);
      await service.startCapture(page);

      // Wait a bit
      await new Promise(resolve => setTimeout(resolve, 50));

      const elapsed = service.getElapsedTime();
      expect(elapsed).toBeGreaterThan(0);
      expect(elapsed).toBeLessThan(200);

      await service.stopCapture(page);
    });

    it('should return 0 after stopping', async () => {
      const page = createMockPage();

      await service.injectRecorder(page);
      await service.startCapture(page);
      await service.stopCapture(page);

      expect(service.getElapsedTime()).toBe(0);
    });
  });

  describe('isConnected', () => {
    it('should return true when connected', async () => {
      const page = createMockPage({ isConnected: true });

      await service.injectRecorder(page);
      const connected = await service.isConnected(page);

      expect(connected).toBe(true);
    });

    it('should return false when not connected', async () => {
      const page = createMockPage({ isConnected: false });

      await service.injectRecorder(page);
      const connected = await service.isConnected(page);

      expect(connected).toBe(false);
    });

    it('should return false when not initialized', async () => {
      const page = createMockPage({ notInitialized: true });

      const connected = await service.isConnected(page);

      expect(connected).toBe(false);
    });
  });

  // ============================================================================
  // UTILITY METHODS TESTS
  // ============================================================================

  describe('clearChunks', () => {
    it('should clear chunks without error', async () => {
      const page = createMockPage();

      await service.injectRecorder(page);
      await expect(service.clearChunks(page)).resolves.not.toThrow();
    });
  });

  describe('getMimeType', () => {
    it('should return WebM/Opus MIME type', () => {
      expect(service.getMimeType()).toBe('audio/webm;codecs=opus');
    });
  });

  // ============================================================================
  // ERROR HANDLING TESTS
  // ============================================================================

  describe('Error Handling', () => {
    it('should propagate start errors', async () => {
      const page = createMockPage({ startError: 'Custom start error' });

      await service.injectRecorder(page);
      await expect(service.startCapture(page)).rejects.toThrow('Custom start error');
    });

    it('should propagate stop errors', async () => {
      const page = createMockPage({ stopError: 'Custom stop error' });

      await service.injectRecorder(page);
      await service.startCapture(page);
      // Manually set capturing state for this test
      (service as any)._isCapturing = true;

      await expect(service.stopCapture(page)).rejects.toThrow('Custom stop error');
    });

    it('should handle missing capture result gracefully', async () => {
      const page = createMockPage({
        captureResult: {}
      });

      await service.injectRecorder(page);
      await service.startCapture(page);
      const result = await service.stopCapture(page);

      expect(result).toHaveProperty('timestamp');
    });

    it('should fall back to default start error message when error field is missing', async () => {
      // Cover the `result.error || 'Failed to start capture'` fallback branch
      const page = {
        evaluate: jest.fn().mockResolvedValue({ success: false }),
      } as unknown as Page;

      await expect(service.startCapture(page)).rejects.toThrow('Failed to start capture');
    });

    it('should fall back to default stop error message when error field is missing', async () => {
      // Cover the `result.error || 'Failed to stop capture'` fallback branch
      const page = {
        evaluate: jest.fn()
          .mockResolvedValueOnce({ success: true })           // startCapture
          .mockResolvedValueOnce({ success: false }),          // stopCapture (no error string)
      } as unknown as Page;

      await service.startCapture(page);
      await expect(service.stopCapture(page)).rejects.toThrow('Failed to stop capture');
    });
  });

  // ============================================================================
  // CONFIGURATION TESTS
  // ============================================================================

  describe('Configuration', () => {
    it('should accept optional config in startCapture', async () => {
      const page = createMockPage();
      const config: AudioCaptureConfig = {
        format: 'opus',
        sampleRate: 44100,
        durationMs: 10000
      };

      await service.injectRecorder(page);
      await expect(service.startCapture(page, config)).resolves.not.toThrow();
    });
  });

  // ============================================================================
  // LIFECYCLE TESTS
  // ============================================================================

  describe('Lifecycle', () => {
    it('should allow multiple capture cycles', async () => {
      const page = createMockPage();

      await service.injectRecorder(page);

      // First cycle
      await service.startCapture(page);
      const result1 = await service.stopCapture(page);
      expect(result1).toHaveProperty('blob');

      // Reset mock state for second cycle
      const page2 = createMockPage();

      // Second cycle
      await service.startCapture(page2);
      const result2 = await service.stopCapture(page2);
      expect(result2).toHaveProperty('blob');
    });

    it('should track state correctly across operations', async () => {
      const page = createMockPage();

      await service.injectRecorder(page);

      expect(service.isCapturing()).toBe(false);

      await service.startCapture(page);
      expect(service.isCapturing()).toBe(true);

      await service.stopCapture(page);
      expect(service.isCapturing()).toBe(false);
    });
  });

  // ============================================================================
  // BROWSER INTEGRATION PATTERN TESTS
  // ============================================================================

  describe('Browser Integration Pattern', () => {
    it('should follow AudioAnalyzer GainNode interception pattern', async () => {
      const page = createMockPage();
      const evaluateSpy = page.evaluate as jest.Mock;

      await service.injectRecorder(page);

      // Check that the injected code includes GainNode.prototype.connect interception
      const injectedCode = evaluateSpy.mock.calls[0][0].toString();
      expect(injectedCode).toContain('GainNode.prototype.connect');
      expect(injectedCode).toContain('strudelAudioCapture');
      expect(injectedCode).toContain('MediaRecorder');
    });

    it('should use correct MIME type for Gemini compatibility', async () => {
      const page = createMockPage();
      const evaluateSpy = page.evaluate as jest.Mock;

      await service.injectRecorder(page);

      const injectedCode = evaluateSpy.mock.calls[0][0].toString();
      expect(injectedCode).toContain('audio/webm;codecs=opus');
    });

    it('should create MediaStreamDestination for recording', async () => {
      const page = createMockPage();
      const evaluateSpy = page.evaluate as jest.Mock;

      await service.injectRecorder(page);

      const injectedCode = evaluateSpy.mock.calls[0][0].toString();
      expect(injectedCode).toContain('createMediaStreamDestination');
    });
  });
});
