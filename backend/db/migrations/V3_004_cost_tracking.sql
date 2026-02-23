-- V3_004: Cost Tracking and Monitoring
-- Adds comprehensive cost tracking for LLM and embedding operations
-- Enables budget enforcement and cost attribution

-- ============================================================
-- Cost Tracking Log Table
-- ============================================================

CREATE TABLE IF NOT EXISTS llm_cost_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Context and Attribution
  correlation_id VARCHAR(100),
  signal_id UUID,
  agent_id UUID,

  -- Operation Details
  operation VARCHAR(50) NOT NULL,  -- 'llm_extraction', 'embedding', 'llm_chat', 'synthesis', etc.
  provider VARCHAR(50) NOT NULL,   -- 'openai', 'azure_openai', 'cohere'
  model VARCHAR(100) NOT NULL,     -- 'gpt-4o', 'gpt-4o-mini', 'text-embedding-3-large', etc.

  -- Token Usage
  tokens_input INTEGER NOT NULL DEFAULT 0,
  tokens_output INTEGER NOT NULL DEFAULT 0,

  -- Cost Calculation
  cost_usd NUMERIC(10, 6) NOT NULL DEFAULT 0,

  -- Performance Metrics
  response_time_ms INTEGER,

  -- Metadata
  created_at TIMESTAMP DEFAULT NOW(),

  -- Foreign Keys
  CONSTRAINT fk_llm_cost_agent FOREIGN KEY (agent_id) REFERENCES agent_registry(id) ON DELETE SET NULL,
  CONSTRAINT fk_llm_cost_signal FOREIGN KEY (signal_id) REFERENCES signals(id) ON DELETE SET NULL
);

-- ============================================================
-- Indexes for Fast Queries
-- ============================================================

-- Index for correlation tracking
CREATE INDEX IF NOT EXISTS idx_llm_cost_correlation
  ON llm_cost_log(correlation_id);

-- Index for signal-level cost queries
CREATE INDEX IF NOT EXISTS idx_llm_cost_signal
  ON llm_cost_log(signal_id)
  WHERE signal_id IS NOT NULL;

-- Index for agent-level cost queries (most common use case)
CREATE INDEX IF NOT EXISTS idx_llm_cost_agent
  ON llm_cost_log(agent_id, created_at DESC)
  WHERE agent_id IS NOT NULL;

-- Index for time-based queries
CREATE INDEX IF NOT EXISTS idx_llm_cost_created
  ON llm_cost_log(created_at DESC);

-- Index for provider/model analysis
CREATE INDEX IF NOT EXISTS idx_llm_cost_provider_model
  ON llm_cost_log(provider, model);

-- Index for operation type analysis
CREATE INDEX IF NOT EXISTS idx_llm_cost_operation
  ON llm_cost_log(operation, created_at DESC);

-- Composite index for common dashboard queries (agent costs by month)
CREATE INDEX IF NOT EXISTS idx_llm_cost_agent_month
  ON llm_cost_log(agent_id, date_trunc('month', created_at))
  WHERE agent_id IS NOT NULL;

-- ============================================================
-- Materialized View for Fast Agent Cost Queries
-- ============================================================

CREATE MATERIALIZED VIEW IF NOT EXISTS agent_cost_summary AS
SELECT
  agent_id,
  date_trunc('month', created_at) AS month,
  SUM(tokens_input) AS total_input_tokens,
  SUM(tokens_output) AS total_output_tokens,
  SUM(cost_usd) AS total_cost_usd,
  COUNT(*) AS operation_count,
  AVG(response_time_ms) AS avg_response_time_ms,
  MIN(created_at) AS first_operation_at,
  MAX(created_at) AS last_operation_at
FROM llm_cost_log
WHERE agent_id IS NOT NULL
GROUP BY agent_id, date_trunc('month', created_at);

-- Unique index for CONCURRENTLY refresh support
CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_cost_summary_unique
  ON agent_cost_summary(agent_id, month);

-- Index for querying current month costs
CREATE INDEX IF NOT EXISTS idx_agent_cost_summary_month
  ON agent_cost_summary(month DESC);

-- ============================================================
-- Refresh Function for Materialized View
-- ============================================================

CREATE OR REPLACE FUNCTION refresh_agent_cost_summary()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  -- Refresh concurrently to avoid locking
  REFRESH MATERIALIZED VIEW CONCURRENTLY agent_cost_summary;

  -- Log the refresh for monitoring
  INSERT INTO system_metrics (metric_name, metric_value, labels)
  VALUES (
    'agent_cost_summary_refresh',
    1,
    jsonb_build_object(
      'refreshed_at', NOW(),
      'row_count', (SELECT COUNT(*) FROM agent_cost_summary)
    )
  );
END;
$$;

-- ============================================================
-- Helper Views for Common Queries
-- ============================================================

-- Current month cost by agent
CREATE OR REPLACE VIEW agent_current_month_cost AS
SELECT
  ar.id AS agent_id,
  ar.agent_name,
  ar.max_monthly_cost_usd AS budget_limit,
  COALESCE(acs.total_cost_usd, 0) AS current_cost,
  ar.max_monthly_cost_usd - COALESCE(acs.total_cost_usd, 0) AS remaining,
  CASE
    WHEN ar.max_monthly_cost_usd > 0 THEN
      ROUND((COALESCE(acs.total_cost_usd, 0) / ar.max_monthly_cost_usd * 100)::numeric, 2)
    ELSE 0
  END AS utilization_pct,
  COALESCE(acs.operation_count, 0) AS operation_count,
  ar.is_active,
  ar.cost_reset_at
FROM agent_registry ar
LEFT JOIN agent_cost_summary acs
  ON ar.id = acs.agent_id
  AND acs.month = date_trunc('month', NOW());

-- Cost breakdown by model (current month)
CREATE OR REPLACE VIEW cost_by_model AS
SELECT
  provider,
  model,
  SUM(tokens_input) AS total_input_tokens,
  SUM(tokens_output) AS total_output_tokens,
  SUM(cost_usd) AS total_cost_usd,
  COUNT(*) AS operation_count,
  AVG(response_time_ms) AS avg_response_time_ms,
  MIN(created_at) AS first_use,
  MAX(created_at) AS last_use
FROM llm_cost_log
WHERE created_at >= date_trunc('month', NOW())
GROUP BY provider, model
ORDER BY total_cost_usd DESC;

-- Cost breakdown by operation type (current month)
CREATE OR REPLACE VIEW cost_by_operation AS
SELECT
  operation,
  SUM(tokens_input) AS total_input_tokens,
  SUM(tokens_output) AS total_output_tokens,
  SUM(cost_usd) AS total_cost_usd,
  COUNT(*) AS operation_count,
  AVG(cost_usd) AS avg_cost_per_operation,
  AVG(response_time_ms) AS avg_response_time_ms
FROM llm_cost_log
WHERE created_at >= date_trunc('month', NOW())
GROUP BY operation
ORDER BY total_cost_usd DESC;

-- Daily cost trend (last 30 days)
CREATE OR REPLACE VIEW daily_cost_trend AS
SELECT
  date_trunc('day', created_at) AS day,
  SUM(cost_usd) AS total_cost_usd,
  COUNT(*) AS operation_count,
  SUM(tokens_input + tokens_output) AS total_tokens
FROM llm_cost_log
WHERE created_at >= NOW() - INTERVAL '30 days'
GROUP BY date_trunc('day', created_at)
ORDER BY day DESC;

-- ============================================================
-- Comments for Documentation
-- ============================================================

COMMENT ON TABLE llm_cost_log IS 'Tracks all LLM and embedding operations with token usage and cost attribution';
COMMENT ON COLUMN llm_cost_log.correlation_id IS 'Links to request correlation tracking for debugging';
COMMENT ON COLUMN llm_cost_log.signal_id IS 'Associates cost with specific signal being processed';
COMMENT ON COLUMN llm_cost_log.agent_id IS 'Attributes cost to specific agent for budget enforcement';
COMMENT ON COLUMN llm_cost_log.operation IS 'Type of operation: llm_extraction, embedding, synthesis, query, etc.';
COMMENT ON COLUMN llm_cost_log.cost_usd IS 'Calculated cost in USD based on token usage and pricing table';

COMMENT ON MATERIALIZED VIEW agent_cost_summary IS 'Pre-aggregated agent costs by month for fast dashboard queries';
COMMENT ON FUNCTION refresh_agent_cost_summary() IS 'Refreshes agent_cost_summary materialized view concurrently';

COMMENT ON VIEW agent_current_month_cost IS 'Shows current month cost status for all agents with budget utilization';
COMMENT ON VIEW cost_by_model IS 'Aggregates costs by provider and model for current month';
COMMENT ON VIEW cost_by_operation IS 'Aggregates costs by operation type for current month';
COMMENT ON VIEW daily_cost_trend IS 'Shows daily cost trends for last 30 days';

-- ============================================================
-- Initial Materialized View Population
-- ============================================================

-- Populate the materialized view with any existing data
REFRESH MATERIALIZED VIEW agent_cost_summary;
