-- V2: Neo4j sync backlog
CREATE TABLE IF NOT EXISTS neo4j_sync_backlog (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operation VARCHAR(30) NOT NULL,
  payload JSONB NOT NULL,
  status VARCHAR(20) DEFAULT 'pending',
  retry_count INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW(),
  processed_at TIMESTAMP
);
