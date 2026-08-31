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

  describe('getErrorStats', () => {
    test('should report instrumented operations with zero counts when no errors', () => {
      // `{}` meant both "healthy" and "nothing is instrumented", and an
      // operator could not tell which. Instrumented operations now
      // always appear, with explicit zeros (#286).
      // 'Browser Init', not 'Pattern Write': the seeded row names the
      // operation that actually runs. `handlePatternWrite` is reachable
      // only from `writePatternWithValidation`, which nothing in
      // `src/server` calls (#445).
      const stats = recovery.getErrorStats();
      expect(stats['Browser Init']).toEqual({
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
