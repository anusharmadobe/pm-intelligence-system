-- V2: Source registry
CREATE TABLE IF NOT EXISTS source_registry (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_name VARCHAR(100) NOT NULL UNIQUE,
  source_type VARCHAR(50) NOT NULL, -- 'slack', 'transcript', 'document', 'web_scrape', 'jira', 'wiki'
  status VARCHAR(20) DEFAULT 'connected', -- 'connected', 'error', 'disabled'
  config JSONB DEFAULT '{}'::jsonb,
  last_synced_at TIMESTAMP,
  last_error TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_source_registry_type ON source_registry(source_type);
CREATE INDEX IF NOT EXISTS idx_source_registry_status ON source_registry(status);
