-- V2: Cached entity-name embeddings for semantic entity resolution
CREATE TABLE IF NOT EXISTS entity_name_embeddings (
  entity_id UUID PRIMARY KEY REFERENCES entity_registry(id) ON DELETE CASCADE,
  embedding JSONB NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_entity_name_embeddings_updated_at
  ON entity_name_embeddings(updated_at);
