-- V2: Feedback log and prompt versions
CREATE TABLE IF NOT EXISTS feedback_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  feedback_type VARCHAR(50) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',

  -- What the system produced
  system_output JSONB NOT NULL,
  -- What the human says is correct
  human_correction JSONB,

  -- Resolution metadata
  resolved_by VARCHAR(100),
  resolved_at TIMESTAMP,
  resolution_notes TEXT,

  -- System confidence at time of output
  system_confidence FLOAT NOT NULL,

  -- Impact tracking
  signals_affected INTEGER DEFAULT 0,
  entities_affected INTEGER DEFAULT 0,

  -- Agent-specific extensions
  source_agent_id UUID,
  agent_output_type VARCHAR(50),

  -- Audit
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),

  CONSTRAINT valid_feedback_type CHECK (feedback_type IN (
    'entity_merge', 'entity_split', 'entity_rename',
    'classification_correction', 'extraction_correction',
    'false_positive', 'missing_entity', 'relevance_feedback',
    'severity_correction', 'entity_description_correction',
    'signal_is_noise', 'cluster_review', 'entity_type_correction',
    'agent_output_correction', 'agent_output_approval', 'agent_proposal_review'
  )),
  CONSTRAINT valid_status CHECK (status IN ('pending', 'accepted', 'rejected', 'deferred'))
);

CREATE INDEX IF NOT EXISTS idx_feedback_status ON feedback_log(status);
CREATE INDEX IF NOT EXISTS idx_feedback_type ON feedback_log(feedback_type);
CREATE INDEX IF NOT EXISTS idx_feedback_created ON feedback_log(created_at);

-- Prompt versioning: track prompt changes driven by feedback
CREATE TABLE IF NOT EXISTS prompt_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prompt_name VARCHAR(100) NOT NULL,
  version INTEGER NOT NULL,
  prompt_text TEXT NOT NULL,
  change_reason TEXT,
  feedback_ids UUID[],
  accuracy_before FLOAT,
  accuracy_after FLOAT,
  is_active BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT NOW(),

  CONSTRAINT unique_prompt_version UNIQUE (prompt_name, version)
);

-- View: per-agent accuracy over rolling 30-day window
CREATE OR REPLACE VIEW agent_accuracy_30d AS
SELECT
  source_agent_id,
  agent_output_type,
  COUNT(*) FILTER (WHERE feedback_type = 'agent_output_approval') AS approved,
  COUNT(*) FILTER (WHERE feedback_type = 'agent_output_correction') AS corrected,
  COUNT(*) FILTER (WHERE feedback_type IN ('agent_output_approval', 'agent_output_correction')) AS total,
  CASE
    WHEN COUNT(*) FILTER (WHERE feedback_type IN ('agent_output_approval', 'agent_output_correction')) = 0 THEN 0
    ELSE ROUND(
      (COUNT(*) FILTER (WHERE feedback_type = 'agent_output_approval'))::numeric
      / (COUNT(*) FILTER (WHERE feedback_type IN ('agent_output_approval', 'agent_output_correction'))::numeric), 4
    )
  END AS accuracy_pct
FROM feedback_log
WHERE created_at >= NOW() - INTERVAL '30 days'
  AND source_agent_id IS NOT NULL
GROUP BY source_agent_id, agent_output_type;
