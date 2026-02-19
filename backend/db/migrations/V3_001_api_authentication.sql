-- V3_001: General API Authentication System
-- This adds authentication tables for general API access (not just agent-specific)

-- General-purpose API keys table
-- These are used for programmatic access to the API
CREATE TABLE IF NOT EXISTS api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(200) NOT NULL,
  key_hash VARCHAR(256) NOT NULL UNIQUE,
  key_prefix VARCHAR(20) NOT NULL, -- First chars of key for identification (e.g., "pk_abc...")
  scopes TEXT[] NOT NULL DEFAULT '{}', -- e.g., ['read:signals', 'write:signals', 'admin']
  created_by VARCHAR(100),
  expires_at TIMESTAMPTZ, -- NULL means no expiration
  last_used_at TIMESTAMPTZ,
  is_active BOOLEAN DEFAULT true,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_api_keys_key_hash ON api_keys(key_hash) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_api_keys_prefix ON api_keys(key_prefix) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_api_keys_expires ON api_keys(expires_at) WHERE is_active = true AND expires_at IS NOT NULL;

-- User session table for JWT-based authentication
-- This allows for temporary session tokens
CREATE TABLE IF NOT EXISTS user_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id VARCHAR(100) NOT NULL,
  token_hash VARCHAR(256) NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  is_active BOOLEAN DEFAULT true,
  user_agent VARCHAR(500),
  ip_address INET,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  last_accessed_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_user_sessions_token_hash ON user_sessions(token_hash) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id ON user_sessions(user_id) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_user_sessions_expires ON user_sessions(expires_at) WHERE is_active = true;

-- API key usage tracking
CREATE TABLE IF NOT EXISTS api_key_usage_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  api_key_id UUID NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
  endpoint VARCHAR(200) NOT NULL,
  method VARCHAR(10) NOT NULL,
  status_code INTEGER,
  response_time_ms INTEGER,
  error_message TEXT,
  ip_address INET,
  user_agent VARCHAR(500),
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_api_key_usage_key ON api_key_usage_log(api_key_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_api_key_usage_created ON api_key_usage_log(created_at DESC);

-- View for API key statistics
CREATE OR REPLACE VIEW api_key_stats AS
SELECT
  k.id,
  k.name,
  k.key_prefix,
  k.scopes,
  k.created_by,
  k.created_at,
  k.last_used_at,
  k.expires_at,
  k.is_active,
  COUNT(l.id) FILTER (WHERE l.created_at > NOW() - INTERVAL '24 hours') AS requests_24h,
  COUNT(l.id) FILTER (WHERE l.created_at > NOW() - INTERVAL '7 days') AS requests_7d,
  COUNT(l.id) FILTER (WHERE l.status_code >= 400 AND l.created_at > NOW() - INTERVAL '24 hours') AS errors_24h,
  AVG(l.response_time_ms) FILTER (WHERE l.created_at > NOW() - INTERVAL '24 hours') AS avg_response_ms_24h
FROM api_keys k
LEFT JOIN api_key_usage_log l ON k.id = l.api_key_id
GROUP BY k.id, k.name, k.key_prefix, k.scopes, k.created_by, k.created_at, k.last_used_at, k.expires_at, k.is_active;

-- Function to automatically expire old sessions
CREATE OR REPLACE FUNCTION expire_old_sessions()
RETURNS INTEGER AS $$
DECLARE
  expired_count INTEGER;
BEGIN
  UPDATE user_sessions
  SET is_active = false
  WHERE is_active = true AND expires_at < NOW();

  GET DIAGNOSTICS expired_count = ROW_COUNT;
  RETURN expired_count;
END;
$$ LANGUAGE plpgsql;

-- Cleanup function for old usage logs (keep last 90 days)
CREATE OR REPLACE FUNCTION cleanup_old_usage_logs()
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM api_key_usage_log
  WHERE created_at < NOW() - INTERVAL '90 days';

  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

COMMENT ON TABLE api_keys IS 'General-purpose API keys for programmatic access to the system';
COMMENT ON TABLE user_sessions IS 'JWT-based user sessions for temporary authentication';
COMMENT ON TABLE api_key_usage_log IS 'Audit log of API key usage for security and monitoring';
COMMENT ON VIEW api_key_stats IS 'Aggregated statistics for each API key';
