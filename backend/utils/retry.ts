import { createModuleLogger } from './logger';

const logger = createModuleLogger('retry', 'LOG_LEVEL_RETRY');

/**
 * Options for retry logic with exponential backoff
 */
export interface RetryOptions {
  maxAttempts: number;
  initialDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
  retryableErrors?: (error: any) => boolean;
  onRetry?: (attempt: number, error: any) => void;
}

/**
 * Default retry options
 */
const DEFAULT_RETRY_OPTIONS: RetryOptions = {
  maxAttempts: 3,
  initialDelayMs: 1000,
  maxDelayMs: 30000,
  backoffMultiplier: 2,
  retryableErrors: (error) => {
    // Retry on network errors, rate limits, timeouts
    const retryableCodes = ['ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'ECONNREFUSED'];
    const retryableStatuses = [429, 503, 504];

    return (
      retryableCodes.includes(error.code) ||
      retryableStatuses.includes(error.status) ||
      retryableStatuses.includes(error.statusCode) ||
      error.message?.toLowerCase().includes('timeout') ||
      error.message?.toLowerCase().includes('rate limit')
    );
  }
};

/**
 * Executes an operation with exponential backoff retry logic
 */
export async function withRetry<T>(
  operation: () => Promise<T>,
  options: Partial<RetryOptions> = {}
): Promise<T> {
  const opts = { ...DEFAULT_RETRY_OPTIONS, ...options };
  let lastError: any;

  for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
    try {
      const result = await operation();

      logger.trace('Operation succeeded', {
        attempt,
        max_attempts: opts.maxAttempts
      });

      return result;
    } catch (error: any) {
      lastError = error;

      // Check if error is retryable
      if (!opts.retryableErrors!(error)) {
        logger.debug('Error not retryable, throwing immediately', {
          error: error.message,
          errorClass: error.constructor.name,
          attempt
        });
        throw error;
      }

      // Don't retry on last attempt
      if (attempt === opts.maxAttempts) {
        break;
      }

      // Calculate delay with exponential backoff
      const delayMs = Math.min(
        opts.initialDelayMs * Math.pow(opts.backoffMultiplier, attempt - 1),
        opts.maxDelayMs
      );

      // Call onRetry callback
      if (opts.onRetry) {
        opts.onRetry(attempt, error);
      }

      logger.warn('Operation failed, retrying with exponential backoff', {
        attempt,
        maxAttempts: opts.maxAttempts,
        delayMs,
        error: error.message,
        errorClass: error.constructor.name,
        errorCode: error.code,
        errorStatus: error.status || error.statusCode
      });

      // Wait before retry
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  logger.error('Operation failed after all retry attempts', {
    maxAttempts: opts.maxAttempts,
    error: lastError.message,
    errorClass: lastError.constructor.name,
    stack: lastError.stack
  });

  throw lastError;
}

/**
 * Circuit breaker states
 */
export enum CircuitState {
  CLOSED = 'CLOSED', // Normal operation
  OPEN = 'OPEN', // Failing, rejecting requests
  HALF_OPEN = 'HALF_OPEN' // Testing if service recovered
}

/**
 * Circuit breaker implementation to prevent cascading failures
 */
export class CircuitBreaker {
  private failures = 0;
  private lastFailureTime = 0;
  private state: CircuitState = CircuitState.CLOSED;
  private successCount = 0;

  constructor(
    private failureThreshold: number,
    private resetTimeoutMs: number,
    private halfOpenSuccessThreshold: number = 2
  ) {}

  /**
   * Execute operation with circuit breaker protection
   */
  async execute<T>(operation: () => Promise<T>): Promise<T> {
    // Check circuit state
    if (this.state === CircuitState.OPEN) {
      const timeSinceFailure = Date.now() - this.lastFailureTime;

      if (timeSinceFailure > this.resetTimeoutMs) {
        logger.info('Circuit breaker transitioning to HALF_OPEN', {
          timeSinceFailure,
          resetTimeoutMs: this.resetTimeoutMs
        });
        this.state = CircuitState.HALF_OPEN;
        this.successCount = 0;
      } else {
        const error = new Error('Circuit breaker is OPEN');
        (error as any).circuitState = this.state;
        logger.warn('Circuit breaker rejecting request', {
          state: this.state,
          failures: this.failures,
          timeSinceFailure,
          resetTimeoutMs: this.resetTimeoutMs
        });
        throw error;
      }
    }

    try {
      const result = await operation();
      this.onSuccess();

      logger.trace('Circuit breaker operation succeeded', {
        state: this.state,
        consecutive_failures: 0
      });

      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  /**
   * Handle successful operation
   */
  private onSuccess() {
    if (this.state === CircuitState.HALF_OPEN) {
      this.successCount++;

      if (this.successCount >= this.halfOpenSuccessThreshold) {
        logger.info('Circuit breaker transitioning to CLOSED', {
          successCount: this.successCount,
          threshold: this.halfOpenSuccessThreshold
        });
        this.state = CircuitState.CLOSED;
        this.failures = 0;
        this.successCount = 0;
      }
    } else if (this.state === CircuitState.CLOSED) {
      // Reset failure count on success
      this.failures = 0;
    }
  }

  /**
   * Handle failed operation
   */
  private onFailure() {
    this.failures++;
    this.lastFailureTime = Date.now();

    if (this.state === CircuitState.HALF_OPEN) {
      logger.warn('Circuit breaker transitioning to OPEN (failure in HALF_OPEN)', {
        failures: this.failures
      });
      this.state = CircuitState.OPEN;
      this.successCount = 0;
    } else if (this.state === CircuitState.CLOSED && this.failures >= this.failureThreshold) {
      logger.error('Circuit breaker transitioning to OPEN (threshold reached)', {
        failures: this.failures,
        threshold: this.failureThreshold
      });
      this.state = CircuitState.OPEN;
    }
  }

  /**
   * Get current circuit breaker state
   */
  getState(): CircuitState {
    return this.state;
  }

  /**
   * Get failure count
   */
  getFailures(): number {
    return this.failures;
  }

  /**
   * Manually reset circuit breaker
   */
  reset() {
    logger.info('Circuit breaker manually reset');
    this.state = CircuitState.CLOSED;
    this.failures = 0;
    this.successCount = 0;
  }
}

/**
 * Combines retry logic with circuit breaker for robust error handling
 */
export async function withRetryAndCircuitBreaker<T>(
  operation: () => Promise<T>,
  circuitBreaker: CircuitBreaker,
  retryOptions: Partial<RetryOptions> = {}
): Promise<T> {
  return await circuitBreaker.execute(async () => {
    return await withRetry(operation, retryOptions);
  });
}
