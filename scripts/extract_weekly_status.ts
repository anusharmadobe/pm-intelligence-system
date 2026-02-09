#!/usr/bin/env ts-node

/**
 * Extract weekly status updates from Slack channel messages
 * Parses the fetched messages and identifies status update patterns
 */

import { readFileSync } from 'fs';
import { join } from 'path';

const MESSAGES_FILE = '/Users/anusharm/.cursor/projects/Users-anusharm-learn-PM-cursor-system/agent-tools/9307e169-59cc-4b62-a4df-5a60682170cd.txt';

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
    if (element.type === 'rich_text_section') {
      if (element.elements) {
        texts.push(extractTextFromElements(element.elements));
      }
    } else if (element.type === 'rich_text_list') {
      if (element.elements) {
        element.elements.forEach((item: any) => {
          if (item.elements) {
            texts.push('• ' + extractTextFromElements(item.elements));
          }
        });
      }
    } else if (element.text) {
      texts.push(element.text);
    } else if (element.type === 'text') {
      texts.push(element.text || '');
    }
  }
  
  return texts.join('').trim();
}

function isStatusUpdate(message: SlackMessage): boolean {
  // Skip system messages
  if (message.subtype) {
    return false;
  }

  const text = message.text || '';
  const lowerText = text.toLowerCase();
  
  // Keywords that indicate status updates
  const statusKeywords = [
    'this week',
    'last week',
    'next week',
    'completed',
    'in progress',
    'working on',
    'status update',
    'weekly',
    'accomplished',
    'delivered',
    'blocked',
    'challenges',
    'goals',
    'objectives',
    'key highlights',
    'summary',
    'update:',
    'status:',
    'progress'
  ];

  // Check for structured format (bullet points, numbered lists)
  const hasStructure = /^[\s]*[•\-\*]\s|^\d+\.\s|:\s*$/m.test(text);
  
  // Check for status keywords
  const hasKeywords = statusKeywords.some(keyword => lowerText.includes(keyword));
  
  // Check for longer messages (status updates are usually detailed)
  const isDetailed = text.length > 50;
  
  // Check for multiple lines (structured status updates)
  const isMultiLine = text.split('\n').length > 2;
  
  return (hasKeywords || hasStructure) && (isDetailed || isMultiLine);
}

function formatMessage(message: SlackMessage): string {
  const timestamp = new Date(parseFloat(message.ts) * 1000).toISOString();
  const userName = message.user_profile?.real_name || message.user_profile?.display_name || message.user || 'Unknown';
  
  let text = message.text || '';
  if (!text && message.blocks) {
    text = extractTextFromBlocks(message.blocks);
  }
  
  return `\n${'='.repeat(80)}
📅 Date: ${timestamp}
👤 User: ${userName}
📝 Message:
${text}
${'='.repeat(80)}`;
}

async function extractStatusUpdates() {
  console.log('\n🔍 Extracting Weekly Status Updates from Channel C043FKMNUNM\n');
  
  try {
    const fileContent = readFileSync(MESSAGES_FILE, 'utf-8');
    const data = JSON.parse(fileContent);
    const messages: SlackMessage[] = data.messages || [];
    
    console.log(`📊 Total messages analyzed: ${messages.length}\n`);
    
    // Filter for status updates
    const statusUpdates = messages.filter(isStatusUpdate);
    
    console.log(`✅ Found ${statusUpdates.length} potential status updates\n`);
    
    if (statusUpdates.length === 0) {
      console.log('⚠️  No status updates found. Trying broader search...\n');
      
      // Broader search - look for messages with "week" keyword
      const weekMessages = messages.filter(msg => {
        if (msg.subtype) return false;
        const text = (msg.text || '').toLowerCase();
        return text.includes('week') && text.length > 30;
      });
      
      console.log(`Found ${weekMessages.length} messages mentioning "week"\n`);
      weekMessages.slice(0, 10).forEach(msg => {
        console.log(formatMessage(msg));
      });
    } else {
      // Display status updates (most recent first)
      statusUpdates.forEach(msg => {
        console.log(formatMessage(msg));
      });
    }
    
    // Summary
    console.log(`\n📈 Summary:`);
    console.log(`   Total messages: ${messages.length}`);
    console.log(`   Status updates found: ${statusUpdates.length}`);
    console.log(`   Date range: ${messages.length > 0 ? new Date(parseFloat(messages[messages.length - 1].ts) * 1000).toISOString() : 'N/A'} to ${messages.length > 0 ? new Date(parseFloat(messages[0].ts) * 1000).toISOString() : 'N/A'}\n`);
    
  } catch (error: any) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

if (require.main === module) {
  extractStatusUpdates()
    .then(() => process.exit(0))
    .catch(error => {
      console.error('Fatal error:', error);
      process.exit(1);
    });
}

export { extractStatusUpdates };
