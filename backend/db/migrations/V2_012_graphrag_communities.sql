-- V2: GraphRAG communities
CREATE TABLE IF NOT EXISTS graphrag_communities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id TEXT NOT NULL,
  community_key TEXT NOT NULL,
  label TEXT NOT NULL,
  level INTEGER DEFAULT 0,
  signal_ids UUID[] DEFAULT '{}',
  entity_counts JSONB DEFAULT '{}'::jsonb,
  summary TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_graphrag_run ON graphrag_communities(run_id);
CREATE INDEX IF NOT EXISTS idx_graphrag_label ON graphrag_communities(label);
