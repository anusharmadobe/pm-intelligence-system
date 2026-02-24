/**
 * Structured Logging Utilities
 *
 * Provides standardized logging helpers with consistent field names,
 * sensitive data redaction, and rich context propagation.
 */

import { logger } from './logger';

/**
 * Standard field names for consistent logging across the application
 */
export const LogFields = {
  // Request/Response
  REQUEST_ID: 'requestId',
  CORRELATION_ID: 'correlationId',
  USER_ID: 'userId',
  SESSION_ID: 'sessionId',
  HTTP_METHOD: 'httpMethod',
  HTTP_PATH: 'httpPath',
  HTTP_STATUS: 'httpStatus',

  // Performance
  DURATION_MS: 'durationMs',
  RESPONSE_TIME_MS: 'responseTimeMs',
  QUERY_TIME_MS: 'queryTimeMs',

  // Database
  DB_OPERATION: 'dbOperation',
  DB_TABLE: 'dbTable',
  DB_ROWS_AFFECTED: 'dbRowsAffected',

  // External Services
  EXTERNAL_SERVICE: 'externalService',
  EXTERNAL_API: 'externalApi',
  EXTERNAL_STATUS: 'externalStatus',

  // Business Logic
  SIGNAL_ID: 'signalId',
  OPPORTUNITY_ID: 'opportunityId',
  AGENT_ID: 'agentId',
  JIRA_ISSUE: 'jiraIssue',

  // Errors
  ERROR_TYPE: 'errorType',
  ERROR_CODE: 'errorCode',
  ERROR_MESSAGE: 'errorMessage',
  ERROR_STACK: 'errorStack',

  // System
  MODULE: 'module',
  OPERATION: 'operation',
  ENVIRONMENT: 'environment',
  VERSION: 'version'
} as const;

/**
 * Sensitive fields that should be redacted in logs
 */
const SENSITIVE_PATTERNS = [
  /password/i,
  /secret/i,
  /token/i,
  /api[_-]?key/i,
  /auth/i,
  /credential/i,
  /bearer/i,
  /session[_-]?id/i
];

/**
 * Check if a field name is sensitive
 */
function isSensitiveField(key: string): boolean {
  return SENSITIVE_PATTERNS.some(pattern => pattern.test(key));
}

/**
 * Redact sensitive data from objects
 */
export function redactSensitiveData(data: any, depth = 0): any {
  if (depth > 5) return '[Max Depth]'; // Prevent infinite recursion

  if (data === null || data === undefined) return data;

  if (typeof data === 'string') {
    // Redact strings that look like tokens/keys
    if (data.length > 20 && (data.startsWith('pk_') || data.startsWith('Bearer '))) {
      return '[REDACTED]';
    }
    return data;
  }

  if (Array.isArray(data)) {
    return data.map(item => redactSensitiveData(item, depth + 1));
  }

  if (typeof data === 'object') {
    const redacted: any = {};
    for (const [key, value] of Object.entries(data)) {
      if (isSensitiveField(key)) {
        redacted[key] = '[REDACTED]';
      } else {
        redacted[key] = redactSensitiveData(value, depth + 1);
      }
    }
    return redacted;
  }

  return data;
}

/**
 * Log HTTP request with standard fields
 */
export function logHttpRequest(metadata: {
  method: string;
  path: string;
  statusCode?: number;
  durationMs?: number;
  userId?: string;
  requestId?: string;
  correlationId?: string;
  [key: string]: any;
}): void {
  const logData = {
    [LogFields.HTTP_METHOD]: metadata.method,
    [LogFields.HTTP_PATH]: metadata.path,
    [LogFields.HTTP_STATUS]: metadata.statusCode,
    [LogFields.DURATION_MS]: metadata.durationMs,
    [LogFields.USER_ID]: metadata.userId,
    [LogFields.REQUEST_ID]: metadata.requestId,
    [LogFields.CORRELATION_ID]: metadata.correlationId,
    ...redactSensitiveData(metadata)
  };

  if (metadata.statusCode && metadata.statusCode >= 500) {
    logger.error('HTTP request failed', logData);
  } else if (metadata.statusCode && metadata.statusCode >= 400) {
    logger.warn('HTTP request client error', logData);
  } else {
    logger.info('HTTP request completed', logData);
  }
}

/**
 * Log database operation with standard fields
 */
export function logDatabaseOperation(metadata: {
  operation: string;
  table?: string;
  durationMs?: number;
  rowsAffected?: number;
  success: boolean;
  error?: Error;
  [key: string]: any;
}): void {
  const logData = {
    [LogFields.DB_OPERATION]: metadata.operation,
    [LogFields.DB_TABLE]: metadata.table,
    [LogFields.DURATION_MS]: metadata.durationMs,
    [LogFields.DB_ROWS_AFFECTED]: metadata.rowsAffected,
    ...redactSensitiveData(metadata)
  };

  if (!metadata.success && metadata.error) {
    logger.error('Database operation failed', {
      ...logData,
      [LogFields.ERROR_MESSAGE]: metadata.error.message,
      [LogFields.ERROR_STACK]: metadata.error.stack
    });
  } else if (metadata.durationMs && metadata.durationMs > 1000) {
    logger.warn('Slow database operation', logData);
  } else {
    logger.debug('Database operation completed', logData);
  }
}

/**
 * Log external API call with standard fields
 */
export function logExternalApiCall(metadata: {
  service: string;
  api: string;
  method?: string;
  statusCode?: number;
  durationMs?: number;
  success: boolean;
  error?: Error;
  [key: string]: any;
}): void {
  const logData = {
    [LogFields.EXTERNAL_SERVICE]: metadata.service,
    [LogFields.EXTERNAL_API]: metadata.api,
    [LogFields.HTTP_METHOD]: metadata.method,
    [LogFields.EXTERNAL_STATUS]: metadata.statusCode,
    [LogFields.DURATION_MS]: metadata.durationMs,
    ...redactSensitiveData(metadata)
  };

  if (!metadata.success && metadata.error) {
    logger.error('External API call failed', {
      ...logData,
      [LogFields.ERROR_MESSAGE]: metadata.error.message,
      [LogFields.ERROR_STACK]: metadata.error.stack
    });
  } else if (metadata.durationMs && metadata.durationMs > 5000) {
    logger.warn('Slow external API call', logData);
  } else {
    logger.info('External API call completed', logData);
  }
}

/**
 * Log business operation with standard fields
 */
export function logBusinessOperation(metadata: {
  operation: string;
  module: string;
  success: boolean;
  durationMs?: number;
  signalId?: string;
  opportunityId?: string;
  agentId?: string;
  error?: Error;
  [key: string]: any;
}): void {
  const logData = {
    [LogFields.OPERATION]: metadata.operation,
    [LogFields.MODULE]: metadata.module,
    [LogFields.DURATION_MS]: metadata.durationMs,
    [LogFields.SIGNAL_ID]: metadata.signalId,
    [LogFields.OPPORTUNITY_ID]: metadata.opportunityId,
    [LogFields.AGENT_ID]: metadata.agentId,
    ...redactSensitiveData(metadata)
  };

  if (!metadata.success && metadata.error) {
    logger.error('Business operation failed', {
      ...logData,
      [LogFields.ERROR_MESSAGE]: metadata.error.message,
      [LogFields.ERROR_STACK]: metadata.error.stack
    });
  } else {
    logger.info('Business operation completed', logData);
  }
}

/**
 * Log error with rich context
 */
export function logError(error: Error, context?: {
  module?: string;
  operation?: string;
  userId?: string;
  correlationId?: string;
  [key: string]: any;
}): void {
  const errorData: any = {
    [LogFields.ERROR_TYPE]: error.name,
    [LogFields.ERROR_MESSAGE]: error.message,
    [LogFields.ERROR_STACK]: error.stack
  };

  // Extract error code if available
  if ((error as any).code) {
    errorData[LogFields.ERROR_CODE] = (error as any).code;
  }

  // Add context
  if (context) {
    Object.assign(errorData, redactSensitiveData(context));
  }

  logger.error('Error occurred', errorData);
}

/**
 * Create a timer for measuring operation duration
 */
export interface OperationTimer {
  end: (metadata?: Record<string, any>) => void;
}

/**
 * Start timing an operation
 */
export function startOperationTimer(operation: string, module: string): OperationTimer {
  const startTime = Date.now();

  return {
    end: (metadata?: Record<string, any>) => {
      const durationMs = Date.now() - startTime;

      logger.debug('Operation timing', {
        [LogFields.OPERATION]: operation,
        [LogFields.MODULE]: module,
        [LogFields.DURATION_MS]: durationMs,
        ...redactSensitiveData(metadata || {})
      });
    }
  };
}

/**
 * Log with automatic timing
 */
export async function logWithTiming<T>(
  operation: string,
  module: string,
  fn: () => Promise<T>,
  metadata?: Record<string, any>
): Promise<T> {
  const startTime = Date.now();
  let success = false;
  let error: Error | undefined;

  try {
    const result = await fn();
    success = true;
    return result;
  } catch (err) {
    error = err as Error;
    throw err;
  } finally {
    const durationMs = Date.now() - startTime;

    if (error) {
      logger.error('Operation failed', {
        [LogFields.OPERATION]: operation,
        [LogFields.MODULE]: module,
        [LogFields.DURATION_MS]: durationMs,
        [LogFields.ERROR_MESSAGE]: error.message,
        [LogFields.ERROR_STACK]: error.stack,
        ...redactSensitiveData(metadata || {})
      });
    } else {
      logger.debug('Operation completed', {
        [LogFields.OPERATION]: operation,
        [LogFields.MODULE]: module,
        [LogFields.DURATION_MS]: durationMs,
        ...redactSensitiveData(metadata || {})
      });
    }
  }
}

/**
 * Security audit log
 */
export function logSecurityEvent(event: {
  type: 'auth_success' | 'auth_failure' | 'permission_denied' | 'api_key_created' | 'api_key_revoked';
  userId?: string;
  apiKeyId?: string;
  resource?: string;
  action?: string;
  ipAddress?: string;
  userAgent?: string;
  [key: string]: any;
}): void {
  const auditData = {
    securityEvent: event.type,
    [LogFields.USER_ID]: event.userId,
    apiKeyId: event.apiKeyId,
    resource: event.resource,
    action: event.action,
    ipAddress: event.ipAddress,
    userAgent: event.userAgent,
    timestamp: new Date().toISOString(),
    ...redactSensitiveData(event)
  };

  if (event.type === 'auth_failure' || event.type === 'permission_denied') {
    logger.warn('Security event', auditData);
  } else {
    logger.info('Security event', auditData);
  }
}
