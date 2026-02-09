#!/usr/bin/env ts-node

/**
 * Weekly Wins Summary Generator (MCP Version)
 * Uses MCP tools directly to fetch and analyze messages
 */

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
  
  const customerKeywords = [
    'customer', 'client', 'user', 'adoption', 'satisfaction', 'feedback',
    'deployment', 'implementation', 'rollout', 'launch', 'release',
    'case study', 'testimonial', 'success story', 'win', 'forms',
    'aem', 'documentation', 'content', 'published', 'shared'
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
    'visibility', 'brand', 'analysed', 'analyzed'
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
    /(\d+)\s*(customers?|users?|deployments?|implementations?|documents?|pdfs?)/gi,
    /(\$|USD|dollars?)\s*(\d+[,\d]*)/gi,
    /(\d+)\s*(x|times)\s*(faster|more|less|improvement)/gi,
    /reduced\s+(by|to)\s+(\d+)/gi,
    /increased\s+(by|to)\s+(\d+)/gi,
    /(\d+)\s*(edition|version|release|newsletter)/gi,
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
      'discussed', 'preparing', 'working on', 'incorporated'
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

async function generateWeeklyWinsSummary(weekOffset: number = 0) {
  const weekRange = getWeekRange(weekOffset);
  const weekLabel = weekOffset === 0 ? 'Current Week' : 'Last Week';
  
  console.log(`\n${'='.repeat(80)}`);
  console.log(`📊 ${weekLabel} Wins Summary`);
  console.log(`📅 Week: ${weekRange.start.toISOString().split('T')[0]} to ${weekRange.end.toISOString().split('T')[0]}`);
  console.log(`${'='.repeat(80)}\n`);
  
  // Note: This script expects messages to be passed or fetched externally
  // In Cursor IDE context, MCP tools would be used
  console.log('⚠️  This script needs to be run in Cursor IDE with MCP access');
  console.log('   Or messages need to be provided via file input\n');
  
  return { weekRange, weekLabel };
}

// Export for use in other scripts
export { generateWeeklyWinsSummary, getWeekRange, identifyWins, categorizeWin, extractQuantifiableImpact };
