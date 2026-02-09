-- Slack-only supplemental indexes

CREATE INDEX IF NOT EXISTS idx_slack_messages_channel_id ON slack_messages(slack_channel_id);
CREATE INDEX IF NOT EXISTS idx_slack_messages_user_id ON slack_messages(slack_user_id);
CREATE INDEX IF NOT EXISTS idx_slack_messages_thread_ts ON slack_messages(slack_thread_ts);

CREATE INDEX IF NOT EXISTS idx_customers_name ON customers(name);
CREATE INDEX IF NOT EXISTS idx_features_name ON features(canonical_name);
CREATE INDEX IF NOT EXISTS idx_issues_category ON issues(category);
CREATE INDEX IF NOT EXISTS idx_themes_name ON themes(name);

CREATE INDEX IF NOT EXISTS idx_signal_entities_signal ON signal_entities(signal_id);
CREATE INDEX IF NOT EXISTS idx_signal_entities_type ON signal_entities(entity_type);
CREATE INDEX IF NOT EXISTS idx_signal_entities_entity ON signal_entities(entity_id);
CREATE INDEX IF NOT EXISTS idx_signal_entities_type_entity ON signal_entities(entity_type, entity_id);

CREATE INDEX IF NOT EXISTS idx_customer_feature_usage_strength ON customer_feature_usage(usage_strength DESC);
CREATE INDEX IF NOT EXISTS idx_customer_feature_usage_last ON customer_feature_usage(last_mentioned_at DESC);

CREATE INDEX IF NOT EXISTS idx_customer_issue_reports_issue ON customer_issue_reports(issue_id);
CREATE INDEX IF NOT EXISTS idx_customer_issue_reports_customer ON customer_issue_reports(customer_id);
CREATE INDEX IF NOT EXISTS idx_signal_extractions_source ON signal_extractions(source);
