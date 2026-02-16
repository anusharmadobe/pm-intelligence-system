-- V2: Entity aliases
CREATE TABLE IF NOT EXISTS entity_aliases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_entity_id UUID NOT NULL REFERENCES entity_registry(id),
  alias TEXT NOT NULL,
  alias_normalized TEXT NOT NULL,
  alias_source VARCHAR(30) NOT NULL,
  confidence FLOAT DEFAULT 1.0,
  signal_id UUID REFERENCES signals(id),
  confirmed_by_human BOOLEAN DEFAULT false,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  CONSTRAINT unique_alias_per_type UNIQUE (alias_normalized, canonical_entity_id)
);

CREATE INDEX IF NOT EXISTS idx_entity_aliases_normalized ON entity_aliases(alias_normalized);
CREATE INDEX IF NOT EXISTS idx_entity_aliases_entity ON entity_aliases(canonical_entity_id);
