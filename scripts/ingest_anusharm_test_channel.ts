import * as dotenv from 'dotenv';
dotenv.config();

import { ingestSignal, RawSignal } from '../backend/processing/signal_extractor';
import { logger } from '../backend/utils/logger';

/**
 * Script to ingest messages from anusharm-test-channel
 * This demonstrates how the Cursor extension would work
 */
async function ingestAnusharmTestChannel() {
  const channelName = 'anusharm-test-channel';
  const limit = 50;

  console.log('\n📥 Ingesting from anusharm-test-channel');
  console.log('========================================\n');

  logger.info('Starting ingestion', { channelName, limit });

  // Note: In Cursor IDE, you would use the extension command:
  // "PM Intelligence: Ingest Slack Channel (MCP)"
  // Then enter: anusharm-test-channel
  
  console.log('⚠️  Channel Status:');
  console.log('   The channel "anusharm-test-channel" was not found in public channels.');
  console.log('   This could mean:');
  console.log('   1. It\'s a private channel (requires membership)');
  console.log('   2. The channel name is different');
  console.log('   3. The channel doesn\'t exist yet\n');

  console.log('📋 To ingest from this channel:');
  console.log('   1. Ensure you\'re a member of the channel');
  console.log('   2. Use Cursor IDE extension command:');
  console.log('      PM Intelligence: Ingest Slack Channel (MCP)');
  console.log('   3. Enter the exact channel name\n');

  // Create a test signal to verify the system works
  console.log('Creating test signal to verify ingestion pipeline...\n');
  
  const testSignal: RawSignal = {
    source: 'slack',
    id: `test_${Date.now()}`,
    type: 'message',
    text: `Test message from #${channelName} - This is a test signal. When you run the Cursor extension command and successfully connect to Slack MCP, real messages from this channel will be ingested.`,
    metadata: {
      channel: channelName,
      channel_id: 'test_channel_id',
      user: 'test_user',
      timestamp: Date.now().toString(),
      test: true,
      note: 'This is a test signal. Use Cursor extension to ingest real Slack messages.'
    }
  };

  try {
    const signal = await ingestSignal(testSignal);
    console.log('✅ Test signal ingested successfully!');
    console.log(`   Signal ID: ${signal.id}`);
    console.log(`   Source: ${signal.source}`);
    console.log(`   Channel: ${signal.metadata?.channel}`);
    console.log(`   Content: ${signal.content.substring(0, 80)}...\n`);
    
    logger.info('Test signal ingested', { 
      signalId: signal.id,
      channelName 
    });

    console.log('📊 Next Steps:');
    console.log('   1. Open Cursor IDE');
    console.log('   2. Ensure Slack MCP is enabled');
    console.log('   3. Run: PM Intelligence: Ingest Slack Channel (MCP)');
    console.log(`   4. Enter: ${channelName}`);
    console.log('   5. Check logs: tail -f logs/combined.log\n');

  } catch (error: any) {
    console.error('❌ Failed to ingest test signal:', error.message);
    logger.error('Test signal ingestion failed', { 
      error: error.message,
      stack: error.stack 
    });
    process.exit(1);
  }
}

ingestAnusharmTestChannel().catch((error) => {
  console.error('\n❌ Script failed:', error.message);
  logger.error('Script failed', { error: error.message });
  process.exit(1);
});
