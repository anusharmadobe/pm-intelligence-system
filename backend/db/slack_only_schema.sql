-- Slack-only supplemental schema
-- This file adds Slack-specific tables without modifying immutable specs.

CREATE TABLE IF NOT EXISTS slack_messages (
  signal_id UUID PRIMARY KEY REFERENCES signals(id) ON DELETE CASCADE,
  slack_channel_id TEXT,
  slack_channel_name TEXT,
  slack_user_id TEXT,
  slack_message_ts TEXT,
  slack_thread_ts TEXT,
  is_thread_reply BOOLEAN DEFAULT FALSE,
  is_edit BOOLEAN DEFAULT FALSE,
  is_delete BOOLEAN DEFAULT FALSE,
  permalink TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS customers (
  id UUID PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  segment TEXT,
  crm_id TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS slack_users (
  slack_user_id TEXT PRIMARY KEY,
  customer_id UUID REFERENCES customers(id),
  display_name TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS features (
  id UUID PRIMARY KEY,
  canonical_name TEXT UNIQUE NOT NULL,
  aliases JSONB,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS issues (
  id UUID PRIMARY KEY,
  title TEXT NOT NULL,
  category TEXT,
  severity INT,
  first_seen_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE (title, category)
);

CREATE TABLE IF NOT EXISTS themes (
  id UUID PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS signal_entities (
  signal_id UUID REFERENCES signals(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL,
  entity_id UUID NOT NULL,
  confidence FLOAT,
  created_at TIMESTAMP DEFAULT NOW(),
  PRIMARY KEY (signal_id, entity_type, entity_id)
);

CREATE TABLE IF NOT EXISTS customer_feature_usage (
  customer_id UUID REFERENCES customers(id) ON DELETE CASCADE,
  feature_id UUID REFERENCES features(id) ON DELETE CASCADE,
  usage_strength INT NOT NULL DEFAULT 0,
  last_mentioned_at TIMESTAMP,
  PRIMARY KEY (customer_id, feature_id)
);

CREATE TABLE IF NOT EXISTS customer_issue_reports (
  customer_id UUID REFERENCES customers(id) ON DELETE CASCADE,
  issue_id UUID REFERENCES issues(id) ON DELETE CASCADE,
  evidence_signal_id UUID REFERENCES signals(id) ON DELETE CASCADE,
  created_at TIMESTAMP DEFAULT NOW(),
  PRIMARY KEY (customer_id, issue_id, evidence_signal_id)
);

CREATE TABLE IF NOT EXISTS signal_extractions (
  signal_id UUID PRIMARY KEY REFERENCES signals(id) ON DELETE CASCADE,
  extraction JSONB NOT NULL,
  source TEXT NOT NULL DEFAULT 'llm',
  model TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Mark duplicate signals discovered via embedding similarity
ALTER TABLE IF EXISTS signals
  ADD COLUMN IF NOT EXISTS is_duplicate_of UUID REFERENCES signals(id);
