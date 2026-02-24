/**
 * Distributed Request Tracing
 *
 * Provides span-based tracing for distributed operations
 */

import { v4 as uuidv4 } from 'uuid';
import { getDbPool } from '../db/connection';
import { logger } from './logger';
import { getCorrelationContext } from './correlation';

export type SpanKind = 'internal' | 'server' | 'client' | 'producer' | 'consumer';
export type SpanStatus = 'ok' | 'error' | 'unset';

export interface SpanEvent {
  name: string;
  timestamp: Date;
  attributes?: Record<string, any>;
}

export interface Span {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  operation: string;
  module: string;
  spanKind: SpanKind;
  startTime: Date;
  endTime?: Date;
  durationMs?: number;
  status: SpanStatus;
  statusMessage?: string;
  tags: Record<string, any>;
  events: SpanEvent[];
}

/**
 * Active span tracker (in-memory for current request)
 */
class SpanTracker {
  private activeSpans: Map<string, Span> = new Map();

  createSpan(params: {
    operation: string;
    module: string;
    spanKind?: SpanKind;
    parentSpanId?: string;
    tags?: Record<string, any>;
  }): Span {
    const context = getCorrelationContext();
    const traceId = context?.correlationId || uuidv4();
    const spanId = uuidv4();

    const span: Span = {
      traceId,
      spanId,
      parentSpanId: params.parentSpanId,
      operation: params.operation,
      module: params.module,
      spanKind: params.spanKind || 'internal',
      startTime: new Date(),
      status: 'unset',
      tags: {
        ...params.tags,
        userId: context?.userId,
        requestId: context?.requestId
      },
      events: []
    };

    this.activeSpans.set(spanId, span);
    return span;
  }

  endSpan(spanId: string, params?: {
    status?: SpanStatus;
    statusMessage?: string;
    tags?: Record<string, any>;
  }): Span | null {
    const span = this.activeSpans.get(spanId);
    if (!span) {
      logger.warn('Attempted to end non-existent span', { spanId });
      return null;
    }

    span.endTime = new Date();
    span.durationMs = span.endTime.getTime() - span.startTime.getTime();
    span.status = params?.status || 'ok';
    span.statusMessage = params?.statusMessage;

    if (params?.tags) {
      Object.assign(span.tags, params.tags);
    }

    this.activeSpans.delete(spanId);

    // Persist span to database
    this.persistSpan(span).catch(err => {
      logger.error('Failed to persist span', {
        error: err.message,
        spanId: span.spanId
      });
    });

    return span;
  }

  addEvent(spanId: string, name: string, attributes?: Record<string, any>): void {
    const span = this.activeSpans.get(spanId);
    if (!span) {
      logger.warn('Attempted to add event to non-existent span', { spanId, eventName: name });
      return;
    }

    span.events.push({
      name,
      timestamp: new Date(),
      attributes
    });
  }

  addTag(spanId: string, key: string, value: any): void {
    const span = this.activeSpans.get(spanId);
    if (!span) {
      logger.warn('Attempted to add tag to non-existent span', { spanId, tagKey: key });
      return;
    }

    span.tags[key] = value;
  }

  private async persistSpan(span: Span): Promise<void> {
    const pool = getDbPool();

    try {
      await pool.query(
        `INSERT INTO tracing_spans (
          trace_id, span_id, parent_span_id,
          operation, module, span_kind,
          start_time, end_time, duration_ms,
          user_id, correlation_id, request_id,
          status, status_message,
          tags, events
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
        [
          span.traceId,
          span.spanId,
          span.parentSpanId || null,
          span.operation,
          span.module,
          span.spanKind,
          span.startTime,
          span.endTime || null,
          span.durationMs || null,
          span.tags.userId || null,
          span.tags.correlationId || span.traceId,
          span.tags.requestId || null,
          span.status,
          span.statusMessage || null,
          JSON.stringify(span.tags),
          JSON.stringify(span.events)
        ]
      );
    } catch (error: any) {
      // Don't throw - tracing should not break the request
      logger.error('Failed to persist span to database', {
        error: error.message,
        spanId: span.spanId
      });
    }
  }
}

// Global span tracker
const spanTracker = new SpanTracker();

/**
 * Start a new span
 */
export function startSpan(params: {
  operation: string;
  module: string;
  spanKind?: SpanKind;
  parentSpanId?: string;
  tags?: Record<string, any>;
}): Span {
  return spanTracker.createSpan(params);
}

/**
 * End an active span
 */
export function endSpan(spanId: string, params?: {
  status?: SpanStatus;
  statusMessage?: string;
  tags?: Record<string, any>;
}): void {
  spanTracker.endSpan(spanId, params);
}

/**
 * Add an event to a span
 */
export function addSpanEvent(spanId: string, name: string, attributes?: Record<string, any>): void {
  spanTracker.addEvent(spanId, name, attributes);
}

/**
 * Add a tag to a span
 */
export function addSpanTag(spanId: string, key: string, value: any): void {
  spanTracker.addTag(spanId, key, value);
}

/**
 * Trace a function with automatic span management
 */
export async function traceOperation<T>(
  operation: string,
  module: string,
  fn: (span: Span) => Promise<T>,
  spanKind?: SpanKind
): Promise<T> {
  const span = startSpan({ operation, module, spanKind });

  try {
    const result = await fn(span);
    endSpan(span.spanId, { status: 'ok' });
    return result;
  } catch (error: any) {
    endSpan(span.spanId, {
      status: 'error',
      statusMessage: error.message,
      tags: {
        errorType: error.name,
        errorCode: error.code
      }
    });
    throw error;
  }
}

/**
 * Trace a database query
 */
export async function traceDatabaseQuery<T>(
  query: string,
  table: string,
  fn: (span: Span) => Promise<T>
): Promise<T> {
  return traceOperation(
    `db.query.${table}`,
    'database',
    async (span) => {
      addSpanTag(span.spanId, 'db.table', table);
      addSpanTag(span.spanId, 'db.operation', query);
      return await fn(span);
    },
    'client'
  );
}

/**
 * Trace an external API call
 */
export async function traceExternalCall<T>(
  service: string,
  endpoint: string,
  method: string,
  fn: (span: Span) => Promise<T>
): Promise<T> {
  return traceOperation(
    `external.${service}.${endpoint}`,
    'external_api',
    async (span) => {
      addSpanTag(span.spanId, 'http.method', method);
      addSpanTag(span.spanId, 'external.service', service);
      addSpanTag(span.spanId, 'external.endpoint', endpoint);
      return await fn(span);
    },
    'client'
  );
}

/**
 * Query spans from database
 */
export async function getTraceSpans(traceId: string): Promise<any[]> {
  const pool = getDbPool();

  const result = await pool.query(
    `SELECT * FROM tracing_spans
     WHERE trace_id = $1
     ORDER BY start_time ASC`,
    [traceId]
  );

  return result.rows;
}

/**
 * Get trace tree structure
 */
export async function getTraceTree(traceId: string): Promise<any> {
  const spans = await getTraceSpans(traceId);

  // Build tree structure
  const spanMap = new Map(spans.map(s => [s.span_id, { ...s, children: [] }]));
  const rootSpans: any[] = [];

  for (const span of spanMap.values()) {
    if (span.parent_span_id && spanMap.has(span.parent_span_id)) {
      const parent = spanMap.get(span.parent_span_id);
      parent.children.push(span);
    } else {
      rootSpans.push(span);
    }
  }

  return {
    traceId,
    spans: rootSpans,
    totalSpans: spans.length,
    totalDuration: Math.max(...spans.map((s: any) => s.duration_ms || 0)),
    hasErrors: spans.some((s: any) => s.status === 'error')
  };
}

/**
 * Get slow traces
 */
export async function getSlowTraces(params: {
  thresholdMs?: number;
  hours?: number;
  limit?: number;
}): Promise<any[]> {
  const pool = getDbPool();
  const thresholdMs = params.thresholdMs || 1000;
  const hours = params.hours || 24;
  const limit = params.limit || 50;

  const result = await pool.query(
    `SELECT
      trace_id,
      MIN(start_time) AS trace_start,
      MAX(end_time) AS trace_end,
      SUM(duration_ms) AS total_duration_ms,
      COUNT(*) AS span_count,
      COUNT(CASE WHEN status = 'error' THEN 1 END) AS error_count
    FROM tracing_spans
    WHERE start_time >= NOW() - INTERVAL '${hours} hours'
      AND duration_ms IS NOT NULL
    GROUP BY trace_id
    HAVING SUM(duration_ms) > $1
    ORDER BY total_duration_ms DESC
    LIMIT $2`,
    [thresholdMs, limit]
  );

  return result.rows;
}

/**
 * Get trace statistics
 */
export async function getTraceStats(params: {
  module?: string;
  operation?: string;
  hours?: number;
}): Promise<{
  totalTraces: number;
  avgSpansPerTrace: number;
  avgDurationMs: number;
  p95DurationMs: number;
  errorRate: number;
}> {
  const pool = getDbPool();
  const hours = params.hours || 24;

  const conditions: string[] = [`start_time >= NOW() - INTERVAL '${hours} hours'`];
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
      COUNT(DISTINCT trace_id) AS total_traces,
      COUNT(*) AS total_spans,
      AVG(duration_ms) AS avg_duration_ms,
      PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY duration_ms) AS p95_duration_ms,
      SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) AS error_count
    FROM tracing_spans
    WHERE ${whereClause}`,
    values
  );

  const row = result.rows[0];
  const totalTraces = parseInt(row.total_traces) || 0;
  const totalSpans = parseInt(row.total_spans) || 0;

  return {
    totalTraces,
    avgSpansPerTrace: totalTraces > 0 ? totalSpans / totalTraces : 0,
    avgDurationMs: parseFloat(row.avg_duration_ms) || 0,
    p95DurationMs: parseFloat(row.p95_duration_ms) || 0,
    errorRate: totalSpans > 0 ? (parseInt(row.error_count) / totalSpans) : 0
  };
}
