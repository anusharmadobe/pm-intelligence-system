ALTER TABLE jira_issue_templates
  ADD COLUMN IF NOT EXISTS area TEXT,
  ADD COLUMN IF NOT EXISTS content_fingerprint TEXT,
  ADD COLUMN IF NOT EXISTS evidence_count INTEGER DEFAULT 1,
  ADD COLUMN IF NOT EXISTS unique_customers INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW();

CREATE UNIQUE INDEX IF NOT EXISTS idx_jira_templates_fingerprint
  ON jira_issue_templates(content_fingerprint)
  WHERE content_fingerprint IS NOT NULL;
