#!/usr/bin/env ts-node

/**
 * Get the latest message from a Slack channel
 * Uses Slack MCP configured in Cursor
 * Usage: ts-node scripts/get_latest_message.ts [CHANNEL_ID]
 */

import * as dotenv from 'dotenv';
dotenv.config();

// Get channel ID from command line argument or use default
const CHANNEL_ID = process.argv[2] || 'C08T43UHK9D';

async function getLatestMessage(channelId: string) {
  console.log('\n📨 Fetching Latest Message from Channel');
  console.log('='.repeat(60));
  console.log(`Channel ID: ${channelId}\n`);
  
  let messages: any[] = [];
  let methodUsed = '';
  
  // Method 1: Global MCP functions (most common in Cursor IDE)
  if (typeof (global as any).mcp_Slack_slack_get_channel_history === 'function') {
    console.log('✅ Found MCP function: global.mcp_Slack_slack_get_channel_history\n');
    methodUsed = 'global.mcp_Slack_slack_get_channel_history';
    try {
      console.log('Fetching latest message...\n');
      const result = await (global as any).mcp_Slack_slack_get_channel_history({
        channel_id: channelId,
        limit: 1  // Only fetch the latest message
      });
      messages = result.messages || result || [];
      if (Array.isArray(messages) && messages.length > 0) {
        console.log(`✅ Successfully fetched latest message using Method 1\n`);
      }
    } catch (error: any) {
      console.error(`❌ Error with Method 1: ${error.message}\n`);
    }
  }
  
  // Method 2: Global mcp object
  if (messages.length === 0 && (global as any).mcp?.Slack?.slack_get_channel_history) {
    console.log('✅ Found MCP function: global.mcp.Slack.slack_get_channel_history\n');
    methodUsed = 'global.mcp.Slack.slack_get_channel_history';
    try {
      console.log('Fetching latest message...\n');
      const result = await (global as any).mcp.Slack.slack_get_channel_history({
        channel_id: channelId,
        limit: 1
      });
      messages = result.messages || result || [];
      if (Array.isArray(messages) && messages.length > 0) {
        console.log(`✅ Successfully fetched latest message using Method 2\n`);
      }
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
        console.log('Fetching latest message...\n');
        const result = await (vscode as any).mcp.Slack.slack_get_channel_history({
          channel_id: channelId,
          limit: 1
        });
        messages = result.messages || result || [];
        if (Array.isArray(messages) && messages.length > 0) {
          console.log(`✅ Successfully fetched latest message using Method 3\n`);
        }
      }
    } catch (e) {
      // vscode not available, continue
    }
  }
  
  // Check if we got a message
  if (!Array.isArray(messages) || messages.length === 0) {
    console.log('❌ Could not access Slack MCP functions or fetch messages\n');
    console.log('Troubleshooting:\n');
    console.log('1. Ensure you are running this in Cursor IDE terminal');
    console.log('2. Verify Slack MCP is enabled in Cursor Settings → MCP → Slack');
    console.log(`3. Check that you have access to channel ${channelId}`);
    console.log('4. Try reloading Cursor IDE\n');
    return null;
  }
  
  // Get the latest message (first in array, as Slack returns newest first)
  const latestMessage = messages[0];
  
  // Display the latest message
  console.log('📨 Latest Message');
  console.log('='.repeat(60));
  
  const timestamp = latestMessage.ts ? new Date(parseFloat(latestMessage.ts) * 1000).toISOString() : 'unknown';
  const user = latestMessage.user || latestMessage.username || 'unknown';
  const text = latestMessage.text || '';
  
  // Extract text from blocks if text is empty
  let messageText = text;
  if (!messageText && latestMessage.blocks) {
    messageText = extractTextFromBlocks(latestMessage.blocks);
  }
  
  console.log(`Timestamp: ${timestamp}`);
  console.log(`User: ${user}`);
  console.log(`Type: ${latestMessage.subtype || latestMessage.type || 'message'}`);
  if (latestMessage.bot_id) {
    console.log(`Bot ID: ${latestMessage.bot_id}`);
  }
  console.log(`\nMessage Text:\n${messageText || '(empty)'}\n`);
  
  // Show additional metadata if available
  if (latestMessage.thread_ts) {
    console.log(`Thread TS: ${latestMessage.thread_ts}`);
  }
  if (latestMessage.reply_count !== undefined) {
    console.log(`Reply Count: ${latestMessage.reply_count}`);
  }
  
  console.log('\n' + '='.repeat(60) + '\n');
  
  return latestMessage;
}

function extractTextFromBlocks(blocks: any[]): string {
  const texts: string[] = [];
  
  for (const block of blocks) {
    if (block.type === 'rich_text' && block.elements) {
      texts.push(extractTextFromElements(block.elements));
    } else if (block.text) {
      texts.push(block.text);
    }
  }
  
  return texts.join('\n').trim();
}

function extractTextFromElements(elements: any[]): string {
  const texts: string[] = [];
  
  for (const element of elements) {
    if (element.type === 'rich_text_section') {
      if (element.elements) {
        texts.push(extractTextFromElements(element.elements));
      }
    } else if (element.type === 'rich_text_list') {
      if (element.elements) {
        element.elements.forEach((item: any) => {
          if (item.elements) {
            texts.push('• ' + extractTextFromElements(item.elements));
          }
        });
      }
    } else if (element.text) {
      texts.push(element.text);
    } else if (element.type === 'text') {
      texts.push(element.text || '');
    }
  }
  
  return texts.join('').trim();
}

if (require.main === module) {
  const channelId = process.argv[2] || CHANNEL_ID;
  
  getLatestMessage(channelId)
    .then(message => {
      if (message) {
        console.log('✅ Successfully retrieved latest message\n');
        process.exit(0);
      } else {
        console.log('❌ Could not retrieve latest message\n');
        process.exit(1);
      }
    })
    .catch(error => {
      console.error('\n❌ Fatal error:', error.message);
      console.error(error.stack);
      process.exit(1);
    });
}

export { getLatestMessage };
