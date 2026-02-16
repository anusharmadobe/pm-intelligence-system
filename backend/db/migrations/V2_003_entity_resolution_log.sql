-- V2: Entity resolution log
CREATE TABLE IF NOT EXISTS entity_resolution_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_mention TEXT NOT NULL,
  entity_type VARCHAR(50) NOT NULL,
  signal_id UUID REFERENCES signals(id),
  resolution_result VARCHAR(30) NOT NULL,
  resolved_to_entity_id UUID REFERENCES entity_registry(id),
  confidence FLOAT NOT NULL,
  match_details JSONB,
  llm_reasoning TEXT,
  resolved_by VARCHAR(20) DEFAULT 'system',
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_er_log_signal ON entity_resolution_log(signal_id);
CREATE INDEX IF NOT EXISTS idx_er_log_entity ON entity_resolution_log(resolved_to_entity_id);
CREATE INDEX IF NOT EXISTS idx_er_log_result ON entity_resolution_log(resolution_result);

-- Extend signal_extractions to link to canonical entities
ALTER TABLE IF EXISTS signal_extractions
  ADD COLUMN IF NOT EXISTS canonical_entity_id UUID REFERENCES entity_registry(id);
ALTER TABLE IF EXISTS signal_extractions
  ADD COLUMN IF NOT EXISTS resolution_confidence FLOAT;
ALTER TABLE IF EXISTS signal_extractions
  ADD COLUMN IF NOT EXISTS resolution_method VARCHAR(30);
