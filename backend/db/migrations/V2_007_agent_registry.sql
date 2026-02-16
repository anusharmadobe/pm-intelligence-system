-- V2: Agent registry and activity log
CREATE TABLE IF NOT EXISTS agent_registry (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_name VARCHAR(100) NOT NULL UNIQUE,
  agent_class VARCHAR(20) NOT NULL,
  api_key_hash VARCHAR(256) NOT NULL,
  permissions JSONB NOT NULL DEFAULT '{}'::jsonb,
  rate_limit_per_minute INTEGER DEFAULT 60,
  event_subscriptions TEXT[] DEFAULT '{}',
  webhook_url VARCHAR(500),
  is_active BOOLEAN DEFAULT true,
  last_seen_at TIMESTAMP,
  total_requests INTEGER DEFAULT 0,

  -- Versioning
  current_version VARCHAR(20) NOT NULL DEFAULT '1.0.0',
  deployed_at TIMESTAMP DEFAULT NOW(),
  rollback_version VARCHAR(20),

  -- SLOs
  slo_accuracy_pct FLOAT DEFAULT 90.0,
  slo_response_time_ms INTEGER DEFAULT 5000,
  slo_uptime_pct FLOAT DEFAULT 95.0,
  slo_breach_count INTEGER DEFAULT 0,
  slo_last_checked_at TIMESTAMP,

  -- Cost tracking
  max_monthly_cost_usd FLOAT DEFAULT 50.0,
  current_month_cost_usd FLOAT DEFAULT 0.0,
  cost_reset_at TIMESTAMP DEFAULT date_trunc('month', NOW()),

  -- A2A discovery
  a2a_agent_card_url VARCHAR(500),
  a2a_capabilities JSONB,

  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_api_key ON agent_registry(api_key_hash);
CREATE INDEX IF NOT EXISTS idx_agent_active ON agent_registry(is_active);
CREATE INDEX IF NOT EXISTS idx_agent_class ON agent_registry(agent_class);

CREATE TABLE IF NOT EXISTS agent_version_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES agent_registry(id),
  version VARCHAR(20) NOT NULL,
  config JSONB NOT NULL,
  deployed_at TIMESTAMP DEFAULT NOW(),
  retired_at TIMESTAMP,
  deployed_by VARCHAR(100) NOT NULL,
  rollback_reason TEXT,
  performance_snapshot JSONB,
  UNIQUE(agent_id, version)
);

CREATE INDEX IF NOT EXISTS idx_version_agent ON agent_version_history(agent_id);
CREATE INDEX IF NOT EXISTS idx_version_deployed ON agent_version_history(deployed_at);

CREATE TABLE IF NOT EXISTS agent_activity_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES agent_registry(id),
  action VARCHAR(100) NOT NULL,
  endpoint VARCHAR(200) NOT NULL,
  request_params JSONB,
  response_status INTEGER,
  response_time_ms INTEGER,
  error_message TEXT,

  tokens_input INTEGER DEFAULT 0,
  tokens_output INTEGER DEFAULT 0,
  model_used VARCHAR(50),
  estimated_cost_usd FLOAT DEFAULT 0.0,

  agent_version VARCHAR(20),
  created_at TIMESTAMP DEFAULT NOW()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'feedback_log_source_agent_id_fkey'
  ) THEN
    ALTER TABLE feedback_log
      ADD CONSTRAINT feedback_log_source_agent_id_fkey
      FOREIGN KEY (source_agent_id) REFERENCES agent_registry(id);
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS idx_agent_activity_agent ON agent_activity_log(agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_activity_created ON agent_activity_log(created_at);
CREATE INDEX IF NOT EXISTS idx_agent_activity_cost ON agent_activity_log(agent_id, created_at)
  WHERE estimated_cost_usd > 0;

CREATE OR REPLACE VIEW agent_monthly_cost AS
SELECT
  agent_id,
  date_trunc('month', created_at) AS month,
  SUM(tokens_input) AS total_input_tokens,
  SUM(tokens_output) AS total_output_tokens,
  SUM(estimated_cost_usd) AS total_cost_usd,
  COUNT(*) AS total_requests
FROM agent_activity_log
GROUP BY agent_id, date_trunc('month', created_at);
