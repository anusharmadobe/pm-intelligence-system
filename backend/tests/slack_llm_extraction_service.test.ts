import { ingestSignal, RawSignal } from '../processing/signal_extractor';
import { ingestSlackExtraction } from '../services/slack_llm_extraction_service';
import { getDbPool } from '../db/connection';
import { resetDatabase, runMigrations } from './test_db';

describe('Slack LLM extraction ingestion', () => {
  beforeAll(async () => {
    await runMigrations();
  });

  beforeEach(async () => {
    await resetDatabase();
  });

  it('stores extraction and updates structured tables', async () => {
    const raw: RawSignal = {
      source: 'slack',
      id: '1700000000.555500',
      type: 'message',
      text: 'Adobe is blocked on Forms Experience Builder and asks for a migration path.',
      metadata: {
        channel: 'customer-feedback',
        channel_id: 'C123',
        user: 'U123',
        timestamp: '1700000000.555500'
      }
    };

    const signal = await ingestSignal(raw);
    await ingestSlackExtraction(signal.id, {
      customers: [{ name: 'Adobe', confidence: 0.9 }],
      features: [{ name: 'Forms Experience Builder', confidence: 0.8 }],
      themes: [{ name: 'Migration', confidence: 0.7 }],
      issues: [{ title: 'Blocked on migration path', category: 'blocker', severity: 5, confidence: 0.8 }]
    });

    const pool = getDbPool();
    const extractions = await pool.query('SELECT * FROM signal_extractions');
    const themes = await pool.query('SELECT * FROM themes');
    const usage = await pool.query('SELECT * FROM customer_feature_usage');
    const reports = await pool.query('SELECT * FROM customer_issue_reports');

    expect(extractions.rows.length).toBe(1);
    const themeNames = themes.rows.map((row: { name: string }) => row.name);
    expect(themeNames).toContain('Migration');
    expect(usage.rows.length).toBe(1);
    expect(reports.rows.length).toBe(1);
  });
});
