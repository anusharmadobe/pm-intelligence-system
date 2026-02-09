#!/usr/bin/env ts-node

/**
 * Script to ingest messages from channel C08T43UHK9D (anusharm-test-channel)
 * This script uses Slack MCP functions directly to fetch and ingest messages
 */

import * as dotenv from 'dotenv';
dotenv.config();

import { ingestSignal, RawSignal } from '../backend/processing/signal_extractor';
import { logger } from '../backend/utils/logger';

const CHANNEL_ID = 'C08T43UHK9D';
const CHANNEL_NAME = 'anusharm-test-channel';

/**
 * Ingests messages from the Slack channel using MCP functions
 * Note: This requires running in a context where MCP Slack functions are available
 */
async function ingestChannelMessages(limit: number = 1000) {
  logger.info('Starting Slack channel ingestion', { channelId: CHANNEL_ID, channelName: CHANNEL_NAME, limit });
  
  let ingestedCount = 0;
  let skippedCount = 0;
  let errorCount = 0;
  
  try {
    // Note: In a real implementation, this would call the MCP Slack API
    // For now, we'll create a function that can be called from the Cursor extension
    // or we can manually fetch messages and ingest them
    
    console.log('\n📥 Ingesting messages from Slack channel');
    console.log('==========================================');
    console.log(`   Channel ID: ${CHANNEL_ID}`);
    console.log(`   Channel Name: ${CHANNEL_NAME}`);
    console.log(`   Limit: ${limit}\n`);
    
    // This is a placeholder - actual implementation would fetch from Slack MCP
    // The messages would be fetched using: mcp_Slack_slack_get_channel_history
    console.log('⚠️  Note: This script needs to be run from Cursor extension context');
    console.log('   where Slack MCP functions are available.\n');
    
    console.log('📋 To ingest messages:');
    console.log('   1. Use the Cursor extension command:');
    console.log('      "PM Intelligence: Ingest Slack Channel (MCP)"');
    console.log(`   2. Enter channel ID: ${CHANNEL_ID}`);
    console.log('   3. Or use channel name: anusharm-test-channel\n');
    
    // For testing, let's create a test signal
    const testSignal: RawSignal = {
      source: 'slack',
      id: `slack_${CHANNEL_ID}_${Date.now()}`,
      type: 'message',
      text: `Test ingestion from channel ${CHANNEL_NAME} (${CHANNEL_ID}). This signal was created to test the ingestion pipeline.`,
      metadata: {
        channel_id: CHANNEL_ID,
        channel_name: CHANNEL_NAME,
        user: 'system',
        timestamp: Date.now().toString(),
        test: true
      }
    };
    
    try {
      const signal = await ingestSignal(testSignal);
      ingestedCount++;
      console.log('✅ Test signal ingested successfully!');
      console.log(`   Signal ID: ${signal.id}`);
      console.log(`   Source: ${signal.source}`);
      console.log(`   Type: ${signal.signal_type}\n`);
    } catch (error: any) {
      errorCount++;
      console.error('❌ Failed to ingest test signal:', error.message);
      logger.error('Test signal ingestion failed', { error: error.message });
    }
    
    logger.info('Ingestion summary', { 
      channelId: CHANNEL_ID,
      ingestedCount,
      skippedCount,
      errorCount
    });
    
    return { ingestedCount, skippedCount, errorCount };
  } catch (error: any) {
    logger.error('Channel ingestion failed', { 
      error: error.message,
      channelId: CHANNEL_ID 
    });
    throw error;
  }
}

/**
 * Helper function to ingest messages from Slack API response
 * This can be called with actual Slack message data
 */
export async function ingestSlackMessages(messages: any[], channelId: string, channelName: string) {
  let ingestedCount = 0;
  let skippedCount = 0;
  
  for (const message of messages) {
    try {
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
        id: message.ts || message.event_ts || `slack_${Date.now()}_${Math.random()}`,
        type: 'message',
        text: message.text,
        metadata: {
          channel_id: channelId,
          channel_name: channelName,
          user: message.user,
          timestamp: message.ts,
          thread_ts: message.thread_ts,
          team: message.team,
          client_msg_id: message.client_msg_id
        }
      };
      
      await ingestSignal(signal);
      ingestedCount++;
      
      logger.debug('Message ingested', { 
        messageId: message.ts, 
        userId: message.user,
        textPreview: message.text.substring(0, 50) + '...'
      });
    } catch (error: any) {
      logger.error('Failed to ingest message', { 
        error: error.message, 
        messageId: message.ts 
      });
      skippedCount++;
    }
  }
  
  return { ingestedCount, skippedCount };
}

// Main execution
if (require.main === module) {
  const limit = parseInt(process.argv[2] || '1000', 10);
  
  ingestChannelMessages(limit)
    .then(result => {
      console.log('\n📊 Ingestion Summary:');
      console.log(`   Messages ingested: ${result.ingestedCount}`);
      console.log(`   Messages skipped: ${result.skippedCount}`);
      console.log(`   Errors: ${result.errorCount}\n`);
      process.exit(0);
    })
    .catch(error => {
      console.error('\n❌ Ingestion failed:', error.message);
      process.exit(1);
    });
}

export { ingestChannelMessages };
