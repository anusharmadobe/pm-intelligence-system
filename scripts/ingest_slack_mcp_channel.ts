#!/usr/bin/env ts-node

/**
 * Script to ingest Slack channel messages via MCP into PM Intelligence system
 * Usage: ts-node scripts/ingest_slack_mcp_channel.ts [channel_id] [limit]
 */

import { ingestSignal, RawSignal } from '../backend/processing/signal_extractor';
import { logger } from '../backend/utils/logger';

// Note: This script assumes it's running in a context where Slack MCP is available
// In practice, this would be called from the Cursor extension context

async function ingestSlackChannelViaMCP(channelId: string, limit: number = 1000) {
  logger.info('Starting Slack channel ingestion via MCP', { channelId, limit });
  
  let ingestedCount = 0;
  let skippedCount = 0;
  
  try {
    // Get messages from Slack channel using MCP
    // Note: In actual implementation, this would use the MCP client
    // For now, we'll simulate by calling the MCP function directly
    
    const messages = await getSlackChannelMessages(channelId, limit);
    
    logger.info(`Retrieved ${messages.length} messages from channel ${channelId}`);
    
    // Process each message
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
          id: message.ts || message.event_ts,
          type: 'message',
          text: message.text,
          metadata: {
            channel_id: channelId,
            channel_name: 'anusharm-test-channel',
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
      }
    }
    
    logger.info('Slack channel ingestion completed', { 
      channelId,
      ingestedCount,
      skippedCount,
      totalMessages: messages.length
    });
    
    return { ingestedCount, skippedCount, totalMessages: messages.length };
  } catch (error: any) {
    logger.error('Slack channel ingestion failed', { 
      error: error.message,
      channelId 
    });
    throw error;
  }
}

/**
 * Helper function to get messages from Slack channel via MCP
 * This is a placeholder - in actual implementation, this would use the MCP client
 */
async function getSlackChannelMessages(channelId: string, limit: number): Promise<any[]> {
  // This function would normally call the MCP Slack API
  // For now, we'll throw an error indicating it needs to be called from Cursor context
  throw new Error(
    'This script must be run from Cursor extension context where Slack MCP is available. ' +
    'Use the Cursor extension command "PM Intelligence: Ingest Slack Channel (MCP)" instead.'
  );
}

// Main execution
if (require.main === module) {
  const channelId = process.argv[2] || 'C08T43UHK9D';
  const limit = parseInt(process.argv[3] || '1000', 10);
  
  ingestSlackChannelViaMCP(channelId, limit)
    .then(result => {
      console.log('\n✅ Ingestion Summary:');
      console.log(`   Channel ID: ${channelId}`);
      console.log(`   Messages ingested: ${result.ingestedCount}`);
      console.log(`   Messages skipped: ${result.skippedCount}`);
      console.log(`   Total messages: ${result.totalMessages}`);
      process.exit(0);
    })
    .catch(error => {
      console.error('\n❌ Ingestion failed:', error.message);
      process.exit(1);
    });
}

export { ingestSlackChannelViaMCP };
