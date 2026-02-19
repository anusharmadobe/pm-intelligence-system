import { ingestSignal, RawSignal } from '../processing/signal_extractor';
import { getFeatureUsageByCustomer, getFeatureBottlenecks } from '../services/slack_query_service';
import { getStrategicInsights } from '../services/slack_insight_service';
import { runMigrations, resetDatabase, shutdownDatabase } from './test_db';

describe('End-to-end Slack insights', () => {
  beforeAll(async () => {
    await runMigrations();
  });

  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await shutdownDatabase();
  });

  it('produces usage, bottlenecks, and strategic insights from ingested signals', async () => {
    const baseMetadata = {
      channel: 'customer-feedback',
      channel_id: 'C555',
      user: 'U555'
    };

    const signals: RawSignal[] = [
      {
        source: 'slack',
        id: '1700000300.000700',
        type: 'message',
        text: 'Customer: Adobe uses Forms Experience Builder daily but is blocked today.',
        metadata: { ...baseMetadata, timestamp: '1700000300.000700', customer_name: 'Adobe' }
      },
      {
        source: 'slack',
        id: '1700000400.000800',
        type: 'message',
        text: 'Customer: NFCU reports Forms Experience Builder error and failure.',
        metadata: { ...baseMetadata, timestamp: '1700000400.000800', customer_name: 'NFCU' }
      },
      {
        source: 'slack',
        id: '1700000500.000900',
        type: 'message',
        text: 'Customer: Adobe relies on Data Binding and it is slow.',
        metadata: { ...baseMetadata, timestamp: '1700000500.000900', customer_name: 'Adobe' }
      }
    ];

    for (const signal of signals) {
      await ingestSignal(signal);
    }

    const usage = await getFeatureUsageByCustomer('Forms Experience Builder');
    expect(usage.length).toBeGreaterThan(0);

    const bottlenecks = await getFeatureBottlenecks('Forms Experience Builder');
    expect(bottlenecks.length).toBeGreaterThan(0);

    const insights = await getStrategicInsights({ limit: 10, lookbackDays: 365 });
    expect(insights.length).toBeGreaterThan(0);
  });
});
