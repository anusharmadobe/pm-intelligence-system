#!/usr/bin/env ts-node

/**
 * Fetch all thread replies and merge with customer engagement data
 * This script processes the thread timestamps and merges replies into engagement data
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

const CHANNEL_ID = 'C04D195JVGS';
const RAW_DATA_DIR = join(process.cwd(), 'data', 'raw', 'slack', CHANNEL_ID);
const INTERMEDIATE_DIR = join(process.cwd(), 'data', 'intermediate');
const THREAD_TIMESTAMPS_FILE = join(INTERMEDIATE_DIR, 'thread_timestamps.json');
const ENGAGEMENT_DATA_FILE = join(RAW_DATA_DIR, 'customer_engagement_C04D195JVGS.json');
const PROGRESS_FILE = join(INTERMEDIATE_DIR, 'thread_replies_progress.json');

interface ThreadProgress {
  fetched: string[];
  failed: Array<{ threadTs: string; error: string }>;
  threadReplies: Record<string, any[]>;
}

interface ThreadData {
  threadTs: string;
  replyCount: number;
  date: string;
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

function processThreadReply(reply: any, threadTs: string): any {
  // Filter out the parent message itself
  if (reply.ts === threadTs) {
    return null;
  }
  
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

async function mergeThreadReplies() {
  console.log(`\n🔗 Merging Thread Replies with Customer Engagement Data\n`);
  
  try {
    // Load thread timestamps
    const threadData: ThreadData[] = JSON.parse(readFileSync(THREAD_TIMESTAMPS_FILE, 'utf-8'));
    console.log(`📋 Found ${threadData.length} threads\n`);
    
    // Load progress if exists
    let progress: ThreadProgress = {
      fetched: [],
      failed: [],
      threadReplies: {}
    };
    
    if (existsSync(PROGRESS_FILE)) {
      progress = JSON.parse(readFileSync(PROGRESS_FILE, 'utf-8'));
      console.log(`📊 Loaded progress: ${progress.fetched.length} fetched, ${progress.failed.length} failed\n`);
    }
    
    // Load engagement data
    const engagementData = JSON.parse(readFileSync(ENGAGEMENT_DATA_FILE, 'utf-8'));
    
    // Merge thread replies with engagement data
    console.log(`🔗 Merging thread replies...\n`);
    
    let totalReplies = 0;
    for (const engagement of engagementData.engagements) {
      const replies = progress.threadReplies[engagement.id];
      if (replies && replies.length > 0) {
        engagement.threadReplies = replies;
        totalReplies += replies.length;
      }
    }
    
    engagementData.totalReplies = totalReplies;
    engagementData.fetchedAt = new Date().toISOString();
    
    // Save updated engagement data
    const outputFile = join(RAW_DATA_DIR, `customer_engagement_C04D195JVGS_complete.json`);
    writeFileSync(outputFile, JSON.stringify(engagementData, null, 2), 'utf-8');
    console.log(`✅ Complete data saved to: ${outputFile}\n`);
    
    // Create comprehensive CSV
    const csvLines = [
      'Type,ID,Timestamp,Date,Customer Name,PM Name,User,UserID,Text Preview,Has Thread,Reply Count,Is Bot'
    ];
    
    for (const eng of engagementData.engagements) {
      // Add parent engagement
      const notesPreview = (eng.notes || '').substring(0, 300).replace(/"/g, '""').replace(/\n/g, ' ');
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
    
    const csvFile = join(RAW_DATA_DIR, `customer_engagement_C04D195JVGS_complete.csv`);
    writeFileSync(csvFile, csvLines.join('\n'), 'utf-8');
    console.log(`✅ Complete CSV saved to: ${csvFile}\n`);
    
    // Summary
    console.log(`${'='.repeat(60)}\n`);
    console.log(`📊 SUMMARY\n`);
    console.log(`Total Threads: ${threadData.length}`);
    console.log(`Threads with Replies Fetched: ${progress.fetched.length}`);
    console.log(`Failed: ${progress.failed.length}`);
    console.log(`Total Replies Merged: ${totalReplies}`);
    console.log(`Total Engagements: ${engagementData.totalEngagements}`);
    console.log(`\nFiles Created:\n`);
    console.log(`  1. ${outputFile}`);
    console.log(`  2. ${csvFile}`);
    console.log(`\n${'='.repeat(60)}\n`);
    
    return { engagementData, progress };
    
  } catch (error: any) {
    console.error(`\n❌ Error: ${error.message}`);
    throw error;
  }
}

if (require.main === module) {
  mergeThreadReplies()
    .then(() => {
      console.log('✅ Merge complete\n');
      process.exit(0);
    })
    .catch(error => {
      console.error('\n❌ Fatal error:', error.message);
      process.exit(1);
    });
}

export { mergeThreadReplies, processThreadReply };
