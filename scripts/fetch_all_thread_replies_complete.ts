#!/usr/bin/env ts-node

/**
 * Complete script to fetch all thread replies and merge with customer engagement data
 * This script can run standalone using Slack Web API or MCP (if available)
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import * as dotenv from 'dotenv';
import { homedir } from 'os';

dotenv.config();

// Try to import MCP SDK (for MCP server connection)
let Client: any = null;
let StdioClientTransport: any = null;
try {
  // Import Client from client subpath
  const mcpClient = require('@modelcontextprotocol/sdk/client');
  Client = mcpClient.Client;
  
  // Import StdioClientTransport - it's in the same directory as client/index.js
  const { dirname } = require('path');
  const clientPath = require.resolve('@modelcontextprotocol/sdk/client');
  const clientDir = dirname(clientPath);
  const stdioPath = join(clientDir, 'stdio.js');
  const stdioTransport = require(stdioPath);
  StdioClientTransport = stdioTransport.StdioClientTransport;
  
  if (!Client || !StdioClientTransport) {
    throw new Error('Client or StdioClientTransport not found in MCP SDK');
  }
} catch (e) {
  throw new Error(
    'MCP SDK not available. Please install: npm install @modelcontextprotocol/sdk zod\n' +
    'Error: ' + (e as Error).message
  );
}

const CHANNEL_ID = 'C04D195JVGS';
const RAW_DATA_DIR = join(process.cwd(), 'data', 'raw', 'slack', CHANNEL_ID);
const INTERMEDIATE_DIR = join(process.cwd(), 'data', 'intermediate');
const THREAD_TIMESTAMPS_FILE = join(INTERMEDIATE_DIR, 'thread_timestamps.json');
const ENGAGEMENT_DATA_FILE = join(RAW_DATA_DIR, `customer_engagement_${CHANNEL_ID}.json`);
const PROGRESS_FILE = join(INTERMEDIATE_DIR, 'thread_replies_progress.json');

// MCP client (will be initialized)
let mcpClient: any = null;
let useCursorMCP = false;

interface MCPServerConfig {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
}

interface MCPConfig {
  mcpServers?: {
    [key: string]: MCPServerConfig | { autoApprove?: string[] };
  };
}

interface ThreadProgress {
  fetched: string[];
  failed: Array<{ threadTs: string; error: string }>;
  lastFetchedIndex: number;
  threadReplies: Record<string, any[]>;
}

interface ThreadData {
  threadTs: string;
  replyCount: number;
  date: string;
}

// Helper functions to extract text from Slack message blocks
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
    if (element.type === 'rich_text_section' && element.elements) {
      texts.push(extractTextFromElements(element.elements));
    } else if (element.type === 'rich_text_list' && element.elements) {
      element.elements.forEach((item: any) => {
        if (item.elements) {
          texts.push('• ' + extractTextFromElements(item.elements));
        }
      });
    } else if (element.text) {
      texts.push(element.text);
    } else if (element.type === 'text') {
      texts.push(element.text || '');
    } else if (element.type === 'user') {
      texts.push(`<@${element.user_id}>`);
    } else if (element.type === 'link') {
      texts.push(element.url || '');
    }
  }
  return texts.join('').trim();
}

function getMessageText(message: any): string {
  if (message.text) return message.text;
  if (message.blocks) return extractTextFromBlocks(message.blocks);
  return '';
}

function processThreadReply(reply: any): any {
  return {
    id: reply.ts,
    timestamp: reply.ts,
    date: new Date(parseFloat(reply.ts) * 1000).toISOString().split('T')[0],
    user: reply.user_profile?.real_name || 
          reply.user_profile?.display_name || 
          reply.user || 'Unknown',
    userId: reply.user,
    text: getMessageText(reply),
    isBot: !!reply.bot_id || reply.user === 'USLACKBOT',
    rawData: reply
  };
}

/**
 * Read MCP configuration from Cursor settings
 */
function readCursorMCPConfig(): MCPServerConfig | null {
  // Try project-level config first
  const projectMCPFile = join(process.cwd(), '.cursor', 'mcp.json');
  if (existsSync(projectMCPFile)) {
    try {
      const config: MCPConfig = JSON.parse(readFileSync(projectMCPFile, 'utf-8'));
      const slackConfig = config.mcpServers?.Slack || config.mcpServers?.slack;
      if (slackConfig && 'command' in slackConfig) {
        return slackConfig as MCPServerConfig;
      }
    } catch (e) {
      // Continue to try global config
    }
  }

  // Try global Cursor settings (platform-specific)
  const candidatePaths: string[] = [];
  if (process.env.CURSOR_SETTINGS_PATH) {
    candidatePaths.push(process.env.CURSOR_SETTINGS_PATH);
  }
  if (process.platform === 'darwin') {
    candidatePaths.push(join(homedir(), 'Library', 'Application Support', 'Cursor', 'User', 'settings.json'));
  } else if (process.platform === 'win32') {
    const appData = process.env.APPDATA || join(homedir(), 'AppData', 'Roaming');
    candidatePaths.push(join(appData, 'Cursor', 'User', 'settings.json'));
  } else {
    candidatePaths.push(join(homedir(), '.config', 'Cursor', 'User', 'settings.json'));
    candidatePaths.push(join(homedir(), '.config', 'cursor', 'User', 'settings.json'));
  }

  for (const globalSettingsFile of candidatePaths) {
    if (!existsSync(globalSettingsFile)) continue;
    try {
      const settings: any = JSON.parse(readFileSync(globalSettingsFile, 'utf-8'));
      const slackConfig = settings.mcpServers?.Slack || settings.mcpServers?.slack;
      if (slackConfig && 'command' in slackConfig) {
        return slackConfig as MCPServerConfig;
      }
    } catch (e) {
      // Config not found or invalid
    }
  }

  return null;
}

/**
 * Initialize Slack MCP client using Cursor's configuration
 */
async function initializeSlackMCP(): Promise<void> {
  // Method 1: Try Cursor IDE's injected MCP (if available)
  if (typeof (global as any).mcp_Slack_slack_get_thread_replies === 'function' ||
      (global as any).mcp?.Slack?.slack_get_thread_replies) {
    console.log('✅ Using Cursor IDE injected MCP functions\n');
    useCursorMCP = true;
    return;
  }

  // Method 2: Read Cursor's MCP configuration and connect to the same server
  const mcpConfig = readCursorMCPConfig();
  
  // Default Slack MCP server configuration (standard Cursor setup)
  const defaultConfig: MCPServerConfig = {
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-slack'],
    env: {
      SLACK_BOT_TOKEN: process.env.SLACK_BOT_TOKEN || process.env.SLACK_TOKEN || '',
      SLACK_TEAM_ID: process.env.SLACK_TEAM_ID || ''
    }
  };

  const config = mcpConfig || defaultConfig;

  // Check if we have required environment variables
  const env = config.env || {};
  const slackToken = env.SLACK_BOT_TOKEN || process.env.SLACK_BOT_TOKEN || process.env.SLACK_TOKEN;
  
  if (!slackToken) {
    throw new Error(
      'Slack bot token not found. Please set SLACK_BOT_TOKEN or SLACK_TOKEN environment variable.\n' +
      'You can get a token from: https://api.slack.com/apps\n' +
      'Required scopes: channels:history, channels:read, users:read\n' +
      'The token will be used to connect to the same Slack MCP server that Cursor uses.'
    );
  }

  // Merge environment variables
  const mergedEnv: Record<string, string> = {
    ...process.env,
    ...env,
    SLACK_BOT_TOKEN: slackToken
  };

  if (env.SLACK_TEAM_ID || process.env.SLACK_TEAM_ID) {
    mergedEnv.SLACK_TEAM_ID = env.SLACK_TEAM_ID || process.env.SLACK_TEAM_ID || '';
  }

  try {
    console.log('🔄 Connecting to Slack MCP server (same as Cursor uses)...\n');
    console.log(`   Command: ${config.command} ${(config.args || []).join(' ')}\n`);
    console.log(`   Token: ${slackToken.substring(0, 10)}... (${slackToken.length} chars)\n`);
    
    const transport = new StdioClientTransport({
      command: config.command || 'npx',
      args: config.args || ['-y', '@modelcontextprotocol/server-slack'],
      env: mergedEnv
    });
    
    mcpClient = new Client({
      name: 'thread-fetcher',
      version: '1.0.0'
    }, {
      capabilities: {}
    });
    
    console.log('   Establishing connection...');
    await mcpClient.connect(transport);
    
    // Verify connection by listing available tools
    const tools = await mcpClient.listTools();
    console.log(`   Available tools: ${tools.tools.map((t: any) => t.name).join(', ')}\n`);
    
    console.log('✅ Connected to Slack MCP server\n');
    useCursorMCP = false;
    return;
  } catch (error: any) {
    const errorMsg = error.message || String(error);
    console.error(`❌ Connection failed: ${errorMsg}\n`);
    throw new Error(
      `Failed to connect to Slack MCP server: ${errorMsg}\n` +
      '\nTroubleshooting:\n' +
      '1. Verify SLACK_BOT_TOKEN is set correctly in .env file\n' +
      '2. Check internet connection (needs to download @modelcontextprotocol/server-slack)\n' +
      '3. Ensure Node.js and npm are installed and working\n' +
      '4. Try running: npx -y @modelcontextprotocol/server-slack manually to test\n' +
      '5. Check token has required scopes: channels:history, channels:read, users:read'
    );
  }
}

/**
 * Fetch thread replies using MCP (Cursor injected or MCP server)
 */
async function fetchThreadReplies(threadTs: string): Promise<any[]> {
  // Method 1: Cursor IDE injected MCP functions
  if (useCursorMCP) {
    if (typeof (global as any).mcp_Slack_slack_get_thread_replies === 'function') {
      const getThreadReplies = (global as any).mcp_Slack_slack_get_thread_replies;
      const result = await getThreadReplies({
        channel_id: CHANNEL_ID,
        thread_ts: threadTs
      });
      return result.messages || [];
    }

    if ((global as any).mcp?.Slack?.slack_get_thread_replies) {
      const getThreadReplies = (global as any).mcp.Slack.slack_get_thread_replies;
      const result = await getThreadReplies({
        channel_id: CHANNEL_ID,
        thread_ts: threadTs
      });
      return result.messages || [];
    }
    
    // If useCursorMCP is true but functions aren't available, something went wrong
    throw new Error('Cursor MCP functions not available. Please ensure you are running in Cursor IDE terminal, or the script will connect to MCP server automatically.');
  }

  // Method 2: MCP SDK client (standalone MCP server connection)
  if (!mcpClient) {
    throw new Error(
      'MCP client not initialized. The script should have connected to Slack MCP server.\n' +
      'Please check:\n' +
      '1. SLACK_BOT_TOKEN is set in .env file\n' +
      '2. Internet connection is available (to download MCP server)\n' +
      '3. Node.js and npm are installed'
    );
  }

  try {
    const result = await mcpClient.callTool({
      name: 'slack_get_thread_replies',
      arguments: {
        channel_id: CHANNEL_ID,
        thread_ts: threadTs
      }
    });
    
    // Parse MCP response
    if (result.content && result.content.length > 0) {
      const content = result.content[0];
      if (content.type === 'text') {
        try {
          const parsed = JSON.parse(content.text);
          // Handle different response formats
          if (Array.isArray(parsed)) {
            return parsed;
          } else if (parsed && Array.isArray(parsed.messages)) {
            return parsed.messages;
          } else if (parsed && parsed.data && Array.isArray(parsed.data)) {
            return parsed.data;
          } else if (typeof parsed === 'object' && parsed !== null) {
            // If it's an object but not an array, try to extract messages
            console.warn(`Warning: Unexpected response format for thread ${threadTs}, returning empty array`);
            return [];
          }
          return [];
        } catch (parseError) {
          // If parsing fails, try to return the text as-is or empty array
          console.warn(`Warning: Could not parse MCP response for thread ${threadTs}: ${parseError}`);
          return [];
        }
      } else if (content.type === 'resource') {
        // Handle resource type if needed
        return [];
      }
    }
    return [];
  } catch (error: any) {
    throw new Error(`MCP tool call failed for thread ${threadTs}: ${error.message}`);
  }
}

async function fetchAllThreadReplies() {
  console.log(`\n📥 Fetching All Thread Replies\n`);
  console.log(`Channel: ${CHANNEL_ID}\n`);
  
  try {
    // Initialize Slack MCP client (uses same config as Cursor)
    await initializeSlackMCP();
    
    // Verify MCP client is ready
    if (!useCursorMCP && !mcpClient) {
      throw new Error(
        'MCP client initialization failed. The script attempted to connect to Slack MCP server but the connection was not established.\n' +
        'Please check the error messages above for details.'
      );
    }
    
    console.log(`✅ MCP client ready (${useCursorMCP ? 'Cursor IDE' : 'Standalone MCP server'})\n`);
    
    // Load thread timestamps
    const threadData: ThreadData[] = JSON.parse(readFileSync(THREAD_TIMESTAMPS_FILE, 'utf-8'));
    console.log(`📋 Found ${threadData.length} threads to fetch\n`);
    
    // Load progress if exists
    let progress: ThreadProgress = {
      fetched: [],
      failed: [],
      lastFetchedIndex: -1,
      threadReplies: {}
    };
    
    if (existsSync(PROGRESS_FILE)) {
      progress = JSON.parse(readFileSync(PROGRESS_FILE, 'utf-8'));
      console.log(`📊 Resuming from index ${progress.lastFetchedIndex + 1}`);
      console.log(`   Already fetched: ${progress.fetched.length}`);
      console.log(`   Failed: ${progress.failed.length}\n`);
    }
    
    // Fetch thread replies
    let totalReplies = 0;
    const startIndex = progress.lastFetchedIndex + 1;
    const BATCH_SIZE = 10;
    
    for (let i = startIndex; i < threadData.length; i++) {
      const thread = threadData[i];
      const threadTs = thread.threadTs;
      
      // Skip if already fetched
      if (progress.fetched.includes(threadTs)) {
        continue;
      }
      
      console.log(`[${i + 1}/${threadData.length}] Fetching thread ${threadTs.substring(0, 10)}... (${thread.replyCount} replies)`);
      
      try {
        const replies = await fetchThreadReplies(threadTs);
        
        // Ensure replies is an array
        if (!Array.isArray(replies)) {
          throw new Error(`Expected array but got ${typeof replies}: ${JSON.stringify(replies).substring(0, 200)}`);
        }
        
        // Filter out the parent message itself
        const actualReplies = replies.filter(r => r.ts !== threadTs);
        totalReplies += actualReplies.length;
        
        // Process replies
        const processedReplies = actualReplies.map(reply => processThreadReply(reply));
        
        progress.threadReplies[threadTs] = processedReplies;
        progress.fetched.push(threadTs);
        progress.lastFetchedIndex = i;
        
        console.log(`  ✓ Fetched ${actualReplies.length} replies\n`);
        
        // Save progress every BATCH_SIZE threads
        if ((i + 1) % BATCH_SIZE === 0) {
          writeFileSync(PROGRESS_FILE, JSON.stringify(progress, null, 2), 'utf-8');
          console.log(`💾 Progress saved (${i + 1}/${threadData.length})\n`);
        }
        
        // Small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 200));
        
      } catch (error: any) {
        console.error(`\n❌ Error fetching thread ${threadTs}: ${error.message}\n`);
        progress.failed.push({
          threadTs: threadTs,
          error: error.message
        });
        progress.lastFetchedIndex = i;
        
        // Save progress on error
        writeFileSync(PROGRESS_FILE, JSON.stringify(progress, null, 2), 'utf-8');
        
        // Stop execution on first error so user can fix the issue
        console.error(`\n${'='.repeat(60)}\n`);
        console.error(`🛑 STOPPING: First error encountered. Fix the issue and re-run the script.\n`);
        console.error(`   Failed thread: ${threadTs}`);
        console.error(`   Error: ${error.message}\n`);
        console.error(`   Progress saved to: ${PROGRESS_FILE}\n`);
        console.error(`   To resume after fixing, run: npm run fetch-all-thread-replies\n`);
        console.error(`${'='.repeat(60)}\n`);
        throw error;
      }
    }
    
    // Save final progress
    writeFileSync(PROGRESS_FILE, JSON.stringify(progress, null, 2), 'utf-8');
    
    // Load engagement data (create if doesn't exist)
    let engagementData: any;
    if (existsSync(ENGAGEMENT_DATA_FILE)) {
      engagementData = JSON.parse(readFileSync(ENGAGEMENT_DATA_FILE, 'utf-8'));
    } else {
      console.log(`⚠️  Engagement data file not found. Creating empty structure...\n`);
      engagementData = {
        channelId: CHANNEL_ID,
        fetchedAt: new Date().toISOString(),
        totalEngagements: 0,
        engagements: []
      };
    }
    
    // Merge thread replies with engagement data
    console.log(`\n🔗 Merging thread replies with engagement data...\n`);
    
    for (const engagement of engagementData.engagements) {
      const replies = progress.threadReplies[engagement.id];
      if (replies && replies.length > 0) {
        engagement.threadReplies = replies;
      }
    }
    
    engagementData.totalReplies = totalReplies;
    engagementData.fetchedAt = new Date().toISOString();
    
    // Save updated engagement data
    const outputFile = join(RAW_DATA_DIR, `customer_engagement_${CHANNEL_ID}_complete.json`);
    writeFileSync(outputFile, JSON.stringify(engagementData, null, 2), 'utf-8');
    console.log(`✅ Complete data saved to: ${outputFile}\n`);
    
    // Create comprehensive CSV
    const csvLines = [
      'Type,ID,Timestamp,Date,Customer Name,PM Name,User,UserID,Text Preview,Has Thread,Reply Count,Is Bot'
    ];
    
    for (const eng of engagementData.engagements) {
      // Add parent engagement
      const notesPreview = (eng.notes || '').substring(0, 300).replace(/"/g, '""').replace(/\n/g, ' ');
      const attendeesStr = (eng.attendees || []).join(';');
      const replyCount = (eng.threadReplies || []).length;
      
      csvLines.push(
        `"Engagement","${eng.id}","${eng.timestamp}","${eng.date}","${eng.customerName || ''}","${eng.pmName || ''}","","","${notesPreview}","${replyCount > 0}","${replyCount}","false"`
      );
      
      // Add thread replies
      if (eng.threadReplies && eng.threadReplies.length > 0) {
        for (const reply of eng.threadReplies) {
          const replyText = (reply.text || '').substring(0, 500).replace(/"/g, '""').replace(/\n/g, ' ');
          csvLines.push(
            `"Thread Reply","${reply.id}","${reply.timestamp}","${reply.date}","${eng.customerName || ''}","${eng.pmName || ''}","${reply.user || ''}","${reply.userId || ''}","${replyText}","false","0","${reply.isBot || false}"`
          );
        }
      }
    }
    
    const csvFile = join(RAW_DATA_DIR, `customer_engagement_${CHANNEL_ID}_complete.csv`);
    writeFileSync(csvFile, csvLines.join('\n'), 'utf-8');
    console.log(`✅ Complete CSV saved to: ${csvFile}\n`);
    
    // Summary
    console.log(`${'='.repeat(60)}\n`);
    console.log(`📊 SUMMARY\n`);
    console.log(`Total Threads: ${threadData.length}`);
    console.log(`Successfully Fetched: ${progress.fetched.length}`);
    console.log(`Failed: ${progress.failed.length}`);
    console.log(`Total Replies Fetched: ${totalReplies}`);
    console.log(`Total Engagements: ${engagementData.totalEngagements}`);
    console.log(`\nFiles Created:\n`);
    console.log(`  1. ${outputFile}`);
    console.log(`  2. ${csvFile}`);
    console.log(`  3. ${PROGRESS_FILE}`);
    console.log(`\n${'='.repeat(60)}\n`);
    
    if (progress.failed.length > 0) {
      console.log(`\n⚠️  Failed Threads (${progress.failed.length}):\n`);
      progress.failed.forEach((f, idx) => {
        console.log(`  ${idx + 1}. ${f.threadTs}: ${f.error}`);
      });
      console.log();
    }
    
    return { engagementData, progress };
    
  } catch (error: any) {
    console.error(`\n❌ Error: ${error.message}`);
    throw error;
  } finally {
    // Cleanup MCP client if used
    if (mcpClient) {
      try {
        await mcpClient.close();
      } catch (e) {
        // Ignore cleanup errors
      }
    }
  }
}

if (require.main === module) {
  fetchAllThreadReplies()
    .then(() => {
      console.log('✅ Thread replies fetch complete\n');
      process.exit(0);
    })
    .catch(error => {
      console.error('\n❌ Fatal error:', error.message);
      process.exit(1);
    });
}

export { fetchAllThreadReplies };
