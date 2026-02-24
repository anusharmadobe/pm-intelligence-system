-- V3_013: User Preferences for Quality & UX Features
-- Created: 2026-02-24

-- Saved Queries/Filters Table
CREATE TABLE IF NOT EXISTS saved_filters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id VARCHAR(255) NOT NULL,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  filter_type VARCHAR(50) NOT NULL, -- 'signal', 'opportunity', 'custom'
  filters JSONB NOT NULL,
  is_public BOOLEAN DEFAULT false,
  is_favorite BOOLEAN DEFAULT false,
  usage_count INTEGER DEFAULT 0,
  last_used_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, name, filter_type)
);

CREATE INDEX idx_saved_filters_user ON saved_filters(user_id);
CREATE INDEX idx_saved_filters_type ON saved_filters(filter_type);
CREATE INDEX idx_saved_filters_favorite ON saved_filters(user_id, is_favorite) WHERE is_favorite = true;

-- Notification Preferences Table
CREATE TABLE IF NOT EXISTS notification_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id VARCHAR(255) UNIQUE NOT NULL,
  email_enabled BOOLEAN DEFAULT true,
  in_app_enabled BOOLEAN DEFAULT true,
  notification_types JSONB DEFAULT '{}', -- {"new_opportunity": true, "budget_alert": true, ...}
  quiet_hours_start TIME,
  quiet_hours_end TIME,
  frequency VARCHAR(20) DEFAULT 'realtime', -- 'realtime', 'hourly', 'daily', 'weekly'
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_notification_prefs_user ON notification_preferences(user_id);

-- Custom Dashboards Table
CREATE TABLE IF NOT EXISTS custom_dashboards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id VARCHAR(255) NOT NULL,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  layout JSONB NOT NULL, -- Widget layout configuration
  widgets JSONB NOT NULL, -- Widget configurations
  is_default BOOLEAN DEFAULT false,
  is_public BOOLEAN DEFAULT false,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_custom_dashboards_user ON custom_dashboards(user_id);
CREATE INDEX idx_custom_dashboards_default ON custom_dashboards(user_id, is_default) WHERE is_default = true;

-- Report Schedules Table
CREATE TABLE IF NOT EXISTS report_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id VARCHAR(255) NOT NULL,
  name VARCHAR(255) NOT NULL,
  report_type VARCHAR(50) NOT NULL, -- 'signals', 'opportunities', 'performance', 'custom'
  schedule_type VARCHAR(20) NOT NULL, -- 'daily', 'weekly', 'monthly'
  schedule_config JSONB NOT NULL, -- Day of week, time, etc.
  filters JSONB, -- Report filters
  format VARCHAR(10) NOT NULL DEFAULT 'pdf', -- 'pdf', 'csv', 'xlsx', 'json'
  recipients JSON NOT NULL, -- Array of email addresses
  enabled BOOLEAN DEFAULT true,
  last_run_at TIMESTAMP,
  next_run_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_report_schedules_user ON report_schedules(user_id);
CREATE INDEX idx_report_schedules_next_run ON report_schedules(next_run_at) WHERE enabled = true;
CREATE INDEX idx_report_schedules_enabled ON report_schedules(enabled) WHERE enabled = true;

-- Report Runs History Table
CREATE TABLE IF NOT EXISTS report_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id UUID NOT NULL REFERENCES report_schedules(id) ON DELETE CASCADE,
  status VARCHAR(20) NOT NULL, -- 'success', 'failed', 'running'
  started_at TIMESTAMP NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMP,
  duration_ms INTEGER,
  row_count INTEGER,
  file_size_bytes BIGINT,
  file_path TEXT,
  error_message TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_report_runs_schedule ON report_runs(schedule_id);
CREATE INDEX idx_report_runs_status ON report_runs(status);
CREATE INDEX idx_report_runs_created ON report_runs(created_at DESC);

-- User Activity Log (for audit trail)
CREATE TABLE IF NOT EXISTS user_activity_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id VARCHAR(255) NOT NULL,
  action VARCHAR(100) NOT NULL, -- 'login', 'create', 'update', 'delete', 'export', etc.
  resource_type VARCHAR(50), -- 'signal', 'opportunity', 'filter', etc.
  resource_id VARCHAR(255),
  details JSONB,
  ip_address VARCHAR(45),
  user_agent TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_user_activity_user ON user_activity_log(user_id);
CREATE INDEX idx_user_activity_action ON user_activity_log(action);
CREATE INDEX idx_user_activity_resource ON user_activity_log(resource_type, resource_id);
CREATE INDEX idx_user_activity_created ON user_activity_log(created_at DESC);

-- Partition user activity log by month for performance
-- CREATE TABLE user_activity_log_y2026m02 PARTITION OF user_activity_log
--   FOR VALUES FROM ('2026-02-01') TO ('2026-03-01');

-- User Preferences Table (general settings)
CREATE TABLE IF NOT EXISTS user_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id VARCHAR(255) UNIQUE NOT NULL,
  theme VARCHAR(20) DEFAULT 'system', -- 'light', 'dark', 'system'
  language VARCHAR(10) DEFAULT 'en',
  timezone VARCHAR(50) DEFAULT 'UTC',
  date_format VARCHAR(20) DEFAULT 'YYYY-MM-DD',
  time_format VARCHAR(20) DEFAULT 'HH:mm:ss',
  items_per_page INTEGER DEFAULT 50,
  sidebar_collapsed BOOLEAN DEFAULT false,
  compact_mode BOOLEAN DEFAULT false,
  reduce_animations BOOLEAN DEFAULT false,
  preferences JSONB DEFAULT '{}', -- Additional custom preferences
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_user_preferences_user ON user_preferences(user_id);

-- Feedback/Support Tickets Table
CREATE TABLE IF NOT EXISTS feedback_tickets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id VARCHAR(255) NOT NULL,
  type VARCHAR(20) NOT NULL, -- 'bug', 'feature', 'question', 'feedback'
  priority VARCHAR(20) DEFAULT 'medium', -- 'low', 'medium', 'high', 'urgent'
  status VARCHAR(20) DEFAULT 'open', -- 'open', 'in_progress', 'resolved', 'closed'
  title VARCHAR(255) NOT NULL,
  description TEXT NOT NULL,
  category VARCHAR(50),
  metadata JSONB, -- Browser info, screenshots, etc.
  assigned_to VARCHAR(255),
  resolved_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_feedback_user ON feedback_tickets(user_id);
CREATE INDEX idx_feedback_status ON feedback_tickets(status);
CREATE INDEX idx_feedback_type ON feedback_tickets(type);
CREATE INDEX idx_feedback_created ON feedback_tickets(created_at DESC);

-- Add comments for documentation
COMMENT ON TABLE saved_filters IS 'Saved search filters and queries for reuse';
COMMENT ON TABLE notification_preferences IS 'User notification settings and preferences';
COMMENT ON TABLE custom_dashboards IS 'User-created custom dashboard layouts';
COMMENT ON TABLE report_schedules IS 'Scheduled report generation configurations';
COMMENT ON TABLE report_runs IS 'History of scheduled report executions';
COMMENT ON TABLE user_activity_log IS 'Audit trail of user actions';
COMMENT ON TABLE user_preferences IS 'General user preferences and settings';
COMMENT ON TABLE feedback_tickets IS 'User feedback and support tickets';
