import { getDbPool } from '../db/connection';
import { ingestSignal, RawSignal } from '../processing/signal_extractor';
import { runMigrations, resetDatabase, shutdownDatabase } from './test_db';

describe('Slack structuring pipeline', () => {
  beforeAll(() => {
    runMigrations();
  });

  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await shutdownDatabase();
  });

  it('stores structured entities for Slack signals', async () => {
    const rawSignal: RawSignal = {
      source: 'slack',
      id: '1700000000.000100',
      type: 'message',
      text: 'Customer: Adobe says Forms Experience Builder is blocked and broken today.',
      metadata: {
        channel: 'customer-feedback',
        channel_id: 'C123',
        user: 'U123',
        timestamp: '1700000000.000100'
      }
    };

    const signal = await ingestSignal(rawSignal);

    const pool = getDbPool();
    const customers = await pool.query('SELECT * FROM customers');
    const features = await pool.query('SELECT * FROM features');
    const issues = await pool.query('SELECT * FROM issues');
    const usage = await pool.query('SELECT * FROM customer_feature_usage');
    const reports = await pool.query('SELECT * FROM customer_issue_reports');
    const entities = await pool.query('SELECT * FROM signal_entities');
    const slackMessages = await pool.query('SELECT * FROM slack_messages');

    expect(customers.rows.length).toBe(1);
    expect(customers.rows[0].name).toBe('Adobe');

    expect(features.rows.length).toBe(1);
    expect(features.rows[0].canonical_name).toBe('Forms Experience Builder');

    expect(issues.rows.length).toBe(1);
    expect(issues.rows[0].category).toBe('blocker');

    expect(usage.rows.length).toBe(1);
    expect(reports.rows.length).toBe(1);

    const themeEntities = entities.rows.filter((row: { entity_type: string }) => row.entity_type === 'theme');
    expect(themeEntities.length).toBeGreaterThan(0);
    expect(slackMessages.rows.length).toBe(1);
    expect(slackMessages.rows[0].signal_id).toBe(signal.id);
  });

  it('inherits customer metadata for thread replies', async () => {
    const parentSignal: RawSignal = {
      source: 'slack',
      id: '1700000000.000200',
      type: 'message',
      text: 'Customer: NFCU asked about Data Binding issues.',
      metadata: {
        channel: 'customer-feedback',
        channel_id: 'C123',
        user: 'U999',
        timestamp: '1700000000.000200'
      }
    };

    const replySignal: RawSignal = {
      source: 'slack',
      id: '1700000000.000201',
      type: 'message',
      text: 'We are still blocked.',
      metadata: {
        channel: 'customer-feedback',
        channel_id: 'C123',
        user: 'U999',
        timestamp: '1700000000.000201',
        thread_ts: '1700000000.000200'
      }
    };

    await ingestSignal(parentSignal);
    await ingestSignal(replySignal);

    const pool = getDbPool();
    const result = await pool.query(
      'SELECT metadata FROM signals WHERE source_ref = $1 LIMIT 1',
      [replySignal.id]
    );

    const metadata = typeof result.rows[0].metadata === 'string'
      ? JSON.parse(result.rows[0].metadata)
      : result.rows[0].metadata;

    expect(Array.isArray(metadata.customers)).toBe(true);
    expect(metadata.customers).toContain('NFCU');
  });
});
