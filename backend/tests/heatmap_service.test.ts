import { randomUUID } from 'crypto';
import { HeatmapService } from '../services/heatmap_service';
import { getDbPool } from '../db/connection';
import { runMigrations, resetDatabase, shutdownDatabase } from './test_db';

describe('HeatmapService', () => {
  const service = new HeatmapService();

  beforeAll(() => {
    runMigrations();
  });

  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await shutdownDatabase();
  });

  it('returns heatmap rows for issues by customer', async () => {
    const pool = getDbPool();
    const signalId = randomUUID();
    await pool.query(
      `INSERT INTO signals (id, source, source_ref, signal_type, content, normalized_content, metadata, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
      [signalId, 'manual', 'ref', 'message', 'Issue with checkout', 'Issue with checkout', '{}']
    );
    await pool.query(
      `INSERT INTO signal_extractions (signal_id, extraction, source, model, created_at)
       VALUES ($1, $2, $3, $4, NOW())`,
      [
        signalId,
        JSON.stringify({ entities: { issues: ['Checkout'], customers: ['Acme Corp'] } }),
        'llm',
        'mock'
      ]
    );

    const response = await service.getHeatmap({ dimension: 'issues_by_customer', limit: 10 });
    expect(response.rows.length).toBeGreaterThan(0);
  });
});
