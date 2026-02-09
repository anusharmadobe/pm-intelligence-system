import * as dotenv from 'dotenv';
dotenv.config();

import * as vscode from 'vscode';
import { ingestSignal, RawSignal } from '../backend/processing/signal_extractor';
import { logger } from '../backend/utils/logger';

/**
 * Test script to ingest messages from anusharm-test-channel
 * This can be run from Cursor extension or as a standalone test
 */
async function testAnusharmTestChannel() {
  const channelName = 'anusharm-test-channel';
  
  console.log('\n🧪 Testing Slack MCP - anusharm-test-channel');
  console.log('=============================================\n');

  logger.info('Starting Slack MCP test', { channelName });

  // This would normally use MCP functions, but for testing we'll simulate
  // In actual Cursor extension, MCP functions are available
  
  console.log('To test Slack MCP integration:');
  console.log('1. Open Cursor IDE');
  console.log('2. Run command: PM Intelligence: Ingest Slack Channel (MCP)');
  console.log(`3. Enter channel name: ${channelName}`);
  console.log('4. Enter limit: 50\n');

  // Create a test signal to verify the system works
  console.log('Creating test signal to verify system...\n');
  
  const testSignal: RawSignal = {
    source: 'slack',
    id: `test_${Date.now()}`,
    type: 'message',
    text: `Test message from #${channelName} - Testing Slack MCP integration. This signal was created to verify the ingestion pipeline works correctly.`,
    metadata: {
      channel: channelName,
      channel_id: 'test_channel_id',
      user: 'test_user',
      timestamp: Date.now().toString(),
      test: true
    }
  };

  try {
    const signal = await ingestSignal(testSignal);
    console.log('✅ Test signal ingested successfully!');
    console.log(`   Signal ID: ${signal.id}`);
    console.log(`   Source: ${signal.source}`);
    console.log(`   Channel: ${channelName}`);
    console.log(`   Content: ${signal.content.substring(0, 80)}...\n`);
    
    logger.info('Test signal ingested', { 
      signalId: signal.id,
      channelName 
    });

    console.log('📋 Next Steps:');
    console.log('1. Use Cursor extension command to ingest real Slack messages');
    console.log('2. Command: PM Intelligence: Ingest Slack Channel (MCP)');
    console.log(`3. Channel: ${channelName}`);
    console.log('4. Then view signals: PM Intelligence: View Signals\n');
    
  } catch (error: any) {
    console.error('❌ Failed to ingest test signal:', error.message);
    logger.error('Test signal ingestion failed', { 
      error: error.message,
      stack: error.stack 
    });
    process.exit(1);
  }
}

// Run if executed directly
if (require.main === module) {
  testAnusharmTestChannel().catch((error) => {
    console.error('Test failed:', error);
    logger.error('Slack MCP test failed', { error: error.message });
    process.exit(1);
  });
}

export { testAnusharmTestChannel };
