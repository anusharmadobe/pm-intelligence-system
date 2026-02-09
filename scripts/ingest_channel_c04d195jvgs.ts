#!/usr/bin/env ts-node

/**
 * Script to ingest messages from Slack channel C04D195JVGS
 * Uses Slack MCP to fetch and ingest messages
 */

import * as dotenv from 'dotenv';
dotenv.config();

import { ingestSignal, RawSignal } from '../backend/processing/signal_extractor';
import { logger } from '../backend/utils/logger';
import { getSlackMCPFunctions } from '../backend/utils/slack_mcp_helper';

const CHANNEL_ID = 'C04D195JVGS';

async function ingestChannelMessages() {
  console.log('\n📥 Ingesting messages from Slack channel');
  console.log('==========================================');
  console.log(`   Channel ID: ${CHANNEL_ID}\n`);
  
  try {
    // Try to get Slack MCP functions
    const slackMCP = await getSlackMCPFunctions();
    
    console.log('✓ Slack MCP functions available\n');
    console.log('Fetching channel history...\n');
    
    // Get channel history
    const history = await slackMCP.getChannelHistory({
      channel_id: CHANNEL_ID,
      limit: 1000 // Get up to 1000 messages
    });
    
    if (!history || !history.messages) {
      console.error('❌ Could not retrieve messages from channel');
      console.error('   Check Slack MCP permissions and channel access\n');
      process.exit(1);
    }
    
    const messages = history.messages;
    console.log(`✓ Retrieved ${messages.length} messages\n`);
    console.log('Ingesting messages as signals...\n');
    
    let ingestedCount = 0;
    let skippedCount = 0;
    let errorCount = 0;
    
    for (const message of messages) {
      // Skip bot messages and system messages
      if (message.subtype || message.bot_id) {
        skippedCount++;
        continue;
      }
      
      // Skip empty messages
      if (!message.text || message.text.trim().length === 0) {
        skippedCount++;
        continue;
      }
      
      const signal: RawSignal = {
        source: 'slack',
        id: message.ts || message.event_ts || Date.now().toString(),
        type: 'message',
        text: message.text,
        metadata: {
          channel_id: CHANNEL_ID,
          user: message.user,
          timestamp: message.ts,
          thread_ts: message.thread_ts,
          client_msg_id: message.client_msg_id
        }
      };
      
      try {
        await ingestSignal(signal);
        ingestedCount++;
        process.stdout.write('.');
      } catch (error: any) {
        if (error.message.includes('duplicate') || error.message.includes('already exists')) {
          skippedCount++;
        } else {
          errorCount++;
          logger.warn('Failed to ingest message', {
            error: error.message,
            messageTs: message.ts
          });
        }
      }
    }
    
    console.log('\n');
    console.log('✅ Ingestion complete!');
    console.log(`   Ingested: ${ingestedCount} signals`);
    console.log(`   Skipped: ${skippedCount} (duplicates/bots/system messages)`);
    console.log(`   Errors: ${errorCount}`);
    console.log(`   Total: ${messages.length} messages\n`);
    
    logger.info('Channel ingestion complete', {
      channelId: CHANNEL_ID,
      ingestedCount,
      skippedCount,
      errorCount,
      totalMessages: messages.length
    });
    
    return { ingestedCount, skippedCount, errorCount, total: messages.length };
    
  } catch (error: any) {
    if (error.message.includes('MCP functions not available')) {
      console.error('❌ Slack MCP functions not available');
      console.error('   This script requires Cursor IDE with Slack MCP enabled.');
      console.error('   Please run this in Cursor IDE or use the API/webhook method.\n');
    } else {
      console.error('❌ Error:', error.message);
      logger.error('Channel ingestion failed', {
        error: error.message,
        stack: error.stack,
        channelId: CHANNEL_ID
      });
    }
    throw error;
  }
}

if (require.main === module) {
  ingestChannelMessages()
    .then(result => {
      if (result.errorCount === 0) {
        console.log('✅ All messages processed successfully!\n');
        process.exit(0);
      } else {
        console.log(`⚠️  Completed with ${result.errorCount} errors\n`);
        process.exit(1);
      }
    })
    .catch(error => {
      console.error('\n❌ Fatal error:', error.message);
      logger.error('Fatal error in ingestion script', { error: error.message, stack: error.stack });
      process.exit(1);
    });
}

export { ingestChannelMessages };
