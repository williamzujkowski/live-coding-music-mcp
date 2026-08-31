import { ErrorRecovery, RecoveryStrategy } from '../../utils/ErrorRecovery';

// Mock Logger to prevent console output during tests
jest.mock('../../utils/Logger', () => ({
  Logger: jest.fn().mockImplementation(() => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  })),
}));

describe('ErrorRecovery', () => {
  let recovery: ErrorRecovery;

  beforeEach(() => {
    jest.useFakeTimers();
    recovery = new ErrorRecovery();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  describe('executeWithRetry', () => {
    test('should succeed immediately when operation succeeds on first attempt', async () => {
      const operation = jest.fn().mockResolvedValue('success');

      const promise = recovery.executeWithRetry(operation, 'test-op');
      jest.runAllTimers();
      const result = await promise;

      expect(result).toBe('success');
      expect(operation).toHaveBeenCalledTimes(1);
    });

    test('should retry and succeed when operation fails then succeeds', async () => {
      const operation = jest.fn()
        .mockRejectedValueOnce(new Error('fail 1'))
        .mockRejectedValueOnce(new Error('fail 2'))
        .mockResolvedValue('success');

      const promise = recovery.executeWithRetry(operation, 'test-op', {
        maxRetries: 3,
        retryDelay: 1000,
        exponentialBackoff: false,
      });

      // First attempt fails, wait for retry delay
      await jest.advanceTimersByTimeAsync(0);
      expect(operation).toHaveBeenCalledTimes(1);

      // Second attempt after delay
      await jest.advanceTimersByTimeAsync(1000);
      expect(operation).toHaveBeenCalledTimes(2);

      // Third attempt after another delay
      await jest.advanceTimersByTimeAsync(1000);
      expect(operation).toHaveBeenCalledTimes(3);

      const result = await promise;
      expect(result).toBe('success');
    });

    test('should throw error after all retries exhausted', async () => {
      const operation = jest.fn().mockRejectedValue(new Error('persistent failure'));

      const strategy: RecoveryStrategy = {
        maxRetries: 2,
        retryDelay: 100,
        exponentialBackoff: false,
      };

      // Start the operation and handle timers properly
      let error: Error | undefined;
      const promise = recovery.executeWithRetry(operation, 'test-op', strategy)
        .catch((e: Error) => { error = e; });

      // Run through all retries
      await jest.advanceTimersByTimeAsync(0);
      await jest.advanceTimersByTimeAsync(100);
      await jest.advanceTimersByTimeAsync(100);
      await promise;

      expect(error).toBeDefined();
      expect(error!.message).toBe('test-op failed after 3 attempts: persistent failure');
      expect(operation).toHaveBeenCalledTimes(3);
    });

    test('should apply exponential backoff correctly', async () => {
      const operation = jest.fn()
        .mockRejectedValueOnce(new Error('fail 1'))
        .mockRejectedValueOnce(new Error('fail 2'))
        .mockRejectedValueOnce(new Error('fail 3'))
        .mockResolvedValue('success');

      const promise = recovery.executeWithRetry(operation, 'test-op', {
        maxRetries: 3,
        retryDelay: 1000,
        exponentialBackoff: true,
      });

      // First attempt
      await jest.advanceTimersByTimeAsync(0);
      expect(operation).toHaveBeenCalledTimes(1);

      // After 1000ms (2^0 * 1000)
      await jest.advanceTimersByTimeAsync(1000);
      expect(operation).toHaveBeenCalledTimes(2);

      // After 2000ms (2^1 * 1000)
      await jest.advanceTimersByTimeAsync(2000);
      expect(operation).toHaveBeenCalledTimes(3);

      // After 4000ms (2^2 * 1000)
      await jest.advanceTimersByTimeAsync(4000);
      expect(operation).toHaveBeenCalledTimes(4);

      const result = await promise;
      expect(result).toBe('success');
    });

    test('should use fallback when all retries fail', async () => {
      const operation = jest.fn().mockRejectedValue(new Error('always fails'));
      const fallback = jest.fn().mockResolvedValue('fallback result');

      const promise = recovery.executeWithRetry(operation, 'test-op', {
        maxRetries: 1,
        retryDelay: 100,
        exponentialBackoff: false,
        fallbackAction: fallback,
      });

      await jest.advanceTimersByTimeAsync(0);
      await jest.advanceTimersByTimeAsync(100);

      const result = await promise;
      expect(result).toBe('fallback result');
      expect(fallback).toHaveBeenCalledTimes(1);
    });

    test('should throw error when fallback also fails', async () => {
      const operation = jest.fn().mockRejectedValue(new Error('operation fails'));
      const fallback = jest.fn().mockRejectedValue(new Error('fallback fails'));

      let error: Error | undefined;
      const promise = recovery.executeWithRetry(operation, 'test-op', {
        maxRetries: 1,
        retryDelay: 100,
        exponentialBackoff: false,
        fallbackAction: fallback,
      }).catch((e: Error) => { error = e; });

      await jest.advanceTimersByTimeAsync(0);
      await jest.advanceTimersByTimeAsync(100);
      await promise;

      expect(error).toBeDefined();
      expect(error!.message).toContain('test-op failed after 2 attempts');
    });

    test('should use default strategy when none provided', async () => {
      const operation = jest.fn()
        .mockRejectedValueOnce(new Error('fail'))
        .mockResolvedValue('success');

      const promise = recovery.executeWithRetry(operation, 'test-op');

      // Default: maxRetries=3, retryDelay=1000, exponentialBackoff=true
      await jest.advanceTimersByTimeAsync(0);
      expect(operation).toHaveBeenCalledTimes(1);

      await jest.advanceTimersByTimeAsync(1000);
      expect(operation).toHaveBeenCalledTimes(2);

      const result = await promise;
      expect(result).toBe('success');
    });

    test('should clear error history on success', async () => {
      const operation = jest.fn()
        .mockRejectedValueOnce(new Error('fail'))
        .mockResolvedValue('success');

      const promise = recovery.executeWithRetry(operation, 'tracked-op', {
        maxRetries: 2,
        retryDelay: 100,
        exponentialBackoff: false,
      });

      await jest.advanceTimersByTimeAsync(0);
      await jest.advanceTimersByTimeAsync(100);

      await promise;

      // Error history should be cleared
      expect(recovery.isFrequentlyFailing('tracked-op')).toBe(false);
    });
  });

  describe('executeWithTimeout', () => {
    test('should return result when operation completes before timeout', async () => {
      const operation = jest.fn().mockImplementation(async () => {
        return 'fast result';
      });

      const result = await recovery.executeWithTimeout(operation, 5000, 'fast-op');
      expect(result).toBe('fast result');
    });

    test('should throw timeout error when operation exceeds timeout', async () => {
      const operation = jest.fn().mockImplementation(() => {
        return new Promise((resolve) => {
          setTimeout(() => resolve('slow result'), 10000);
        });
      });

      const promise = recovery.executeWithTimeout(operation, 1000, 'slow-op');

      jest.advanceTimersByTime(1000);

      await expect(promise).rejects.toThrow('slow-op timed out after 1000ms');
    });

    test('should handle operation errors separately from timeout', async () => {
      const operation = jest.fn().mockRejectedValue(new Error('operation error'));

      await expect(recovery.executeWithTimeout(operation, 5000, 'error-op'))
        .rejects.toThrow('operation error');
    });
  });

  describe('executeWithRetryAndTimeout', () => {
    test('should combine retry and timeout functionality', async () => {
      const operation = jest.fn()
        .mockImplementationOnce(() => new Promise((_, reject) => {
          setTimeout(() => reject(new Error('timeout')), 200);
        }))
        .mockResolvedValue('success');

      const promise = recovery.executeWithRetryAndTimeout(
        operation,
        'combined-op',
        100, // 100ms timeout
        {
          maxRetries: 2,
          retryDelay: 50,
          exponentialBackoff: false,
        }
      );

      // First attempt times out after 100ms
      jest.advanceTimersByTime(100);
      await jest.advanceTimersByTimeAsync(0);

      // Wait for retry delay
      jest.advanceTimersByTime(50);
      await jest.advanceTimersByTimeAsync(0);

      const result = await promise;
      expect(result).toBe('success');
    });

    test('should use default strategy when none provided', async () => {
      const operation = jest.fn().mockResolvedValue('success');

      const result = await recovery.executeWithRetryAndTimeout(
        operation,
        'default-op',
        5000
      );

      expect(result).toBe('success');
    });
  });

  describe('handleBrowserInit', () => {
    test('should successfully initialize browser', async () => {
      const initFn = jest.fn().mockResolvedValue('Browser ready');

      const result = await recovery.handleBrowserInit(initFn);

      expect(result).toBe('Browser ready');
      expect(initFn).toHaveBeenCalledTimes(1);
    });

    test('should return fallback message when browser init fails repeatedly', async () => {
      const initFn = jest.fn().mockRejectedValue(new Error('Browser crash'));

      const promise = recovery.handleBrowserInit(initFn);

      // 30s timeout, maxRetries=2, retryDelay=2000 with exponential backoff
      // First attempt
      jest.advanceTimersByTime(30000);
      await jest.advanceTimersByTimeAsync(0);

      // Second attempt after 2s
      jest.advanceTimersByTime(2000);
      jest.advanceTimersByTime(30000);
      await jest.advanceTimersByTimeAsync(0);

      // Third attempt after 4s
      jest.advanceTimersByTime(4000);
      jest.advanceTimersByTime(30000);
      await jest.advanceTimersByTimeAsync(0);

      const result = await promise;
      expect(result).toContain('Browser initialization failed');
      expect(result).toContain('headless:true');
    });
  });

  describe('handlePatternWrite', () => {
    test('should successfully write pattern', async () => {
      const writeFn = jest.fn().mockResolvedValue('Pattern written');

      const result = await recovery.handlePatternWrite(writeFn, 's("bd*4")');

      expect(result).toBe('Pattern written');
      expect(writeFn).toHaveBeenCalledWith('s("bd*4")');
    });

    test('should try simplified pattern when write fails', async () => {
      const pattern = 's("bd*4").delay(0.5).reverb(0.3).room(0.8)';
      const writeFn = jest.fn()
        .mockRejectedValueOnce(new Error('Write failed'))
        .mockRejectedValueOnce(new Error('Write failed'))
        .mockRejectedValueOnce(new Error('Write failed'))
        .mockResolvedValue('Simplified pattern written');

      const promise = recovery.handlePatternWrite(writeFn, pattern);

      // maxRetries=2, retryDelay=500, no exponential backoff
      await jest.advanceTimersByTimeAsync(0);
      await jest.advanceTimersByTimeAsync(500);
      await jest.advanceTimersByTimeAsync(500);

      const result = await promise;
      expect(result).toBe('Simplified pattern written');

      // Last call should be with simplified pattern
      const lastCall = writeFn.mock.calls[writeFn.mock.calls.length - 1][0];
      expect(lastCall).not.toContain('.delay');
      expect(lastCall).not.toContain('.reverb');
      expect(lastCall).not.toContain('.room');
    });
  });

  describe('handleNetworkOperation', () => {
    test('should retry network operations with exponential backoff', async () => {
      const networkOp = jest.fn()
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValue('Network success');

      const promise = recovery.handleNetworkOperation(networkOp, 'api-call');

      // maxRetries=5, retryDelay=2000, exponentialBackoff=true
      await jest.advanceTimersByTimeAsync(0);
      expect(networkOp).toHaveBeenCalledTimes(1);

      await jest.advanceTimersByTimeAsync(2000);
      expect(networkOp).toHaveBeenCalledTimes(2);

      const result = await promise;
      expect(result).toBe('Network success');
    });

    test('should throw error after all network retries fail', async () => {
      const networkOp = jest.fn().mockRejectedValue(new Error('Persistent network error'));

      let error: Error | undefined;
      const promise = recovery.handleNetworkOperation(networkOp, 'api-call')
        .catch((e: Error) => { error = e; });

      // Run through 6 attempts (initial + 5 retries) with exponential backoff
      // Delays: 2000, 4000, 8000, 16000, 32000
      await jest.advanceTimersByTimeAsync(0);
      await jest.advanceTimersByTimeAsync(2000);
      await jest.advanceTimersByTimeAsync(4000);
      await jest.advanceTimersByTimeAsync(8000);
      await jest.advanceTimersByTimeAsync(16000);
      await jest.advanceTimersByTimeAsync(32000);
      await promise;

      expect(error).toBeDefined();
      // The fallback throws which is then caught, resulting in the standard retry error message
      expect(error!.message).toContain('api-call failed after 6 attempts');
      expect(networkOp).toHaveBeenCalledTimes(6);
    });
  });

  describe('isFrequentlyFailing', () => {
    test('should return false when no errors recorded', () => {
      expect(recovery.isFrequentlyFailing('unknown-op')).toBe(false);
    });

    test('should return false when errors below threshold', async () => {
      // Record 2 errors (below default threshold of 3)
      const failingOp = jest.fn().mockRejectedValue(new Error('fail'));

      try {
        await recovery.executeWithRetry(failingOp, 'test-op', {
          maxRetries: 0,
          retryDelay: 0,
          exponentialBackoff: false,
        });
      } catch {}

      try {
        await recovery.executeWithRetry(failingOp, 'test-op', {
          maxRetries: 0,
          retryDelay: 0,
          exponentialBackoff: false,
        });
      } catch {}

      expect(recovery.isFrequentlyFailing('test-op', 3)).toBe(false);
    });

    test('should return true when errors meet threshold', async () => {
      const failingOp = jest.fn().mockRejectedValue(new Error('fail'));

      // Record 3 errors
      for (let i = 0; i < 3; i++) {
        try {
          await recovery.executeWithRetry(failingOp, 'frequent-fail', {
            maxRetries: 0,
            retryDelay: 0,
            exponentialBackoff: false,
          });
        } catch {}
      }

      expect(recovery.isFrequentlyFailing('frequent-fail', 3)).toBe(true);
    });

    test('should only count errors within time window', async () => {
      const failingOp = jest.fn().mockRejectedValue(new Error('fail'));

      // Record an error
      try {
        await recovery.executeWithRetry(failingOp, 'windowed-op', {
          maxRetries: 0,
          retryDelay: 0,
          exponentialBackoff: false,
        });
      } catch {}

      // Advance time beyond the 60-second window
      jest.advanceTimersByTime(70000);

      // The old error should be expired
      expect(recovery.isFrequentlyFailing('windowed-op', 1)).toBe(false);
    });
  });

  describe('getErrorStats', () => {
    test('should report instrumented operations with zero counts when no errors', () => {
      // `{}` meant both "healthy" and "nothing is instrumented", and an
      // operator could not tell which. Instrumented operations now
      // always appear, with explicit zeros (#286).
      const stats = recovery.getErrorStats();
      expect(stats['Pattern Write']).toEqual({
        count: 0, lastError: null, recovered: 0, lastRecovery: null,
      });
    });

    test('should return accurate error counts', async () => {
      const failingOp = jest.fn().mockRejectedValue(new Error('fail'));

      // Record errors for two different operations
      for (let i = 0; i < 3; i++) {
        try {
          await recovery.executeWithRetry(failingOp, 'op-a', {
            maxRetries: 0,
            retryDelay: 0,
            exponentialBackoff: false,
          });
        } catch {}
      }

      for (let i = 0; i < 2; i++) {
        try {
          await recovery.executeWithRetry(failingOp, 'op-b', {
            maxRetries: 0,
            retryDelay: 0,
            exponentialBackoff: false,
          });
        } catch {}
      }

      const stats = recovery.getErrorStats();
      expect(stats['op-a'].count).toBe(3);
      expect(stats['op-b'].count).toBe(2);
    });

    test('should include lastError timestamp', async () => {
      const failingOp = jest.fn().mockRejectedValue(new Error('fail'));
      const startTime = Date.now();

      try {
        await recovery.executeWithRetry(failingOp, 'timed-op', {
          maxRetries: 0,
          retryDelay: 0,
          exponentialBackoff: false,
        });
      } catch {}

      const stats = recovery.getErrorStats();
      expect(stats['timed-op'].lastError).not.toBeNull();
      expect(stats['timed-op'].lastError!.getTime()).toBeGreaterThanOrEqual(startTime);
    });

    test('should exclude errors outside time window', async () => {
      const failingOp = jest.fn().mockRejectedValue(new Error('fail'));

      try {
        await recovery.executeWithRetry(failingOp, 'old-error', {
          maxRetries: 0,
          retryDelay: 0,
          exponentialBackoff: false,
        });
      } catch {}

      // Advance time beyond window
      jest.advanceTimersByTime(70000);

      const stats = recovery.getErrorStats();
      expect(stats['old-error'].count).toBe(0);
      expect(stats['old-error'].lastError).toBeNull();
    });
  });

  describe('clearErrorHistory', () => {
    test('should clear error history for specific operation', async () => {
      const failingOp = jest.fn().mockRejectedValue(new Error('fail'));

      // Record errors
      for (let i = 0; i < 3; i++) {
        try {
          await recovery.executeWithRetry(failingOp, 'clear-test', {
            maxRetries: 0,
            retryDelay: 0,
            exponentialBackoff: false,
          });
        } catch {}
      }

      expect(recovery.isFrequentlyFailing('clear-test', 3)).toBe(true);

      recovery.clearErrorHistory('clear-test');

      expect(recovery.isFrequentlyFailing('clear-test', 3)).toBe(false);
      expect(recovery.getErrorStats()['clear-test']).toBeUndefined();
    });

    test('should not affect other operations', async () => {
      const failingOp = jest.fn().mockRejectedValue(new Error('fail'));

      // Record errors for two operations
      try {
        await recovery.executeWithRetry(failingOp, 'keep-me', {
          maxRetries: 0,
          retryDelay: 0,
          exponentialBackoff: false,
        });
      } catch {}

      try {
        await recovery.executeWithRetry(failingOp, 'clear-me', {
          maxRetries: 0,
          retryDelay: 0,
          exponentialBackoff: false,
        });
      } catch {}

      recovery.clearErrorHistory('clear-me');

      const stats = recovery.getErrorStats();
      expect(stats['keep-me'].count).toBe(1);
      expect(stats['clear-me']).toBeUndefined();
    });
  });

  describe('clearAllErrorHistory', () => {
    test('should clear all error history', async () => {
      const failingOp = jest.fn().mockRejectedValue(new Error('fail'));

      // Record errors for multiple operations
      for (const op of ['op-1', 'op-2', 'op-3']) {
        try {
          await recovery.executeWithRetry(failingOp, op, {
            maxRetries: 0,
            retryDelay: 0,
            exponentialBackoff: false,
          });
        } catch {}
      }

      recovery.clearAllErrorHistory();

      const stats = recovery.getErrorStats();
      // The ad-hoc op-1/2/3 rows are gone; only the always-reported
      // instrumented row remains, at zero (#286).
      expect(Object.keys(stats)).toEqual(['Pattern Write']);
      expect(stats['Pattern Write'].count).toBe(0);
      expect(stats['Pattern Write'].recovered).toBe(0);
    });
  });

  describe('createCircuitBreaker', () => {
    test('should execute operation when circuit is closed', async () => {
      const operation = jest.fn().mockResolvedValue('success');
      const protectedOp = recovery.createCircuitBreaker(operation, 'circuit-test', 3);

      const result = await protectedOp();

      expect(result).toBe('success');
      expect(operation).toHaveBeenCalledTimes(1);
    });

    test('should open circuit after threshold failures', async () => {
      const failingOp = jest.fn().mockRejectedValue(new Error('fail'));

      // Record enough failures to trip the circuit breaker
      for (let i = 0; i < 5; i++) {
        try {
          await recovery.executeWithRetry(failingOp, 'circuit-op', {
            maxRetries: 0,
            retryDelay: 0,
            exponentialBackoff: false,
          });
        } catch {}
      }

      const operation = jest.fn().mockResolvedValue('success');
      const protectedOp = recovery.createCircuitBreaker(operation, 'circuit-op', 5);

      await expect(protectedOp()).rejects.toThrow(
        'Circuit breaker open for circuit-op - operation disabled due to repeated failures'
      );
      expect(operation).not.toHaveBeenCalled();
    });

    test('should close circuit after errors expire', async () => {
      const failingOp = jest.fn().mockRejectedValue(new Error('fail'));

      // Trip the circuit breaker
      for (let i = 0; i < 3; i++) {
        try {
          await recovery.executeWithRetry(failingOp, 'timed-circuit', {
            maxRetries: 0,
            retryDelay: 0,
            exponentialBackoff: false,
          });
        } catch {}
      }

      // Verify circuit is open
      const protectedOp1 = recovery.createCircuitBreaker(
        jest.fn().mockResolvedValue('blocked'),
        'timed-circuit',
        3
      );
      await expect(protectedOp1()).rejects.toThrow('Circuit breaker open');

      // Advance time beyond error window
      jest.advanceTimersByTime(70000);

      // Circuit should now be closed
      const operation = jest.fn().mockResolvedValue('allowed');
      const protectedOp2 = recovery.createCircuitBreaker(operation, 'timed-circuit', 3);

      const result = await protectedOp2();
      expect(result).toBe('allowed');
      expect(operation).toHaveBeenCalledTimes(1);
    });

    test('should use default threshold of 5', async () => {
      const failingOp = jest.fn().mockRejectedValue(new Error('fail'));

      // Record 4 failures (below default threshold)
      for (let i = 0; i < 4; i++) {
        try {
          await recovery.executeWithRetry(failingOp, 'default-threshold', {
            maxRetries: 0,
            retryDelay: 0,
            exponentialBackoff: false,
          });
        } catch {}
      }

      const operation = jest.fn().mockResolvedValue('success');
      const protectedOp = recovery.createCircuitBreaker(operation, 'default-threshold');

      // Should still work (4 < 5)
      const result = await protectedOp();
      expect(result).toBe('success');

      // Record one more failure
      try {
        await recovery.executeWithRetry(failingOp, 'default-threshold', {
          maxRetries: 0,
          retryDelay: 0,
          exponentialBackoff: false,
        });
      } catch {}

      // Now circuit should be open (5 >= 5)
      const protectedOp2 = recovery.createCircuitBreaker(
        jest.fn().mockResolvedValue('blocked'),
        'default-threshold'
      );
      await expect(protectedOp2()).rejects.toThrow('Circuit breaker open');
    });
  });

  describe('simplifyPattern (via handlePatternWrite)', () => {
    test('should remove delay effects', async () => {
      const writeFn = jest.fn()
        .mockRejectedValueOnce(new Error('fail'))
        .mockRejectedValueOnce(new Error('fail'))
        .mockRejectedValueOnce(new Error('fail'))
        .mockImplementation((pattern: string) => {
          expect(pattern).not.toContain('.delay');
          return Promise.resolve('ok');
        });

      const promise = recovery.handlePatternWrite(writeFn, 's("bd").delay(0.5)');
      await jest.advanceTimersByTimeAsync(0);
      await jest.advanceTimersByTimeAsync(500);
      await jest.advanceTimersByTimeAsync(500);
      await promise;
    });

    test('should remove reverb effects', async () => {
      const writeFn = jest.fn()
        .mockRejectedValueOnce(new Error('fail'))
        .mockRejectedValueOnce(new Error('fail'))
        .mockRejectedValueOnce(new Error('fail'))
        .mockImplementation((pattern: string) => {
          expect(pattern).not.toContain('.reverb');
          return Promise.resolve('ok');
        });

      const promise = recovery.handlePatternWrite(writeFn, 's("bd").reverb(0.3)');
      await jest.advanceTimersByTimeAsync(0);
      await jest.advanceTimersByTimeAsync(500);
      await jest.advanceTimersByTimeAsync(500);
      await promise;
    });

    test('should remove room effects', async () => {
      const writeFn = jest.fn()
        .mockRejectedValueOnce(new Error('fail'))
        .mockRejectedValueOnce(new Error('fail'))
        .mockRejectedValueOnce(new Error('fail'))
        .mockImplementation((pattern: string) => {
          expect(pattern).not.toContain('.room');
          return Promise.resolve('ok');
        });

      const promise = recovery.handlePatternWrite(writeFn, 's("bd").room(0.8)');
      await jest.advanceTimersByTimeAsync(0);
      await jest.advanceTimersByTimeAsync(500);
      await jest.advanceTimersByTimeAsync(500);
      await promise;
    });

    test('should remove filter effects (lpf, hpf, bpf)', async () => {
      const writeFn = jest.fn()
        .mockRejectedValueOnce(new Error('fail'))
        .mockRejectedValueOnce(new Error('fail'))
        .mockRejectedValueOnce(new Error('fail'))
        .mockImplementation((pattern: string) => {
          expect(pattern).not.toContain('.lpf');
          expect(pattern).not.toContain('.hpf');
          expect(pattern).not.toContain('.bpf');
          return Promise.resolve('ok');
        });

      const promise = recovery.handlePatternWrite(writeFn, 's("bd").lpf(500).hpf(100).bpf(1000)');
      await jest.advanceTimersByTimeAsync(0);
      await jest.advanceTimersByTimeAsync(500);
      await jest.advanceTimersByTimeAsync(500);
      await promise;
    });

    test('should remove complex transformations', async () => {
      const writeFn = jest.fn()
        .mockRejectedValueOnce(new Error('fail'))
        .mockRejectedValueOnce(new Error('fail'))
        .mockRejectedValueOnce(new Error('fail'))
        .mockImplementation((pattern: string) => {
          expect(pattern).not.toContain('.jux');
          expect(pattern).not.toContain('.iter');
          expect(pattern).not.toContain('.chop');
          expect(pattern).not.toContain('.striate');
          expect(pattern).not.toContain('.scramble');
          return Promise.resolve('ok');
        });

      const promise = recovery.handlePatternWrite(
        writeFn,
        's("bd").jux(rev).iter(4).chop(8).striate(3).scramble(2)'
      );
      await jest.advanceTimersByTimeAsync(0);
      await jest.advanceTimersByTimeAsync(500);
      await jest.advanceTimersByTimeAsync(500);
      await promise;
    });

    test('should remove conditional modifications', async () => {
      const writeFn = jest.fn()
        .mockRejectedValueOnce(new Error('fail'))
        .mockRejectedValueOnce(new Error('fail'))
        .mockRejectedValueOnce(new Error('fail'))
        .mockImplementation((pattern: string) => {
          expect(pattern).not.toContain('.sometimes');
          expect(pattern).not.toContain('.often');
          expect(pattern).not.toContain('.rarely');
          expect(pattern).not.toContain('.every');
          return Promise.resolve('ok');
        });

      const promise = recovery.handlePatternWrite(
        writeFn,
        's("bd").sometimes(x => x.fast(2)).often(x => x.slow(2)).rarely(x => x.rev()).every(4, x => x.fast(2))'
      );
      await jest.advanceTimersByTimeAsync(0);
      await jest.advanceTimersByTimeAsync(500);
      await jest.advanceTimersByTimeAsync(500);
      await promise;
    });

    test('should preserve basic pattern structure', async () => {
      const writeFn = jest.fn()
        .mockRejectedValueOnce(new Error('fail'))
        .mockRejectedValueOnce(new Error('fail'))
        .mockRejectedValueOnce(new Error('fail'))
        .mockImplementation((pattern: string) => {
          expect(pattern).toContain('s("bd*4")');
          return Promise.resolve('ok');
        });

      const promise = recovery.handlePatternWrite(
        writeFn,
        's("bd*4").delay(0.5).room(0.8)'
      );
      await jest.advanceTimersByTimeAsync(0);
      await jest.advanceTimersByTimeAsync(500);
      await jest.advanceTimersByTimeAsync(500);
      await promise;
    });
  });

  describe('edge cases', () => {
    test('should handle zero retries', async () => {
      const operation = jest.fn().mockRejectedValue(new Error('fail'));

      const promise = recovery.executeWithRetry(operation, 'zero-retry', {
        maxRetries: 0,
        retryDelay: 1000,
        exponentialBackoff: false,
      });

      await expect(promise).rejects.toThrow('zero-retry failed after 1 attempts');
      expect(operation).toHaveBeenCalledTimes(1);
    });

    test('should handle concurrent operations', async () => {
      const op1 = jest.fn().mockResolvedValue('result1');
      const op2 = jest.fn().mockResolvedValue('result2');

      const [result1, result2] = await Promise.all([
        recovery.executeWithRetry(op1, 'concurrent-1'),
        recovery.executeWithRetry(op2, 'concurrent-2'),
      ]);

      expect(result1).toBe('result1');
      expect(result2).toBe('result2');
    });

    test('should track errors independently for different operations', async () => {
      const failingOp = jest.fn().mockRejectedValue(new Error('fail'));

      // Fail op-a 3 times
      for (let i = 0; i < 3; i++) {
        try {
          await recovery.executeWithRetry(failingOp, 'op-a', {
            maxRetries: 0,
            retryDelay: 0,
            exponentialBackoff: false,
          });
        } catch {}
      }

      // Fail op-b 1 time
      try {
        await recovery.executeWithRetry(failingOp, 'op-b', {
          maxRetries: 0,
          retryDelay: 0,
          exponentialBackoff: false,
        });
      } catch {}

      expect(recovery.isFrequentlyFailing('op-a', 3)).toBe(true);
      expect(recovery.isFrequentlyFailing('op-b', 3)).toBe(false);
    });

    test('should handle null/undefined error messages gracefully', async () => {
      const operation = jest.fn().mockRejectedValue(new Error());

      const promise = recovery.executeWithRetry(operation, 'null-error', {
        maxRetries: 0,
        retryDelay: 0,
        exponentialBackoff: false,
      });

      await expect(promise).rejects.toThrow('null-error failed after 1 attempts');
    });
  });
});
