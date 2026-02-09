-- Performance indexes for PM Intelligence System
-- Run after initial schema migration

-- Signals indexes
CREATE INDEX IF NOT EXISTS idx_signals_source ON signals(source);
CREATE INDEX IF NOT EXISTS idx_signals_created_at ON signals(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_signals_source_type ON signals(source, signal_type);
CREATE INDEX IF NOT EXISTS idx_signals_normalized_content ON signals USING gin(to_tsvector('english', normalized_content));

-- Enhanced indexes for filtering and querying
CREATE INDEX IF NOT EXISTS idx_signals_source_ref ON signals(source, source_ref);
CREATE INDEX IF NOT EXISTS idx_signals_created_at_btree ON signals(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_signals_severity ON signals(severity) WHERE severity IS NOT NULL;

-- JSONB indexes for metadata queries (customers, topics, quality_score)
CREATE INDEX IF NOT EXISTS idx_signals_metadata_customers ON signals USING gin((metadata->'customers'));
CREATE INDEX IF NOT EXISTS idx_signals_metadata_topics ON signals USING gin((metadata->'topics'));
CREATE INDEX IF NOT EXISTS idx_signals_metadata_quality_score ON signals((CAST(metadata->>'quality_score' AS INT))) WHERE metadata->>'quality_score' IS NOT NULL;

-- Opportunities indexes
CREATE INDEX IF NOT EXISTS idx_opportunities_status ON opportunities(status);
CREATE INDEX IF NOT EXISTS idx_opportunities_created_at ON opportunities(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_opportunities_status_created ON opportunities(status, created_at DESC);

-- Opportunity signals junction table
CREATE INDEX IF NOT EXISTS idx_opportunity_signals_opportunity_id ON opportunity_signals(opportunity_id);
CREATE INDEX IF NOT EXISTS idx_opportunity_signals_signal_id ON opportunity_signals(signal_id);

-- Composite index for finding signals not yet linked to opportunities
CREATE INDEX IF NOT EXISTS idx_opportunity_signals_composite ON opportunity_signals(opportunity_id, signal_id);

-- Judgments indexes
CREATE INDEX IF NOT EXISTS idx_judgments_opportunity_id ON judgments(opportunity_id);
CREATE INDEX IF NOT EXISTS idx_judgments_created_at ON judgments(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_judgments_confidence_level ON judgments(confidence_level);

-- Artifacts indexes
CREATE INDEX IF NOT EXISTS idx_artifacts_judgment_id ON artifacts(judgment_id);
CREATE INDEX IF NOT EXISTS idx_artifacts_type ON artifacts(artifact_type);
CREATE INDEX IF NOT EXISTS idx_artifacts_created_at ON artifacts(created_at DESC);
