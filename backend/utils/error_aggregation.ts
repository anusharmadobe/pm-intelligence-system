/**
 * Error Aggregation System
 *
 * Aggregates errors by type and message for monitoring and alerting
 */

import { createHash } from 'crypto';
import { getDbPool } from '../db/connection';
import { logger } from './logger';
import { getCorrelationContext } from './correlation';

export interface ErrorOccurrence {
  errorType: string;
  errorCode?: string;
  errorMessage: string;
  stackTrace?: string;
  module: string;
  operation?: string;
  httpMethod?: string;
  httpPath?: string;
  httpStatus?: number;
  metadata?: Record<string, any>;
}

/**
 * Generate a hash for error grouping
 */
function generateErrorHash(errorType: string, errorMessage: string): string {
  // Normalize error message by removing variable parts (IDs, timestamps, etc.)
  const normalized = errorMessage
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '[UUID]')
    .replace(/\b\d{13,}\b/g, '[TIMESTAMP]')
    .replace(/\b\d+\b/g, '[NUMBER]')
    .replace(/['"][^'"]+['"]/g, '[STRING]')
    .substring(0, 500); // Limit length

  const input = `${errorType}:${normalized}`;
  return createHash('sha256').update(input).digest('hex');
}

/**
 * Track an error occurrence
 */
export async function trackError(error: ErrorOccurrence): Promise<void> {
  const pool = getDbPool();
  const context = getCorrelationContext();
  const errorHash = generateErrorHash(error.errorType, error.errorMessage);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Insert or update aggregation
    const aggResult = await client.query(
      `INSERT INTO error_aggregation (
        error_type, error_code, error_message, error_hash, module, operation,
        occurrence_count, first_seen_at, last_seen_at,
        last_stack_trace, last_correlation_id, last_request_id, last_user_id, last_metadata
      ) VALUES ($1, $2, $3, $4, $5, $6, 1, NOW(), NOW(), $7, $8, $9, $10, $11)
      ON CONFLICT (error_hash, module) DO UPDATE SET
        occurrence_count = error_aggregation.occurrence_count + 1,
        last_seen_at = NOW(),
        last_stack_trace = EXCLUDED.last_stack_trace,
        last_correlation_id = EXCLUDED.last_correlation_id,
        last_request_id = EXCLUDED.last_request_id,
        last_user_id = EXCLUDED.last_user_id,
        last_metadata = EXCLUDED.last_metadata,
        updated_at = NOW()
      RETURNING id`,
      [
        error.errorType,
        error.errorCode || null,
        error.errorMessage,
        errorHash,
        error.module,
        error.operation || null,
        error.stackTrace || null,
        context?.correlationId || null,
        context?.requestId || null,
        context?.userId || null,
        JSON.stringify(error.metadata || {})
      ]
    );

    const aggregationId = aggResult.rows[0].id;

    // Insert individual occurrence
    await client.query(
      `INSERT INTO error_occurrences (
        aggregation_id, error_type, error_code, error_message, stack_trace,
        correlation_id, request_id, user_id, module, operation,
        http_method, http_path, http_status, metadata
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
      [
        aggregationId,
        error.errorType,
        error.errorCode || null,
        error.errorMessage,
        error.stackTrace || null,
        context?.correlationId || null,
        context?.requestId || null,
        context?.userId || null,
        error.module,
        error.operation || null,
        error.httpMethod || null,
        error.httpPath || null,
        error.httpStatus || null,
        JSON.stringify(error.metadata || {})
      ]
    );

    await client.query('COMMIT');
  } catch (err: any) {
    await client.query('ROLLBACK');
    // Don't throw - error tracking should not break the request
    logger.error('Failed to track error occurrence', {
      error: err.message,
      errorType: error.errorType,
      module: error.module
    });
  } finally {
    client.release();
  }
}

/**
 * Track an error from an Error object
 */
export async function trackErrorFromException(
  error: Error,
  module: string,
  operation?: string,
  metadata?: Record<string, any>
): Promise<void> {
  await trackError({
    errorType: error.name || 'Error',
    errorCode: (error as any).code,
    errorMessage: error.message,
    stackTrace: error.stack,
    module,
    operation,
    metadata
  });
}

/**
 * Get aggregated errors
 */
export async function getAggregatedErrors(params: {
  module?: string;
  errorType?: string;
  unresolvedOnly?: boolean;
  minOccurrences?: number;
  hours?: number;
  limit?: number;
}): Promise<any[]> {
  const pool = getDbPool();

  const conditions: string[] = [];
  const values: any[] = [];
  let paramIndex = 1;

  if (params.module) {
    conditions.push(`module = $${paramIndex++}`);
    values.push(params.module);
  }

  if (params.errorType) {
    conditions.push(`error_type = $${paramIndex++}`);
    values.push(params.errorType);
  }

  if (params.unresolvedOnly) {
    conditions.push('resolved = false');
  }

  if (params.minOccurrences) {
    conditions.push(`occurrence_count >= $${paramIndex++}`);
    values.push(params.minOccurrences);
  }

  if (params.hours) {
    conditions.push(`last_seen_at >= NOW() - INTERVAL '${params.hours} hours'`);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = params.limit || 100;

  const result = await pool.query(
    `SELECT * FROM error_aggregation
     ${whereClause}
     ORDER BY last_seen_at DESC
     LIMIT $${paramIndex}`,
    [...values, limit]
  );

  return result.rows;
}

/**
 * Get error occurrences for a specific aggregation
 */
export async function getErrorOccurrences(
  aggregationId: string,
  limit: number = 50
): Promise<any[]> {
  const pool = getDbPool();

  const result = await pool.query(
    `SELECT * FROM error_occurrences
     WHERE aggregation_id = $1
     ORDER BY occurred_at DESC
     LIMIT $2`,
    [aggregationId, limit]
  );

  return result.rows;
}

/**
 * Mark an aggregated error as resolved
 */
export async function resolveError(
  aggregationId: string,
  resolvedBy: string,
  resolutionNotes?: string
): Promise<boolean> {
  const pool = getDbPool();

  const result = await pool.query(
    `UPDATE error_aggregation
     SET resolved = true,
         resolved_at = NOW(),
         resolved_by = $2,
         resolution_notes = $3,
         updated_at = NOW()
     WHERE id = $1 AND resolved = false
     RETURNING id`,
    [aggregationId, resolvedBy, resolutionNotes || null]
  );

  return result.rows.length > 0;
}

/**
 * Get error statistics
 */
export async function getErrorStats(params: {
  module?: string;
  hours?: number;
}): Promise<{
  totalErrors: number;
  uniqueErrors: number;
  unresolvedErrors: number;
  errorRate: number;
  topErrors: Array<{
    errorType: string;
    module: string;
    occurrenceCount: number;
  }>;
}> {
  const pool = getDbPool();
  const hours = params.hours || 24;

  const conditions: string[] = [`last_seen_at >= NOW() - INTERVAL '${hours} hours'`];
  const values: any[] = [];
  let paramIndex = 1;

  if (params.module) {
    conditions.push(`module = $${paramIndex++}`);
    values.push(params.module);
  }

  const whereClause = conditions.join(' AND ');

  // Get overall stats
  const statsResult = await pool.query(
    `SELECT
      COUNT(*) AS unique_errors,
      SUM(occurrence_count) AS total_errors,
      SUM(CASE WHEN resolved = false THEN 1 ELSE 0 END) AS unresolved_errors
    FROM error_aggregation
    WHERE ${whereClause}`,
    values
  );

  const stats = statsResult.rows[0];

  // Get top errors
  const topErrorsResult = await pool.query(
    `SELECT error_type, module, occurrence_count
    FROM error_aggregation
    WHERE ${whereClause}
    ORDER BY occurrence_count DESC
    LIMIT 10`,
    values
  );

  return {
    totalErrors: parseInt(stats.total_errors) || 0,
    uniqueErrors: parseInt(stats.unique_errors) || 0,
    unresolvedErrors: parseInt(stats.unresolved_errors) || 0,
    errorRate: 0, // Would need total request count to calculate
    topErrors: topErrorsResult.rows.map(row => ({
      errorType: row.error_type,
      module: row.module,
      occurrenceCount: parseInt(row.occurrence_count)
    }))
  };
}

/**
 * Get error trend over time
 */
export async function getErrorTrend(params: {
  module?: string;
  errorType?: string;
  hours?: number;
  intervalMinutes?: number;
}): Promise<Array<{
  timestamp: Date;
  errorCount: number;
}>> {
  const pool = getDbPool();
  const hours = params.hours || 24;
  const intervalMinutes = params.intervalMinutes || 60;

  const conditions: string[] = [`occurred_at >= NOW() - INTERVAL '${hours} hours'`];
  const values: any[] = [];
  let paramIndex = 1;

  if (params.module) {
    conditions.push(`module = $${paramIndex++}`);
    values.push(params.module);
  }

  if (params.errorType) {
    conditions.push(`error_type = $${paramIndex++}`);
    values.push(params.errorType);
  }

  const whereClause = conditions.join(' AND ');

  const result = await pool.query(
    `SELECT
      DATE_TRUNC('hour', occurred_at) +
        INTERVAL '${intervalMinutes} minutes' *
        FLOOR(EXTRACT(MINUTE FROM occurred_at) / ${intervalMinutes}) AS timestamp,
      COUNT(*) AS error_count
    FROM error_occurrences
    WHERE ${whereClause}
    GROUP BY timestamp
    ORDER BY timestamp ASC`,
    values
  );

  return result.rows.map(row => ({
    timestamp: row.timestamp,
    errorCount: parseInt(row.error_count)
  }));
}
