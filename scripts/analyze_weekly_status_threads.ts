#!/usr/bin/env ts-node

/**
 * Analyze Weekly Status Update Thread Replies for Wins
 * Finds all Slackbot reminders and analyzes their thread replies
 */

import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const CHANNEL_ID = 'C043FKMNUNM';
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

interface WeeklyWin {
  user: string;
  date: string;
  category: 'customer' | 'productivity' | 'business' | 'other';
  description: string;
  customerName?: string;
  quantifiable?: string;
  businessImpact?: string;
  confidence: 'high' | 'medium' | 'low';
  threadDate?: string;
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

function extractCustomerName(text: string): string | undefined {
  // Look for customer names - common patterns
  const patterns = [
    /(?:for|with|at|to)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\s+(?:customer|client|company|enterprise|organization)/i,
    /(?:customer|client)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/i,
    /([A-Z][A-Z]+)\s+(?:deployment|implementation|rollout|launch)/i,
    /(?:deployed|launched|shipped|delivered)\s+(?:to|for)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/i,
    /(?:customer|client)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\s+(?:feedback|request|issue|project)/i,
  ];
  
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      const name = match[1].trim();
      // Filter out common false positives
      const falsePositives = ['AEM', 'Forms', 'Cloud', 'Service', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December', 'EDS', 'EXL', 'JEE', 'LTS'];
      if (!falsePositives.includes(name)) {
        return name;
      }
    }
  }
  
  return undefined;
}

function extractQuantifiableMetrics(text: string): { metrics: string; hasRealNumbers: boolean } {
  // Look for REAL metrics, not just dates
  const realMetricPatterns = [
    /(\d+)\s*(%|percent)\s*(?:increase|decrease|improvement|growth|reduction|savings|adoption|usage)/gi,
    /(\d+)\s*(?:hours?|days?|weeks?|months?)\s*(?:saved|reduced|decreased|faster|improved|cut|eliminated)/gi,
    /(\$|USD)\s*(\d+[,\d]*)\s*(?:saved|revenue|cost|reduction|savings)/gi,
    /(\d+)\s*(?:customers?|users?|deployments?|implementations?|adoptions?|organizations?)\s*(?:added|gained|onboarded|launched|migrated)/gi,
    /(\d+)\s*(?:x|times)\s*(?:faster|more|less|improvement|increase)/gi,
    /reduced\s+(?:by|to)\s+(\d+)\s*(?:%|hours?|days?|cost)/gi,
    /increased\s+(?:by|to)\s+(\d+)\s*(?:%|users?|customers?|revenue|adoption)/gi,
    /(\d+)\s*(?:million|billion|k|thousand)\s*(?:users?|customers?|revenue|dollars?)/gi,
    /(\d+)\s*(?:documents?|articles?|pdfs?|pages?|features?)\s*(?:published|created|migrated|completed)/gi,
  ];
  
  const matches: string[] = [];
  let hasRealNumbers = false;
  
  realMetricPatterns.forEach(pattern => {
    const found = text.match(pattern);
    if (found) {
      matches.push(...found);
      found.forEach(match => {
        const numMatch = match.match(/\d+/);
        if (numMatch) {
          const num = parseInt(numMatch[0]);
          // Exclude years (1900-2100 range) unless they're clearly part of a metric
          if (num < 1900 || num > 2100 || match.includes('%') || match.includes('$') || match.includes('hours') || match.includes('days') || match.includes('x') || match.includes('times')) {
            hasRealNumbers = true;
          }
        }
      });
    }
  });
  
  return {
    metrics: matches.length > 0 ? matches.join(', ') : '',
    hasRealNumbers: hasRealNumbers
  };
}

function hasBusinessImpact(text: string): boolean {
  const lowerText = text.toLowerCase();
  
  // Strong impact indicators
  const impactKeywords = [
    'launched', 'deployed', 'shipped', 'released', 'delivered', 'completed',
    'achieved', 'exceeded', 'closed', 'signed', 'won', 'adopted',
    'revenue', 'cost savings', 'time saved', 'efficiency', 'productivity',
    'customer success', 'adoption', 'usage', 'growth', 'increase',
    'reduced', 'eliminated', 'solved', 'resolved', 'fixed', 'published',
    'migrated', 'handed over', 'shared', 'incorporated'
  ];
  
  // Weak indicators (routine work) - but allow if combined with impact keywords
  const routineKeywords = [
    'working on', 'preparing', 'discussing', 'planning', 'analyzing',
    'reviewing', 'drafting', 'defining', 'exploring'
  ];
  
  const hasImpact = impactKeywords.some(kw => lowerText.includes(kw));
  const isRoutine = routineKeywords.some(kw => lowerText.includes(kw)) && !hasImpact;
  
  return hasImpact && !isRoutine;
}

function identifyWins(messages: SlackMessage[], threadDate?: string): WeeklyWin[] {
  const wins: WeeklyWin[] = [];
  
  for (const message of messages) {
    // Skip bot messages and system messages
    if (message.subtype || message.user === 'USLACKBOT' || message.bot_id) {
      continue;
    }
    
    const text = getMessageText(message);
    if (!text || text.length < 30) {
      continue; // Need substantial content
    }
    
    // Skip simple acknowledgments
    if (text.toLowerCase().match(/^(thanks|thank you|appreciate|good|nice|great)$/i)) {
      continue;
    }
    
    // REQUIREMENT 1: Must have completion/shipment language
    const completionKeywords = [
      'launched', 'deployed', 'shipped', 'released', 'delivered', 'completed',
      'achieved', 'exceeded', 'closed', 'signed', 'won', 'adopted',
      'handed over', 'published', 'migrated', 'implemented', 'shared',
      'incorporated', 'worked on', 'prepared', 'created', 'built'
    ];
    
    const hasCompletion = completionKeywords.some(kw => 
      text.toLowerCase().includes(kw)
    );
    
    if (!hasCompletion) {
      continue;
    }
    
    // REQUIREMENT 2: Must have business impact
    if (!hasBusinessImpact(text)) {
      continue;
    }
    
    // REQUIREMENT 3: Extract customer name (if present)
    const customerName = extractCustomerName(text);
    
    // REQUIREMENT 4: Extract REAL quantifiable metrics
    const metrics = extractQuantifiableMetrics(text);
    
    // REQUIREMENT 5: Determine confidence level
    let confidence: 'high' | 'medium' | 'low' = 'low';
    
    if (customerName && metrics.hasRealNumbers) {
      confidence = 'high';
    } else if (customerName || metrics.hasRealNumbers) {
      confidence = 'medium';
    } else {
      // Even without customer name or metrics, if it's a clear completion with impact, it's medium
      if (hasCompletion && hasBusinessImpact(text)) {
        confidence = 'medium';
      } else {
        continue; // Skip low confidence items
      }
    }
    
    // Only include medium or high confidence wins
    if (confidence !== 'high' && confidence !== 'medium') {
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
      category: customerName ? 'customer' : (metrics.hasRealNumbers ? 'business' : 'other'),
      description: text.substring(0, 600),
      customerName: customerName,
      quantifiable: metrics.metrics || undefined,
      businessImpact: metrics.hasRealNumbers ? metrics.metrics : undefined,
      confidence: confidence,
      threadDate: threadDate
    });
  }
  
  // Sort by confidence (high first), then by date (newest first)
  wins.sort((a, b) => {
    const order = { 'high': 3, 'medium': 2, 'low': 1 };
    if (order[b.confidence] !== order[a.confidence]) {
      return order[b.confidence] - order[a.confidence];
    }
    return b.date.localeCompare(a.date);
  });
  
  return wins;
}

async function fetchThreadReplies(threadTs: string): Promise<SlackMessage[]> {
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
    console.error(`  ⚠ Error fetching thread ${threadTs}: ${error.message}`);
    return [];
  }
}

async function analyzeWeeklyStatusThreads() {
  console.log(`\n📊 Analyzing Weekly Status Update Thread Replies\n`);
  console.log(`Searching for Slackbot reminders and analyzing their thread replies...\n`);
  
  try {
    // Read messages from file
    console.log('📥 Reading messages from file...');
    const fileContent = readFileSync(MESSAGES_FILE, 'utf-8');
    const data = JSON.parse(fileContent);
    const messages: SlackMessage[] = data.messages || [];
    console.log(`✅ Loaded ${messages.length} messages\n`);
    
    // Find all reminder messages
    const reminderPatterns = [
      /weekly status updates/i,
      /your top wins for this week and impact created/i
    ];
    
    const reminderMessages: SlackMessage[] = messages.filter(msg => {
      const text = getMessageText(msg);
      return reminderPatterns.some(pattern => pattern.test(text)) && 
             (msg.bot_id === 'B01' || msg.user === 'USLACKBOT') &&
             msg.thread_ts &&
             msg.reply_count && msg.reply_count > 0;
    });
    
    console.log(`📋 Found ${reminderMessages.length} reminder threads with replies\n`);
    
    // Fetch thread replies for each reminder
    const allThreadReplies: Array<{ threadTs: string; threadDate: string; replies: SlackMessage[] }> = [];
    
    for (const reminder of reminderMessages) {
      const threadTs = reminder.thread_ts!;
      const threadDate = new Date(parseFloat(threadTs) * 1000).toISOString().split('T')[0];
      
      console.log(`🔄 Fetching replies for thread ${threadTs.substring(0, 10)}... (${reminder.reply_count} replies)`);
      
      const replies = await fetchThreadReplies(threadTs);
      
      // Filter out the parent reminder message itself
      const actualReplies = replies.filter(r => r.ts !== threadTs);
      
      console.log(`  ✓ Fetched ${actualReplies.length} replies\n`);
      
      if (actualReplies.length > 0) {
        allThreadReplies.push({
          threadTs: threadTs,
          threadDate: threadDate,
          replies: actualReplies
        });
      }
      
      // Small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    console.log(`\n✅ Total threads analyzed: ${allThreadReplies.length}\n`);
    
    // Analyze all thread replies for wins
    const allWins: WeeklyWin[] = [];
    
    for (const threadData of allThreadReplies) {
      const wins = identifyWins(threadData.replies, threadData.threadDate);
      allWins.push(...wins);
    }
    
    const highConfidenceWins = allWins.filter(w => w.confidence === 'high');
    const mediumConfidenceWins = allWins.filter(w => w.confidence === 'medium');
    const customerWins = allWins.filter(w => w.customerName);
    const quantifiedWins = allWins.filter(w => w.quantifiable);
    
    // Generate summary
    let summary = `\n${'='.repeat(80)}\n`;
    summary += `📈 WEEKLY STATUS UPDATE WINS ANALYSIS\n`;
    summary += `📋 Analyzed ${allThreadReplies.length} weekly status update threads\n`;
    summary += `${'='.repeat(80)}\n\n`;
    
    summary += `📊 Summary Statistics:\n`;
    summary += `   Total Thread Replies Analyzed: ${allThreadReplies.reduce((sum, t) => sum + t.replies.length, 0)}\n`;
    summary += `   Total Wins Identified: ${allWins.length}\n`;
    summary += `   High Confidence Wins: ${highConfidenceWins.length}\n`;
    summary += `   Medium Confidence Wins: ${mediumConfidenceWins.length}\n`;
    summary += `   Wins with Customer Names: ${customerWins.length}\n`;
    summary += `   Wins with Quantifiable Metrics: ${quantifiedWins.length}\n\n`;
    
    if (highConfidenceWins.length > 0) {
      summary += `${'─'.repeat(80)}\n`;
      summary += `⭐ HIGH CONFIDENCE WINS (Customer Name + Quantifiable Metrics)\n`;
      summary += `${'─'.repeat(80)}\n\n`;
      highConfidenceWins.forEach((win, idx) => {
        summary += `${idx + 1}. ${win.user} (${win.date})`;
        if (win.threadDate) {
          summary += ` [Thread: ${win.threadDate}]`;
        }
        summary += `\n`;
        if (win.customerName) {
          summary += `   👤 Customer: ${win.customerName}\n`;
        }
        if (win.quantifiable) {
          summary += `   📊 Metrics: ${win.quantifiable}\n`;
        }
        summary += `   ${win.description.substring(0, 500)}${win.description.length > 500 ? '...' : ''}\n\n`;
      });
    }
    
    if (mediumConfidenceWins.length > 0) {
      summary += `${'─'.repeat(80)}\n`;
      summary += `📋 MEDIUM CONFIDENCE WINS (Customer Name OR Quantifiable Metrics OR Clear Impact)\n`;
      summary += `${'─'.repeat(80)}\n\n`;
      mediumConfidenceWins.forEach((win, idx) => {
        summary += `${idx + 1}. ${win.user} (${win.date})`;
        if (win.threadDate) {
          summary += ` [Thread: ${win.threadDate}]`;
        }
        summary += `\n`;
        if (win.customerName) {
          summary += `   👤 Customer: ${win.customerName}\n`;
        }
        if (win.quantifiable) {
          summary += `   📊 Metrics: ${win.quantifiable}\n`;
        }
        summary += `   ${win.description.substring(0, 500)}${win.description.length > 500 ? '...' : ''}\n\n`;
      });
    }
    
    if (allWins.length === 0) {
      summary += `\n⚠️  No significant wins identified in weekly status update threads.\n\n`;
      summary += `This suggests:\n`;
      summary += `   • Status updates may focus on work-in-progress rather than completed deliverables\n`;
      summary += `   • Customer names may not be explicitly mentioned\n`;
      summary += `   • Quantifiable metrics may not be included\n`;
      summary += `   • Updates may use activity language ("working on") rather than completion language ("delivered")\n\n`;
    }
    
    summary += `${'='.repeat(80)}\n`;
    
    console.log(summary);
    
    const outputFile = join(process.cwd(), `weekly_status_threads_wins.txt`);
    writeFileSync(outputFile, summary, 'utf-8');
    console.log(`\n✅ Analysis saved to: ${outputFile}\n`);
    
    return { allWins, allThreadReplies, summary };
    
  } catch (error: any) {
    console.error(`\n❌ Error: ${error.message}`);
    console.error(error.stack);
    throw error;
  }
}

// Main execution
if (require.main === module) {
  analyzeWeeklyStatusThreads()
    .then(() => {
      console.log('✅ Analysis complete\n');
      process.exit(0);
    })
    .catch(error => {
      console.error('\n❌ Fatal error:', error.message);
      process.exit(1);
    });
}

export { analyzeWeeklyStatusThreads };
