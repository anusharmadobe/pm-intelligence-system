-- V2: Idempotency keys for agent gateway writes
CREATE TABLE IF NOT EXISTS idempotency_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key VARCHAR(120) NOT NULL,
  endpoint VARCHAR(200) NOT NULL,
  response_status INTEGER NOT NULL DEFAULT 200,
  response JSONB NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  expires_at TIMESTAMP DEFAULT NOW() + INTERVAL '24 hours'
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_idempotency_key_endpoint
  ON idempotency_keys(idempotency_key, endpoint);

CREATE INDEX IF NOT EXISTS idx_idempotency_expires
  ON idempotency_keys(expires_at);
