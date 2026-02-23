import { AsyncLocalStorage } from 'async_hooks';
import { v4 as uuidv4 } from 'uuid';
import { Request, Response, NextFunction } from 'express';

const correlationLogLevel = (process.env.LOG_LEVEL_CORRELATION || process.env.LOG_LEVEL || 'info').toLowerCase();
function shouldLog(level: 'trace' | 'debug'): boolean {
  if (correlationLogLevel === 'trace') return true;
  if (level === 'debug' && (correlationLogLevel === 'debug' || correlationLogLevel === 'trace')) return true;
  return false;
}
function logCorrelation(level: 'trace' | 'debug', message: string, meta: Record<string, any>): void {
  if (!shouldLog(level)) return;
  const payload = {
    ts: new Date().toISOString(),
    level,
    module: 'correlation',
    msg: message,
    ...meta
  };
  if (level === 'trace') {
    console.debug(JSON.stringify(payload));
  } else {
    console.log(JSON.stringify(payload));
  }
}

/**
 * Correlation context for distributed tracing
 * Propagates through async operations automatically
 */
export interface CorrelationContext {
  correlationId: string;
  requestId?: string;
  userId?: string;
  signalId?: string;
  sessionId?: string;
  operation?: string;
  startTime?: number;
  agentId?: string;                  // Agent ID for cost attribution
  costTrackingEnabled?: boolean;     // Feature flag for cost tracking
}

// AsyncLocalStorage provides automatic context propagation across async boundaries
const asyncLocalStorage = new AsyncLocalStorage<CorrelationContext>();

/**
 * Get current correlation context
 */
export function getCorrelationContext(): CorrelationContext | undefined {
  return asyncLocalStorage.getStore();
}

/**
 * Get correlation ID from context
 */
export function getCorrelationId(): string | undefined {
  return getCorrelationContext()?.correlationId;
}

/**
 * Get request ID from context
 */
export function getRequestId(): string | undefined {
  return getCorrelationContext()?.requestId;
}

/**
 * Run function with correlation context
 */
export function withCorrelationContext<T>(
  context: Partial<CorrelationContext>,
  fn: () => T
): T {
  const existingContext = getCorrelationContext();
  const newContext: CorrelationContext = {
    ...existingContext,
    ...context,
    correlationId: context.correlationId || existingContext?.correlationId || uuidv4(),
    startTime: context.startTime || existingContext?.startTime || Date.now()
  };

  return asyncLocalStorage.run(newContext, fn);
}

/**
 * Run async function with correlation context
 */
export async function withCorrelationContextAsync<T>(
  context: Partial<CorrelationContext>,
  fn: () => Promise<T>
): Promise<T> {
  const existingContext = getCorrelationContext();
  const newContext: CorrelationContext = {
    ...existingContext,
    ...context,
    correlationId: context.correlationId || existingContext?.correlationId || uuidv4(),
    startTime: context.startTime || existingContext?.startTime || Date.now()
  };

  return asyncLocalStorage.run(newContext, fn);
}

/**
 * Update current correlation context
 */
export function updateCorrelationContext(update: Partial<CorrelationContext>): void {
  const current = getCorrelationContext();
  if (current) {
    Object.assign(current, update);
  }
}

/**
 * Get context for logging (safe for JSON serialization)
 */
export function getLoggingContext(): Record<string, any> {
  const context = getCorrelationContext();
  if (!context) return {};

  const result: Record<string, any> = {
    correlationId: context.correlationId
  };

  if (context.requestId) result.requestId = context.requestId;
  if (context.userId) result.userId = context.userId;
  if (context.signalId) result.signalId = context.signalId;
  if (context.sessionId) result.sessionId = context.sessionId;
  if (context.operation) result.operation = context.operation;
  if (context.startTime) {
    result.elapsedMs = Date.now() - context.startTime;
  }

  return result;
}

/**
 * Express middleware for correlation ID propagation
 * Extracts correlation ID from headers or generates new one
 * Adds correlation ID to response headers
 */
export function correlationMiddleware(req: Request, res: Response, next: NextFunction): void {
  // Extract correlation ID from incoming request headers
  const correlationId =
    (req.headers['x-correlation-id'] as string) ||
    (req.headers['x-request-id'] as string) ||
    uuidv4();

  const requestId = uuidv4();

  // Create initial context
  const context: CorrelationContext = {
    correlationId,
    requestId,
    operation: `${req.method} ${req.path}`,
    startTime: Date.now()
  };

  // Extract user ID from auth if available
  if ((req as any).user?.id) {
    context.userId = (req as any).user.id;
  }

  // Extract session ID if available
  const sessionId = (req as any).session?.id;
  if (sessionId) {
    context.sessionId = sessionId;
  }

  logCorrelation('debug', 'Correlation context created', {
    correlationId,
    requestId,
    method: req.method,
    path: req.path,
    hasUserId: !!context.userId,
    hasSessionId: !!context.sessionId
  });

  // Set response headers for downstream tracing
  res.setHeader('X-Correlation-ID', correlationId);
  res.setHeader('X-Request-ID', requestId);

  // Store in request for easy access
  (req as any).correlationId = correlationId;
  (req as any).requestId = requestId;

  // Run request handling in correlation context
  asyncLocalStorage.run(context, () => {
    next();
  });
}

/**
 * Create child correlation context for nested operations
 */
export function createChildContext(operation: string): CorrelationContext {
  const parent = getCorrelationContext();
  return {
    correlationId: parent?.correlationId || uuidv4(),
    requestId: parent?.requestId,
    userId: parent?.userId,
    operation,
    startTime: Date.now()
  };
}

/**
 * Measure operation duration and add to context
 */
export function measureOperation<T>(operation: string, fn: () => T): T {
  const start = Date.now();
  try {
    return fn();
  } finally {
    const duration = Date.now() - start;
    const context = getCorrelationContext();
    if (context) {
      (context as any)[`${operation}_duration_ms`] = duration;
    }
  }
}

/**
 * Measure async operation duration and add to context
 */
export async function measureOperationAsync<T>(operation: string, fn: () => Promise<T>): Promise<T> {
  const start = Date.now();
  let error: any = null;
  try {
    return await fn();
  } catch (err) {
    error = err;
    throw err;
  } finally {
    const duration = Date.now() - start;
    const context = getCorrelationContext();
    if (context) {
      (context as any)[`${operation}_duration_ms`] = duration;
    }

    logCorrelation('trace', 'Operation measured', {
      operation,
      duration_ms: duration,
      success: !error
    });
  }
}
