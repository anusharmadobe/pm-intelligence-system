ALTER TABLE neo4j_sync_backlog
  ADD COLUMN IF NOT EXISTS error_message TEXT;
