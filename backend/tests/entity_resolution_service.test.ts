import { EntityResolutionService } from '../services/entity_resolution_service';
import { getDbPool } from '../db/connection';
import { runMigrations, resetDatabase, shutdownDatabase } from './test_db';

describe('EntityResolutionService', () => {
  const service = new EntityResolutionService();

  beforeAll(async () => {
    await runMigrations();
  });

  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await shutdownDatabase();
  });

  it('creates a new entity when no match exists', async () => {
    const result = await service.resolveEntityMention({
      mention: 'Acme Corporation',
      entityType: 'customer',
      signalText: 'Acme Corporation is a newly onboarded customer.'
    });

    expect(result.status).toBe('new_entity');
    expect(result.entity_id).toBeDefined();

    const pool = getDbPool();
    const entity = await pool.query(`SELECT id FROM entity_registry WHERE id = $1`, [
      result.entity_id
    ]);
    expect(entity.rows.length).toBe(1);
  });
});
