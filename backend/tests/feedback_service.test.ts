import { FeedbackService } from '../services/feedback_service';
import { EntityRegistryService } from '../services/entity_registry_service';
import { getDbPool } from '../db/connection';
import { runMigrations, resetDatabase, shutdownDatabase } from './test_db';

describe('FeedbackService', () => {
  const service = new FeedbackService();
  const registry = new EntityRegistryService();

  beforeAll(() => {
    runMigrations();
  });

  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await shutdownDatabase();
  });

  it('confirms merge and creates alias', async () => {
    const entity = await registry.createEntity({
      entityType: 'customer',
      canonicalName: 'Acme Corp'
    });

    const pool = getDbPool();
    const feedback = await pool.query(
      `INSERT INTO feedback_log
        (id, feedback_type, system_output, system_confidence, status, signals_affected, entities_affected)
       VALUES (gen_random_uuid(), 'entity_merge', $1, $2, 'pending', 1, 1)
       RETURNING id`,
      [
        JSON.stringify({
          entity_a: 'Acme',
          candidate_entity_id: entity.id,
          entity_type: 'customer'
        }),
        0.9
      ]
    );

    const feedbackId = feedback.rows[0].id;
    await service.confirmMerge(feedbackId, 'tester');

    const aliases = await pool.query(
      `SELECT alias FROM entity_aliases WHERE canonical_entity_id = $1`,
      [entity.id]
    );
    expect(aliases.rows.length).toBeGreaterThan(0);
  });
});
