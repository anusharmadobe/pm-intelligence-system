#!/usr/bin/env ts-node

/**
 * Fetch all thread replies and merge with customer engagement data
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

const CHANNEL_ID = 'C04D195JVGS';
const RAW_DATA_DIR = join(process.cwd(), 'data', 'raw', 'slack', CHANNEL_ID);
const INTERMEDIATE_DIR = join(process.cwd(), 'data', 'intermediate');
const THREAD_TIMESTAMPS_FILE = join(INTERMEDIATE_DIR, 'thread_timestamps.json');
const ENGAGEMENT_DATA_FILE = join(RAW_DATA_DIR, `customer_engagement_${CHANNEL_ID}.json`);
const PROGRESS_FILE = join(INTERMEDIATE_DIR, 'thread_replies_progress.json');

interface ThreadProgress {
  fetched: string[];
  failed: Array<{ threadTs: string; error: string }>;
  lastFetchedIndex: number;
}

interface ThreadData {
  threadTs: string;
  replyCount: number;
  date: string;
}

async function fetchThreadReplies(threadTs: string): Promise<any[]> {
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
    throw new Error(`Error fetching thread ${threadTs}: ${error.message}`);
  }
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

function getMessageText(message: any): string {
  if (message.text) return message.text;
  if (message.blocks) return extractTextFromBlocks(message.blocks);
  return '';
}

async function fetchAllThreadReplies() {
  console.log(`\n📥 Fetching All Thread Replies\n`);
  console.log(`Channel: ${CHANNEL_ID}\n`);
  
  try {
    // Load thread timestamps
    const threadData: ThreadData[] = JSON.parse(readFileSync(THREAD_TIMESTAMPS_FILE, 'utf-8'));
    console.log(`📋 Found ${threadData.length} threads to fetch\n`);
    
    // Load progress if exists
    let progress: ThreadProgress = {
      fetched: [],
      failed: [],
      lastFetchedIndex: -1
    };
    
    if (existsSync(PROGRESS_FILE)) {
      progress = JSON.parse(readFileSync(PROGRESS_FILE, 'utf-8'));
      console.log(`📊 Resuming from index ${progress.lastFetchedIndex + 1}`);
      console.log(`   Already fetched: ${progress.fetched.length}`);
      console.log(`   Failed: ${progress.failed.length}\n`);
    }
    
    // Load engagement data
    const engagementData = JSON.parse(readFileSync(ENGAGEMENT_DATA_FILE, 'utf-8'));
    const threadRepliesMap = new Map<string, any[]>();
    
    // Fetch thread replies
    let totalReplies = 0;
    const startIndex = progress.lastFetchedIndex + 1;
    
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
        totalReplies += actualReplies.length;
        
        // Process replies
        const processedReplies = actualReplies.map(reply => ({
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
        }));
        
        threadRepliesMap.set(threadTs, processedReplies);
        
        console.log(`  ✓ Fetched ${actualReplies.length} replies\n`);
        
        // Update progress
        progress.fetched.push(threadTs);
        progress.lastFetchedIndex = i;
        
        // Save progress every 10 threads
        if ((i + 1) % 10 === 0) {
          writeFileSync(PROGRESS_FILE, JSON.stringify(progress, null, 2), 'utf-8');
          console.log(`💾 Progress saved (${i + 1}/${threadData.length})\n`);
        }
        
        // Small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 150));
        
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
    
    // Save final progress
    writeFileSync(PROGRESS_FILE, JSON.stringify(progress, null, 2), 'utf-8');
    
    // Merge thread replies with engagement data
    console.log(`\n🔗 Merging thread replies with engagement data...\n`);
    
    for (const engagement of engagementData.engagements) {
      const replies = threadRepliesMap.get(engagement.id);
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
    
    // Create updated CSV
    const csvLines = [
      'ID,Timestamp,Date,Customer Name,PM Name,Attendees,Notes Preview,Next Actions Count,Has Thread,Reply Count'
    ];
    
    for (const eng of engagementData.engagements) {
      const notesPreview = (eng.notes || '').substring(0, 200).replace(/"/g, '""').replace(/\n/g, ' ');
      const attendeesStr = (eng.attendees || []).join(';');
      const actionsCount = (eng.nextActions || []).length;
      const replyCount = (eng.threadReplies || []).length;
      
      csvLines.push(
        `"${eng.id}","${eng.timestamp}","${eng.date}","${eng.customerName || ''}","${eng.pmName || ''}","${attendeesStr}","${notesPreview}","${actionsCount}","${replyCount > 0}","${replyCount}"`
      );
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
