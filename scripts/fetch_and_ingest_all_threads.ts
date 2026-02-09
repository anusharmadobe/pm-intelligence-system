#!/usr/bin/env ts-node

/**
 * Complete script to fetch all thread replies and ingest them into the PM Intelligence System
 * This script:
 * 1. Fetches thread replies for all threads using MCP tools
 * 2. Ingests them into the database via API
 * 3. Handles progress/resumption
 * 4. Provides comprehensive logging
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

const CHANNEL_ID = 'C04D195JVGS';
const INTERMEDIATE_DIR = join(process.cwd(), 'data', 'intermediate');
const THREAD_TIMESTAMPS_FILE = join(INTERMEDIATE_DIR, 'thread_timestamps.json');
const PROGRESS_FILE = join(INTERMEDIATE_DIR, 'thread_ingestion_progress.json');
const API_BASE = process.env.API_BASE || 'http://localhost:3000';

interface ThreadProgress {
  fetched: string[];
  ingested: string[];
  failed: Array<{ threadTs: string; error: string }>;
  lastFetchedIndex: number;
  lastIngestedIndex: number;
  totalRepliesFetched: number;
  totalRepliesIngested: number;
  threadReplies?: Record<string, SlackMessage[]>;
}

interface ThreadData {
  threadTs: string;
  replyCount: number;
  date: string;
}

interface SlackMessage {
  ts: string;
  text?: string;
  user?: string;
  user_profile?: {
    real_name?: string;
    display_name?: string;
  };
  blocks?: any[];
  bot_id?: string;
  thread_ts?: string;
  [key: string]: any;
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

function getMessageText(message: SlackMessage): string {
  if (message.text) return message.text;
  if (message.blocks) return extractTextFromBlocks(message.blocks);
  return '';
}

async function fetchThreadReplies(threadTs: string): Promise<SlackMessage[]> {
  // Access MCP function - this will only work in Cursor IDE context
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
    throw new Error(`Error fetching thread ${threadTs}: ${error.message}`);
  }
}

async function ingestReplyViaAPI(reply: SlackMessage, threadTs: string): Promise<boolean> {
  const text = getMessageText(reply);
  
  // Skip empty messages or bot messages
  if (!text || text.length < 3 || reply.bot_id || reply.user === 'USLACKBOT') {
    return false;
  }
  
  try {
    const response = await fetch(`${API_BASE}/api/signals`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source: 'slack',
        id: reply.ts,
        type: 'message',
        text: text,
        metadata: {
          channel_id: CHANNEL_ID,
          user: reply.user,
          user_name: reply.user_profile?.real_name || reply.user_profile?.display_name || 'Unknown',
          timestamp: reply.ts,
          thread_ts: threadTs,
          is_thread_reply: true,
          parent_thread: threadTs
        }
      })
    });
    
    if (response.ok) {
      return true;
    } else {
      const error = await response.json();
      // Ignore duplicate errors
      if (error.error?.includes('duplicate') || error.error?.includes('already exists')) {
        return true; // Count as success
      }
      throw new Error(error.error || `HTTP ${response.status}`);
    }
  } catch (error: any) {
    throw new Error(`Ingestion failed: ${error.message}`);
  }
}

async function fetchAndIngestAllThreads() {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`📥 Fetching and Ingesting All Thread Replies`);
  console.log(`${'='.repeat(60)}\n`);
  console.log(`Channel: ${CHANNEL_ID}`);
  console.log(`API Base: ${API_BASE}\n`);
  
  try {
    // Load thread timestamps
    console.log('📖 Loading thread timestamps...');
    const threadData: ThreadData[] = JSON.parse(readFileSync(THREAD_TIMESTAMPS_FILE, 'utf-8'));
    console.log(`✅ Found ${threadData.length} threads to process\n`);
    
    // Load or initialize progress
    let progress: ThreadProgress = {
      fetched: [],
      ingested: [],
      failed: [],
      lastFetchedIndex: -1,
      lastIngestedIndex: -1,
      totalRepliesFetched: 0,
      totalRepliesIngested: 0
    };
    
    if (existsSync(PROGRESS_FILE)) {
      progress = JSON.parse(readFileSync(PROGRESS_FILE, 'utf-8'));
      console.log(`📊 Resuming from previous session:`);
      console.log(`   Threads fetched: ${progress.fetched.length}`);
      console.log(`   Threads ingested: ${progress.ingested.length}`);
      console.log(`   Replies fetched: ${progress.totalRepliesFetched}`);
      console.log(`   Replies ingested: ${progress.totalRepliesIngested}`);
      console.log(`   Failed: ${progress.failed.length}\n`);
    }
    
    const startIndex = Math.max(progress.lastFetchedIndex + 1, 0);
    const BATCH_SIZE = 10;
    const INGEST_BATCH_SIZE = 50;
    
    console.log(`🚀 Starting from thread ${startIndex + 1} of ${threadData.length}\n`);
    
    // Phase 1: Fetch all thread replies
    console.log(`${'='.repeat(60)}`);
    console.log(`PHASE 1: Fetching Thread Replies`);
    console.log(`${'='.repeat(60)}\n`);
    
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
        
        // Filter out the parent message itself
        const actualReplies = replies.filter(r => r.ts !== threadTs);
        progress.totalRepliesFetched += actualReplies.length;
        
        // Store replies in progress (we'll ingest them in phase 2)
        if (!progress.threadReplies) {
          progress.threadReplies = {};
        }
        progress.threadReplies[threadTs] = actualReplies;
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
        console.error(`  ⚠ Error: ${error.message}\n`);
        progress.failed.push({
          threadTs: threadTs,
          error: error.message
        });
        progress.lastFetchedIndex = i;
        
        // Save progress on error too
        writeFileSync(PROGRESS_FILE, JSON.stringify(progress, null, 2), 'utf-8');
        
        // Continue with next thread
        continue;
      }
    }
    
    // Save final fetch progress
    writeFileSync(PROGRESS_FILE, JSON.stringify(progress, null, 2), 'utf-8');
    console.log(`\n✅ Phase 1 complete: Fetched ${progress.totalRepliesFetched} replies from ${progress.fetched.length} threads\n`);
    
    // Phase 2: Ingest all fetched replies
    console.log(`${'='.repeat(60)}`);
    console.log(`PHASE 2: Ingesting Replies into Database`);
    console.log(`${'='.repeat(60)}\n`);
    
    let ingestedCount = 0;
    let skippedCount = 0;
    let errorCount = 0;
    
    for (let i = 0; i < threadData.length; i++) {
      const thread = threadData[i];
      const threadTs = thread.threadTs;
      
      // Skip if not fetched or already ingested
      if (!progress.fetched.includes(threadTs)) {
        continue;
      }
      
      if (progress.ingested.includes(threadTs)) {
        continue;
      }
      
      const replies = progress.threadReplies?.[threadTs] || [];
      if (replies.length === 0) {
        progress.ingested.push(threadTs);
        progress.lastIngestedIndex = i;
        continue;
      }
      
      console.log(`[${i + 1}/${threadData.length}] Ingesting ${replies.length} replies from thread ${threadTs.substring(0, 10)}...`);
      
      let threadIngested = 0;
      let threadSkipped = 0;
      let threadErrors = 0;
      
      for (const reply of replies) {
        try {
          const success = await ingestReplyViaAPI(reply, threadTs);
          if (success) {
            threadIngested++;
            ingestedCount++;
            progress.totalRepliesIngested++;
          } else {
            threadSkipped++;
            skippedCount++;
          }
        } catch (error: any) {
          threadErrors++;
          errorCount++;
          console.error(`    ⚠ Failed to ingest reply ${reply.ts}: ${error.message}`);
        }
        
        // Small delay between API calls
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      
      progress.ingested.push(threadTs);
      progress.lastIngestedIndex = i;
      
      console.log(`  ✓ Ingested: ${threadIngested}, Skipped: ${threadSkipped}, Errors: ${threadErrors}\n`);
      
      // Save progress every INGEST_BATCH_SIZE threads
      if ((i + 1) % INGEST_BATCH_SIZE === 0) {
        writeFileSync(PROGRESS_FILE, JSON.stringify(progress, null, 2), 'utf-8');
        console.log(`💾 Ingestion progress saved (${i + 1}/${threadData.length})\n`);
      }
    }
    
    // Save final progress
    writeFileSync(PROGRESS_FILE, JSON.stringify(progress, null, 2), 'utf-8');
    
    // Final summary
    console.log(`\n${'='.repeat(60)}`);
    console.log(`📊 FINAL SUMMARY`);
    console.log(`${'='.repeat(60)}\n`);
    console.log(`Total Threads: ${threadData.length}`);
    console.log(`Threads Fetched: ${progress.fetched.length}`);
    console.log(`Threads Ingested: ${progress.ingested.length}`);
    console.log(`Total Replies Fetched: ${progress.totalRepliesFetched}`);
    console.log(`Total Replies Ingested: ${progress.totalRepliesIngested}`);
    console.log(`Skipped (empty/bot): ${skippedCount}`);
    console.log(`Errors: ${errorCount}`);
    console.log(`Failed Threads: ${progress.failed.length}`);
    console.log(`\nProgress saved to: ${PROGRESS_FILE}\n`);
    
    if (progress.failed.length > 0) {
      console.log(`\n⚠️  Failed Threads (${progress.failed.length}):\n`);
      progress.failed.slice(0, 10).forEach((f, idx) => {
        console.log(`  ${idx + 1}. ${f.threadTs}: ${f.error}`);
      });
      if (progress.failed.length > 10) {
        console.log(`  ... and ${progress.failed.length - 10} more`);
      }
      console.log();
    }
    
    return { progress, ingestedCount, skippedCount, errorCount };
    
  } catch (error: any) {
    console.error(`\n❌ Fatal error: ${error.message}`);
    console.error(error.stack);
    throw error;
  }
}

if (require.main === module) {
  fetchAndIngestAllThreads()
    .then((result) => {
      console.log(`\n✅ Process complete!`);
      console.log(`   Ingested: ${result.ingestedCount} replies`);
      console.log(`   Skipped: ${result.skippedCount} replies`);
      console.log(`   Errors: ${result.errorCount} replies\n`);
      process.exit(0);
    })
    .catch(error => {
      console.error('\n❌ Fatal error:', error.message);
      process.exit(1);
    });
}

export { fetchAndIngestAllThreads };
