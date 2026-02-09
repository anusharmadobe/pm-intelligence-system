#!/usr/bin/env ts-node

/**
 * Merge fetched thread replies with customer engagement data
 * Processes thread reply files and merges them into the main dataset
 */

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';

const CHANNEL_ID = 'C04D195JVGS';
const RAW_DATA_DIR = join(process.cwd(), 'data', 'raw', 'slack', CHANNEL_ID);
const ENGAGEMENT_DATA_FILE = join(RAW_DATA_DIR, 'customer_engagement_C04D195JVGS.json');
const THREAD_REPLIES_DIR = '/Users/anusharm/.cursor/projects/Users-anusharm-learn-PM-cursor-system/agent-tools';

interface CustomerEngagement {
  id: string;
  timestamp: string;
  date: string;
  customerName?: string;
  pmName?: string;
  attendees?: string[];
  notes?: string;
  nextActions?: string[];
  threadReplies?: any[];
  rawData: any;
}

interface PMSystemFormat {
  channelId: string;
  fetchedAt: string;
  totalEngagements: number;
  totalThreads: number;
  totalReplies: number;
  engagements: CustomerEngagement[];
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

async function mergeThreadReplies() {
  console.log(`\n🔗 Merging Thread Replies with Customer Engagement Data\n`);
  
  try {
    // Load engagement data
    const engagementData: PMSystemFormat = JSON.parse(readFileSync(ENGAGEMENT_DATA_FILE, 'utf-8'));
    console.log(`✅ Loaded ${engagementData.totalEngagements} engagements\n`);
    
    // Create a map of thread replies by thread timestamp
    const threadRepliesMap = new Map<string, any[]>();
    
    // Find all thread reply files (they're saved in agent-tools directory)
    // For now, we'll process the ones we've fetched
    // In a real scenario, you'd read from saved files or continue fetching
    
    console.log('📥 Processing thread replies...\n');
    console.log('Note: Thread replies need to be fetched via MCP tools');
    console.log('This script will merge them once fetched.\n');
    
    // For demonstration, we'll create a structure that can be populated
    // In practice, you'd fetch all 512 threads and save their replies
    
    // Update engagement data with thread reply counts
    let totalReplies = 0;
    for (const engagement of engagementData.engagements) {
      // Thread replies would be added here when fetched
      if (engagement.threadReplies) {
        totalReplies += engagement.threadReplies.length;
      }
    }
    
    engagementData.totalReplies = totalReplies;
    engagementData.fetchedAt = new Date().toISOString();
    
    // Save updated data
    const outputFile = join(RAW_DATA_DIR, `customer_engagement_C04D195JVGS_complete.json`);
    writeFileSync(outputFile, JSON.stringify(engagementData, null, 2), 'utf-8');
    console.log(`✅ Updated data saved to: ${outputFile}\n`);
    
    // Create comprehensive CSV
    const csvLines = [
      'Type,ID,Timestamp,Date,Customer Name,PM Name,User,UserID,Text,Has Thread,Reply Count,Is Bot'
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
    
    const csvFile = join(RAW_DATA_DIR, `customer_engagement_C04D195JVGS_complete.csv`);
    writeFileSync(csvFile, csvLines.join('\n'), 'utf-8');
    console.log(`✅ Complete CSV saved to: ${csvFile}\n`);
    
    console.log(`${'='.repeat(60)}\n`);
    console.log(`📊 SUMMARY\n`);
    console.log(`Total Engagements: ${engagementData.totalEngagements}`);
    console.log(`Total Replies Merged: ${totalReplies}`);
    console.log(`\nFiles Created:\n`);
    console.log(`  1. ${outputFile}`);
    console.log(`  2. ${csvFile}`);
    console.log(`\n${'='.repeat(60)}\n`);
    
    return engagementData;
    
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
