-- V3_012: Observability Tables for Performance Metrics and Error Aggregation
-- Created: 2026-02-24

-- Performance Metrics Table
-- Tracks detailed performance metrics for operations across the system
CREATE TABLE IF NOT EXISTS performance_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Identification
  correlation_id VARCHAR(255),
  request_id VARCHAR(255),
  operation VARCHAR(255) NOT NULL,
  module VARCHAR(100) NOT NULL,

  -- Timing
  duration_ms INTEGER NOT NULL,
  started_at TIMESTAMP NOT NULL,
  completed_at TIMESTAMP NOT NULL DEFAULT NOW(),

  -- Context
  user_id VARCHAR(255),
  agent_id VARCHAR(255),

  -- Database metrics (if applicable)
  db_operation VARCHAR(50),
  db_table VARCHAR(100),
  db_rows_affected INTEGER,
  db_query_time_ms INTEGER,

  -- External API metrics (if applicable)
  external_service VARCHAR(100),
  external_api VARCHAR(255),
  external_status INTEGER,
  external_duration_ms INTEGER,

  -- Result
  success BOOLEAN NOT NULL DEFAULT true,
  error_type VARCHAR(255),
  error_message TEXT,

  -- Additional metadata
  metadata JSONB DEFAULT '{}',

  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Indexes for performance metrics queries
CREATE INDEX idx_perf_metrics_operation ON performance_metrics(operation);
CREATE INDEX idx_perf_metrics_module ON performance_metrics(module);
CREATE INDEX idx_perf_metrics_correlation ON performance_metrics(correlation_id) WHERE correlation_id IS NOT NULL;
CREATE INDEX idx_perf_metrics_created_at ON performance_metrics(created_at DESC);
CREATE INDEX idx_perf_metrics_duration ON performance_metrics(duration_ms DESC);
CREATE INDEX idx_perf_metrics_success ON performance_metrics(success) WHERE success = false;
CREATE INDEX idx_perf_metrics_external_service ON performance_metrics(external_service) WHERE external_service IS NOT NULL;

-- Partial index for slow operations (>1000ms)
CREATE INDEX idx_perf_metrics_slow_ops ON performance_metrics(operation, duration_ms)
  WHERE duration_ms > 1000;

-- Error Aggregation Table
-- Aggregates errors by type, module, and message for monitoring
CREATE TABLE IF NOT EXISTS error_aggregation (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Error identification
  error_type VARCHAR(255) NOT NULL,
  error_code VARCHAR(100),
  error_message TEXT NOT NULL,
  error_hash VARCHAR(64) NOT NULL, -- Hash of type+message for grouping

  -- Context
  module VARCHAR(100) NOT NULL,
  operation VARCHAR(255),

  -- Aggregation
  occurrence_count INTEGER NOT NULL DEFAULT 1,
  first_seen_at TIMESTAMP NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMP NOT NULL DEFAULT NOW(),

  -- Sample data from most recent occurrence
  last_stack_trace TEXT,
  last_correlation_id VARCHAR(255),
  last_request_id VARCHAR(255),
  last_user_id VARCHAR(255),
  last_metadata JSONB DEFAULT '{}',

  -- Status
  resolved BOOLEAN DEFAULT false,
  resolved_at TIMESTAMP,
  resolved_by VARCHAR(255),
  resolution_notes TEXT,

  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Unique constraint on error hash + module for aggregation
CREATE UNIQUE INDEX idx_error_agg_unique ON error_aggregation(error_hash, module);

-- Indexes for error aggregation queries
CREATE INDEX idx_error_agg_type ON error_aggregation(error_type);
CREATE INDEX idx_error_agg_module ON error_aggregation(module);
CREATE INDEX idx_error_agg_unresolved ON error_aggregation(resolved) WHERE resolved = false;
CREATE INDEX idx_error_agg_last_seen ON error_aggregation(last_seen_at DESC);
CREATE INDEX idx_error_agg_occurrence_count ON error_aggregation(occurrence_count DESC);

-- Error Occurrence Details Table
-- Stores individual error occurrences for detailed analysis
CREATE TABLE IF NOT EXISTS error_occurrences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  aggregation_id UUID NOT NULL REFERENCES error_aggregation(id) ON DELETE CASCADE,

  -- Error details
  error_type VARCHAR(255) NOT NULL,
  error_code VARCHAR(100),
  error_message TEXT NOT NULL,
  stack_trace TEXT,

  -- Context
  correlation_id VARCHAR(255),
  request_id VARCHAR(255),
  user_id VARCHAR(255),
  module VARCHAR(100) NOT NULL,
  operation VARCHAR(255),

  -- HTTP context (if applicable)
  http_method VARCHAR(10),
  http_path VARCHAR(500),
  http_status INTEGER,

  -- Additional context
  metadata JSONB DEFAULT '{}',

  occurred_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Indexes for error occurrences
CREATE INDEX idx_error_occ_aggregation ON error_occurrences(aggregation_id);
CREATE INDEX idx_error_occ_correlation ON error_occurrences(correlation_id) WHERE correlation_id IS NOT NULL;
CREATE INDEX idx_error_occ_occurred_at ON error_occurrences(occurred_at DESC);
CREATE INDEX idx_error_occ_module ON error_occurrences(module);

-- Request Tracing Spans Table
-- Stores detailed spans for distributed tracing
CREATE TABLE IF NOT EXISTS tracing_spans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Trace identification
  trace_id VARCHAR(255) NOT NULL, -- Overall trace ID (same as correlation_id)
  span_id VARCHAR(255) NOT NULL,  -- Unique span ID
  parent_span_id VARCHAR(255),    -- Parent span ID for nested operations

  -- Span details
  operation VARCHAR(255) NOT NULL,
  module VARCHAR(100) NOT NULL,
  span_kind VARCHAR(50) NOT NULL DEFAULT 'internal', -- internal, server, client, producer, consumer

  -- Timing
  start_time TIMESTAMP NOT NULL,
  end_time TIMESTAMP,
  duration_ms INTEGER,

  -- Context
  user_id VARCHAR(255),
  correlation_id VARCHAR(255),
  request_id VARCHAR(255),

  -- Status
  status VARCHAR(20) NOT NULL DEFAULT 'ok', -- ok, error, unset
  status_message TEXT,

  -- Tags and attributes
  tags JSONB DEFAULT '{}',

  -- Metrics
  events JSONB DEFAULT '[]', -- Array of span events

  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Indexes for tracing spans
CREATE INDEX idx_tracing_spans_trace_id ON tracing_spans(trace_id);
CREATE INDEX idx_tracing_spans_span_id ON tracing_spans(span_id);
CREATE INDEX idx_tracing_spans_parent ON tracing_spans(parent_span_id) WHERE parent_span_id IS NOT NULL;
CREATE INDEX idx_tracing_spans_operation ON tracing_spans(operation);
CREATE INDEX idx_tracing_spans_module ON tracing_spans(module);
CREATE INDEX idx_tracing_spans_created_at ON tracing_spans(created_at DESC);
CREATE INDEX idx_tracing_spans_duration ON tracing_spans(duration_ms DESC) WHERE duration_ms IS NOT NULL;

-- Materialized view for performance aggregations
CREATE MATERIALIZED VIEW IF NOT EXISTS performance_metrics_hourly AS
SELECT
  DATE_TRUNC('hour', created_at) AS hour,
  module,
  operation,
  COUNT(*) AS request_count,
  AVG(duration_ms) AS avg_duration_ms,
  PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY duration_ms) AS p50_duration_ms,
  PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY duration_ms) AS p95_duration_ms,
  PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY duration_ms) AS p99_duration_ms,
  MAX(duration_ms) AS max_duration_ms,
  SUM(CASE WHEN success = false THEN 1 ELSE 0 END) AS error_count,
  CAST(SUM(CASE WHEN success = false THEN 1 ELSE 0 END) AS FLOAT) / COUNT(*) AS error_rate
FROM performance_metrics
WHERE created_at >= NOW() - INTERVAL '7 days'
GROUP BY DATE_TRUNC('hour', created_at), module, operation;

-- Index for materialized view
CREATE UNIQUE INDEX idx_perf_metrics_hourly_unique ON performance_metrics_hourly(hour, module, operation);

-- Materialized view for error summaries
CREATE MATERIALIZED VIEW IF NOT EXISTS error_summary AS
SELECT
  DATE_TRUNC('hour', last_seen_at) AS hour,
  module,
  error_type,
  COUNT(*) AS error_groups,
  SUM(occurrence_count) AS total_occurrences,
  SUM(CASE WHEN resolved = false THEN 1 ELSE 0 END) AS unresolved_groups,
  MAX(last_seen_at) AS most_recent_occurrence
FROM error_aggregation
WHERE last_seen_at >= NOW() - INTERVAL '7 days'
GROUP BY DATE_TRUNC('hour', last_seen_at), module, error_type;

-- Index for error summary
CREATE UNIQUE INDEX idx_error_summary_unique ON error_summary(hour, module, error_type);

-- Function to refresh materialized views (call periodically via cron)
CREATE OR REPLACE FUNCTION refresh_observability_views()
RETURNS void AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY performance_metrics_hourly;
  REFRESH MATERIALIZED VIEW CONCURRENTLY error_summary;
END;
$$ LANGUAGE plpgsql;

-- Add comments for documentation
COMMENT ON TABLE performance_metrics IS 'Detailed performance metrics for all operations';
COMMENT ON TABLE error_aggregation IS 'Aggregated error tracking with occurrence counts';
COMMENT ON TABLE error_occurrences IS 'Individual error occurrences for detailed analysis';
COMMENT ON TABLE tracing_spans IS 'Distributed tracing spans for request flows';
COMMENT ON MATERIALIZED VIEW performance_metrics_hourly IS 'Hourly aggregated performance metrics (refresh periodically)';
COMMENT ON MATERIALIZED VIEW error_summary IS 'Hourly error summaries (refresh periodically)';
