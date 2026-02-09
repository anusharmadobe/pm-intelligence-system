#!/usr/bin/env ts-node

/**
 * Check how many messages are available in channel C04D195JVGS
 * Attempts to use real Slack MCP to count messages
 */

import * as dotenv from 'dotenv';
dotenv.config();

const CHANNEL_ID = 'C04D195JVGS';

async function checkMessageCount() {
  console.log('\n📊 Checking Message Count for Channel C04D195JVGS');
  console.log('====================================================\n');
  
  // Try multiple ways to access MCP
  let messageCount: number | null = null;
  let maxLimit = 1000; // Try fetching up to 1000 messages
  
  // Method 1: Global MCP functions
  if (typeof (global as any).mcp_Slack_slack_get_channel_history === 'function') {
    console.log('✓ Found Slack MCP function\n');
    try {
      console.log(`Fetching messages (limit: ${maxLimit})...\n`);
      const history = await (global as any).mcp_Slack_slack_get_channel_history({
        channel_id: CHANNEL_ID,
        limit: maxLimit
      });
      
      const messages = history.messages || history || [];
      messageCount = Array.isArray(messages) ? messages.length : 0;
      
      console.log(`✅ Retrieved ${messageCount} messages from channel\n`);
      
      if (messageCount > 0) {
        console.log('Sample messages:\n');
        messages.slice(0, 5).forEach((msg: any, i: number) => {
          const text = (msg.text || '').substring(0, 100);
          const date = msg.ts ? new Date(parseFloat(msg.ts) * 1000).toISOString() : 'unknown';
          console.log(`  ${i + 1}. [${date}] ${text}...`);
        });
      }
      
      // Check if there might be more messages
      if (messageCount === maxLimit) {
        console.log(`\n⚠️  Hit limit of ${maxLimit} messages. There may be more messages available.\n`);
      }
      
    } catch (error: any) {
      console.log(`❌ Error: ${error.message}\n`);
    }
  } else {
    // Method 2: Try via mcp object
    if ((global as any).mcp?.Slack?.slack_get_channel_history) {
      console.log('✓ Found Slack MCP via mcp object\n');
      try {
        const history = await (global as any).mcp.Slack.slack_get_channel_history({
          channel_id: CHANNEL_ID,
          limit: maxLimit
        });
        const messages = history.messages || history || [];
        messageCount = Array.isArray(messages) ? messages.length : 0;
        console.log(`✅ Retrieved ${messageCount} messages\n`);
      } catch (error: any) {
        console.log(`❌ Error: ${error.message}\n`);
      }
    } else {
      console.log('⚠️  Slack MCP not available in this context\n');
      console.log('To check message count, you need:');
      console.log('  1. Run in Cursor IDE');
      console.log('  2. Have Slack MCP enabled');
      console.log('  3. Use Cursor extension command:\n');
      console.log('     "PM Intelligence: Ingest Slack Channel (MCP)"');
      console.log('     Then enter: C04D195JVGS\n');
      console.log('Or use the ingestion script which will show the count:\n');
      console.log('     npm run ingest-channel-c04d195jvgs\n');
    }
  }
  
  if (messageCount !== null) {
    console.log('\n📊 Summary');
    console.log('='.repeat(50));
    console.log(`Channel ID: ${CHANNEL_ID}`);
    console.log(`Messages available: ${messageCount}`);
    console.log(`Can ingest: ${messageCount} messages (excluding bots/system messages)\n`);
    
    // Estimate ingestible count (roughly 80-90% after filtering bots/system)
    const estimatedIngestible = Math.floor(messageCount * 0.85);
    console.log(`Estimated ingestible: ~${estimatedIngestible} signals\n`);
  }
  
  return messageCount;
}

if (require.main === module) {
  checkMessageCount()
    .then(count => {
      if (count !== null) {
        console.log(`\n✅ Check complete: ${count} messages found\n`);
      }
      process.exit(0);
    })
    .catch(error => {
      console.error('\n❌ Fatal error:', error.message);
      process.exit(1);
    });
}

export { checkMessageCount };
