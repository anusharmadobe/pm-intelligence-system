#!/usr/bin/env ts-node

/**
 * Process fetched Slack messages and generate weekly wins summary
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
  [key: string]: any;
}

interface WeeklyWin {
  user: string;
  date: string;
  category: 'customer' | 'productivity' | 'business' | 'other';
  description: string;
  impact?: string;
  quantifiable?: string;
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
            const itemText = extractTextFromElements(item.elements);
            texts.push('• ' + itemText);
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

function getMessageText(message: SlackMessage): string {
  if (message.text) {
    return message.text;
  }
  if (message.blocks) {
    return extractTextFromBlocks(message.blocks);
  }
  return '';
}

function getWeekRange(weekOffset: number = 0): { start: Date; end: Date } {
  const now = new Date();
  const currentDay = now.getDay();
  const daysFromMonday = currentDay === 0 ? 6 : currentDay - 1;
  
  const startOfWeek = new Date(now);
  startOfWeek.setDate(now.getDate() - daysFromMonday - (weekOffset * 7));
  startOfWeek.setHours(0, 0, 0, 0);
  
  const endOfWeek = new Date(startOfWeek);
  endOfWeek.setDate(startOfWeek.getDate() + 6);
  endOfWeek.setHours(23, 59, 59, 999);
  
  return { start: startOfWeek, end: endOfWeek };
}

function isInWeekRange(timestamp: string, weekStart: Date, weekEnd: Date): boolean {
  const msgDate = new Date(parseFloat(timestamp) * 1000);
  return msgDate >= weekStart && msgDate <= weekEnd;
}

function categorizeWin(text: string): 'customer' | 'productivity' | 'business' | 'other' {
  const lowerText = text.toLowerCase();
  
  const customerKeywords = [
    'customer', 'client', 'user', 'adoption', 'satisfaction', 'feedback',
    'deployment', 'implementation', 'rollout', 'launch', 'release',
    'case study', 'testimonial', 'success story', 'win', 'forms',
    'aem', 'documentation', 'content', 'published', 'shared', 'newsletter',
    'cab', 'handed over', 'migrated', 'eds documents'
  ];
  
  const productivityKeywords = [
    'automation', 'efficiency', 'time saved', 'faster', 'streamlined',
    'process improvement', 'workflow', 'optimization', 'reduced',
    'eliminated', 'simplified', 'accelerated', 'migrated'
  ];
  
  const businessKeywords = [
    'revenue', 'cost', 'savings', 'roi', 'growth', 'increase',
    'decrease', 'percentage', '%', 'metric', 'kpi', 'goal',
    'target', 'achieved', 'exceeded', 'delivered', 'completed',
    'visibility', 'brand', 'analysed', 'analyzed', 'terminology',
    'intent', 'seo'
  ];
  
  const hasNumbers = /\d+/.test(text);
  const hasPercent = /%|\bpercent\b/i.test(text);
  
  if (customerKeywords.some(kw => lowerText.includes(kw)) && (hasNumbers || hasPercent)) {
    return 'customer';
  }
  
  if (productivityKeywords.some(kw => lowerText.includes(kw)) && (hasNumbers || hasPercent)) {
    return 'productivity';
  }
  
  if (businessKeywords.some(kw => lowerText.includes(kw)) && (hasNumbers || hasPercent)) {
    return 'business';
  }
  
  if (customerKeywords.some(kw => lowerText.includes(kw))) {
    return 'customer';
  }
  
  if (productivityKeywords.some(kw => lowerText.includes(kw))) {
    return 'productivity';
  }
  
  return 'other';
}

function extractQuantifiableImpact(text: string): string | undefined {
  const patterns = [
    /(\d+)\s*(%|percent)/gi,
    /(\d+)\s*(hours?|days?|weeks?|months?)\s*(saved|reduced|decreased|faster|improved)/gi,
    /(\d+)\s*(customers?|users?|deployments?|implementations?|documents?|pdfs?|editions?)/gi,
    /(\$|USD|dollars?)\s*(\d+[,\d]*)/gi,
    /(\d+)\s*(x|times)\s*(faster|more|less|improvement)/gi,
    /reduced\s+(by|to)\s+(\d+)/gi,
    /increased\s+(by|to)\s+(\d+)/gi,
    /january\s+(\d{4})/gi,
    /(\d{4})\s+goals?/gi,
  ];
  
  const matches: string[] = [];
  patterns.forEach(pattern => {
    const found = text.match(pattern);
    if (found) {
      matches.push(...found);
    }
  });
  
  return matches.length > 0 ? matches.join(', ') : undefined;
}

function identifyWins(messages: SlackMessage[]): WeeklyWin[] {
  const wins: WeeklyWin[] = [];
  
  for (const message of messages) {
    if (message.subtype || message.user === 'USLACKBOT') {
      continue;
    }
    
    const text = getMessageText(message);
    if (!text || text.length < 20) {
      continue;
    }
    
    const accomplishmentKeywords = [
      'completed', 'delivered', 'launched', 'released', 'deployed',
      'achieved', 'accomplished', 'finished', 'implemented', 'shipped',
      'handed over', 'published', 'created', 'built', 'developed',
      'improved', 'enhanced', 'optimized', 'migrated', 'analyzed',
      'analysed', 'shared', 'prepared', 'worked on', 'defined',
      'discussed', 'preparing', 'working on', 'incorporated', 'preparing'
    ];
    
    const hasAccomplishment = accomplishmentKeywords.some(kw => 
      text.toLowerCase().includes(kw)
    );
    
    if (!hasAccomplishment) {
      continue;
    }
    
    const category = categorizeWin(text);
    const quantifiable = extractQuantifiableImpact(text);
    
    // Prioritize wins with quantifiable impact or customer focus
    if (category === 'other' && !quantifiable) {
      continue;
    }
    
    const userName = message.user_profile?.real_name || 
                    message.user_profile?.display_name || 
                    message.user || 
                    'Unknown';
    
    const date = new Date(parseFloat(message.ts) * 1000).toISOString().split('T')[0];
    
    wins.push({
      user: userName,
      date: date,
      category: category,
      description: text.substring(0, 500),
      impact: quantifiable,
      quantifiable: quantifiable
    });
  }
  
  return wins;
}

function generateSummary(wins: WeeklyWin[], weekRange: { start: Date; end: Date }, weekLabel: string): string {
  const customerWins = wins.filter(w => w.category === 'customer');
  const productivityWins = wins.filter(w => w.category === 'productivity');
  const businessWins = wins.filter(w => w.category === 'business');
  const otherWins = wins.filter(w => w.category === 'other');
  
  let summary = `\n${'='.repeat(80)}\n`;
  summary += `📈 WEEKLY WINS SUMMARY - ${weekLabel.toUpperCase()}\n`;
  summary += `📅 Week: ${weekRange.start.toISOString().split('T')[0]} to ${weekRange.end.toISOString().split('T')[0]}\n`;
  summary += `${'='.repeat(80)}\n\n`;
  
  summary += `📊 Summary Statistics:\n`;
  summary += `   Total Wins Identified: ${wins.length}\n`;
  summary += `   Customer Wins: ${customerWins.length}\n`;
  summary += `   Productivity Wins: ${productivityWins.length}\n`;
  summary += `   Business Impact Wins: ${businessWins.length}\n`;
  summary += `   Other Wins: ${otherWins.length}\n\n`;
  
  if (customerWins.length > 0) {
    summary += `${'─'.repeat(80)}\n`;
    summary += `🎯 CUSTOMER WINS & IMPACT\n`;
    summary += `${'─'.repeat(80)}\n\n`;
    customerWins.forEach((win, idx) => {
      summary += `${idx + 1}. ${win.user} (${win.date})\n`;
      if (win.quantifiable) {
        summary += `   📊 Impact: ${win.quantifiable}\n`;
      }
      summary += `   ${win.description.substring(0, 300)}${win.description.length > 300 ? '...' : ''}\n\n`;
    });
  }
  
  if (businessWins.length > 0) {
    summary += `${'─'.repeat(80)}\n`;
    summary += `💰 BUSINESS IMPACT\n`;
    summary += `${'─'.repeat(80)}\n\n`;
    businessWins.forEach((win, idx) => {
      summary += `${idx + 1}. ${win.user} (${win.date})\n`;
      if (win.quantifiable) {
        summary += `   📊 Impact: ${win.quantifiable}\n`;
      }
      summary += `   ${win.description.substring(0, 300)}${win.description.length > 300 ? '...' : ''}\n\n`;
    });
  }
  
  if (productivityWins.length > 0) {
    summary += `${'─'.repeat(80)}\n`;
    summary += `⚡ PRODUCTIVITY IMPROVEMENTS\n`;
    summary += `${'─'.repeat(80)}\n\n`;
    productivityWins.forEach((win, idx) => {
      summary += `${idx + 1}. ${win.user} (${win.date})\n`;
      if (win.quantifiable) {
        summary += `   📊 Impact: ${win.quantifiable}\n`;
      }
      summary += `   ${win.description.substring(0, 300)}${win.description.length > 300 ? '...' : ''}\n\n`;
    });
  }
  
  if (otherWins.length > 0 && (customerWins.length + businessWins.length + productivityWins.length) < 5) {
    summary += `${'─'.repeat(80)}\n`;
    summary += `📝 OTHER NOTABLE ACHIEVEMENTS\n`;
    summary += `${'─'.repeat(80)}\n\n`;
    otherWins.slice(0, 5).forEach((win, idx) => {
      summary += `${idx + 1}. ${win.user} (${win.date})\n`;
      summary += `   ${win.description.substring(0, 300)}${win.description.length > 300 ? '...' : ''}\n\n`;
    });
  }
  
  summary += `${'='.repeat(80)}\n`;
  
  return summary;
}

async function processWeeklyWins(weekOffset: number = 0) {
  const weekRange = getWeekRange(weekOffset);
  const weekLabel = weekOffset === 0 ? 'Current Week' : 'Last Week';
  
  console.log(`\n📊 Processing ${weekLabel} Wins Summary`);
  console.log(`📅 Week: ${weekRange.start.toISOString().split('T')[0]} to ${weekRange.end.toISOString().split('T')[0]}\n`);
  
  try {
    // Read messages from file
    console.log('📥 Reading messages from file...');
    const fileContent = readFileSync(MESSAGES_FILE, 'utf-8');
    const data = JSON.parse(fileContent);
    const messages: SlackMessage[] = data.messages || [];
    console.log(`✅ Loaded ${messages.length} messages\n`);
    
    // Filter messages for the week
    const weekMessages = messages.filter(msg => 
      isInWeekRange(msg.ts, weekRange.start, weekRange.end)
    );
    
    console.log(`📅 Found ${weekMessages.length} messages in ${weekLabel}\n`);
    
    // Identify wins
    console.log('🔍 Analyzing messages for wins and impact...\n');
    const wins = identifyWins(weekMessages);
    
    // Generate summary
    const summary = generateSummary(wins, weekRange, weekLabel);
    console.log(summary);
    
    // Save to file
    const outputFile = join(process.cwd(), `weekly_wins_${weekOffset === 0 ? 'current' : 'last'}_week.txt`);
    writeFileSync(outputFile, summary, 'utf-8');
    console.log(`\n✅ Summary saved to: ${outputFile}\n`);
    
    return { wins, weekRange, weekLabel, summary };
    
  } catch (error: any) {
    console.error(`\n❌ Error: ${error.message}`);
    console.error(error.stack);
    throw error;
  }
}

// Main execution
if (require.main === module) {
  const weekOffset = process.argv[2] ? parseInt(process.argv[2]) : 0;
  
  processWeeklyWins(weekOffset)
    .then(() => {
      console.log('✅ Processing complete\n');
      process.exit(0);
    })
    .catch(error => {
      console.error('\n❌ Fatal error:', error.message);
      process.exit(1);
    });
}

export { processWeeklyWins, generateSummary };
