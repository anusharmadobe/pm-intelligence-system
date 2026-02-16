/**
 * Structured Error Classes for PM Intelligence System
 *
 * Provides a hierarchy of domain-specific errors with consistent properties:
 * - Proper error names for logging and monitoring
 * - HTTP status codes for API responses
 * - Retryability hints for circuit breakers
 * - Correlation IDs for request tracing
 */

export class BaseError extends Error {
  public readonly statusCode: number;
  public readonly isRetryable: boolean;
  public readonly correlationId?: string;

  constructor(message: string, statusCode: number = 500, isRetryable: boolean = false, correlationId?: string) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.isRetryable = isRetryable;
    this.correlationId = correlationId;
    Error.captureStackTrace(this, this.constructor);
  }

  toJSON() {
    return {
      name: this.name,
      message: this.message,
      statusCode: this.statusCode,
      isRetryable: this.isRetryable,
      correlationId: this.correlationId
    };
  }
}

/**
 * Validation Errors (400)
 * Not retryable - client needs to fix input
 */
export class ValidationError extends BaseError {
  public readonly field?: string;

  constructor(message: string, field?: string, correlationId?: string) {
    super(message, 400, false, correlationId);
    this.field = field;
  }
}

/**
 * Extraction Errors (422)
 * Retryable - LLM output may be inconsistent
 */
export class ExtractionError extends BaseError {
  public readonly extractionType: string;
  public readonly signalId?: string;

  constructor(message: string, extractionType: string, signalId?: string, correlationId?: string) {
    super(message, 422, true, correlationId);
    this.extractionType = extractionType;
    this.signalId = signalId;
  }
}

/**
 * Entity Resolution Errors (422)
 * Partially retryable - depends on cause
 */
export class EntityResolutionError extends BaseError {
  public readonly mention: string;
  public readonly entityType?: string;

  constructor(message: string, mention: string, isRetryable: boolean = false, correlationId?: string) {
    super(message, 422, isRetryable, correlationId);
    this.mention = mention;
  }
}

/**
 * Infrastructure Errors (503)
 * Retryable - external service may recover
 */
export class InfrastructureError extends BaseError {
  public readonly service: string;

  constructor(message: string, service: string, correlationId?: string) {
    super(message, 503, true, correlationId);
    this.service = service;
  }
}

/**
 * Database Errors (500/503)
 * Retryable for transient issues
 */
export class DatabaseError extends InfrastructureError {
  public readonly query?: string;

  constructor(message: string, isRetryable: boolean = true, query?: string, correlationId?: string) {
    super(message, 'database', correlationId);
    this.statusCode = isRetryable ? 503 : 500;
    this.isRetryable = isRetryable;
    this.query = query;
  }
}

/**
 * Neo4j Sync Errors (503)
 * Retryable - queued to backlog
 */
export class Neo4jSyncError extends InfrastructureError {
  public readonly entityId?: string;

  constructor(message: string, entityId?: string, correlationId?: string) {
    super(message, 'neo4j', correlationId);
    this.entityId = entityId;
  }
}

/**
 * LLM Provider Errors (502/503/429)
 * Retryable based on error type
 */
export class LLMProviderError extends InfrastructureError {
  public readonly provider: string;
  public readonly errorCode?: string;

  constructor(message: string, provider: string, statusCode: number = 503, errorCode?: string, correlationId?: string) {
    super(message, provider, correlationId);
    this.statusCode = statusCode;
    this.provider = provider;
    this.errorCode = errorCode;

    // Rate limit errors are retryable with exponential backoff
    this.isRetryable = statusCode === 429 || statusCode === 503;
  }
}

/**
 * Rate Limit Errors (429)
 * Retryable with exponential backoff
 */
export class RateLimitError extends BaseError {
  public readonly retryAfter?: number; // seconds

  constructor(message: string, retryAfter?: number, correlationId?: string) {
    super(message, 429, true, correlationId);
    this.retryAfter = retryAfter;
  }
}

/**
 * Not Found Errors (404)
 * Not retryable
 */
export class NotFoundError extends BaseError {
  public readonly resourceType: string;
  public readonly resourceId: string;

  constructor(resourceType: string, resourceId: string, correlationId?: string) {
    super(`${resourceType} not found: ${resourceId}`, 404, false, correlationId);
    this.resourceType = resourceType;
    this.resourceId = resourceId;
  }
}

/**
 * Authentication Errors (401)
 * Not retryable
 */
export class AuthenticationError extends BaseError {
  constructor(message: string = 'Authentication required', correlationId?: string) {
    super(message, 401, false, correlationId);
  }
}

/**
 * Authorization Errors (403)
 * Not retryable
 */
export class AuthorizationError extends BaseError {
  public readonly resource?: string;
  public readonly action?: string;

  constructor(message: string = 'Insufficient permissions', resource?: string, action?: string, correlationId?: string) {
    super(message, 403, false, correlationId);
    this.resource = resource;
    this.action = action;
  }
}

/**
 * Circuit Breaker Open Error (503)
 * Retryable after cooldown period
 */
export class CircuitBreakerError extends InfrastructureError {
  public readonly cooldownSeconds: number;

  constructor(service: string, cooldownSeconds: number, correlationId?: string) {
    super(`Circuit breaker open for ${service}. Retry after ${cooldownSeconds}s`, service, correlationId);
    this.cooldownSeconds = cooldownSeconds;
  }
}

/**
 * Timeout Errors (504)
 * Retryable
 */
export class TimeoutError extends BaseError {
  public readonly operation: string;
  public readonly timeoutMs: number;

  constructor(operation: string, timeoutMs: number, correlationId?: string) {
    super(`Operation '${operation}' timed out after ${timeoutMs}ms`, 504, true, correlationId);
    this.operation = operation;
    this.timeoutMs = timeoutMs;
  }
}

/**
 * Conflict Errors (409)
 * Not retryable - client needs to resolve conflict
 */
export class ConflictError extends BaseError {
  public readonly conflictType: string;

  constructor(message: string, conflictType: string, correlationId?: string) {
    super(message, 409, false, correlationId);
    this.conflictType = conflictType;
  }
}

/**
 * Helper function to determine if an error is retriable
 */
export function isRetryableError(error: Error): boolean {
  if (error instanceof BaseError) {
    return error.isRetryable;
  }

  // Common transient error patterns
  const retryablePatterns = [
    /ECONNREFUSED/,
    /ETIMEDOUT/,
    /ENOTFOUND/,
    /ECONNRESET/,
    /socket hang up/,
    /network timeout/,
    /429/,
    /503/,
    /504/
  ];

  return retryablePatterns.some(pattern => pattern.test(error.message));
}

/**
 * Helper function to extract status code from error
 */
export function getStatusCode(error: Error): number {
  if (error instanceof BaseError) {
    return error.statusCode;
  }
  return 500;
}

/**
 * Helper function to create error response for API
 */
export function toErrorResponse(error: Error, includeStack: boolean = false) {
  const response: any = {
    error: {
      name: error.name,
      message: error.message
    }
  };

  if (error instanceof BaseError) {
    response.error.statusCode = error.statusCode;
    response.error.isRetryable = error.isRetryable;
    if (error.correlationId) {
      response.error.correlationId = error.correlationId;
    }
  }

  if (includeStack && error.stack) {
    response.error.stack = error.stack;
  }

  return response;
}
