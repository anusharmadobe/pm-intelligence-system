#!/usr/bin/env ts-node

/**
 * Standalone script to ingest messages from Slack channel C04D195JVGS
 * Doesn't require vscode module - tries to access MCP directly
 */

import * as dotenv from 'dotenv';
dotenv.config();

import { ingestSignal, RawSignal } from '../backend/processing/signal_extractor';
import { logger } from '../backend/utils/logger';

const CHANNEL_ID = 'C04D195JVGS';

/**
 * Try to get Slack MCP functions directly (without vscode dependency)
 */
async function getSlackMCPFunctions(): Promise<{
  getChannelHistory: (params: { channel_id: string; limit?: number }) => Promise<any>;
} | null> {
  // Method 1: Global MCP functions (available in Cursor IDE)
  if (typeof (global as any).mcp_Slack_slack_get_channel_history === 'function') {
    logger.info('Found MCP via global functions');
    return {
      getChannelHistory: (global as any).mcp_Slack_slack_get_channel_history
    };
  }
  
  // Method 2: Global mcp object
  if ((global as any).mcp?.Slack?.slack_get_channel_history) {
    logger.info('Found MCP via global.mcp');
    return {
      getChannelHistory: (global as any).mcp.Slack.slack_get_channel_history
    };
  }
  
  // Method 3: Try to require vscode dynamically (only if available)
  try {
    const vscode = require('vscode');
    if ((vscode as any).mcp?.Slack?.slack_get_channel_history) {
      logger.info('Found MCP via vscode.mcp');
      return {
        getChannelHistory: (vscode as any).mcp.Slack.slack_get_channel_history
      };
    }
  } catch (e) {
    // vscode not available, continue
  }
  
  return null;
}

async function ingestChannelMessages() {
  console.log('\n📥 Ingesting messages from Slack channel');
  console.log('==========================================');
  console.log(`   Channel ID: ${CHANNEL_ID}\n`);
  
  try {
    // Try to get Slack MCP functions
    const slackMCP = await getSlackMCPFunctions();
    
    if (!slackMCP) {
      console.error('❌ Slack MCP functions not available');
      console.error('\nThis script requires Cursor IDE with Slack MCP enabled.');
      console.error('The MCP functions are only available when running in Cursor IDE context.\n');
      console.error('To ingest messages, you can:');
      console.error('  1. Run this script in Cursor IDE terminal (may have MCP access)');
      console.error('  2. Use the Cursor extension (if installed)');
      console.error('  3. Manually ingest via API if you have message data\n');
      process.exit(1);
    }
    
    console.log('✓ Slack MCP functions available\n');
    console.log('Fetching channel history (limit: 1000 messages)...\n');
    
    // Get channel history
    const history = await slackMCP.getChannelHistory({
      channel_id: CHANNEL_ID,
      limit: 1000 // Get up to 1000 messages
    });
    
    if (!history) {
      console.error('❌ Could not retrieve messages from channel');
      console.error('   Check Slack MCP permissions and channel access\n');
      process.exit(1);
    }
    
    const messages = history.messages || history || [];
    
    if (!Array.isArray(messages) || messages.length === 0) {
      console.log('⚠️  No messages found in channel or invalid response');
      console.log(`   Response: ${JSON.stringify(history).substring(0, 200)}...\n`);
      process.exit(1);
    }
    
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
        if (ingestedCount % 10 === 0) {
          process.stdout.write('.');
        }
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
    if (error.message.includes('MCP') || error.message.includes('Slack')) {
      console.error('❌ Slack MCP error:', error.message);
      console.error('\nThis script requires:');
      console.error('  1. Cursor IDE with Slack MCP enabled');
      console.error('  2. Slack MCP properly configured');
      console.error('  3. Access to channel C04D195JVGS\n');
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
