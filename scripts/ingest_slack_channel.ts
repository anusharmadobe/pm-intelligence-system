import * as dotenv from 'dotenv';
dotenv.config();

import { ingestSignal, RawSignal } from '../backend/processing/signal_extractor';
import { logger } from '../backend/utils/logger';

/**
 * Script to ingest messages from anusharm-test-channel via Slack MCP
 * This can be run from command line or called from Cursor extension
 */
async function ingestSlackChannel(channelName: string = 'anusharm-test-channel', limit: number = 50) {
  console.log('\n📥 Ingesting Slack Channel via MCP');
  console.log('===================================\n');
  console.log(`Channel: #${channelName}`);
  console.log(`Limit: ${limit} messages\n`);

  logger.info('Starting Slack channel ingestion', { channelName, limit });

  // Note: In Cursor IDE, MCP functions are available via the extension context
  // This script shows what the extension command does
  
  console.log('⚠️  This script requires Cursor IDE with Slack MCP enabled.');
  console.log('   For best results, use the Cursor extension command:\n');
  console.log('   Command: PM Intelligence: Ingest Slack Channel (MCP)\n');
  console.log('   Then enter: anusharm-test-channel\n');

  // Try to access MCP functions (if available in this context)
  let channelsResponse: any = null;
  let history: any = null;

  // Method 1: Try global MCP functions
  try {
    if (typeof (global as any).mcp_Slack_slack_list_channels === 'function') {
      console.log('✓ Found MCP functions via global context\n');
      channelsResponse = await (global as any).mcp_Slack_slack_list_channels({
        limit: 200,
        exclude_archived: true
      });
    }
  } catch (e) {
    logger.debug('Global MCP access failed', { error: (e as Error).message });
  }

  // If we have channels, proceed
  if (channelsResponse && channelsResponse.channels) {
    const channels = channelsResponse.channels;
    console.log(`✓ Found ${channels.length} Slack channels\n`);

    const channel = channels.find((c: any) =>
      c.name === channelName.replace('#', '') ||
      c.id === channelName
    );

    if (!channel) {
      const available = channels.map((c: any) => c.name).slice(0, 10).join(', ');
      console.error(`❌ Channel '${channelName}' not found`);
      console.error(`   Available channels: ${available}\n`);
      process.exit(1);
    }

    console.log(`✓ Found channel: #${channel.name} (ID: ${channel.id})\n`);

    // Get channel history
    try {
      if (typeof (global as any).mcp_Slack_slack_get_channel_history === 'function') {
        console.log(`Fetching messages from #${channel.name}...\n`);
        history = await (global as any).mcp_Slack_slack_get_channel_history({
          channel_id: channel.id,
          limit: limit
        });
      }
    } catch (e) {
      logger.error('Failed to get channel history', { error: (e as Error).message });
      throw e;
    }

    if (history && history.messages) {
      const messages = history.messages;
      console.log(`✓ Retrieved ${messages.length} messages\n`);
      console.log('Ingesting messages as signals...\n');

      let ingestedCount = 0;
      let skippedCount = 0;

      for (const message of messages) {
        // Skip bot messages and system messages
        if (message.subtype || message.bot_id) {
          skippedCount++;
          continue;
        }

        const signal: RawSignal = {
          source: 'slack',
          id: message.ts || message.event_ts || Date.now().toString(),
          type: 'message',
          text: message.text || '',
          metadata: {
            channel: channel.name,
            channel_id: channel.id,
            user: message.user,
            timestamp: message.ts,
            thread_ts: message.thread_ts
          }
        };

        try {
          await ingestSignal(signal);
          ingestedCount++;
          process.stdout.write('.');
        } catch (error: any) {
          logger.warn('Failed to ingest message', {
            error: error.message,
            messageTs: message.ts
          });
        }
      }

      console.log('\n');
      console.log('✅ Ingestion complete!');
      console.log(`   Ingested: ${ingestedCount} signals`);
      console.log(`   Skipped: ${skippedCount} (bots/system messages)`);
      console.log(`   Total: ${messages.length} messages\n`);

      logger.info('Slack channel ingestion complete', {
        channelName: channel.name,
        ingestedCount,
        skippedCount,
        totalMessages: messages.length
      });

    } else {
      console.error('❌ Could not retrieve messages from channel');
      console.error('   Check Slack MCP permissions and channel access\n');
      process.exit(1);
    }

  } else {
    console.log('ℹ️  MCP functions not available in this context.');
    console.log('   This is expected when running outside Cursor IDE.\n');
    console.log('📋 To ingest from Slack:');
    console.log('   1. Open Cursor IDE');
    console.log('   2. Run: PM Intelligence: Ingest Slack Channel (MCP)');
    console.log(`   3. Enter: ${channelName}\n`);
    
    // Create a test signal to verify the system works
    console.log('Creating test signal to verify system...\n');
    
    const testSignal: RawSignal = {
      source: 'slack',
      id: `test_${Date.now()}`,
      type: 'message',
      text: `Test message from #${channelName} - This is a test signal. Use Cursor extension command to ingest real Slack messages.`,
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
      console.log(`   Signal ID: ${signal.id}\n`);
      logger.info('Test signal ingested', { signalId: signal.id });
    } catch (error: any) {
      console.error('❌ Failed to ingest test signal:', error.message);
      logger.error('Test signal ingestion failed', { error: error.message });
      process.exit(1);
    }
  }
}

// Run if executed directly
const channelName = process.argv[2] || 'anusharm-test-channel';
const limit = parseInt(process.argv[3] || '50') || 50;

ingestSlackChannel(channelName, limit).catch((error) => {
  console.error('\n❌ Ingestion failed:', error.message);
  logger.error('Slack channel ingestion failed', {
    error: error.message,
    stack: error.stack
  });
  process.exit(1);
});
