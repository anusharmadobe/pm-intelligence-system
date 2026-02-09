#!/usr/bin/env ts-node

/**
 * Fetch all messages and thread replies from a Slack channel
 * Designed for PM system ingestion
 */

import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const CHANNEL_ID = 'C04D195JVGS';
const MESSAGES_FILE = '/Users/anusharm/.cursor/projects/Users-anusharm-learn-PM-cursor-system/agent-tools/d95e9433-1c13-4020-96b4-ea2117197ce6.txt';

interface SlackMessage {
  text?: string;
  user?: string;
  ts: string;
  user_profile?: {
    real_name?: string;
    display_name?: string;
  };
  blocks?: any[];
  subtype?: string;
  thread_ts?: string;
  reply_count?: number;
  bot_id?: string;
  [key: string]: any;
}

interface ThreadData {
  threadTs: string;
  parentMessage: SlackMessage;
  replies: SlackMessage[];
}

interface ChannelData {
  channelId: string;
  fetchedAt: string;
  totalMessages: number;
  totalThreads: number;
  totalReplies: number;
  messages: SlackMessage[];
  threads: ThreadData[];
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

function getMessageText(message: SlackMessage): string {
  if (message.text) return message.text;
  if (message.blocks) return extractTextFromBlocks(message.blocks);
  return '';
}

function extractThreadTimestamps(messages: SlackMessage[]): Map<string, SlackMessage> {
  const threads = new Map<string, SlackMessage>();
  
  for (const msg of messages) {
    if (msg.thread_ts && msg.reply_count && msg.reply_count > 0) {
      // Use thread_ts as key, store the parent message
      if (!threads.has(msg.thread_ts)) {
        threads.set(msg.thread_ts, msg);
      }
    }
  }
  
  return threads;
}

async function fetchThreadReplies(threadTs: string): Promise<SlackMessage[]> {
  // Access MCP function
  let getThreadReplies: any = null;
  
  if (typeof (global as any).mcp_Slack_slack_get_thread_replies === 'function') {
    getThreadReplies = (global as any).mcp_Slack_slack_get_thread_replies;
  } else if ((global as any).mcp?.Slack?.slack_get_thread_replies) {
    getThreadReplies = (global as any).mcp.Slack.slack_get_thread_replies;
  } else {
    throw new Error('Slack MCP thread function not available. Run this script in Cursor IDE.');
  }
  
  try {
    const result = await getThreadReplies({
      channel_id: CHANNEL_ID,
      thread_ts: threadTs
    });
    
    return result.messages || [];
  } catch (error: any) {
    console.error(`  ⚠ Error fetching thread ${threadTs}: ${error.message}`);
    return [];
  }
}

async function fetchAllChannelData() {
  console.log(`\n📥 Fetching All Channel Data for PM System Ingestion\n`);
  console.log(`Channel: ${CHANNEL_ID}\n`);
  
  try {
    // Read messages from file
    console.log('📖 Reading messages from file...');
    const fileContent = readFileSync(MESSAGES_FILE, 'utf-8');
    const data = JSON.parse(fileContent);
    const messages: SlackMessage[] = data.messages || [];
    console.log(`✅ Loaded ${messages.length} messages\n`);
    
    // Extract thread timestamps
    console.log('🔍 Extracting thread timestamps...');
    const threadMap = extractThreadTimestamps(messages);
    console.log(`✅ Found ${threadMap.size} threads with replies\n`);
    
    // Fetch all thread replies
    const threads: ThreadData[] = [];
    let totalReplies = 0;
    
    console.log('📥 Fetching thread replies...\n');
    let count = 0;
    for (const [threadTs, parentMessage] of threadMap.entries()) {
      count++;
      const replyCount = parentMessage.reply_count || 0;
      console.log(`[${count}/${threadMap.size}] Fetching replies for thread ${threadTs.substring(0, 10)}... (${replyCount} replies)`);
      
      const replies = await fetchThreadReplies(threadTs);
      
      // Filter out the parent message itself
      const actualReplies = replies.filter(r => r.ts !== threadTs);
      totalReplies += actualReplies.length;
      
      console.log(`  ✓ Fetched ${actualReplies.length} replies\n`);
      
      threads.push({
        threadTs: threadTs,
        parentMessage: parentMessage,
        replies: actualReplies
      });
      
      // Small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    // Prepare structured data for PM system
    const channelData: ChannelData = {
      channelId: CHANNEL_ID,
      fetchedAt: new Date().toISOString(),
      totalMessages: messages.length,
      totalThreads: threads.length,
      totalReplies: totalReplies,
      messages: messages,
      threads: threads
    };
    
    // Save complete data
    const outputFile = join(process.cwd(), `channel_${CHANNEL_ID}_complete_data.json`);
    writeFileSync(outputFile, JSON.stringify(channelData, null, 2), 'utf-8');
    console.log(`✅ Complete data saved to: ${outputFile}\n`);
    
    // Create PM-friendly format (flattened)
    const pmFormat = {
      channelId: CHANNEL_ID,
      fetchedAt: channelData.fetchedAt,
      summary: {
        totalMessages: messages.length,
        totalThreads: threads.length,
        totalReplies: totalReplies,
        totalItems: messages.length + totalReplies
      },
      items: [] as any[]
    };
    
    // Add all messages (non-threaded)
    for (const msg of messages) {
      if (!msg.thread_ts) {
        pmFormat.items.push({
          type: 'message',
          id: msg.ts,
          timestamp: msg.ts,
          date: new Date(parseFloat(msg.ts) * 1000).toISOString(),
          user: msg.user_profile?.real_name || msg.user_profile?.display_name || msg.user || 'Unknown',
          userId: msg.user,
          text: getMessageText(msg),
          isBot: !!msg.bot_id || msg.user === 'USLACKBOT',
          hasThread: false
        });
      }
    }
    
    // Add threaded messages with replies
    for (const thread of threads) {
      // Add parent message
      pmFormat.items.push({
        type: 'thread_parent',
        id: thread.threadTs,
        timestamp: thread.threadTs,
        date: new Date(parseFloat(thread.threadTs) * 1000).toISOString(),
        user: thread.parentMessage.user_profile?.real_name || 
              thread.parentMessage.user_profile?.display_name || 
              thread.parentMessage.user || 'Unknown',
        userId: thread.parentMessage.user,
        text: getMessageText(thread.parentMessage),
        isBot: !!thread.parentMessage.bot_id || thread.parentMessage.user === 'USLACKBOT',
        hasThread: true,
        replyCount: thread.replies.length,
        replies: thread.replies.map(reply => ({
          type: 'thread_reply',
          id: reply.ts,
          timestamp: reply.ts,
          date: new Date(parseFloat(reply.ts) * 1000).toISOString(),
          user: reply.user_profile?.real_name || 
                reply.user_profile?.display_name || 
                reply.user || 'Unknown',
          userId: reply.user,
          text: getMessageText(reply),
          isBot: !!reply.bot_id || reply.user === 'USLACKBOT',
          threadTs: thread.threadTs
        }))
      });
    }
    
    // Sort by timestamp (newest first)
    pmFormat.items.sort((a, b) => parseFloat(b.timestamp) - parseFloat(a.timestamp));
    
    // Save PM-friendly format
    const pmOutputFile = join(process.cwd(), `channel_${CHANNEL_ID}_pm_format.json`);
    writeFileSync(pmOutputFile, JSON.stringify(pmFormat, null, 2), 'utf-8');
    console.log(`✅ PM-friendly format saved to: ${pmOutputFile}\n`);
    
    // Create CSV export for easy import
    const csvLines = ['Type,ID,Timestamp,Date,User,UserID,Text,HasThread,ReplyCount,IsBot'];
    for (const item of pmFormat.items) {
      const text = (item.text || '').replace(/"/g, '""').replace(/\n/g, ' ').substring(0, 500);
      const type = item.type === 'thread_parent' ? 'Thread Parent' : 
                   item.type === 'thread_reply' ? 'Thread Reply' : 'Message';
      csvLines.push(`"${type}","${item.id}","${item.timestamp}","${item.date}","${item.user}","${item.userId || ''}","${text}","${item.hasThread || false}","${item.replyCount || 0}","${item.isBot || false}"`);
    }
    
    const csvFile = join(process.cwd(), `channel_${CHANNEL_ID}_export.csv`);
    writeFileSync(csvFile, csvLines.join('\n'), 'utf-8');
    console.log(`✅ CSV export saved to: ${csvFile}\n`);
    
    // Summary
    console.log(`${'='.repeat(60)}\n`);
    console.log(`📊 SUMMARY\n`);
    console.log(`Total Messages: ${messages.length}`);
    console.log(`Total Threads: ${threads.length}`);
    console.log(`Total Replies: ${totalReplies}`);
    console.log(`Total Items: ${messages.length + totalReplies}`);
    console.log(`\nFiles Created:\n`);
    console.log(`  1. ${outputFile}`);
    console.log(`  2. ${pmOutputFile}`);
    console.log(`  3. ${csvFile}`);
    console.log(`\n${'='.repeat(60)}\n`);
    
    return { channelData, pmFormat };
    
  } catch (error: any) {
    console.error(`\n❌ Error: ${error.message}`);
    console.error(error.stack);
    throw error;
  }
}

// Main execution
if (require.main === module) {
  fetchAllChannelData()
    .then(() => {
      console.log('✅ Data fetch complete\n');
      process.exit(0);
    })
    .catch(error => {
      console.error('\n❌ Fatal error:', error.message);
      process.exit(1);
    });
}

export { fetchAllChannelData };
