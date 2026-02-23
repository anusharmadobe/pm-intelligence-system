CREATE TABLE IF NOT EXISTS pipeline_checkpoints (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id TEXT NOT NULL,
  stage TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at TIMESTAMP,
  completed_at TIMESTAMP,
  signature JSONB,
  result JSONB,
  error TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(run_id, stage)
);

CREATE INDEX IF NOT EXISTS idx_pipeline_checkpoints_created_at
  ON pipeline_checkpoints(created_at DESC);
