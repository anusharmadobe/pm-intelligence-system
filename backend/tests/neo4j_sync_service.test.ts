import { getDbPool } from '../db/connection';
import { runMigrations, resetDatabase, shutdownDatabase } from './test_db';

describe('Neo4jSyncService', () => {
  beforeAll(() => {
    runMigrations();
  });

  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await shutdownDatabase();
  });

  it('enqueues sync when Neo4j sync is disabled', async () => {
    process.env.FF_NEO4J_SYNC = 'false';
    jest.resetModules();
    const { Neo4jSyncService } = await import('../services/neo4j_sync_service');

    const service = new Neo4jSyncService();
    await service.syncEntity({
      id: 'entity-1',
      entity_type: 'customer',
      canonical_name: 'Acme Corp'
    });

    const pool = getDbPool();
    const backlog = await pool.query(
      `SELECT id FROM neo4j_sync_backlog WHERE operation = 'signal_sync'`
    );
    expect(backlog.rows.length).toBeGreaterThan(0);
  });
});
