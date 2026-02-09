#!/usr/bin/env ts-node

/**
 * Ingest Customer Engagement Updates from Slack Channel
 * Fetches all messages and thread replies, formats for PM system ingestion
 */

import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const CHANNEL_ID = 'C04D195JVGS';
const RAW_DATA_DIR = join(process.cwd(), 'data', 'raw', 'slack', CHANNEL_ID);
const INTERMEDIATE_DIR = join(process.cwd(), 'data', 'intermediate');
const MESSAGES_FILE = '/Users/anusharm/.cursor/projects/Users-anusharm-learn-PM-cursor-system/agent-tools/d95e9433-1c13-4020-96b4-ea2117197ce6.txt';
const THREAD_TIMESTAMPS_FILE = join(INTERMEDIATE_DIR, 'thread_timestamps.json');

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
  username?: string;
  [key: string]: any;
}

interface CustomerEngagement {
  id: string;
  timestamp: string;
  date: string;
  customerName?: string;
  pmName?: string;
  attendees?: string[];
  notes?: string;
  nextActions?: string[];
  threadReplies?: CustomerEngagement[];
  rawData: SlackMessage;
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

function getMessageText(message: SlackMessage): string {
  if (message.text) return message.text;
  if (message.blocks) return extractTextFromBlocks(message.blocks);
  return '';
}

function extractCustomerEngagementData(message: SlackMessage): Partial<CustomerEngagement> {
  const text = getMessageText(message);
  const data: Partial<CustomerEngagement> = {};
  
  // Extract customer name
  const customerMatch = text.match(/Customer Name\s*:\s*([^\n]+)/i);
  if (customerMatch) {
    data.customerName = customerMatch[1].trim();
  }
  
  // Extract PM name (usually after :new_user: emoji)
  const pmMatch = text.match(/:new_user:\s*\*([^*]+)\*/);
  if (pmMatch) {
    data.pmName = pmMatch[1].trim();
  }
  
  // Extract date
  const dateMatch = text.match(/Date\s*:\s*([^\n]+)/i);
  if (dateMatch) {
    data.date = dateMatch[1].trim();
  }
  
  // Extract attendees
  const attendeesMatch = text.match(/Attendees\s*:\s*([^\n]+)/i);
  if (attendeesMatch) {
    const attendeesText = attendeesMatch[1];
    // Extract user mentions
    const userMatches = attendeesText.match(/<@([A-Z0-9]+)>/g);
    if (userMatches) {
      data.attendees = userMatches.map(m => m.replace(/[<>@]/g, ''));
    }
  }
  
  // Extract notes (between "Notes" and "Next Action")
  const notesMatch = text.match(/Notes[\s\S]*?(?=Next Action|$)/i);
  if (notesMatch) {
    data.notes = notesMatch[0].replace(/Notes/i, '').trim();
  }
  
  // Extract next actions
  const actionsMatch = text.match(/Next Action[\s\S]*?(?:\n\n|$)/i);
  if (actionsMatch) {
    const actionsText = actionsMatch[0];
    const actionItems = actionsText.match(/•\s*([^\n]+)/g);
    if (actionItems) {
      data.nextActions = actionItems.map(a => a.replace(/^•\s*/, '').trim());
    }
  }
  
  return data;
}

function processMessage(message: SlackMessage): CustomerEngagement | null {
  // Check if this is a customer engagement update (has customer name pattern)
  const text = getMessageText(message);
  if (!text.includes('Customer Name') && !text.includes('customervivo')) {
    return null;
  }
  
  const extracted = extractCustomerEngagementData(message);
  
  return {
    id: message.ts,
    timestamp: message.ts,
    date: extracted.date || new Date(parseFloat(message.ts) * 1000).toISOString().split('T')[0],
    customerName: extracted.customerName,
    pmName: extracted.pmName,
    attendees: extracted.attendees,
    notes: extracted.notes,
    nextActions: extracted.nextActions,
    rawData: message
  };
}

function processThreadReply(message: SlackMessage): CustomerEngagement | null {
  const text = getMessageText(message);
  if (!text || text.length < 10) {
    return null;
  }
  
  return {
    id: message.ts,
    timestamp: message.ts,
    date: new Date(parseFloat(message.ts) * 1000).toISOString().split('T')[0],
    notes: text,
    rawData: message
  };
}

async function ingestCustomerEngagementData() {
  console.log(`\n📥 Ingesting Customer Engagement Data for PM System\n`);
  console.log(`Channel: ${CHANNEL_ID}\n`);
  
  try {
    // Read messages
    console.log('📖 Reading messages...');
    const fileContent = readFileSync(MESSAGES_FILE, 'utf-8');
    const data = JSON.parse(fileContent);
    const messages: SlackMessage[] = data.messages || [];
    console.log(`✅ Loaded ${messages.length} messages\n`);
    
    // Read thread timestamps
    console.log('📖 Reading thread timestamps...');
    const threadData = JSON.parse(readFileSync(THREAD_TIMESTAMPS_FILE, 'utf-8'));
    console.log(`✅ Found ${threadData.length} threads\n`);
    
    // Process main messages
    console.log('🔍 Processing customer engagement updates...');
    const engagements: CustomerEngagement[] = [];
    
    for (const msg of messages) {
      const engagement = processMessage(msg);
      if (engagement) {
        engagements.push(engagement);
      }
    }
    
    console.log(`✅ Found ${engagements.length} customer engagement updates\n`);
    
    // Fetch thread replies (this would need to be done via MCP in Cursor IDE)
    console.log('📥 Note: Thread replies need to be fetched via MCP tools in Cursor IDE');
    console.log(`   Found ${threadData.length} threads with replies\n`);
    
    // Create PM system format
    const pmFormat: PMSystemFormat = {
      channelId: CHANNEL_ID,
      fetchedAt: new Date().toISOString(),
      totalEngagements: engagements.length,
      totalThreads: threadData.length,
      totalReplies: 0, // Will be updated when replies are fetched
      engagements: engagements.sort((a, b) => parseFloat(b.timestamp) - parseFloat(a.timestamp))
    };
    
    // Save initial format
    const outputFile = join(RAW_DATA_DIR, `customer_engagement_${CHANNEL_ID}.json`);
    writeFileSync(outputFile, JSON.stringify(pmFormat, null, 2), 'utf-8');
    console.log(`✅ Initial data saved to: ${outputFile}\n`);
    
    // Create CSV export
    const csvLines = [
      'ID,Timestamp,Date,Customer Name,PM Name,Attendees,Notes Preview,Next Actions Count,Has Thread'
    ];
    
    for (const eng of pmFormat.engagements) {
      const notesPreview = (eng.notes || '').substring(0, 200).replace(/"/g, '""').replace(/\n/g, ' ');
      const attendeesStr = (eng.attendees || []).join(';');
      const actionsCount = (eng.nextActions || []).length;
      const hasThread = threadData.some((t: any) => t.threadTs === eng.timestamp);
      
      csvLines.push(
        `"${eng.id}","${eng.timestamp}","${eng.date}","${eng.customerName || ''}","${eng.pmName || ''}","${attendeesStr}","${notesPreview}","${actionsCount}","${hasThread}"`
      );
    }
    
    const csvFile = join(RAW_DATA_DIR, `customer_engagement_${CHANNEL_ID}.csv`);
    writeFileSync(csvFile, csvLines.join('\n'), 'utf-8');
    console.log(`✅ CSV export saved to: ${csvFile}\n`);
    
    // Summary
    console.log(`${'='.repeat(60)}\n`);
    console.log(`📊 SUMMARY\n`);
    console.log(`Total Messages: ${messages.length}`);
    console.log(`Customer Engagement Updates: ${engagements.length}`);
    console.log(`Threads with Replies: ${threadData.length}`);
    console.log(`\nFiles Created:\n`);
    console.log(`  1. ${outputFile}`);
    console.log(`  2. ${csvFile}`);
    console.log(`\n${'='.repeat(60)}\n`);
    console.log(`\n⚠️  NOTE: To fetch thread replies, use MCP tools in Cursor IDE:\n`);
    console.log(`  Use: mcp_Slack_slack_get_thread_replies`);
    console.log(`  For each thread timestamp in: ${THREAD_TIMESTAMPS_FILE}\n`);
    
    return pmFormat;
    
  } catch (error: any) {
    console.error(`\n❌ Error: ${error.message}`);
    throw error;
  }
}

if (require.main === module) {
  ingestCustomerEngagementData()
    .then(() => {
      console.log('✅ Data ingestion complete\n');
      process.exit(0);
    })
    .catch(error => {
      console.error('\n❌ Fatal error:', error.message);
      process.exit(1);
    });
}

export { ingestCustomerEngagementData, processMessage, processThreadReply };
