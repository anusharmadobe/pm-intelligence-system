#!/usr/bin/env ts-node

/**
 * Extract reminder thread timestamps and analyze their replies
 * This script extracts thread_ts values from the messages file and prepares them for fetching
 */

import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const MESSAGES_FILE = '/Users/anusharm/.cursor/projects/Users-anusharm-learn-PM-cursor-system/agent-tools/1733d34a-9624-4ef6-93ea-b7796f832e13.txt';

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
    }
  }
  return texts.join('').trim();
}

function getMessageText(message: SlackMessage): string {
  if (message.text) return message.text;
  if (message.blocks) return extractTextFromBlocks(message.blocks);
  return '';
}

// Extract all reminder thread timestamps
function extractReminderThreads(messages: SlackMessage[]): Array<{ threadTs: string; replyCount: number; date: string }> {
  const reminderPatterns = [
    /weekly status updates/i,
    /your top wins for this week and impact created/i
  ];
  
  const threads: Array<{ threadTs: string; replyCount: number; date: string }> = [];
  const seen = new Set<string>();
  
  for (const msg of messages) {
    const text = getMessageText(msg);
    const isReminder = reminderPatterns.some(pattern => pattern.test(text));
    
    if (isReminder && 
        (msg.bot_id === 'B01' || msg.user === 'USLACKBOT') &&
        msg.thread_ts &&
        msg.reply_count && 
        msg.reply_count > 0 &&
        !seen.has(msg.thread_ts)) {
      
      seen.add(msg.thread_ts);
      threads.push({
        threadTs: msg.thread_ts,
        replyCount: msg.reply_count,
        date: new Date(parseFloat(msg.thread_ts) * 1000).toISOString().split('T')[0]
      });
    }
  }
  
  // Sort by date (newest first)
  threads.sort((a, b) => b.threadTs.localeCompare(a.threadTs));
  
  return threads;
}

async function extractThreadTimestamps() {
  console.log('\n📊 Extracting Reminder Thread Timestamps\n');
  
  try {
    const fileContent = readFileSync(MESSAGES_FILE, 'utf-8');
    const data = JSON.parse(fileContent);
    const messages: SlackMessage[] = data.messages || [];
    
    console.log(`✅ Loaded ${messages.length} messages\n`);
    
    const threads = extractReminderThreads(messages);
    
    console.log(`📋 Found ${threads.length} reminder threads with replies\n`);
    
    // Display threads
    threads.forEach((thread, idx) => {
      console.log(`${idx + 1}. Thread ${thread.threadTs} (${thread.date}) - ${thread.replyCount} replies`);
    });
    
    // Save to file for use in analysis script
    const outputFile = join(process.cwd(), 'reminder_threads.json');
    writeFileSync(outputFile, JSON.stringify(threads, null, 2), 'utf-8');
    console.log(`\n✅ Thread timestamps saved to: ${outputFile}\n`);
    
    return threads;
    
  } catch (error: any) {
    console.error(`\n❌ Error: ${error.message}`);
    throw error;
  }
}

if (require.main === module) {
  extractThreadTimestamps()
    .then(() => {
      console.log('✅ Extraction complete\n');
      process.exit(0);
    })
    .catch(error => {
      console.error('\n❌ Fatal error:', error.message);
      process.exit(1);
    });
}

export { extractReminderThreads };
