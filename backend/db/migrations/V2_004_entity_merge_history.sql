-- V2: Entity merge history
CREATE TABLE IF NOT EXISTS entity_merge_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action VARCHAR(10) NOT NULL,
  surviving_entity_id UUID NOT NULL REFERENCES entity_registry(id),
  absorbed_entity_id UUID,
  new_entity_id UUID,
  performed_by VARCHAR(20) DEFAULT 'system',
  reasoning TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);
