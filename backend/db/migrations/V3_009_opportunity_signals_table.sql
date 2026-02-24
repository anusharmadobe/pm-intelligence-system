-- V3_009: Create opportunity_signals junction table
-- This table is CRITICAL as it's already being used in opportunity_service.ts but was never created!
-- Priority: P0 (Critical) - Code will fail at runtime without this table

-- ============================================================
-- Opportunity Signals Junction Table
-- ============================================================

-- Create the junction table linking opportunities to their constituent signals
CREATE TABLE IF NOT EXISTS opportunity_signals (
  opportunity_id UUID NOT NULL,
  signal_id UUID NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  PRIMARY KEY (opportunity_id, signal_id)
);

-- ============================================================
-- Foreign Key Constraints
-- ============================================================

-- Add foreign key to opportunities table (with CASCADE delete)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fk_opportunity_signals_opportunity_id'
  ) THEN
    ALTER TABLE opportunity_signals
      ADD CONSTRAINT fk_opportunity_signals_opportunity_id
      FOREIGN KEY (opportunity_id)
      REFERENCES opportunities(id)
      ON DELETE CASCADE;
  END IF;
END $$;

-- Add foreign key to signals table (with CASCADE delete)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fk_opportunity_signals_signal_id'
  ) THEN
    ALTER TABLE opportunity_signals
      ADD CONSTRAINT fk_opportunity_signals_signal_id
      FOREIGN KEY (signal_id)
      REFERENCES signals(id)
      ON DELETE CASCADE;
  END IF;
END $$;

-- ============================================================
-- Performance Indexes
-- ============================================================

-- Index for finding all signals for an opportunity (most common query)
CREATE INDEX IF NOT EXISTS idx_opportunity_signals_opportunity_id
  ON opportunity_signals(opportunity_id);

-- Index for finding which opportunities contain a specific signal
CREATE INDEX IF NOT EXISTS idx_opportunity_signals_signal_id
  ON opportunity_signals(signal_id);

-- Index for time-based queries
CREATE INDEX IF NOT EXISTS idx_opportunity_signals_created_at
  ON opportunity_signals(created_at DESC);

COMMENT ON TABLE opportunity_signals IS 'Junction table linking opportunities to their constituent signals';
COMMENT ON INDEX idx_opportunity_signals_opportunity_id IS 'Optimizes queries for all signals in an opportunity';
COMMENT ON INDEX idx_opportunity_signals_signal_id IS 'Optimizes reverse lookups - which opportunities contain a signal';

-- ============================================================
-- Data Migration (if needed)
-- ============================================================

/*
 * If there are existing opportunities with signals stored in a different way
 * (e.g., in metadata or a different table), migration logic would go here.
 *
 * For now, this table will be populated going forward as opportunities are
 * created or merged.
 */

-- ============================================================
-- Verification Query
-- ============================================================

-- Verify table and indexes were created
SELECT
  table_name,
  column_name,
  data_type,
  is_nullable
FROM information_schema.columns
WHERE table_name = 'opportunity_signals'
ORDER BY ordinal_position;

SELECT
  indexname,
  indexdef
FROM pg_indexes
WHERE tablename = 'opportunity_signals'
  AND schemaname = 'public'
ORDER BY indexname;

-- ============================================================
-- Usage Notes
-- ============================================================

/*
 * CRITICAL FIX:
 * This table is already being used in backend/services/opportunity_service.ts:
 *
 * Line 972-976:
 *   await pool.query(
 *     `UPDATE opportunity_signals
 *      SET opportunity_id = $1
 *      WHERE opportunity_id = $2`,
 *     [primaryOpportunityId, secondaryOpportunityId]
 *   );
 *
 * Without this migration, the mergeOpportunities function would fail with:
 * "relation "opportunity_signals" does not exist"
 *
 * DEPLOYMENT PRIORITY: Deploy this migration BEFORE any opportunity merge operations
 */
