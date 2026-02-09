import * as dotenv from 'dotenv';
dotenv.config();

import { ingestSignal, RawSignal } from '../backend/processing/signal_extractor';
import { logger } from '../backend/utils/logger';

/**
 * Test script to ingest messages from Slack channel via MCP
 * This simulates what the Cursor extension would do
 */
async function testSlackMCPChannel() {
  const channelName = 'anusharm-test-channel';
  const limit = 50;

  logger.info('Testing Slack MCP integration', { channelName, limit });

  console.log('\n🔍 Testing Slack MCP Integration');
  console.log('==================================\n');
  console.log(`Target channel: #${channelName}`);
  console.log(`Message limit: ${limit}\n`);

  // Note: In a real Cursor extension, MCP functions would be available
  // This is a test script that shows what would happen
  
  console.log('⚠️  Note: This script requires Cursor IDE with Slack MCP enabled.');
  console.log('   Use the Cursor extension command instead:\n');
  console.log('   Command: PM Intelligence: Ingest Slack Channel (MCP)\n');
  console.log('   Then enter channel name: anusharm-test-channel\n');

  // For testing, we can create a mock signal
  console.log('Creating test signal for demonstration...\n');
  
  const testSignal: RawSignal = {
    source: 'slack',
    id: `test_${Date.now()}`,
    type: 'message',
    text: `Test message from #${channelName} - This is a test signal to verify Slack MCP integration`,
    metadata: {
      channel: channelName,
      channel_id: 'test_channel_id',
      user: 'test_user',
      timestamp: Date.now().toString()
    }
  };

  try {
    const signal = await ingestSignal(testSignal);
    console.log('✅ Test signal ingested successfully!');
    console.log(`   Signal ID: ${signal.id}`);
    console.log(`   Source: ${signal.source}`);
    console.log(`   Type: ${signal.signal_type}`);
    console.log(`   Content: ${signal.content.substring(0, 50)}...\n`);
    
    logger.info('Test signal ingested', { signalId: signal.id });
  } catch (error: any) {
    console.error('❌ Failed to ingest test signal:', error.message);
    logger.error('Test signal ingestion failed', { error: error.message });
    process.exit(1);
  }

  console.log('📋 Next Steps:');
  console.log('1. Open Cursor IDE');
  console.log('2. Run command: PM Intelligence: Ingest Slack Channel (MCP)');
  console.log('3. Enter channel name: anusharm-test-channel');
  console.log('4. Check ingested signals: PM Intelligence: View Signals\n');
}

testSlackMCPChannel().catch((error) => {
  console.error('Test failed:', error);
  logger.error('Slack MCP test failed', { error: error.message });
  process.exit(1);
});
