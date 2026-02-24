/**
 * Performance Metrics Collection
 *
 * Tracks detailed performance metrics to database for monitoring and analysis
 */

import { getDbPool } from '../db/connection';
import { logger } from './logger';
import { getCorrelationContext } from './correlation';

export interface PerformanceMetricData {
  operation: string;
  module: string;
  durationMs: number;
  startedAt: Date;
  completedAt?: Date;
  success?: boolean;
  errorType?: string;
  errorMessage?: string;

  // Database metrics
  dbOperation?: string;
  dbTable?: string;
  dbRowsAffected?: number;
  dbQueryTimeMs?: number;

  // External API metrics
  externalService?: string;
  externalApi?: string;
  externalStatus?: number;
  externalDurationMs?: number;

  // Additional metadata
  metadata?: Record<string, any>;
}

/**
 * Track a performance metric
 */
export async function trackPerformanceMetric(data: PerformanceMetricData): Promise<void> {
  const pool = getDbPool();
  const context = getCorrelationContext();

  try {
    await pool.query(
      `INSERT INTO performance_metrics (
        correlation_id, request_id, operation, module,
        duration_ms, started_at, completed_at,
        user_id, agent_id,
        db_operation, db_table, db_rows_affected, db_query_time_ms,
        external_service, external_api, external_status, external_duration_ms,
        success, error_type, error_message,
        metadata
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)`,
      [
        context?.correlationId || null,
        context?.requestId || null,
        data.operation,
        data.module,
        data.durationMs,
        data.startedAt,
        data.completedAt || new Date(),
        context?.userId || null,
        context?.agentId || null,
        data.dbOperation || null,
        data.dbTable || null,
        data.dbRowsAffected || null,
        data.dbQueryTimeMs || null,
        data.externalService || null,
        data.externalApi || null,
        data.externalStatus || null,
        data.externalDurationMs || null,
        data.success !== false,
        data.errorType || null,
        data.errorMessage || null,
        JSON.stringify(data.metadata || {})
      ]
    );
  } catch (error: any) {
    // Don't throw - metric tracking should not break the request
    logger.error('Failed to track performance metric', {
      error: error.message,
      operation: data.operation,
      module: data.module
    });
  }
}

/**
 * Track a performance metric with automatic timing
 */
export async function withPerformanceTracking<T>(
  operation: string,
  module: string,
  fn: () => Promise<T>,
  metadata?: Record<string, any>
): Promise<T> {
  const startedAt = new Date();
  const startTime = Date.now();
  let success = true;
  let errorType: string | undefined;
  let errorMessage: string | undefined;

  try {
    const result = await fn();
    return result;
  } catch (error: any) {
    success = false;
    errorType = error.name || 'Error';
    errorMessage = error.message;
    throw error;
  } finally {
    const durationMs = Date.now() - startTime;

    // Track asynchronously (fire and forget)
    trackPerformanceMetric({
      operation,
      module,
      durationMs,
      startedAt,
      completedAt: new Date(),
      success,
      errorType,
      errorMessage,
      metadata
    }).catch(err => {
      logger.error('Failed to track performance in finally block', {
        error: err.message
      });
    });
  }
}

/**
 * Track database query performance
 */
export async function trackDatabaseQuery<T>(
  operation: string,
  table: string,
  fn: () => Promise<T>
): Promise<T> {
  const startedAt = new Date();
  const startTime = Date.now();
  let success = true;
  let errorType: string | undefined;
  let errorMessage: string | undefined;
  let rowsAffected: number | undefined;

  try {
    const result = await fn();

    // Extract rows affected if available
    if (result && typeof result === 'object' && 'rowCount' in result) {
      rowsAffected = (result as any).rowCount;
    }

    return result;
  } catch (error: any) {
    success = false;
    errorType = error.name || 'DatabaseError';
    errorMessage = error.message;
    throw error;
  } finally {
    const durationMs = Date.now() - startTime;

    trackPerformanceMetric({
      operation,
      module: 'database',
      durationMs,
      startedAt,
      completedAt: new Date(),
      success,
      errorType,
      errorMessage,
      dbOperation: operation,
      dbTable: table,
      dbRowsAffected: rowsAffected,
      dbQueryTimeMs: durationMs
    }).catch(err => {
      logger.error('Failed to track database query', {
        error: err.message
      });
    });
  }
}

/**
 * Track external API call performance
 */
export async function trackExternalApiCall<T>(
  service: string,
  api: string,
  fn: () => Promise<T>
): Promise<T> {
  const startedAt = new Date();
  const startTime = Date.now();
  let success = true;
  let errorType: string | undefined;
  let errorMessage: string | undefined;
  let statusCode: number | undefined;

  try {
    const result = await fn();

    // Extract status code if available
    if (result && typeof result === 'object' && 'status' in result) {
      statusCode = (result as any).status;
    }

    return result;
  } catch (error: any) {
    success = false;
    errorType = error.name || 'ApiError';
    errorMessage = error.message;

    // Try to extract status from error
    if (error.response?.status) {
      statusCode = error.response.status;
    }

    throw error;
  } finally {
    const durationMs = Date.now() - startTime;

    trackPerformanceMetric({
      operation: `${service}.${api}`,
      module: 'external_api',
      durationMs,
      startedAt,
      completedAt: new Date(),
      success,
      errorType,
      errorMessage,
      externalService: service,
      externalApi: api,
      externalStatus: statusCode,
      externalDurationMs: durationMs
    }).catch(err => {
      logger.error('Failed to track external API call', {
        error: err.message
      });
    });
  }
}

/**
 * Query performance metrics with aggregation
 */
export async function getPerformanceMetrics(params: {
  module?: string;
  operation?: string;
  startDate?: Date;
  endDate?: Date;
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

  if (params.operation) {
    conditions.push(`operation = $${paramIndex++}`);
    values.push(params.operation);
  }

  if (params.startDate) {
    conditions.push(`created_at >= $${paramIndex++}`);
    values.push(params.startDate);
  }

  if (params.endDate) {
    conditions.push(`created_at <= $${paramIndex++}`);
    values.push(params.endDate);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = params.limit || 100;

  const result = await pool.query(
    `SELECT * FROM performance_metrics
     ${whereClause}
     ORDER BY created_at DESC
     LIMIT $${paramIndex}`,
    [...values, limit]
  );

  return result.rows;
}

/**
 * Get aggregated performance statistics
 */
export async function getPerformanceStats(params: {
  module?: string;
  operation?: string;
  hours?: number;
}): Promise<{
  totalRequests: number;
  avgDurationMs: number;
  p50DurationMs: number;
  p95DurationMs: number;
  p99DurationMs: number;
  maxDurationMs: number;
  errorCount: number;
  errorRate: number;
}> {
  const pool = getDbPool();
  const hours = params.hours || 24;

  const conditions: string[] = [`created_at >= NOW() - INTERVAL '${hours} hours'`];
  const values: any[] = [];
  let paramIndex = 1;

  if (params.module) {
    conditions.push(`module = $${paramIndex++}`);
    values.push(params.module);
  }

  if (params.operation) {
    conditions.push(`operation = $${paramIndex++}`);
    values.push(params.operation);
  }

  const whereClause = conditions.join(' AND ');

  const result = await pool.query(
    `SELECT
      COUNT(*) AS total_requests,
      AVG(duration_ms) AS avg_duration_ms,
      PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY duration_ms) AS p50_duration_ms,
      PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY duration_ms) AS p95_duration_ms,
      PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY duration_ms) AS p99_duration_ms,
      MAX(duration_ms) AS max_duration_ms,
      SUM(CASE WHEN success = false THEN 1 ELSE 0 END) AS error_count
    FROM performance_metrics
    WHERE ${whereClause}`,
    values
  );

  const row = result.rows[0];

  return {
    totalRequests: parseInt(row.total_requests) || 0,
    avgDurationMs: parseFloat(row.avg_duration_ms) || 0,
    p50DurationMs: parseFloat(row.p50_duration_ms) || 0,
    p95DurationMs: parseFloat(row.p95_duration_ms) || 0,
    p99DurationMs: parseFloat(row.p99_duration_ms) || 0,
    maxDurationMs: parseInt(row.max_duration_ms) || 0,
    errorCount: parseInt(row.error_count) || 0,
    errorRate: parseInt(row.total_requests) > 0
      ? (parseInt(row.error_count) / parseInt(row.total_requests))
      : 0
  };
}

/**
 * Get slow operations (operations exceeding threshold)
 */
export async function getSlowOperations(params: {
  thresholdMs?: number;
  hours?: number;
  limit?: number;
}): Promise<any[]> {
  const pool = getDbPool();
  const thresholdMs = params.thresholdMs || 1000;
  const hours = params.hours || 24;
  const limit = params.limit || 100;

  const result = await pool.query(
    `SELECT *
    FROM performance_metrics
    WHERE duration_ms > $1
      AND created_at >= NOW() - INTERVAL '${hours} hours'
    ORDER BY duration_ms DESC
    LIMIT $2`,
    [thresholdMs, limit]
  );

  return result.rows;
}
