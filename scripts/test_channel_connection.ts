#!/usr/bin/env ts-node

/**
 * Test connection to Slack channel C04D195JVGS
 * Attempts to fetch messages using Slack MCP configured in Cursor
 */

import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
dotenv.config();

const CHANNEL_ID = 'C04D195JVGS';
const OUTPUT_FILE = path.join(__dirname, '..', 'data', `messages_${CHANNEL_ID}.json`);

async function testChannelConnection() {
  console.log('\n🔌 Testing Connection to Slack Channel');
  console.log('='.repeat(60));
  console.log(`Channel ID: ${CHANNEL_ID}\n`);
  
  let messages: any[] = [];
  let methodUsed = '';
  let errorDetails: any = null;
  
  // Method 1: Global MCP functions (most common in Cursor IDE)
  if (typeof (global as any).mcp_Slack_slack_get_channel_history === 'function') {
    console.log('✅ Found MCP function: global.mcp_Slack_slack_get_channel_history\n');
    methodUsed = 'global.mcp_Slack_slack_get_channel_history';
    try {
      console.log('Attempting to fetch messages (limit: 1000)...\n');
      const result = await (global as any).mcp_Slack_slack_get_channel_history({
        channel_id: CHANNEL_ID,
        limit: 1000
      });
      messages = result.messages || result || [];
      console.log(`✅ Successfully fetched ${messages.length} messages using Method 1\n`);
    } catch (error: any) {
      errorDetails = error;
      console.error(`❌ Error with Method 1: ${error.message}\n`);
      if (error.stack) {
        console.error(`Stack: ${error.stack}\n`);
      }
    }
  }
  
  // Method 2: Global mcp object
  if (messages.length === 0 && (global as any).mcp?.Slack?.slack_get_channel_history) {
    console.log('✅ Found MCP function: global.mcp.Slack.slack_get_channel_history\n');
    methodUsed = 'global.mcp.Slack.slack_get_channel_history';
    try {
      console.log('Attempting to fetch messages (limit: 1000)...\n');
      const result = await (global as any).mcp.Slack.slack_get_channel_history({
        channel_id: CHANNEL_ID,
        limit: 1000
      });
      messages = result.messages || result || [];
      console.log(`✅ Successfully fetched ${messages.length} messages using Method 2\n`);
    } catch (error: any) {
      errorDetails = error;
      console.error(`❌ Error with Method 2: ${error.message}\n`);
      if (error.stack) {
        console.error(`Stack: ${error.stack}\n`);
      }
    }
  }
  
  // Method 3: Try vscode.mcp (if vscode module is available)
  if (messages.length === 0) {
    try {
      const vscode = require('vscode');
      if ((vscode as any).mcp?.Slack?.slack_get_channel_history) {
        console.log('✅ Found MCP function: vscode.mcp.Slack.slack_get_channel_history\n');
        methodUsed = 'vscode.mcp.Slack.slack_get_channel_history';
        console.log('Attempting to fetch messages (limit: 1000)...\n');
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
  
  // Check if we got messages
  if (messages.length === 0) {
    console.log('\n❌ Could not access Slack MCP functions or fetch messages\n');
    console.log('Troubleshooting:\n');
    console.log('1. Ensure you are running this in Cursor IDE terminal');
    console.log('2. Verify Slack MCP is enabled in Cursor Settings → MCP → Slack');
    console.log('3. Check that you have access to channel C04D195JVGS');
    console.log('4. Try reloading Cursor IDE\n');
    
    if (errorDetails) {
      console.log('Error details:');
      console.log(JSON.stringify(errorDetails, null, 2));
      console.log('\n');
    }
    
    console.log('To check if MCP is available, run:');
    console.log('  node -e "console.log(typeof global.mcp_Slack_slack_get_channel_history)"\n');
    
    return { success: false, messages: [], methodUsed: '', error: errorDetails };
  }
  
  // Display results
  console.log('📊 Connection Results');
  console.log('='.repeat(60));
  console.log(`Method used: ${methodUsed}`);
  console.log(`Total messages: ${messages.length}\n`);
  
  if (messages.length > 0) {
    console.log('Sample messages:\n');
    messages.slice(0, 5).forEach((msg: any, i: number) => {
      const text = (msg.text || '').substring(0, 100).replace(/\n/g, ' ');
      const date = msg.ts ? new Date(parseFloat(msg.ts) * 1000).toISOString() : 'unknown';
      const user = msg.user || msg.username || 'unknown';
      console.log(`${i + 1}. [${date}] User: ${user}`);
      console.log(`   ${text}${text.length >= 100 ? '...' : ''}\n`);
    });
    
    // Count message types
    const botMessages = messages.filter(m => m.bot_id || m.subtype === 'bot_message').length;
    const userMessages = messages.length - botMessages;
    
    console.log('\nMessage Statistics:');
    console.log(`  Total: ${messages.length}`);
    console.log(`  User messages: ${userMessages}`);
    console.log(`  Bot/system messages: ${botMessages}\n`);
    
    // Save messages to file
    try {
      // Ensure data directory exists
      const dataDir = path.dirname(OUTPUT_FILE);
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }
      
      // Save messages
      const output = {
        channel_id: CHANNEL_ID,
        fetched_at: new Date().toISOString(),
        method_used: methodUsed,
        total_messages: messages.length,
        messages: messages
      };
      
      fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));
      console.log(`✅ Messages saved to: ${OUTPUT_FILE}\n`);
    } catch (error: any) {
      console.error(`⚠️  Could not save messages to file: ${error.message}\n`);
    }
  }
  
  return { success: true, messages, methodUsed, outputFile: OUTPUT_FILE };
}

if (require.main === module) {
  testChannelConnection()
    .then(result => {
      if (result.success) {
        console.log(`✅ Successfully connected to channel ${CHANNEL_ID}`);
        console.log(`   Fetched ${result.messages.length} messages`);
        if (result.outputFile) {
          console.log(`   Saved to: ${result.outputFile}\n`);
        }
        process.exit(0);
      } else {
        console.log(`❌ Could not connect to channel ${CHANNEL_ID}\n`);
        process.exit(1);
      }
    })
    .catch(error => {
      console.error('\n❌ Fatal error:', error.message);
      console.error(error.stack);
      process.exit(1);
    });
}

export { testChannelConnection };
