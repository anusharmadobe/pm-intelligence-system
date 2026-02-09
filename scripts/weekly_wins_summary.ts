#!/usr/bin/env ts-node

/**
 * Weekly Wins Summary Generator
 * Fetches messages from Slack channel for a specific week, including thread replies,
 * and generates a summary of customer wins and quantifiable business impact.
 */

import * as dotenv from 'dotenv';
dotenv.config();

const CHANNEL_ID = 'C043FKMNUNM';

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
  replies?: SlackMessage[];
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
  const currentDay = now.getDay(); // 0 = Sunday, 1 = Monday, etc.
  const daysFromMonday = currentDay === 0 ? 6 : currentDay - 1; // Convert Sunday to 6
  
  // Start of current week (Monday)
  const startOfWeek = new Date(now);
  startOfWeek.setDate(now.getDate() - daysFromMonday - (weekOffset * 7));
  startOfWeek.setHours(0, 0, 0, 0);
  
  // End of week (Sunday)
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
  
  // Customer-specific keywords
  const customerKeywords = [
    'customer', 'client', 'user', 'adoption', 'satisfaction', 'feedback',
    'deployment', 'implementation', 'rollout', 'launch', 'release',
    'case study', 'testimonial', 'success story', 'win'
  ];
  
  // Productivity keywords
  const productivityKeywords = [
    'automation', 'efficiency', 'time saved', 'faster', 'streamlined',
    'process improvement', 'workflow', 'optimization', 'reduced',
    'eliminated', 'simplified', 'accelerated'
  ];
  
  // Business impact keywords
  const businessKeywords = [
    'revenue', 'cost', 'savings', 'roi', 'growth', 'increase',
    'decrease', 'percentage', '%', 'metric', 'kpi', 'goal',
    'target', 'achieved', 'exceeded', 'delivered', 'completed'
  ];
  
  // Quantifiable patterns
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
  // Look for numbers with context
  const patterns = [
    /(\d+)\s*(%|percent)/gi,
    /(\d+)\s*(hours?|days?|weeks?|months?)\s*(saved|reduced|decreased|faster|improved)/gi,
    /(\d+)\s*(customers?|users?|deployments?|implementations?)/gi,
    /(\$|USD|dollars?)\s*(\d+[,\d]*)/gi,
    /(\d+)\s*(x|times)\s*(faster|more|less|improvement)/gi,
    /reduced\s+(by|to)\s+(\d+)/gi,
    /increased\s+(by|to)\s+(\d+)/gi,
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
    // Skip system messages
    if (message.subtype || message.user === 'USLACKBOT') {
      continue;
    }
    
    const text = getMessageText(message);
    if (!text || text.length < 20) {
      continue; // Skip very short messages
    }
    
    // Look for status updates or accomplishment indicators
    const accomplishmentKeywords = [
      'completed', 'delivered', 'launched', 'released', 'deployed',
      'achieved', 'accomplished', 'finished', 'implemented', 'shipped',
      'handed over', 'published', 'created', 'built', 'developed',
      'improved', 'enhanced', 'optimized', 'migrated', 'analyzed',
      'shared', 'prepared', 'worked on', 'defined', 'discussed'
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
      continue; // Skip generic updates without impact
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
      description: text.substring(0, 500), // Limit length
      impact: quantifiable,
      quantifiable: quantifiable
    });
  }
  
  return wins;
}

async function fetchChannelHistory(limit: number = 1000): Promise<SlackMessage[]> {
  // Access MCP function
  let getChannelHistory: any = null;
  
  if (typeof (global as any).mcp_Slack_slack_get_channel_history === 'function') {
    getChannelHistory = (global as any).mcp_Slack_slack_get_channel_history;
  } else if ((global as any).mcp?.Slack?.slack_get_channel_history) {
    getChannelHistory = (global as any).mcp.Slack.slack_get_channel_history;
  } else {
    throw new Error('Slack MCP function not available. Run this script in Cursor IDE.');
  }
  
  const result = await getChannelHistory({
    channel_id: CHANNEL_ID,
    limit: limit
  });
  
  return result.messages || [];
}

async function fetchThreadReplies(channelId: string, threadTs: string): Promise<SlackMessage[]> {
  let getThreadReplies: any = null;
  
  if (typeof (global as any).mcp_Slack_slack_get_thread_replies === 'function') {
    getThreadReplies = (global as any).mcp_Slack_slack_get_thread_replies;
  } else if ((global as any).mcp?.Slack?.slack_get_thread_replies) {
    getThreadReplies = (global as any).mcp.Slack.slack_get_thread_replies;
  } else {
    throw new Error('Slack MCP thread function not available.');
  }
  
  const result = await getThreadReplies({
    channel_id: channelId,
    thread_ts: threadTs
  });
  
  return result.messages || [];
}

async function generateWeeklyWinsSummary(weekOffset: number = 0) {
  const weekRange = getWeekRange(weekOffset);
  const weekLabel = weekOffset === 0 ? 'Current Week' : 'Last Week';
  
  console.log(`\n${'='.repeat(80)}`);
  console.log(`📊 ${weekLabel} Wins Summary`);
  console.log(`📅 Week: ${weekRange.start.toISOString().split('T')[0]} to ${weekRange.end.toISOString().split('T')[0]}`);
  console.log(`${'='.repeat(80)}\n`);
  
  try {
    // Fetch channel messages
    console.log('📥 Fetching messages from channel...');
    const messages = await fetchChannelHistory(1000);
    console.log(`✅ Fetched ${messages.length} messages\n`);
    
    // Filter messages for the week
    const weekMessages = messages.filter(msg => 
      isInWeekRange(msg.ts, weekRange.start, weekRange.end)
    );
    
    console.log(`📅 Found ${weekMessages.length} messages in ${weekLabel}\n`);
    
    // Fetch thread replies for threaded messages
    console.log('🔄 Fetching thread replies...');
    const allMessages: SlackMessage[] = [...weekMessages];
    
    for (const message of weekMessages) {
      if (message.thread_ts && message.reply_count && message.reply_count > 0) {
        try {
          const replies = await fetchThreadReplies(CHANNEL_ID, message.thread_ts);
          // Add replies that are also in the week range
          const weekReplies = replies.filter(reply => 
            reply.ts !== message.ts && // Exclude parent message
            isInWeekRange(reply.ts, weekRange.start, weekRange.end)
          );
          allMessages.push(...weekReplies);
          console.log(`  ✓ Fetched ${weekReplies.length} replies for thread ${message.ts.substring(0, 10)}...`);
        } catch (error: any) {
          console.log(`  ⚠ Could not fetch replies for thread ${message.ts}: ${error.message}`);
        }
      }
    }
    
    console.log(`\n✅ Total messages including replies: ${allMessages.length}\n`);
    
    // Identify wins
    console.log('🔍 Analyzing messages for wins and impact...\n');
    const wins = identifyWins(allMessages);
    
    // Group by category
    const customerWins = wins.filter(w => w.category === 'customer');
    const productivityWins = wins.filter(w => w.category === 'productivity');
    const businessWins = wins.filter(w => w.category === 'business');
    const otherWins = wins.filter(w => w.category === 'other');
    
    // Generate summary
    console.log(`${'='.repeat(80)}`);
    console.log(`📈 WEEKLY WINS SUMMARY - ${weekLabel.toUpperCase()}`);
    console.log(`${'='.repeat(80)}\n`);
    
    console.log(`📊 Summary Statistics:`);
    console.log(`   Total Wins Identified: ${wins.length}`);
    console.log(`   Customer Wins: ${customerWins.length}`);
    console.log(`   Productivity Wins: ${productivityWins.length}`);
    console.log(`   Business Impact Wins: ${businessWins.length}`);
    console.log(`   Other Wins: ${otherWins.length}\n`);
    
    // Customer Wins (Priority)
    if (customerWins.length > 0) {
      console.log(`${'─'.repeat(80)}`);
      console.log(`🎯 CUSTOMER WINS & IMPACT`);
      console.log(`${'─'.repeat(80)}\n`);
      customerWins.forEach((win, idx) => {
        console.log(`${idx + 1}. ${win.user} (${win.date})`);
        if (win.quantifiable) {
          console.log(`   📊 Impact: ${win.quantifiable}`);
        }
        console.log(`   ${win.description.substring(0, 200)}${win.description.length > 200 ? '...' : ''}\n`);
      });
    }
    
    // Business Impact Wins
    if (businessWins.length > 0) {
      console.log(`${'─'.repeat(80)}`);
      console.log(`💰 BUSINESS IMPACT`);
      console.log(`${'─'.repeat(80)}\n`);
      businessWins.forEach((win, idx) => {
        console.log(`${idx + 1}. ${win.user} (${win.date})`);
        if (win.quantifiable) {
          console.log(`   📊 Impact: ${win.quantifiable}`);
        }
        console.log(`   ${win.description.substring(0, 200)}${win.description.length > 200 ? '...' : ''}\n`);
      });
    }
    
    // Productivity Wins
    if (productivityWins.length > 0) {
      console.log(`${'─'.repeat(80)}`);
      console.log(`⚡ PRODUCTIVITY IMPROVEMENTS`);
      console.log(`${'─'.repeat(80)}\n`);
      productivityWins.forEach((win, idx) => {
        console.log(`${idx + 1}. ${win.user} (${win.date})`);
        if (win.quantifiable) {
          console.log(`   📊 Impact: ${win.quantifiable}`);
        }
        console.log(`   ${win.description.substring(0, 200)}${win.description.length > 200 ? '...' : ''}\n`);
      });
    }
    
    // Other Notable Wins
    if (otherWins.length > 0 && (customerWins.length + businessWins.length + productivityWins.length) < 5) {
      console.log(`${'─'.repeat(80)}`);
      console.log(`📝 OTHER NOTABLE ACHIEVEMENTS`);
      console.log(`${'─'.repeat(80)}\n`);
      otherWins.slice(0, 5).forEach((win, idx) => {
        console.log(`${idx + 1}. ${win.user} (${win.date})`);
        console.log(`   ${win.description.substring(0, 200)}${win.description.length > 200 ? '...' : ''}\n`);
      });
    }
    
    console.log(`${'='.repeat(80)}\n`);
    
    return { wins, weekRange, weekLabel };
    
  } catch (error: any) {
    console.error(`\n❌ Error generating summary: ${error.message}`);
    console.error(error.stack);
    throw error;
  }
}

// Main execution
if (require.main === module) {
  const weekOffset = process.argv[2] ? parseInt(process.argv[2]) : 0;
  
  generateWeeklyWinsSummary(weekOffset)
    .then(() => {
      console.log('✅ Summary generation complete\n');
      process.exit(0);
    })
    .catch(error => {
      console.error('\n❌ Fatal error:', error.message);
      process.exit(1);
    });
}

export { generateWeeklyWinsSummary, getWeekRange };
