#!/usr/bin/env ts-node

/**
 * Test script to verify MCP connection works
 */

import * as dotenv from 'dotenv';
dotenv.config();

const { dirname } = require('path');
const mcpClient = require('@modelcontextprotocol/sdk/client');
const Client = mcpClient.Client;
const clientPath = require.resolve('@modelcontextprotocol/sdk/client');
const clientDir = dirname(clientPath);
const stdioPath = require('path').join(clientDir, 'stdio.js');
const stdioTransport = require(stdioPath);
const StdioClientTransport = stdioTransport.StdioClientTransport;

const CHANNEL_ID = 'C04D195JVGS';
const SLACK_TOKEN = process.env.SLACK_BOT_TOKEN || process.env.SLACK_TOKEN;

async function testMCPConnection() {
  console.log('\n🧪 Testing Slack MCP Connection\n');
  console.log(`Token: ${SLACK_TOKEN ? SLACK_TOKEN.substring(0, 15) + '...' : 'NOT SET'}\n`);
  
  if (!SLACK_TOKEN) {
    console.error('❌ SLACK_BOT_TOKEN not set in .env file\n');
    process.exit(1);
  }

  try {
    console.log('🔄 Connecting to Slack MCP server...\n');
    
    const transport = new StdioClientTransport({
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-slack'],
      env: {
        ...process.env,
        SLACK_BOT_TOKEN: SLACK_TOKEN
      }
    });
    
    const client = new Client({
      name: 'test-client',
      version: '1.0.0'
    }, {
      capabilities: {}
    });
    
    console.log('   Establishing connection...');
    await client.connect(transport);
    console.log('✅ Connected!\n');
    
    console.log('📋 Listing available tools...');
    const tools = await client.listTools();
    console.log(`✅ Found ${tools.tools.length} tools:\n`);
    tools.tools.forEach((tool: any) => {
      console.log(`   - ${tool.name}: ${tool.description || 'No description'}`);
    });
    
    console.log('\n🧪 Testing slack_get_thread_replies tool...\n');
    const testThreadTs = '1768811097.368169'; // First thread from the list
    
    const result = await client.callTool({
      name: 'slack_get_thread_replies',
      arguments: {
        channel_id: CHANNEL_ID,
        thread_ts: testThreadTs
      }
    });
    
    console.log('✅ Tool call successful!\n');
    console.log('Response type:', result.content?.[0]?.type || 'unknown');
    
    if (result.content && result.content.length > 0) {
      const content = result.content[0];
      if (content.type === 'text') {
        try {
          const parsed = JSON.parse(content.text);
          const messages = parsed.messages || parsed;
          console.log(`✅ Received ${Array.isArray(messages) ? messages.length : 'data'} messages\n`);
        } catch (e) {
          console.log('Response (first 200 chars):', content.text.substring(0, 200));
        }
      }
    }
    
    await client.close();
    console.log('\n✅ Test completed successfully!\n');
    
  } catch (error: any) {
    console.error(`\n❌ Test failed: ${error.message}\n`);
    console.error('Stack:', error.stack);
    process.exit(1);
  }
}

testMCPConnection();
