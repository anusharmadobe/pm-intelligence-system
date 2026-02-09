-- Channel registry with categorization and weighting
-- This schema enables multi-channel Slack ingestion with configurable weights

CREATE TABLE IF NOT EXISTS slack_channels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id TEXT UNIQUE NOT NULL,
  channel_name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'general',
  weight FLOAT NOT NULL DEFAULT 1.0 CHECK (weight >= 0.1 AND weight <= 5.0),
  is_active BOOLEAN DEFAULT TRUE,
  workspace_id TEXT,
  description TEXT,
  metadata JSONB,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Category values: customer_engagement, support, sales, engineering, general
-- Weight ranges: 0.5 (low priority) to 2.0 (high priority), default 1.0

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_slack_channels_category ON slack_channels(category);
CREATE INDEX IF NOT EXISTS idx_slack_channels_active ON slack_channels(is_active);
CREATE INDEX IF NOT EXISTS idx_slack_channels_channel_id ON slack_channels(channel_id);
CREATE INDEX IF NOT EXISTS idx_slack_channels_workspace ON slack_channels(workspace_id);

-- Add trigger for updated_at
CREATE OR REPLACE FUNCTION update_slack_channels_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_slack_channels_updated_at ON slack_channels;
CREATE TRIGGER trigger_slack_channels_updated_at
  BEFORE UPDATE ON slack_channels
  FOR EACH ROW
  EXECUTE FUNCTION update_slack_channels_updated_at();
