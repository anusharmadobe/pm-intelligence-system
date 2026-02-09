import { ingestSignal, RawSignal } from '../processing/signal_extractor';
import { detectAndStoreOpportunities } from '../services/opportunity_service';

/**
 * Creates sample signals for testing and development
 */
export async function createSampleSignals(): Promise<void> {
  const sampleSignals: RawSignal[] = [
    {
      source: 'slack',
      id: 'slack_001',
      type: 'message',
      text: 'Users reporting slow page load times on the dashboard',
      severity: 3,
      metadata: { channel: '#support', user: 'user1' }
    },
    {
      source: 'slack',
      id: 'slack_002',
      type: 'message',
      text: 'Dashboard performance issues - multiple users affected',
      severity: 4,
      metadata: { channel: '#support', user: 'user2' }
    },
    {
      source: 'grafana',
      id: 'grafana_001',
      type: 'alert_firing',
      text: 'High response time detected: dashboard endpoint averaging 3.2s',
      severity: 4,
      metadata: { alert_name: 'High Response Time', threshold: '2s' }
    },
    {
      source: 'teams',
      id: 'teams_001',
      type: 'message',
      text: 'Customer feedback: dashboard is too slow, considering alternatives',
      severity: 5,
      metadata: { channelId: 'channel_123' }
    },
    {
      source: 'splunk',
      id: 'splunk_001',
      type: 'search_result',
      text: 'Error rate spike: 500 errors increased 300% on dashboard endpoints',
      severity: 5,
      metadata: { search_name: 'Error Monitoring' }
    },
    {
      source: 'slack',
      id: 'slack_003',
      type: 'message',
      text: 'Feature request: add export functionality to reports',
      severity: 2,
      metadata: { channel: '#product', user: 'user3' }
    },
    {
      source: 'slack',
      id: 'slack_004',
      type: 'message',
      text: 'Users asking for CSV export option in reports section',
      severity: 2,
      metadata: { channel: '#product', user: 'user4' }
    },
    {
      source: 'teams',
      id: 'teams_002',
      type: 'message',
      text: 'Export feature needed - multiple customer requests',
      severity: 3,
      metadata: { channelId: 'channel_456' }
    }
  ];

  console.log('Creating sample signals...');
  for (const signal of sampleSignals) {
    try {
      await ingestSignal(signal);
      console.log(`✓ Ingested signal: ${signal.id}`);
    } catch (error: any) {
      console.error(`✗ Failed to ingest ${signal.id}:`, error.message);
    }
  }
  
  console.log('Sample signals created. Detecting opportunities...');
  const allSignals = await require('../processing/signal_extractor').getAllSignals();
  const opportunities = await detectAndStoreOpportunities(allSignals);
  console.log(`✓ Detected ${opportunities.length} opportunities`);
}

// Run if executed directly
if (require.main === module) {
  createSampleSignals()
    .then(() => {
      console.log('Sample data creation complete');
      process.exit(0);
    })
    .catch((error) => {
      console.error('Failed to create sample data:', error);
      process.exit(1);
    });
}
