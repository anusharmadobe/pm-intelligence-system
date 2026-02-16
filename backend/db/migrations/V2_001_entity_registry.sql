-- V2: Canonical entity registry
-- Requires pgcrypto for gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS entity_registry (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type VARCHAR(50) NOT NULL,
  canonical_name TEXT NOT NULL,
  description TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  confidence FLOAT DEFAULT 1.0,
  created_by VARCHAR(20) DEFAULT 'system',
  last_validated_by VARCHAR(20),
  last_validated_at TIMESTAMP,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  CONSTRAINT valid_entity_type CHECK (entity_type IN ('customer', 'feature', 'issue', 'theme', 'stakeholder'))
);

CREATE INDEX IF NOT EXISTS idx_entity_registry_type ON entity_registry(entity_type);
CREATE INDEX IF NOT EXISTS idx_entity_registry_name ON entity_registry(canonical_name);
CREATE INDEX IF NOT EXISTS idx_entity_registry_active ON entity_registry(is_active) WHERE is_active = true;
