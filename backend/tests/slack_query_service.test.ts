import { ingestSignal, RawSignal } from '../processing/signal_extractor';
import { getFeatureUsageByCustomer, getFeatureBottlenecks } from '../services/slack_query_service';
import { runMigrations, resetDatabase, shutdownDatabase } from './test_db';

describe('Slack query service', () => {
  beforeAll(() => {
    runMigrations();
  });

  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await shutdownDatabase();
  });

  it('returns customers ordered by feature usage strength', async () => {
    const baseMetadata = {
      channel: 'customer-feedback',
      channel_id: 'C555',
      user: 'U222'
    };

    const signal1: RawSignal = {
      source: 'slack',
      id: '1700000000.000300',
      type: 'message',
      text: 'Customer: Adobe uses Forms Experience Builder daily.',
      metadata: { ...baseMetadata, timestamp: '1700000000.000300' }
    };

    const signal2: RawSignal = {
      source: 'slack',
      id: '1700000000.000301',
      type: 'message',
      text: 'Customer: Adobe relies on Forms Experience Builder.',
      metadata: { ...baseMetadata, timestamp: '1700000000.000301' }
    };

    const signal3: RawSignal = {
      source: 'slack',
      id: '1700000000.000302',
      type: 'message',
      text: 'Customer: NFCU uses Forms Experience Builder occasionally.',
      metadata: { ...baseMetadata, timestamp: '1700000000.000302' }
    };

    await ingestSignal(signal1);
    await ingestSignal(signal2);
    await ingestSignal(signal3);

    const results = await getFeatureUsageByCustomer('Forms Experience Builder');
    expect(results.length).toBe(2);
    expect(results[0].customer_name).toBe('Adobe');
    expect(results[0].usage_strength).toBeGreaterThan(results[1].usage_strength);
  });

  it('returns bottlenecks linked to a feature', async () => {
    const baseMetadata = {
      channel: 'customer-feedback',
      channel_id: 'C555',
      user: 'U333'
    };

    const signal: RawSignal = {
      source: 'slack',
      id: '1700000000.000400',
      type: 'message',
      text: 'Customer: NFCU says Forms Experience Builder is broken and blocked.',
      metadata: { ...baseMetadata, timestamp: '1700000000.000400' }
    };

    await ingestSignal(signal);

    const results = await getFeatureBottlenecks('Forms Experience Builder');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].category).toBe('blocker');
    expect(results[0].report_count).toBeGreaterThanOrEqual(1);
    expect(results[0].customers).toContain('NFCU');
  });
});
