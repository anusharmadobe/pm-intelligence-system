-- Migration V2_020: Auto-Correction Mechanism
-- Creates tables for storing signal extraction corrections and learned patterns

-- Ensure uuid-ossp extension is installed
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Table: signal_corrections
-- Stores individual corrections made by users to signal extractions
CREATE TABLE IF NOT EXISTS signal_corrections (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  signal_id UUID NOT NULL REFERENCES signals(id) ON DELETE CASCADE,
  correction_type VARCHAR(50) NOT NULL, -- 'customer_name', 'feature_name', 'issue_title', 'sentiment', 'urgency', 'theme'
  field_path TEXT NOT NULL, -- JSONPath to field in signal_extractions.extraction (e.g., 'entities.customers[0]')
  old_value TEXT NOT NULL,
  new_value TEXT NOT NULL,
  corrected_by VARCHAR(255) NOT NULL, -- 'human', 'auto', or user identifier
  corrected_at TIMESTAMP NOT NULL DEFAULT NOW(),
  applied_to_similar_count INTEGER DEFAULT 0, -- Number of similar signals this correction was applied to
  confidence FLOAT DEFAULT 1.0, -- Confidence score (1.0 for human corrections, <1.0 for auto)
  human_verified BOOLEAN DEFAULT true, -- Whether this correction was verified by a human
  metadata JSONB DEFAULT '{}'::jsonb, -- Additional metadata about the correction
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Indexes for signal_corrections
CREATE INDEX idx_signal_corrections_signal_id ON signal_corrections(signal_id);
CREATE INDEX idx_signal_corrections_type ON signal_corrections(correction_type);
CREATE INDEX idx_signal_corrections_corrected_at ON signal_corrections(corrected_at DESC);
CREATE INDEX idx_signal_corrections_corrected_by ON signal_corrections(corrected_by);

-- Table: correction_patterns
-- Stores learned patterns from corrections for automatic application
CREATE TABLE IF NOT EXISTS correction_patterns (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  pattern_type VARCHAR(50) NOT NULL, -- 'entity_normalization', 'sentiment_classifier', 'urgency_adjustment', etc.
  pattern_data JSONB NOT NULL, -- Pattern definition: { "old_pattern": "...", "new_pattern": "...", "context": [...] }
  correction_type VARCHAR(50), -- Related correction_type from signal_corrections
  occurrence_count INTEGER DEFAULT 1, -- Number of times this pattern has been observed
  accuracy_rate FLOAT, -- Track how often this pattern is correct (based on human verification)
  last_applied TIMESTAMP DEFAULT NOW(),
  enabled BOOLEAN DEFAULT true, -- Whether this pattern should be auto-applied
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Indexes for correction_patterns
CREATE INDEX idx_correction_patterns_type ON correction_patterns(pattern_type);
CREATE INDEX idx_correction_patterns_enabled ON correction_patterns(enabled) WHERE enabled = true;
CREATE INDEX idx_correction_patterns_accuracy ON correction_patterns(accuracy_rate DESC NULLS LAST);

-- Table: correction_applications
-- Tracks when corrections or patterns were applied to signals
CREATE TABLE IF NOT EXISTS correction_applications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  signal_id UUID NOT NULL REFERENCES signals(id) ON DELETE CASCADE,
  correction_id UUID REFERENCES signal_corrections(id) ON DELETE CASCADE, -- Original correction this was based on
  pattern_id UUID REFERENCES correction_patterns(id) ON DELETE SET NULL, -- Pattern used (if auto-applied)
  applied_at TIMESTAMP NOT NULL DEFAULT NOW(),
  applied_by VARCHAR(50) NOT NULL, -- 'human', 'auto_similar', 'auto_pattern'
  field_path TEXT NOT NULL,
  old_value TEXT,
  new_value TEXT,
  confidence FLOAT DEFAULT 1.0,
  verified BOOLEAN DEFAULT NULL, -- NULL=not reviewed, true=correct, false=incorrect
  verified_at TIMESTAMP,
  verified_by VARCHAR(255)
);

-- Indexes for correction_applications
CREATE INDEX idx_correction_applications_signal_id ON correction_applications(signal_id);
CREATE INDEX idx_correction_applications_correction_id ON correction_applications(correction_id);
CREATE INDEX idx_correction_applications_pattern_id ON correction_applications(pattern_id);
CREATE INDEX idx_correction_applications_verified ON correction_applications(verified) WHERE verified IS NOT NULL;
CREATE INDEX idx_correction_applications_applied_at ON correction_applications(applied_at DESC);

-- Add column to signal_extractions to track if corrections were applied
ALTER TABLE signal_extractions
  ADD COLUMN IF NOT EXISTS corrections_applied BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS corrections_applied_at TIMESTAMP;

CREATE INDEX IF NOT EXISTS idx_signal_extractions_corrections_applied
  ON signal_extractions(corrections_applied) WHERE corrections_applied = true;

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

-- Triggers for updated_at
CREATE TRIGGER update_signal_corrections_updated_at
  BEFORE UPDATE ON signal_corrections
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_correction_patterns_updated_at
  BEFORE UPDATE ON correction_patterns
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Comments for documentation
COMMENT ON TABLE signal_corrections IS 'Stores corrections made to signal extractions by users or automated processes';
COMMENT ON TABLE correction_patterns IS 'Learned patterns from corrections for automatic application to similar signals';
COMMENT ON TABLE correction_applications IS 'Audit log of correction applications to signals with verification status';
COMMENT ON COLUMN signal_corrections.field_path IS 'JSONPath expression to the field in extraction JSONB (e.g., entities.customers[0].name)';
COMMENT ON COLUMN signal_corrections.applied_to_similar_count IS 'Number of similar signals automatically corrected based on this correction';
COMMENT ON COLUMN correction_patterns.accuracy_rate IS 'Success rate of auto-applied corrections using this pattern (verified/total)';
COMMENT ON COLUMN correction_applications.applied_by IS 'Source of correction: human=manual, auto_similar=similarity-based, auto_pattern=pattern-based';
