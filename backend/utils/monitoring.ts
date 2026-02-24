/**
 * Monitoring Dashboard Utilities
 *
 * Provides unified access to observability data for monitoring dashboards
 */

import { getPerformanceStats, getSlowOperations } from './performance_metrics';
import { getErrorStats, getAggregatedErrors } from './error_aggregation';
import { getTraceStats, getSlowTraces } from './tracing';
import { getDbPool } from '../db/connection';
import { logger } from './logger';

export interface SystemHealthStatus {
  status: 'healthy' | 'degraded' | 'critical';
  timestamp: Date;
  performance: {
    avgResponseTimeMs: number;
    p95ResponseTimeMs: number;
    requestCount: number;
    errorRate: number;
  };
  errors: {
    totalErrors: number;
    uniqueErrors: number;
    unresolvedErrors: number;
    topErrors: Array<{
      errorType: string;
      module: string;
      occurrenceCount: number;
    }>;
  };
  traces: {
    totalTraces: number;
    avgSpansPerTrace: number;
    slowTracesCount: number;
  };
  database: {
    activeConnections: number;
    slowQueries: number;
  };
}

/**
 * Get overall system health status
 */
export async function getSystemHealth(hours: number = 1): Promise<SystemHealthStatus> {
  try {
    // Get performance stats
    const perfStats = await getPerformanceStats({ hours });

    // Get error stats
    const errorStats = await getErrorStats({ hours });

    // Get trace stats
    const traceStats = await getTraceStats({ hours });

    // Get slow operations count
    const slowOps = await getSlowOperations({ thresholdMs: 1000, hours, limit: 1 });

    // Get slow traces count
    const slowTraces = await getSlowTraces({ thresholdMs: 1000, hours, limit: 1 });

    // Get database stats
    const dbStats = await getDatabaseStats();

    // Determine overall health status
    let status: 'healthy' | 'degraded' | 'critical' = 'healthy';

    if (perfStats.errorRate > 0.1 || errorStats.unresolvedErrors > 10 || perfStats.p95DurationMs > 5000) {
      status = 'critical';
    } else if (perfStats.errorRate > 0.05 || errorStats.unresolvedErrors > 5 || perfStats.p95DurationMs > 2000) {
      status = 'degraded';
    }

    return {
      status,
      timestamp: new Date(),
      performance: {
        avgResponseTimeMs: perfStats.avgDurationMs,
        p95ResponseTimeMs: perfStats.p95DurationMs,
        requestCount: perfStats.totalRequests,
        errorRate: perfStats.errorRate
      },
      errors: {
        totalErrors: errorStats.totalErrors,
        uniqueErrors: errorStats.uniqueErrors,
        unresolvedErrors: errorStats.unresolvedErrors,
        topErrors: errorStats.topErrors
      },
      traces: {
        totalTraces: traceStats.totalTraces,
        avgSpansPerTrace: traceStats.avgSpansPerTrace,
        slowTracesCount: slowTraces.length
      },
      database: {
        activeConnections: dbStats.activeConnections,
        slowQueries: slowOps.length
      }
    };
  } catch (error: any) {
    logger.error('Failed to get system health', {
      error: error.message,
      stack: error.stack
    });

    return {
      status: 'critical',
      timestamp: new Date(),
      performance: {
        avgResponseTimeMs: 0,
        p95ResponseTimeMs: 0,
        requestCount: 0,
        errorRate: 1
      },
      errors: {
        totalErrors: 1,
        uniqueErrors: 1,
        unresolvedErrors: 1,
        topErrors: []
      },
      traces: {
        totalTraces: 0,
        avgSpansPerTrace: 0,
        slowTracesCount: 0
      },
      database: {
        activeConnections: 0,
        slowQueries: 0
      }
    };
  }
}

/**
 * Get database connection statistics
 */
async function getDatabaseStats(): Promise<{
  activeConnections: number;
  idleConnections: number;
  waitingClients: number;
}> {
  const pool = getDbPool();

  try {
    const result = await pool.query(
      `SELECT
        count(*) FILTER (WHERE state = 'active') AS active,
        count(*) FILTER (WHERE state = 'idle') AS idle
      FROM pg_stat_activity
      WHERE datname = current_database()`
    );

    const row = result.rows[0];

    return {
      activeConnections: parseInt(row.active) || 0,
      idleConnections: parseInt(row.idle) || 0,
      waitingClients: pool.waitingCount || 0
    };
  } catch (error: any) {
    logger.error('Failed to get database stats', {
      error: error.message
    });

    return {
      activeConnections: 0,
      idleConnections: 0,
      waitingClients: 0
    };
  }
}

/**
 * Get module-specific health status
 */
export async function getModuleHealth(module: string, hours: number = 1): Promise<{
  module: string;
  performance: any;
  errors: any;
  traces: any;
}> {
  const [perfStats, errorStats, traceStats] = await Promise.all([
    getPerformanceStats({ module, hours }),
    getErrorStats({ module, hours }),
    getTraceStats({ module, hours })
  ]);

  return {
    module,
    performance: perfStats,
    errors: errorStats,
    traces: traceStats
  };
}

/**
 * Get SLA compliance metrics
 */
export async function getSLAMetrics(hours: number = 24): Promise<{
  availability: number;
  latencyP95: number;
  latencyP99: number;
  errorRate: number;
  uptime: number;
}> {
  const perfStats = await getPerformanceStats({ hours });

  // Calculate availability (successful requests / total requests)
  const availability = perfStats.totalRequests > 0
    ? ((perfStats.totalRequests - perfStats.errorCount) / perfStats.totalRequests) * 100
    : 100;

  // Calculate uptime percentage (simplified - assumes monitoring was active)
  const uptime = availability;

  return {
    availability,
    latencyP95: perfStats.p95DurationMs,
    latencyP99: perfStats.p99DurationMs,
    errorRate: perfStats.errorRate * 100,
    uptime
  };
}

/**
 * Get performance trends over time
 */
export async function getPerformanceTrends(params: {
  module?: string;
  operation?: string;
  hours?: number;
  intervalHours?: number;
}): Promise<Array<{
  timestamp: Date;
  avgDurationMs: number;
  requestCount: number;
  errorCount: number;
  errorRate: number;
}>> {
  const pool = getDbPool();
  const hours = params.hours || 24;
  const intervalHours = params.intervalHours || 1;

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
      DATE_TRUNC('hour', created_at) AS timestamp,
      AVG(duration_ms) AS avg_duration_ms,
      COUNT(*) AS request_count,
      SUM(CASE WHEN success = false THEN 1 ELSE 0 END) AS error_count
    FROM performance_metrics
    WHERE ${whereClause}
    GROUP BY DATE_TRUNC('hour', created_at)
    ORDER BY timestamp ASC`,
    values
  );

  return result.rows.map(row => ({
    timestamp: row.timestamp,
    avgDurationMs: parseFloat(row.avg_duration_ms) || 0,
    requestCount: parseInt(row.request_count) || 0,
    errorCount: parseInt(row.error_count) || 0,
    errorRate: parseInt(row.request_count) > 0
      ? (parseInt(row.error_count) / parseInt(row.request_count))
      : 0
  }));
}

/**
 * Get top slow operations
 */
export async function getTopSlowOperations(params: {
  hours?: number;
  limit?: number;
}): Promise<Array<{
  operation: string;
  module: string;
  avgDurationMs: number;
  p95DurationMs: number;
  count: number;
}>> {
  const pool = getDbPool();
  const hours = params.hours || 24;
  const limit = params.limit || 10;

  const result = await pool.query(
    `SELECT
      operation,
      module,
      AVG(duration_ms) AS avg_duration_ms,
      PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY duration_ms) AS p95_duration_ms,
      COUNT(*) AS count
    FROM performance_metrics
    WHERE created_at >= NOW() - INTERVAL '${hours} hours'
    GROUP BY operation, module
    ORDER BY p95_duration_ms DESC
    LIMIT $1`,
    [limit]
  );

  return result.rows.map(row => ({
    operation: row.operation,
    module: row.module,
    avgDurationMs: parseFloat(row.avg_duration_ms) || 0,
    p95DurationMs: parseFloat(row.p95_duration_ms) || 0,
    count: parseInt(row.count) || 0
  }));
}

/**
 * Get alertable conditions
 */
export async function getAlertConditions(hours: number = 1): Promise<Array<{
  severity: 'critical' | 'warning' | 'info';
  type: string;
  message: string;
  metadata: Record<string, any>;
}>> {
  const alerts: Array<{
    severity: 'critical' | 'warning' | 'info';
    type: string;
    message: string;
    metadata: Record<string, any>;
  }> = [];

  // Check performance
  const perfStats = await getPerformanceStats({ hours });

  if (perfStats.p95DurationMs > 5000) {
    alerts.push({
      severity: 'critical',
      type: 'performance',
      message: 'P95 latency exceeds 5000ms',
      metadata: {
        p95DurationMs: perfStats.p95DurationMs,
        threshold: 5000
      }
    });
  } else if (perfStats.p95DurationMs > 2000) {
    alerts.push({
      severity: 'warning',
      type: 'performance',
      message: 'P95 latency exceeds 2000ms',
      metadata: {
        p95DurationMs: perfStats.p95DurationMs,
        threshold: 2000
      }
    });
  }

  if (perfStats.errorRate > 0.1) {
    alerts.push({
      severity: 'critical',
      type: 'error_rate',
      message: 'Error rate exceeds 10%',
      metadata: {
        errorRate: perfStats.errorRate,
        threshold: 0.1
      }
    });
  } else if (perfStats.errorRate > 0.05) {
    alerts.push({
      severity: 'warning',
      type: 'error_rate',
      message: 'Error rate exceeds 5%',
      metadata: {
        errorRate: perfStats.errorRate,
        threshold: 0.05
      }
    });
  }

  // Check errors
  const errorStats = await getErrorStats({ hours });

  if (errorStats.unresolvedErrors > 10) {
    alerts.push({
      severity: 'critical',
      type: 'unresolved_errors',
      message: 'More than 10 unresolved error groups',
      metadata: {
        unresolvedErrors: errorStats.unresolvedErrors,
        threshold: 10
      }
    });
  } else if (errorStats.unresolvedErrors > 5) {
    alerts.push({
      severity: 'warning',
      type: 'unresolved_errors',
      message: 'More than 5 unresolved error groups',
      metadata: {
        unresolvedErrors: errorStats.unresolvedErrors,
        threshold: 5
      }
    });
  }

  // Check database
  const dbStats = await getDatabaseStats();

  if (dbStats.activeConnections > 80) {
    alerts.push({
      severity: 'warning',
      type: 'database_connections',
      message: 'High number of active database connections',
      metadata: {
        activeConnections: dbStats.activeConnections,
        threshold: 80
      }
    });
  }

  return alerts;
}

/**
 * Export metrics in Prometheus format
 */
export async function exportPrometheusMetrics(hours: number = 1): Promise<string> {
  const perfStats = await getPerformanceStats({ hours });
  const errorStats = await getErrorStats({ hours });
  const health = await getSystemHealth(hours);

  const metrics: string[] = [];

  // Performance metrics
  metrics.push(`# HELP pm_requests_total Total number of requests`);
  metrics.push(`# TYPE pm_requests_total counter`);
  metrics.push(`pm_requests_total ${perfStats.totalRequests}`);

  metrics.push(`# HELP pm_request_duration_ms Request duration in milliseconds`);
  metrics.push(`# TYPE pm_request_duration_ms summary`);
  metrics.push(`pm_request_duration_ms{quantile="0.5"} ${perfStats.p50DurationMs}`);
  metrics.push(`pm_request_duration_ms{quantile="0.95"} ${perfStats.p95DurationMs}`);
  metrics.push(`pm_request_duration_ms{quantile="0.99"} ${perfStats.p99DurationMs}`);

  // Error metrics
  metrics.push(`# HELP pm_errors_total Total number of errors`);
  metrics.push(`# TYPE pm_errors_total counter`);
  metrics.push(`pm_errors_total ${errorStats.totalErrors}`);

  metrics.push(`# HELP pm_error_rate Error rate (0-1)`);
  metrics.push(`# TYPE pm_error_rate gauge`);
  metrics.push(`pm_error_rate ${perfStats.errorRate}`);

  // Health status
  metrics.push(`# HELP pm_system_health System health status (1=healthy, 0.5=degraded, 0=critical)`);
  metrics.push(`# TYPE pm_system_health gauge`);
  const healthValue = health.status === 'healthy' ? 1 : health.status === 'degraded' ? 0.5 : 0;
  metrics.push(`pm_system_health ${healthValue}`);

  return metrics.join('\n');
}
