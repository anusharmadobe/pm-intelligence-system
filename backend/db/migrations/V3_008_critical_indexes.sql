-- V3_008: Critical indexes for performance and data integrity
-- Fixes missing indexes on signal_entities and entity_aliases identified in comprehensive analysis
-- Priority: P0 (Critical) - These indexes are essential for pipeline performance

-- ============================================================
-- Signal Entities Indexes (CRITICAL)
-- ============================================================

-- Index for entity_id lookups - used heavily in entity resolution
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_signal_entities_entity_id
  ON signal_entities(entity_id);

-- Index for signal_id lookups - used when querying entities for a signal
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_signal_entities_signal_id
  ON signal_entities(signal_id);

-- Composite index for entity type filtering with entity_id
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_signal_entities_entity_type_id
  ON signal_entities(entity_type, entity_id);

-- Composite index for finding all entities of a specific type for a signal
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_signal_entities_signal_type
  ON signal_entities(signal_id, entity_type);

COMMENT ON INDEX idx_signal_entities_entity_id IS 'Critical index for entity resolution - enables fast lookups by entity_id';
COMMENT ON INDEX idx_signal_entities_signal_id IS 'Critical index for signal queries - enables fast lookups of all entities for a signal';
COMMENT ON INDEX idx_signal_entities_entity_type_id IS 'Composite index for entity type filtering - used in entity aggregation queries';
COMMENT ON INDEX idx_signal_entities_signal_type IS 'Composite index for type-specific entity queries per signal';

-- ============================================================
-- Entity Aliases Indexes (HIGH PRIORITY)
-- ============================================================

-- Index for canonical_entity_id lookups - used in entity resolution
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_entity_aliases_canonical_id
  ON entity_aliases(canonical_entity_id);

-- Index for alias lookups by name - used when resolving entity mentions
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_entity_aliases_alias_name
  ON entity_aliases(LOWER(alias));

COMMENT ON INDEX idx_entity_aliases_canonical_id IS 'High priority index for canonical entity lookups during resolution';
COMMENT ON INDEX idx_entity_aliases_alias_name IS 'Case-insensitive index for entity alias resolution by name';

-- ============================================================
-- Verification Query
-- ============================================================

-- Verify that critical indexes were created
SELECT
  tablename,
  indexname,
  indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename IN ('signal_entities', 'entity_aliases')
  AND indexname LIKE 'idx_%'
ORDER BY tablename, indexname;

-- ============================================================
-- Performance Impact Note
-- ============================================================

/*
 * EXPECTED PERFORMANCE IMPROVEMENTS:
 *
 * 1. Entity Resolution:
 *    - Before: Full table scan on signal_entities (O(n))
 *    - After: Index lookup (O(log n))
 *    - Expected speedup: 10-100x for typical queries
 *
 * 2. Signal Entity Queries:
 *    - Before: Sequential scan when finding entities for signals
 *    - After: Index-only scan
 *    - Expected speedup: 5-50x
 *
 * 3. Entity Alias Resolution:
 *    - Before: Full table scan with LOWER() function
 *    - After: Index scan on pre-computed lowercase values
 *    - Expected speedup: 20-200x
 *
 * CREATED CONCURRENTLY:
 * These indexes are created with CONCURRENTLY to avoid blocking writes
 * during migration. This is safe for production deployment.
 */
