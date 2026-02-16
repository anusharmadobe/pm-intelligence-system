-- V2: Additional indexes for performance
CREATE INDEX IF NOT EXISTS idx_neo4j_backlog_status ON neo4j_sync_backlog(status);
CREATE INDEX IF NOT EXISTS idx_entity_type_name ON entity_registry(entity_type, canonical_name);
CREATE INDEX IF NOT EXISTS idx_alerts_status ON alerts(status);
CREATE INDEX IF NOT EXISTS idx_signals_source ON signals(source);
CREATE INDEX IF NOT EXISTS idx_signals_created ON signals(created_at);
