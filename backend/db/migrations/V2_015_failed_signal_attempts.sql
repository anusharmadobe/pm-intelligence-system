-- V2: Durable tracking for failed ingestion/extraction attempts
CREATE TABLE IF NOT EXISTS failed_signal_attempts (
  signal_id UUID PRIMARY KEY REFERENCES signals(id) ON DELETE CASCADE,
  source_ref TEXT,
  run_id TEXT NOT NULL,
  error_type TEXT NOT NULL,
  error_message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  attempt_count INTEGER NOT NULL DEFAULT 1,
  failed_at TIMESTAMP NOT NULL DEFAULT NOW(),
  replayed_at TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT failed_signal_attempts_status_check
    CHECK (status IN ('pending', 'recovered', 'permanent_fail'))
);

CREATE INDEX IF NOT EXISTS idx_failed_signal_attempts_status ON failed_signal_attempts(status);
CREATE INDEX IF NOT EXISTS idx_failed_signal_attempts_failed_at ON failed_signal_attempts(failed_at DESC);
