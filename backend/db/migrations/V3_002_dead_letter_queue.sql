-- V3_002: Dead Letter Queue for permanently failed signals
-- Enhances failed signal tracking with retry scheduling and DLQ

-- Add retry scheduling columns to failed_signal_attempts
ALTER TABLE failed_signal_attempts
  ADD COLUMN IF NOT EXISTS next_retry_at TIMESTAMP DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS max_retries INTEGER DEFAULT 5;

-- Update status constraint to include 'retrying'
ALTER TABLE failed_signal_attempts
  DROP CONSTRAINT IF EXISTS failed_signal_attempts_status_check;

ALTER TABLE failed_signal_attempts
  ADD CONSTRAINT failed_signal_attempts_status_check
    CHECK (status IN ('pending', 'retrying', 'recovered', 'permanent_fail', 'moved_to_dlq'));

-- Create index for retry scheduling
CREATE INDEX IF NOT EXISTS idx_failed_signal_attempts_retry
  ON failed_signal_attempts(status, next_retry_at)
  WHERE status = 'pending';

-- Create dead letter queue table
CREATE TABLE IF NOT EXISTS dead_letter_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  signal_id UUID NOT NULL UNIQUE REFERENCES signals(id) ON DELETE CASCADE,
  source_ref TEXT,
  run_id TEXT,
  attempts INTEGER NOT NULL,
  final_error_type TEXT NOT NULL,
  final_error_message TEXT NOT NULL,
  failed_at TIMESTAMP NOT NULL,
  moved_to_dlq_at TIMESTAMP NOT NULL DEFAULT NOW(),
  reviewed BOOLEAN DEFAULT FALSE,
  reviewed_at TIMESTAMP,
  review_notes TEXT,
  resolution TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Indexes for DLQ
CREATE INDEX IF NOT EXISTS idx_dlq_signal_id ON dead_letter_queue(signal_id);
CREATE INDEX IF NOT EXISTS idx_dlq_failed_at ON dead_letter_queue(failed_at DESC);
CREATE INDEX IF NOT EXISTS idx_dlq_reviewed ON dead_letter_queue(reviewed) WHERE NOT reviewed;
CREATE INDEX IF NOT EXISTS idx_dlq_moved_at ON dead_letter_queue(moved_to_dlq_at DESC);

-- Add comment
COMMENT ON TABLE dead_letter_queue IS 'Signals that permanently failed after max retry attempts';
COMMENT ON COLUMN dead_letter_queue.reviewed IS 'Whether engineering has reviewed this failure';
COMMENT ON COLUMN dead_letter_queue.resolution IS 'How the issue was resolved: fixed_in_code, data_issue, transient, etc';
