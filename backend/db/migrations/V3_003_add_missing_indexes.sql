-- V3_003: Add missing indexes and constraints for performance and data integrity
-- Enhances query performance and enforces data constraints across multiple tables

-- ============================================================
-- Neo4j Sync Backlog Improvements
-- ============================================================

-- Index for pending backlog items by creation time
CREATE INDEX IF NOT EXISTS idx_neo4j_backlog_status_created
  ON neo4j_sync_backlog(status, created_at)
  WHERE status = 'pending';

-- Index for processing backlog items
CREATE INDEX IF NOT EXISTS idx_neo4j_backlog_processing
  ON neo4j_sync_backlog(status, created_at)
  WHERE status = 'processing';

-- Enforce valid status values
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'neo4j_sync_backlog_status_check'
  ) THEN
    ALTER TABLE neo4j_sync_backlog
      ADD CONSTRAINT neo4j_sync_backlog_status_check
      CHECK (status IN ('pending', 'processing', 'completed', 'failed'));
  END IF;
END $$;

-- ============================================================
-- Failed Signal Attempts Improvements
-- ============================================================

-- Index for querying by run_id to track batch failures
CREATE INDEX IF NOT EXISTS idx_failed_signals_run_id
  ON failed_signal_attempts(run_id);

-- Index for querying by error type for analysis
CREATE INDEX IF NOT EXISTS idx_failed_signals_error_type
  ON failed_signal_attempts(error_type);

-- Composite index for retry queries
CREATE INDEX IF NOT EXISTS idx_failed_signals_status_next_retry
  ON failed_signal_attempts(status, next_retry_at)
  WHERE status IN ('pending', 'retrying');

-- ============================================================
-- Signal Corrections Improvements
-- ============================================================

-- Index for querying corrections by field path
CREATE INDEX IF NOT EXISTS idx_signal_corrections_field_path
  ON signal_corrections(field_path);

-- Index for reviewed corrections
CREATE INDEX IF NOT EXISTS idx_signal_corrections_reviewed
  ON signal_corrections(corrected_at DESC NULLS LAST);

-- GIN index for pattern data JSONB queries (if table exists)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'correction_patterns') THEN
    CREATE INDEX IF NOT EXISTS idx_correction_patterns_gin
      ON correction_patterns USING GIN (pattern_data);
  END IF;
END $$;

-- ============================================================
-- Signals Table Performance Indexes
-- ============================================================

-- Composite index for source and creation time queries
CREATE INDEX IF NOT EXISTS idx_signals_source_created
  ON signals(source, created_at DESC);

-- Index for quality score filtering
CREATE INDEX IF NOT EXISTS idx_signals_quality_score
  ON signals(((metadata->>'quality_score')::INT) DESC NULLS LAST)
  WHERE metadata->>'quality_score' IS NOT NULL;

-- Index for confidence filtering
CREATE INDEX IF NOT EXISTS idx_signals_confidence
  ON signals(confidence DESC)
  WHERE confidence > 0.5;

-- GIN index for metadata JSONB queries
CREATE INDEX IF NOT EXISTS idx_signals_metadata_gin
  ON signals USING GIN (metadata);

-- Text search index for normalized content
CREATE INDEX IF NOT EXISTS idx_signals_normalized_content_fts
  ON signals USING GIN (to_tsvector('english', normalized_content));

-- ============================================================
-- Opportunities Table Performance Indexes
-- ============================================================

-- Composite index for severity and creation time (only when column exists)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'opportunities'
      AND column_name = 'severity'
  ) THEN
    CREATE INDEX IF NOT EXISTS idx_opportunities_severity_created
      ON opportunities(severity, created_at DESC);
  END IF;
END $$;

-- Index for status filtering
CREATE INDEX IF NOT EXISTS idx_opportunities_status
  ON opportunities(status)
  WHERE status IN ('open', 'in_progress');

-- Index for confidence filtering (only when column exists)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'opportunities'
      AND column_name = 'confidence'
  ) THEN
    CREATE INDEX IF NOT EXISTS idx_opportunities_confidence
      ON opportunities(confidence DESC)
      WHERE confidence > 0.7;
  END IF;
END $$;

-- GIN index for impact areas JSONB (only when column exists)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'opportunities'
      AND column_name = 'impact_areas'
  ) THEN
    CREATE INDEX IF NOT EXISTS idx_opportunities_impact_areas_gin
      ON opportunities USING GIN (impact_areas);
  END IF;
END $$;

-- ============================================================
-- Signal Embeddings Performance Indexes
-- ============================================================

-- Index for model filtering
CREATE INDEX IF NOT EXISTS idx_signal_embeddings_model
  ON signal_embeddings(model);

-- Index for embeddings with recent updates
CREATE INDEX IF NOT EXISTS idx_signal_embeddings_updated
  ON signal_embeddings(created_at DESC NULLS LAST);

-- ============================================================
-- Entity Resolution Indexes
-- ============================================================

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_name = 'entities'
  ) THEN
    -- Index for canonical entities lookup
    CREATE INDEX IF NOT EXISTS idx_entities_is_canonical
      ON entities(is_canonical)
      WHERE is_canonical = true;

    -- Index for entity type filtering
    CREATE INDEX IF NOT EXISTS idx_entities_type
      ON entities(entity_type);

    -- Composite index for name and type lookups
    CREATE INDEX IF NOT EXISTS idx_entities_name_type
      ON entities(LOWER(name), entity_type);
  END IF;
END $$;

-- ============================================================
-- Channel Registry Indexes
-- ============================================================

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_name = 'channels'
  ) THEN
    -- Index for active channels
    CREATE INDEX IF NOT EXISTS idx_channels_active
      ON channels(is_active, last_activity_at DESC NULLS LAST)
      WHERE is_active = true;

    -- Index for channel category
    CREATE INDEX IF NOT EXISTS idx_channels_category
      ON channels(category);
  END IF;
END $$;

-- ============================================================
-- System Metrics Indexes
-- ============================================================

-- Composite index for metrics by name and time
CREATE INDEX IF NOT EXISTS idx_system_metrics_name_time
  ON system_metrics(metric_name, recorded_at DESC);

-- Partial index for non-aggregated metrics
CREATE INDEX IF NOT EXISTS idx_system_metrics_raw
  ON system_metrics(recorded_at DESC)
  WHERE COALESCE(labels->>'aggregated', 'false') = 'false';

-- ============================================================
-- Idempotency Keys Performance
-- ============================================================

-- Index for cleanup of expired keys
CREATE INDEX IF NOT EXISTS idx_idempotency_keys_expires
  ON idempotency_keys(expires_at)
  WHERE expires_at IS NOT NULL;

-- ============================================================
-- Dead Letter Queue Indexes (from V3_002)
-- ============================================================

-- Ensure DLQ indexes exist (may already be created by V3_002)
CREATE INDEX IF NOT EXISTS idx_dlq_signal_id
  ON dead_letter_queue(signal_id);

CREATE INDEX IF NOT EXISTS idx_dlq_failed_at
  ON dead_letter_queue(failed_at DESC);

CREATE INDEX IF NOT EXISTS idx_dlq_reviewed
  ON dead_letter_queue(reviewed)
  WHERE NOT reviewed;

CREATE INDEX IF NOT EXISTS idx_dlq_moved_at
  ON dead_letter_queue(moved_to_dlq_at DESC);

-- ============================================================
-- Theme Classifications Indexes
-- ============================================================

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_name = 'signal_theme_classifications'
  ) THEN
    -- Composite index for theme lookups
    CREATE INDEX IF NOT EXISTS idx_theme_classifications_theme_signal
      ON signal_theme_classifications(theme_slug, signal_id);

    -- Index for confidence-based filtering
    CREATE INDEX IF NOT EXISTS idx_theme_classifications_confidence
      ON signal_theme_classifications(confidence DESC)
      WHERE confidence > 0.7;
  END IF;
END $$;

-- ============================================================
-- API Keys Indexes (from V3_001 auth migration)
-- ============================================================

DO $$
BEGIN
  -- Index for API key lookups (if table exists)
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'api_keys') THEN
    CREATE INDEX IF NOT EXISTS idx_api_keys_expires
      ON api_keys(expires_at)
      WHERE expires_at IS NOT NULL;

    CREATE INDEX IF NOT EXISTS idx_api_keys_last_used
      ON api_keys(last_used_at DESC NULLS LAST);
  END IF;
END $$;

-- ============================================================
-- Comments
-- ============================================================

COMMENT ON INDEX idx_signals_source_created IS 'Optimizes queries filtering by source and sorting by creation time';
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'idx_opportunities_severity_created'
  ) THEN
    COMMENT ON INDEX idx_opportunities_severity_created IS 'Optimizes priority queries for opportunities dashboard';
  END IF;
END $$;
COMMENT ON INDEX idx_failed_signals_status_next_retry IS 'Optimizes retry job queries for pending failed signals';
COMMENT ON INDEX idx_signal_embeddings_updated IS 'Optimizes queries for recently updated embeddings';
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'idx_entities_is_canonical'
  ) THEN
    COMMENT ON INDEX idx_entities_is_canonical IS 'Speeds up canonical entity resolution lookups';
  END IF;
END $$;

-- ============================================================
-- Verification Query
-- ============================================================

-- Verify indexes were created
SELECT
  schemaname,
  tablename,
  indexname,
  indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND indexname LIKE 'idx_%'
ORDER BY tablename, indexname;
