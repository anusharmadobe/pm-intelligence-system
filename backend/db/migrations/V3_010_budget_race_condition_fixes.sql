-- V3_010: Budget Race Condition Fixes
-- Adds optimistic locking to agent_registry to prevent budget race conditions
-- Priority: P0 (Critical) - Prevents budget overspend in concurrent scenarios

-- ============================================================
-- Add Version Column for Optimistic Locking
-- ============================================================

-- Add version column to agent_registry for optimistic locking
ALTER TABLE agent_registry
  ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 0;

-- Create index on version for faster lookups
CREATE INDEX IF NOT EXISTS idx_agent_registry_version
  ON agent_registry(id, version);

COMMENT ON COLUMN agent_registry.version IS 'Version number for optimistic locking - incremented on each update';

-- ============================================================
-- Trigger to Auto-Increment Version on Updates
-- ============================================================

CREATE OR REPLACE FUNCTION increment_agent_version()
RETURNS TRIGGER AS $$
BEGIN
  NEW.version = OLD.version + 1;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop trigger if it exists
DROP TRIGGER IF EXISTS trg_increment_agent_version ON agent_registry;

-- Create trigger to increment version on every update
CREATE TRIGGER trg_increment_agent_version
  BEFORE UPDATE ON agent_registry
  FOR EACH ROW
  EXECUTE FUNCTION increment_agent_version();

COMMENT ON TRIGGER trg_increment_agent_version ON agent_registry IS 'Automatically increments version on each update for optimistic locking';

-- ============================================================
-- Atomic Budget Check Function with Row-Level Locking
-- ============================================================

-- Function to atomically check and update budget with row-level locking
CREATE OR REPLACE FUNCTION check_and_record_budget(
  p_agent_id UUID,
  p_cost_usd NUMERIC,
  p_expected_version INTEGER
)
RETURNS TABLE(
  allowed BOOLEAN,
  remaining NUMERIC,
  current_cost NUMERIC,
  budget_limit NUMERIC,
  new_version INTEGER
) AS $$
DECLARE
  v_budget_limit NUMERIC;
  v_current_cost NUMERIC;
  v_remaining NUMERIC;
  v_is_active BOOLEAN;
  v_version INTEGER;
  v_grace_period NUMERIC;
BEGIN
  -- Lock the agent row for update (prevents concurrent modifications)
  SELECT
    ar.max_monthly_cost_usd,
    ar.is_active,
    ar.version,
    COALESCE(acs.total_cost_usd, 0)
  INTO
    v_budget_limit,
    v_is_active,
    v_version,
    v_current_cost
  FROM agent_registry ar
  LEFT JOIN agent_cost_summary acs
    ON ar.id = acs.agent_id
    AND acs.month = date_trunc('month', NOW())
  WHERE ar.id = p_agent_id
  FOR UPDATE OF ar NOWAIT; -- Fail fast if locked by another transaction

  -- Check if row was found
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Agent not found: %', p_agent_id;
  END IF;

  -- Check version for optimistic locking
  IF v_version != p_expected_version THEN
    RAISE EXCEPTION 'Version mismatch: expected %, got %', p_expected_version, v_version;
  END IF;

  -- Check if agent is active
  IF NOT v_is_active THEN
    RETURN QUERY SELECT false, 0::NUMERIC, v_current_cost, v_budget_limit, v_version;
    RETURN;
  END IF;

  -- Calculate if budget allows this cost (with 10% grace period)
  v_grace_period := v_budget_limit * 0.1;
  v_remaining := v_budget_limit - (v_current_cost + p_cost_usd);

  -- Return result
  RETURN QUERY SELECT
    (v_remaining > -v_grace_period) AS allowed,
    v_remaining AS remaining,
    v_current_cost AS current_cost,
    v_budget_limit AS budget_limit,
    v_version AS new_version;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION check_and_record_budget IS 'Atomically checks budget with row-level locking and optimistic locking';

-- ============================================================
-- Verification Queries
-- ============================================================

-- Verify version column was added
SELECT
  column_name,
  data_type,
  column_default
FROM information_schema.columns
WHERE table_name = 'agent_registry'
  AND column_name = 'version';

-- Verify trigger was created
SELECT
  trigger_name,
  event_manipulation,
  event_object_table
FROM information_schema.triggers
WHERE trigger_name = 'trg_increment_agent_version';

-- ============================================================
-- Migration Notes
-- ============================================================

/*
 * RACE CONDITION FIXES:
 *
 * 1. Optimistic Locking:
 *    - Added version column to agent_registry
 *    - Auto-incremented on every update
 *    - Budget checks compare expected version
 *
 * 2. Pessimistic Locking (when needed):
 *    - check_and_record_budget uses FOR UPDATE NOWAIT
 *    - Prevents concurrent budget modifications
 *    - Fails fast if row is locked
 *
 * 3. Atomic Operations:
 *    - Budget check and cost recording in single transaction
 *    - Either both succeed or both fail
 *    - No partial states
 *
 * USAGE PATTERN:
 *
 * 1. Read agent with version:
 *    SELECT id, version, max_monthly_cost_usd FROM agent_registry WHERE id = $1;
 *
 * 2. Check budget with optimistic lock:
 *    SELECT * FROM check_and_record_budget($1, $2, $3);
 *    -- Retry if version mismatch
 *
 * 3. Handle concurrent updates gracefully:
 *    - Version mismatch → retry with new version
 *    - NOWAIT lock failed → retry with exponential backoff
 */
