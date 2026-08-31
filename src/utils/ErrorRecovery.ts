/**
 * ErrorRecovery - Provides graceful error handling and recovery mechanisms
 * Ensures the MCP server can recover from browser crashes, network issues, and pattern errors
 */

import { Logger } from './Logger.js';

export interface RecoveryStrategy {
  maxRetries: number;
  retryDelay: number;
  exponentialBackoff: boolean;
  fallbackAction?: () => Promise<any>;
}

export class ErrorRecovery {
  private logger: Logger;
  private errorHistory: Map<string, number[]> = new Map();
  /**
   * Failures that a retry or fallback went on to rescue.
   *
   * Kept apart from `errorHistory` because success calls
   * clearErrorHistory, which used to erase exactly the case an operator
   * most wants to see — "writes are flaky but recovering on retry 2".
   * Measured before this: a run that failed once then succeeded
   * reported `{}`, indistinguishable from a run with no trouble at all
   * (#286).
   */
  private recoveredHistory: Map<string, number[]> = new Map();
  /**
   * Operations that actually feed these statistics. Only
   * handlePatternWrite routes through executeWithRetry today, so an
   * empty map meant "nothing instrumented reported trouble", not "the
   * system is healthy" — and the Record<string, …> shape implied
   * coverage that did not exist. Reported explicitly so a reader can
   * tell the two apart (#286).
   */
  private static readonly INSTRUMENTED_OPERATIONS = ['Pattern Write'];
  private readonly ERROR_WINDOW = 60000; // 1 minute window for error tracking

  constructor() {
    this.logger = new Logger();
  }

  /**
   * Executes an operation with automatic retry logic
   * @param operation - Async function to execute
   * @param operationName - Name for logging
   * @param strategy - Recovery strategy configuration
   * @returns Result of the operation
   */
  async executeWithRetry<T>(
    operation: () => Promise<T>,
    operationName: string,
    strategy: RecoveryStrategy = {
      maxRetries: 3,
      retryDelay: 1000,
      exponentialBackoff: true
    }
  ): Promise<T> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= strategy.maxRetries; attempt++) {
      try {
        this.logger.debug(`Executing ${operationName} (attempt ${attempt + 1}/${strategy.maxRetries + 1})`);
        const result = await operation();

        // Success. The failures that preceded it still happened, so
        // move them to the recovered log rather than dropping them —
        // dropping them is what made recovered flakiness invisible
        // (#286). recordRecovery clears the outstanding bucket itself.
        this.recordRecovery(operationName);
        this.clearErrorHistory(operationName);
        return result;

      } catch (error: any) {
        lastError = error;
        this.recordError(operationName);

        this.logger.warn(
          `${operationName} failed (attempt ${attempt + 1}/${strategy.maxRetries + 1})`,
          { error: error.message }
        );

        // Don't retry on last attempt
        if (attempt < strategy.maxRetries) {
          const delay = strategy.exponentialBackoff
            ? strategy.retryDelay * Math.pow(2, attempt)
            : strategy.retryDelay;

          this.logger.debug(`Waiting ${delay}ms before retry`);
          await this.sleep(delay);
        }
      }
    }

    // All retries failed
    this.logger.error(`${operationName} failed after ${strategy.maxRetries + 1} attempts`);

    // Try fallback if available
    if (strategy.fallbackAction) {
      this.logger.info(`Executing fallback for ${operationName}`);
      try {
        const fallbackResult = await strategy.fallbackAction();
        // The fallback rescued it, so these failures are recovered too.
        this.recordRecovery(operationName);
        return fallbackResult;
      } catch (fallbackError: any) {
        this.logger.error(`Fallback failed for ${operationName}`, fallbackError);
      }
    }

    throw new Error(
      `${operationName} failed after ${strategy.maxRetries + 1} attempts: ${lastError?.message}`
    );
  }

  /**
   * Wraps an operation with timeout protection
   * @param operation - Async function to execute
   * @param timeout - Timeout in milliseconds
   * @param operationName - Name for error messages
   * @returns Result of the operation
   */
  async executeWithTimeout<T>(
    operation: () => Promise<T>,
    timeout: number,
    operationName: string
  ): Promise<T> {
    return Promise.race([
      operation(),
      this.createTimeout<T>(timeout, operationName)
    ]);
  }

  /**
   * Combines retry logic with timeout protection
   * @param operation - Async function to execute
   * @param operationName - Name for logging
   * @param timeout - Timeout per attempt in milliseconds
   * @param strategy - Recovery strategy
   * @returns Result of the operation
   */
  async executeWithRetryAndTimeout<T>(
    operation: () => Promise<T>,
    operationName: string,
    timeout: number,
    strategy?: RecoveryStrategy
  ): Promise<T> {
    return this.executeWithRetry(
      () => this.executeWithTimeout(operation, timeout, operationName),
      operationName,
      strategy
    );
  }

  /**
   * Gracefully handles browser initialization errors
   * @param initFunction - Browser initialization function
   * @returns Initialization result
   */
  async handleBrowserInit(initFunction: () => Promise<string>): Promise<string> {
    return this.executeWithRetryAndTimeout(
      initFunction,
      'Browser Initialization',
      30000, // 30 second timeout
      {
        maxRetries: 2,
        retryDelay: 2000,
        exponentialBackoff: true,
        fallbackAction: async () => {
          this.logger.warn('Browser initialization failed, suggesting headless mode');
          return 'Browser initialization failed. Try setting headless:true in config.json';
        }
      }
    );
  }

  /**
   * Handles pattern write errors with validation
   * @param writeFunction - Pattern write function
   * @param pattern - Pattern to write
   * @returns Write result
   */
  async handlePatternWrite(
    writeFunction: (pattern: string) => Promise<string>,
    pattern: string
  ): Promise<string> {
    return this.executeWithRetry(
      () => writeFunction(pattern),
      'Pattern Write',
      {
        maxRetries: 2,
        retryDelay: 500,
        exponentialBackoff: false,
        fallbackAction: async () => {
          // Try writing a simplified version
          const simplified = this.simplifyPattern(pattern);
          this.logger.info('Attempting to write simplified pattern');
          return writeFunction(simplified);
        }
      }
    );
  }

  /**
   * Checks if an operation is experiencing repeated failures
   * @param operationName - Name of operation to check
   * @param threshold - Number of errors to consider "frequent"
   * @returns True if operation is failing frequently
   */
  isFrequentlyFailing(operationName: string, threshold: number = 3): boolean {
    const errors = this.errorHistory.get(operationName) || [];
    const now = Date.now();

    // Count errors within the time window
    const recentErrors = errors.filter(timestamp => now - timestamp < this.ERROR_WINDOW);

    return recentErrors.length >= threshold;
  }

  /**
   * Gets error statistics for monitoring
   * @returns Error statistics by operation
   */
  getErrorStats(): Record<string, {
    count: number;
    lastError: Date | null;
    recovered: number;
    lastRecovery: Date | null;
  }> {
    const stats: Record<string, {
      count: number;
      lastError: Date | null;
      recovered: number;
      lastRecovery: Date | null;
    }> = {};
    const now = Date.now();
    const recent = (ts: number[]) => ts.filter(t => now - t < this.ERROR_WINDOW);

    // Seed with every instrumented operation so an all-zero row is
    // distinguishable from an operation nothing ever watched. `{}` used
    // to mean both.
    const operations = new Set<string>([
      ...ErrorRecovery.INSTRUMENTED_OPERATIONS,
      ...this.errorHistory.keys(),
      ...this.recoveredHistory.keys(),
    ]);

    for (const operation of operations) {
      const failed = recent(this.errorHistory.get(operation) ?? []);
      const rescued = recent(this.recoveredHistory.get(operation) ?? []);
      stats[operation] = {
        count: failed.length,
        lastError: failed.length > 0 ? new Date(Math.max(...failed)) : null,
        recovered: rescued.length,
        lastRecovery: rescued.length > 0 ? new Date(Math.max(...rescued)) : null,
      };
    }

    return stats;
  }

  /**
   * Clears error history for a specific operation
   * @param operationName - Operation to clear
   */
  clearErrorHistory(operationName: string): void {
    this.errorHistory.delete(operationName);
  }

  /**
   * Clears all error history
   */
  clearAllErrorHistory(): void {
    this.errorHistory.clear();
    this.recoveredHistory.clear();
  }

  /**
   * Moves an operation's recorded failures into the recovered log.
   *
   * Called when a retry or fallback rescues the operation, so the
   * failures survive the clearErrorHistory that follows.
   *
   * @param operationName - Name of the operation
   */
  private recordRecovery(operationName: string): void {
    const failures = this.errorHistory.get(operationName);
    if (!failures || failures.length === 0) return;

    const now = Date.now();
    const existing = this.recoveredHistory.get(operationName) ?? [];
    const merged = [...existing, ...failures]
      .filter(ts => now - ts < this.ERROR_WINDOW);
    this.recoveredHistory.set(operationName, merged);
    // A move, not a copy: a failure belongs in exactly one bucket, or
    // the fallback path reports the same three failures as both
    // outstanding and rescued.
    this.errorHistory.delete(operationName);
  }

  /**
   * Records an error occurrence
   * @param operationName - Name of the operation
   */
  private recordError(operationName: string): void {
    const errors = this.errorHistory.get(operationName) || [];
    errors.push(Date.now());

    // Keep only recent errors
    const now = Date.now();
    const recentErrors = errors.filter(ts => now - ts < this.ERROR_WINDOW);

    this.errorHistory.set(operationName, recentErrors);
  }

  /**
   * Creates a timeout promise
   * @param ms - Timeout in milliseconds
   * @param operationName - Name for error message
   * @returns Promise that rejects after timeout
   */
  private createTimeout<T>(ms: number, operationName: string): Promise<T> {
    return new Promise((_, reject) => {
      setTimeout(() => {
        reject(new Error(`${operationName} timed out after ${ms}ms`));
      }, ms);
    });
  }

  /**
   * Sleep utility
   * @param ms - Milliseconds to sleep
   * @returns Promise that resolves after delay
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Simplifies a pattern by removing complex modifiers
   * @param pattern - Original pattern
   * @returns Simplified pattern
   */
  private simplifyPattern(pattern: string): string {
    // Remove complex modifiers but keep core structure
    let simplified = pattern;

    // Remove effect chains but keep basic sound/note calls
    simplified = simplified.replace(/\.(delay|reverb|room|lpf|hpf|bpf)\([^)]*\)/g, '');

    // Remove complex transformations
    simplified = simplified.replace(/\.(jux|iter|chop|striate|scramble)\([^)]*\)/g, '');

    // Remove conditional modifications
    simplified = simplified.replace(/\.(sometimes|often|rarely|every)\([^)]*\)/g, '');

    this.logger.debug('Pattern simplified', {
      original: pattern.substring(0, 50) + '...',
      simplified: simplified.substring(0, 50) + '...'
    });

    return simplified;
  }

  /**
   * Handles network-related errors
   * @param operation - Operation that may fail due to network
   * @param operationName - Name for logging
   * @returns Operation result
   */
  async handleNetworkOperation<T>(
    operation: () => Promise<T>,
    operationName: string
  ): Promise<T> {
    return this.executeWithRetry(
      operation,
      operationName,
      {
        maxRetries: 5,
        retryDelay: 2000,
        exponentialBackoff: true,
        fallbackAction: async () => {
          throw new Error(`Network operation ${operationName} failed - check internet connection`);
        }
      }
    );
  }

  /**
   * Creates a circuit breaker for operations that fail frequently
   * @param operation - Operation to protect
   * @param operationName - Name for tracking
   * @param threshold - Number of failures before circuit opens
   * @returns Protected operation
   */
  createCircuitBreaker<T>(
    operation: () => Promise<T>,
    operationName: string,
    threshold: number = 5
  ): () => Promise<T> {
    return async () => {
      if (this.isFrequentlyFailing(operationName, threshold)) {
        throw new Error(
          `Circuit breaker open for ${operationName} - operation disabled due to repeated failures`
        );
      }

      return operation();
    };
  }
}
