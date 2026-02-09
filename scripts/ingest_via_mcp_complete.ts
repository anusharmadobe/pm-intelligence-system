#!/usr/bin/env ts-node

/**
 * Complete ingestion script for channel C04D195JVGS using MCP
 * Fetches messages and ingests them as signals
 */

import * as dotenv from 'dotenv';
dotenv.config();

import { ingestSignal, RawSignal } from '../backend/processing/signal_extractor';
import { logger } from '../backend/utils/logger';

const CHANNEL_ID = 'C04D195JVGS';

async function ingestViaMCP() {
  console.log('\n📥 Ingesting Messages from Channel C04D195JVGS via MCP');
  console.log('='.repeat(60) + '\n');
  
  // Try to get MCP function
  let getChannelHistory: ((params: { channel_id: string; limit?: number }) => Promise<any>) | null = null;
  
  // Method 1: Global function
  if (typeof (global as any).mcp_Slack_slack_get_channel_history === 'function') {
    getChannelHistory = (global as any).mcp_Slack_slack_get_channel_history;
    console.log('✅ Found MCP function: global.mcp_Slack_slack_get_channel_history\n');
  }
  // Method 2: Global mcp object
  else if ((global as any).mcp?.Slack?.slack_get_channel_history) {
    getChannelHistory = (global as any).mcp.Slack.slack_get_channel_history;
    console.log('✅ Found MCP function: global.mcp.Slack.slack_get_channel_history\n');
  }
  // Method 3: Try vscode (if available)
  else {
    try {
      const vscode = require('vscode');
      if ((vscode as any).mcp?.Slack?.slack_get_channel_history) {
        getChannelHistory = (vscode as any).mcp.Slack.slack_get_channel_history;
        console.log('✅ Found MCP function: vscode.mcp.Slack.slack_get_channel_history\n');
      }
    } catch (e) {
      // vscode not available
    }
  }
  
  if (!getChannelHistory) {
    console.log('❌ Slack MCP functions not available in this context\n');
    console.log('📋 To use MCP, please run this script in Cursor IDE terminal:\n');
    console.log('   1. Open Cursor IDE');
    console.log('   2. Open integrated terminal (View → Terminal)');
    console.log('   3. Run: npm run ingest-channel-c04d195jvgs\n');
    console.log('Or verify MCP is enabled:');
    console.log('   - Cursor Settings → MCP → Slack');
    console.log('   - Ensure Slack MCP is enabled and connected\n');
    return null;
  }
  
  try {
    console.log(`Fetching messages from channel ${CHANNEL_ID}...\n`);
    const history = await getChannelHistory({
      channel_id: CHANNEL_ID,
      limit: 1000
    });
    
    const messages = history.messages || history || [];
    
    if (!Array.isArray(messages) || messages.length === 0) {
      console.log('⚠️  No messages found in channel\n');
      return { ingested: 0, skipped: 0, total: 0 };
    }
    
    console.log(`✅ Retrieved ${messages.length} messages\n`);
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
    
    console.log('\n\n✅ Ingestion Complete!');
    console.log('='.repeat(60));
    console.log(`   Messages fetched: ${messages.length}`);
    console.log(`   Signals ingested: ${ingestedCount}`);
    console.log(`   Skipped: ${skippedCount} (duplicates/bots/system)`);
    console.log(`   Errors: ${errorCount}\n`);
    
    logger.info('Channel ingestion complete', {
      channelId: CHANNEL_ID,
      ingestedCount,
      skippedCount,
      errorCount,
      totalMessages: messages.length
    });
    
    return { ingested: ingestedCount, skipped: skippedCount, total: messages.length };
    
  } catch (error: any) {
    console.error(`\n❌ Error fetching messages: ${error.message}\n`);
    if (error.message.includes('channel_not_found')) {
      console.log('   Channel may not exist or you may not have access\n');
    } else if (error.message.includes('not_authed') || error.message.includes('invalid_auth')) {
      console.log('   Authentication issue - check Slack MCP configuration\n');
    }
    logger.error('MCP ingestion failed', {
      error: error.message,
      stack: error.stack,
      channelId: CHANNEL_ID
    });
    throw error;
  }
}

if (require.main === module) {
  ingestViaMCP()
    .then(result => {
      if (result && result.ingested > 0) {
        console.log('✅ Successfully ingested messages!\n');
        process.exit(0);
      } else if (result && result.total === 0) {
        console.log('⚠️  No messages to ingest\n');
        process.exit(0);
      } else {
        process.exit(1);
      }
    })
    .catch(error => {
      console.error('\n❌ Fatal error:', error.message);
      process.exit(1);
    });
}

export { ingestViaMCP };
