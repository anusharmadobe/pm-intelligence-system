#!/usr/bin/env ts-node

/**
 * Weekly Wins Summary with Thread Replies
 * Includes thread replies data for comprehensive analysis
 */

import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

// Thread replies for weekly status update thread (fetched via MCP)
const STATUS_THREAD_REPLIES = [
  {
    "user": "U0900H3NUUT",
    "ts": "1769055784.412839",
    "text": "Handed over the designs for:\n• Dynamic Tables\n• Associate UI (Content Editing, Rearranging content, Workflow )\nHad a discussion with Devs for stylesheet UIs, understood some gaps, working on them, where defining the creation journey of stylesheet.\n Working on Deck, defined the examples for each patterns including  AEM Forms & AEP AI Agent.",
    "user_profile": {
      "real_name": "Utkarsha Sharma",
      "display_name": "utkarshas"
    }
  },
  {
    "user": "U03HRQ036BD",
    "ts": "1769144888.924279",
    "text": "*Ruchita (leave on 16 Jan)*\n• *AEM Forms as a Cloud Service*\n    ◦ Migrating content from EXL to AEM Live for EDS documents\n    ◦ Worked on January release notes and early access features\n• *AEM Forms 6.5 LTS*\n    ◦ Worked with Bhumika on publishing Install Turnkey and Upgrade Turnkey PDFs\n• *AEM Forms 6.5*\n    ◦ Worked on Transaction Reporting on JEE (added note)\n• *Miscellaneous*\n    ◦ Defined goals for 2026 with Khushwant\n    ◦ Working on the SEO checklist\n    ◦ Working on the first draft PoC of Agent Draft (to be shared with Khushwant soon)",
    "user_profile": {
      "real_name": "Ruchita Srivastava",
      "display_name": "ruchitas"
    }
  },
  {
    "user": "WAM5KDYBZ",
    "ts": "1769162564.412539",
    "text": "• Shared the 2026 goals for the Forms Content Experience team with Anurag.\n• Preparing an overview deck of the AEM Forms Content Experience team's key activities in 2025 and plans for 2026 for leadership meetings. \t\n• Analysed AEM Forms brand visibility for \"Forms Builder\" intent. \n• Analysed \"DoR\" terminology for visibility and customer intent perspective.  This part of activity to rename *Feature and terminology* to match how customers search and describe problems.  \n• Preparing the January 2026 edition of the CAB Newsletter. \t\n• Incorporating customer feedback into Core Components content.\n• Discussed AI UX Patterns deck's outline with Utkarsha. She is developing the deck.",
    "user_profile": {
      "real_name": "Khushwant Singh",
      "display_name": "khsingh"
    }
  }
];

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
    'cab', 'handed over', 'migrated', 'eds documents', 'customer feedback',
    'core components', 'designs', 'ui', 'patterns'
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
    'intent', 'seo', 'brand visibility', 'leadership'
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
    /(\d{4})\s+edition/gi,
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
      'discussed', 'preparing', 'working on', 'incorporating',
      'migrating', 'worked with'
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
      summary += `   ${win.description.substring(0, 400)}${win.description.length > 400 ? '...' : ''}\n\n`;
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
      summary += `   ${win.description.substring(0, 400)}${win.description.length > 400 ? '...' : ''}\n\n`;
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
      summary += `   ${win.description.substring(0, 400)}${win.description.length > 400 ? '...' : ''}\n\n`;
    });
  }
  
  if (otherWins.length > 0 && (customerWins.length + businessWins.length + productivityWins.length) < 5) {
    summary += `${'─'.repeat(80)}\n`;
    summary += `📝 OTHER NOTABLE ACHIEVEMENTS\n`;
    summary += `${'─'.repeat(80)}\n\n`;
    otherWins.slice(0, 5).forEach((win, idx) => {
      summary += `${idx + 1}. ${win.user} (${win.date})\n`;
      summary += `   ${win.description.substring(0, 400)}${win.description.length > 400 ? '...' : ''}\n\n`;
    });
  }
  
  summary += `${'='.repeat(80)}\n`;
  
  return summary;
}

async function processWeeklyWinsWithThreads(weekOffset: number = 0) {
  const weekRange = getWeekRange(weekOffset);
  const weekLabel = weekOffset === 0 ? 'Current Week' : 'Last Week';
  
  console.log(`\n📊 Processing ${weekLabel} Wins Summary`);
  console.log(`📅 Week: ${weekRange.start.toISOString().split('T')[0]} to ${weekRange.end.toISOString().split('T')[0]}\n`);
  
  try {
    // Read messages from file
    console.log('📥 Reading messages from file...');
    const messagesFile = '/Users/anusharm/.cursor/projects/Users-anusharm-learn-PM-cursor-system/agent-tools/1733d34a-9624-4ef6-93ea-b7796f832e13.txt';
    const fileContent = readFileSync(messagesFile, 'utf-8');
    const data = JSON.parse(fileContent);
    const messages: SlackMessage[] = data.messages || [];
    console.log(`✅ Loaded ${messages.length} messages\n`);
    
    // Filter messages for the week
    const weekMessages = messages.filter(msg => 
      isInWeekRange(msg.ts, weekRange.start, weekRange.end)
    );
    
    // Add thread replies for current week
    const allMessages = [...weekMessages];
    if (weekOffset === 0) {
      // Add status thread replies for current week
      STATUS_THREAD_REPLIES.forEach(reply => {
        if (isInWeekRange(reply.ts, weekRange.start, weekRange.end)) {
          allMessages.push(reply as SlackMessage);
        }
      });
    }
    
    console.log(`📅 Found ${weekMessages.length} main messages + ${allMessages.length - weekMessages.length} thread replies = ${allMessages.length} total in ${weekLabel}\n`);
    
    // Identify wins
    console.log('🔍 Analyzing messages for wins and impact...\n');
    const wins = identifyWins(allMessages);
    
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
  
  processWeeklyWinsWithThreads(weekOffset)
    .then(() => {
      console.log('✅ Processing complete\n');
      process.exit(0);
    })
    .catch(error => {
      console.error('\n❌ Fatal error:', error.message);
      process.exit(1);
    });
}

export { processWeeklyWinsWithThreads, generateSummary };
