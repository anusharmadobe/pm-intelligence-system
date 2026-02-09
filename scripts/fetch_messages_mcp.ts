#!/usr/bin/env ts-node

/**
 * Fetch messages from Slack channel C04D195JVGS using MCP
 * This script attempts multiple methods to access Slack MCP functions
 */

import * as dotenv from 'dotenv';
dotenv.config();

const CHANNEL_ID = 'C04D195JVGS';

async function fetchMessagesViaMCP() {
  console.log('\n📥 Fetching Messages via Slack MCP');
  console.log('====================================');
  console.log(`Channel ID: ${CHANNEL_ID}\n`);
  
  let messages: any[] = [];
  let methodUsed = '';
  
  // Method 1: Global MCP functions (most common in Cursor IDE)
  if (typeof (global as any).mcp_Slack_slack_get_channel_history === 'function') {
    console.log('✅ Found MCP function: global.mcp_Slack_slack_get_channel_history\n');
    methodUsed = 'global.mcp_Slack_slack_get_channel_history';
    try {
      const result = await (global as any).mcp_Slack_slack_get_channel_history({
        channel_id: CHANNEL_ID,
        limit: 1000
      });
      messages = result.messages || result || [];
      console.log(`✅ Successfully fetched ${messages.length} messages using Method 1\n`);
    } catch (error: any) {
      console.error(`❌ Error with Method 1: ${error.message}\n`);
    }
  }
  
  // Method 2: Global mcp object
  if (messages.length === 0 && (global as any).mcp?.Slack?.slack_get_channel_history) {
    console.log('✅ Found MCP function: global.mcp.Slack.slack_get_channel_history\n');
    methodUsed = 'global.mcp.Slack.slack_get_channel_history';
    try {
      const result = await (global as any).mcp.Slack.slack_get_channel_history({
        channel_id: CHANNEL_ID,
        limit: 1000
      });
      messages = result.messages || result || [];
      console.log(`✅ Successfully fetched ${messages.length} messages using Method 2\n`);
    } catch (error: any) {
      console.error(`❌ Error with Method 2: ${error.message}\n`);
    }
  }
  
  // Method 3: Try vscode.mcp (if vscode module is available)
  if (messages.length === 0) {
    try {
      const vscode = require('vscode');
      if ((vscode as any).mcp?.Slack?.slack_get_channel_history) {
        console.log('✅ Found MCP function: vscode.mcp.Slack.slack_get_channel_history\n');
        methodUsed = 'vscode.mcp.Slack.slack_get_channel_history';
        const result = await (vscode as any).mcp.Slack.slack_get_channel_history({
          channel_id: CHANNEL_ID,
          limit: 1000
        });
        messages = result.messages || result || [];
        console.log(`✅ Successfully fetched ${messages.length} messages using Method 3\n`);
      }
    } catch (e) {
      // vscode not available, continue
    }
  }
  
  // Method 4: Try process.env or other injection points
  if (messages.length === 0) {
    // Check if MCP is available through environment
    const mcpEnv = process.env.CURSOR_MCP_SLACK || process.env.MCP_SLACK;
    if (mcpEnv) {
      console.log('⚠️  MCP environment variable found but direct access not available\n');
    }
  }
  
  if (messages.length === 0) {
    console.log('❌ Could not access Slack MCP functions\n');
    console.log('Troubleshooting:\n');
    console.log('1. Ensure you are running this in Cursor IDE terminal');
    console.log('2. Verify Slack MCP is enabled in Cursor Settings → MCP → Slack');
    console.log('3. Check that you have access to channel C04D195JVGS');
    console.log('4. Try reloading Cursor IDE\n');
    console.log('To check if MCP is available, run:');
    console.log('  node -e "console.log(typeof global.mcp_Slack_slack_get_channel_history)"\n');
    return null;
  }
  
  // Display results
  console.log('📊 Results');
  console.log('='.repeat(50));
  console.log(`Method used: ${methodUsed}`);
  console.log(`Total messages: ${messages.length}\n`);
  
  if (messages.length > 0) {
    console.log('Sample messages:\n');
    messages.slice(0, 5).forEach((msg: any, i: number) => {
      const text = (msg.text || '').substring(0, 100).replace(/\n/g, ' ');
      const date = msg.ts ? new Date(parseFloat(msg.ts) * 1000).toISOString() : 'unknown';
      const user = msg.user || 'unknown';
      console.log(`${i + 1}. [${date}] User: ${user}`);
      console.log(`   ${text}...\n`);
    });
    
    // Count message types
    const botMessages = messages.filter(m => m.bot_id || m.subtype).length;
    const userMessages = messages.length - botMessages;
    
    console.log('\nMessage Statistics:');
    console.log(`  Total: ${messages.length}`);
    console.log(`  User messages: ${userMessages}`);
    console.log(`  Bot/system messages: ${botMessages}\n`);
  }
  
  return messages;
}

if (require.main === module) {
  fetchMessagesViaMCP()
    .then(messages => {
      if (messages && messages.length > 0) {
        console.log(`✅ Successfully fetched ${messages.length} messages from channel ${CHANNEL_ID}\n`);
        process.exit(0);
      } else {
        console.log('❌ No messages fetched\n');
        process.exit(1);
      }
    })
    .catch(error => {
      console.error('\n❌ Fatal error:', error.message);
      console.error(error.stack);
      process.exit(1);
    });
}

export { fetchMessagesViaMCP };
