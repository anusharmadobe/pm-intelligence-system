/**
 * Simple Circuit Breaker Implementation
 *
 * Prevents cascading failures by failing fast when a service is unhealthy.
 * States: CLOSED (normal), OPEN (failing), HALF_OPEN (recovery testing)
 */

import { logger } from './logger';

export enum CircuitState {
  CLOSED = 'CLOSED',     // Normal operation
  OPEN = 'OPEN',         // Failing - reject requests immediately
  HALF_OPEN = 'HALF_OPEN' // Testing recovery - allow limited requests
}

export interface CircuitBreakerOptions {
  name: string;
  failureThreshold: number;     // Number of failures before opening
  successThreshold: number;      // Number of successes to close from half-open
  timeout: number;               // Timeout in ms for operations
  resetTimeout: number;          // Time in ms before trying half-open from open
  onStateChange?: (oldState: CircuitState, newState: CircuitState) => void;
}

export class CircuitBreaker<T = any> {
  private state: CircuitState = CircuitState.CLOSED;
  private failureCount: number = 0;
  private successCount: number = 0;
  private nextAttempt: number = Date.now();
  private readonly options: CircuitBreakerOptions;

  constructor(options: CircuitBreakerOptions) {
    this.options = options;
  }

  /**
   * Execute a function with circuit breaker protection
   */
  async execute(fn: () => Promise<T>): Promise<T> {
    // Check if circuit is open
    if (this.state === CircuitState.OPEN) {
      // Check if we should try half-open
      if (Date.now() < this.nextAttempt) {
        const error = new Error(`Circuit breaker OPEN for ${this.options.name}`);
        (error as any).circuitBreakerOpen = true;
        throw error;
      }
      // Try half-open
      this.transitionTo(CircuitState.HALF_OPEN);
    }

    try {
      // Execute with timeout
      const result = await this.executeWithTimeout(fn);

      // Record success
      this.onSuccess();

      return result;
    } catch (error) {
      // Record failure
      this.onFailure(error);
      throw error;
    }
  }

  /**
   * Execute function with timeout
   */
  private async executeWithTimeout(fn: () => Promise<T>): Promise<T> {
    return Promise.race([
      fn(),
      new Promise<T>((_, reject) =>
        setTimeout(
          () => reject(new Error(`Operation timed out after ${this.options.timeout}ms`)),
          this.options.timeout
        )
      )
    ]);
  }

  /**
   * Handle successful execution
   */
  private onSuccess(): void {
    this.failureCount = 0;

    if (this.state === CircuitState.HALF_OPEN) {
      this.successCount++;

      if (this.successCount >= this.options.successThreshold) {
        this.transitionTo(CircuitState.CLOSED);
        this.successCount = 0;
      }
    }
  }

  /**
   * Handle failed execution
   */
  private onFailure(error: any): void {
    this.failureCount++;

    logger.warn('Circuit breaker recorded failure', {
      name: this.options.name,
      state: this.state,
      failure_count: this.failureCount,
      threshold: this.options.failureThreshold,
      error: error.message
    });

    if (this.state === CircuitState.HALF_OPEN) {
      // Single failure in half-open => back to open
      this.transitionTo(CircuitState.OPEN);
      this.successCount = 0;
    } else if (this.failureCount >= this.options.failureThreshold) {
      // Too many failures => open circuit
      this.transitionTo(CircuitState.OPEN);
    }
  }

  /**
   * Transition to a new state
   */
  private transitionTo(newState: CircuitState): void {
    const oldState = this.state;

    if (oldState === newState) {
      return;
    }

    this.state = newState;

    if (newState === CircuitState.OPEN) {
      this.nextAttempt = Date.now() + this.options.resetTimeout;
    }

    logger.info('Circuit breaker state changed', {
      name: this.options.name,
      old_state: oldState,
      new_state: newState,
      failure_count: this.failureCount,
      next_attempt: newState === CircuitState.OPEN ? new Date(this.nextAttempt).toISOString() : 'N/A'
    });

    // Call optional callback
    if (this.options.onStateChange) {
      try {
        this.options.onStateChange(oldState, newState);
      } catch (error: any) {
        logger.error('Circuit breaker state change callback failed', {
          name: this.options.name,
          error: error.message
        });
      }
    }
  }

  /**
   * Get current state
   */
  getState(): CircuitState {
    return this.state;
  }

  /**
   * Get current statistics
   */
  getStats() {
    return {
      state: this.state,
      failure_count: this.failureCount,
      success_count: this.successCount,
      next_attempt: this.state === CircuitState.OPEN ? new Date(this.nextAttempt).toISOString() : null
    };
  }

  /**
   * Manually reset the circuit breaker
   */
  reset(): void {
    this.state = CircuitState.CLOSED;
    this.failureCount = 0;
    this.successCount = 0;
    this.nextAttempt = Date.now();

    logger.info('Circuit breaker manually reset', {
      name: this.options.name
    });
  }
}

/**
 * Factory function to create a circuit breaker
 */
export function createCircuitBreaker<T = any>(options: CircuitBreakerOptions): CircuitBreaker<T> {
  return new CircuitBreaker<T>(options);
}
