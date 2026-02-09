#!/usr/bin/env ts-node

/**
 * Directly invoke Slack MCP to get latest message from channel C08T43UHK9D
 */

const CHANNEL_ID = 'C08T43UHK9D';

async function invokeSlackMCPDirect() {
  console.log(`\n🔌 Directly invoking Slack MCP for channel ${CHANNEL_ID}\n`);
  
  // Try to access MCP function directly
  let getChannelHistory: any = null;
  
  // Method 1: Check global.mcp_Slack_slack_get_channel_history
  if (typeof (global as any).mcp_Slack_slack_get_channel_history === 'function') {
    console.log('✅ Found: global.mcp_Slack_slack_get_channel_history');
    getChannelHistory = (global as any).mcp_Slack_slack_get_channel_history;
  }
  // Method 2: Check global.mcp.Slack.slack_get_channel_history
  else if ((global as any).mcp?.Slack?.slack_get_channel_history) {
    console.log('✅ Found: global.mcp.Slack.slack_get_channel_history');
    getChannelHistory = (global as any).mcp.Slack.slack_get_channel_history;
  }
  // Method 3: Try vscode.mcp
  else {
    try {
      const vscode = require('vscode');
      if ((vscode as any).mcp?.Slack?.slack_get_channel_history) {
        console.log('✅ Found: vscode.mcp.Slack.slack_get_channel_history');
        getChannelHistory = (vscode as any).mcp.Slack.slack_get_channel_history;
      }
    } catch (e) {
      // vscode not available
    }
  }
  
  if (!getChannelHistory) {
    console.error('\n❌ Slack MCP function not found in any expected location');
    console.error('Available globals:', Object.keys(global).filter(k => k.includes('mcp') || k.includes('Slack')));
    process.exit(1);
  }
  
  try {
    console.log(`\n📨 Fetching latest message from channel ${CHANNEL_ID}...\n`);
    const result = await getChannelHistory({
      channel_id: CHANNEL_ID,
      limit: 1
    });
    
    const messages = result.messages || result || [];
    
    if (!Array.isArray(messages) || messages.length === 0) {
      console.log('⚠️  No messages found in channel');
      console.log('Response:', JSON.stringify(result, null, 2));
      process.exit(0);
    }
    
    const latestMessage = messages[0];
    
    console.log('✅ Latest Message Retrieved:');
    console.log('='.repeat(60));
    console.log(`Timestamp: ${latestMessage.ts ? new Date(parseFloat(latestMessage.ts) * 1000).toISOString() : 'unknown'}`);
    console.log(`User: ${latestMessage.user || latestMessage.username || 'unknown'}`);
    console.log(`Type: ${latestMessage.subtype || latestMessage.type || 'message'}`);
    console.log(`\nMessage Text:\n${latestMessage.text || '(empty)'}\n`);
    console.log('='.repeat(60));
    
    // Show full message object
    console.log('\nFull message object:');
    console.log(JSON.stringify(latestMessage, null, 2));
    
  } catch (error: any) {
    console.error('\n❌ Error invoking Slack MCP:');
    console.error(`Message: ${error.message}`);
    console.error(`Stack: ${error.stack}`);
    process.exit(1);
  }
}

invokeSlackMCPDirect();
