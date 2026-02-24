-- V3_011: Neo4j Dead Letter Queue
--
-- Purpose: Store Neo4j sync items that exceeded retry limits for manual inspection
-- and reprocessing. This prevents permanently failed items from cluttering the
-- main backlog table and provides a clear audit trail of failures.

CREATE TABLE IF NOT EXISTS neo4j_sync_dead_letter (
  id UUID PRIMARY KEY,  -- Preserve original backlog ID for traceability
  operation VARCHAR(30) NOT NULL,
  payload JSONB NOT NULL,
  retry_count INTEGER NOT NULL,
  error_message TEXT,
  original_created_at TIMESTAMP NOT NULL,  -- When item first entered backlog
  failed_at TIMESTAMP NOT NULL DEFAULT NOW(),  -- When moved to dead letter
  last_retry_at TIMESTAMP,  -- Last attempt to reprocess
  reprocess_count INTEGER DEFAULT 0,  -- How many times reprocessed from DLQ
  resolved BOOLEAN DEFAULT FALSE,  -- Manually marked as resolved
  resolved_at TIMESTAMP,
  resolved_by VARCHAR(100),  -- User/system that resolved
  notes TEXT  -- Manual notes for investigation
);

-- Index for querying unresolved items
CREATE INDEX IF NOT EXISTS idx_neo4j_dlq_unresolved
  ON neo4j_sync_dead_letter(failed_at DESC)
  WHERE resolved = FALSE;

-- Index for querying by operation type
CREATE INDEX IF NOT EXISTS idx_neo4j_dlq_operation
  ON neo4j_sync_dead_letter(operation, failed_at DESC);

-- Add comments for documentation
COMMENT ON TABLE neo4j_sync_dead_letter IS
  'Dead letter queue for Neo4j sync items that exceeded retry limits. Items here require manual inspection and potential reprocessing.';

COMMENT ON COLUMN neo4j_sync_dead_letter.id IS
  'Original ID from neo4j_sync_backlog for traceability';

COMMENT ON COLUMN neo4j_sync_dead_letter.reprocess_count IS
  'Number of manual reprocess attempts from DLQ';

COMMENT ON COLUMN neo4j_sync_dead_letter.resolved IS
  'Whether the issue has been manually resolved or can be ignored';
