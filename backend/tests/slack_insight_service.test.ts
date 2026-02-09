import { ingestSignal, RawSignal } from '../processing/signal_extractor';
import { getStrategicInsights } from '../services/slack_insight_service';
import { runMigrations, resetDatabase, shutdownDatabase } from './test_db';

describe('Slack strategic insights', () => {
  beforeAll(() => {
    runMigrations();
  });

  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await shutdownDatabase();
  });

  it('aggregates feature/category themes with scores', async () => {
    const baseMetadata = {
      channel: 'customer-feedback',
      channel_id: 'C555',
      user: 'U111'
    };

    const signal1: RawSignal = {
      source: 'slack',
      id: '1700000100.000500',
      type: 'message',
      text: 'Customer: Adobe says Forms Experience Builder is blocked.',
      metadata: { ...baseMetadata, timestamp: '1700000100.000500', customer_name: 'Adobe' }
    };

    const signal2: RawSignal = {
      source: 'slack',
      id: '1700000200.000600',
      type: 'message',
      text: 'Customer: NFCU reports Forms Experience Builder error and blocked.',
      metadata: { ...baseMetadata, timestamp: '1700000200.000600', customer_name: 'NFCU' }
    };

    await ingestSignal(signal1);
    await ingestSignal(signal2);

    const insights = await getStrategicInsights({ limit: 5, lookbackDays: 365 });
    expect(insights.length).toBeGreaterThan(0);

    const top = insights[0];
    expect(top.feature).toBe('Forms Experience Builder');
    expect(top.primary_theme).toBeTruthy();
    expect(top.category).toBe('blocker');
    expect(top.report_count).toBeGreaterThanOrEqual(2);
    expect(top.customer_count).toBeGreaterThanOrEqual(2);
    expect(top.score).toBeGreaterThan(0);
    expect(top.top_customers.length).toBeGreaterThan(0);
    expect(top.summary_keywords.length).toBeGreaterThan(0);
  });
});
