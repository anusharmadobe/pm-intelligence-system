#!/usr/bin/env ts-node

/**
 * Analyze ALL messages from channel for real wins
 * Uses improved criteria with higher bar
 */

import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

// Import improved functions
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
  customerName?: string;
  quantifiable?: string;
  businessImpact?: string;
  confidence: 'high' | 'medium' | 'low';
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
  const patterns = [
    /(?:for|with|at|to)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\s+(?:customer|client|company|enterprise|organization)/i,
    /(?:customer|client)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/i,
    /([A-Z][A-Z]+)\s+(?:deployment|implementation|rollout|launch)/i,
    /(?:deployed|launched|shipped|delivered)\s+(?:to|for)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/i,
  ];
  
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      const name = match[1].trim();
      if (!['AEM', 'Forms', 'Cloud', 'Service', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'].includes(name)) {
        return name;
      }
    }
  }
  
  return undefined;
}

function extractQuantifiableMetrics(text: string): { metrics: string; hasRealNumbers: boolean } {
  const realMetricPatterns = [
    /(\d+)\s*(%|percent)\s*(?:increase|decrease|improvement|growth|reduction|savings)/gi,
    /(\d+)\s*(?:hours?|days?|weeks?|months?)\s*(?:saved|reduced|decreased|faster|improved|cut)/gi,
    /(\$|USD)\s*(\d+[,\d]*)\s*(?:saved|revenue|cost|reduction)/gi,
    /(\d+)\s*(?:customers?|users?|deployments?|implementations?|adoptions?)\s*(?:added|gained|onboarded|launched)/gi,
    /(\d+)\s*(?:x|times)\s*(?:faster|more|improvement|increase)/gi,
    /reduced\s+(?:by|to)\s+(\d+)\s*(?:%|hours?|days?|cost)/gi,
    /increased\s+(?:by|to)\s+(\d+)\s*(?:%|users?|customers?|revenue)/gi,
    /(\d+)\s*(?:million|billion|k|thousand)\s*(?:users?|customers?|revenue|dollars?)/gi,
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
          if (num < 1900 || num > 2100 || match.includes('%') || match.includes('$') || match.includes('hours') || match.includes('days')) {
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
  
  const impactKeywords = [
    'launched', 'deployed', 'shipped', 'released', 'delivered', 'completed',
    'achieved', 'exceeded', 'closed', 'signed', 'won', 'adopted',
    'revenue', 'cost savings', 'time saved', 'efficiency', 'productivity',
    'customer success', 'adoption', 'usage', 'growth', 'increase',
    'reduced', 'eliminated', 'solved', 'resolved', 'fixed', 'published'
  ];
  
  const routineKeywords = [
    'working on', 'preparing', 'discussing', 'planning', 'analyzing',
    'reviewing', 'drafting', 'defining', 'exploring', 'migrating'
  ];
  
  const hasImpact = impactKeywords.some(kw => lowerText.includes(kw));
  const isRoutine = routineKeywords.some(kw => lowerText.includes(kw)) && !hasImpact;
  
  return hasImpact && !isRoutine;
}

function identifyWins(messages: SlackMessage[]): WeeklyWin[] {
  const wins: WeeklyWin[] = [];
  
  for (const message of messages) {
    if (message.subtype || message.user === 'USLACKBOT') {
      continue;
    }
    
    const text = getMessageText(message);
    if (!text || text.length < 30) {
      continue;
    }
    
    const completionKeywords = [
      'launched', 'deployed', 'shipped', 'released', 'delivered', 'completed',
      'achieved', 'exceeded', 'closed', 'signed', 'won', 'adopted',
      'handed over', 'published', 'migrated', 'implemented'
    ];
    
    const hasCompletion = completionKeywords.some(kw => 
      text.toLowerCase().includes(kw)
    );
    
    if (!hasCompletion) {
      continue;
    }
    
    if (!hasBusinessImpact(text)) {
      continue;
    }
    
    const customerName = extractCustomerName(text);
    const metrics = extractQuantifiableMetrics(text);
    
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
    
    const userName = message.user_profile?.real_name || 
                    message.user_profile?.display_name || 
                    message.user || 
                    'Unknown';
    
    const date = new Date(parseFloat(message.ts) * 1000).toISOString().split('T')[0];
    
    wins.push({
      user: userName,
      date: date,
      category: customerName ? 'customer' : (metrics.hasRealNumbers ? 'business' : 'other'),
      description: text.substring(0, 500),
      customerName: customerName,
      quantifiable: metrics.metrics || undefined,
      businessImpact: metrics.hasRealNumbers ? metrics.metrics : undefined,
      confidence: confidence
    });
  }
  
  wins.sort((a, b) => {
    const order = { 'high': 3, 'medium': 2, 'low': 1 };
    return order[b.confidence] - order[a.confidence];
  });
  
  return wins;
}

async function analyzeAllWins() {
  console.log(`\n📊 Analyzing ALL Messages for Real Wins\n`);
  console.log(`Using Improved Criteria:\n`);
  console.log(`   ✅ Must have completion language (launched, deployed, shipped, etc.)`);
  console.log(`   ✅ Must have business impact`);
  console.log(`   ✅ Should include customer names OR quantifiable metrics\n`);
  
  try {
    const messagesFile = '/Users/anusharm/.cursor/projects/Users-anusharm-learn-PM-cursor-system/agent-tools/1733d34a-9624-4ef6-93ea-b7796f832e13.txt';
    const fileContent = readFileSync(messagesFile, 'utf-8');
    const data = JSON.parse(fileContent);
    const messages: SlackMessage[] = data.messages || [];
    
    // Add thread replies
    const allMessages = [...messages, ...STATUS_THREAD_REPLIES as SlackMessage[]];
    
    console.log(`📥 Loaded ${messages.length} main messages + ${STATUS_THREAD_REPLIES.length} thread replies = ${allMessages.length} total\n`);
    
    const wins = identifyWins(allMessages);
    
    const highConfidenceWins = wins.filter(w => w.confidence === 'high');
    const mediumConfidenceWins = wins.filter(w => w.confidence === 'medium');
    const customerWins = wins.filter(w => w.customerName);
    const quantifiedWins = wins.filter(w => w.quantifiable);
    
    let summary = `\n${'='.repeat(80)}\n`;
    summary += `📈 COMPREHENSIVE WINS ANALYSIS - ALL MESSAGES\n`;
    summary += `${'='.repeat(80)}\n\n`;
    
    summary += `📊 Summary Statistics:\n`;
    summary += `   Total Messages Analyzed: ${allMessages.length}\n`;
    summary += `   Total Wins Identified: ${wins.length}\n`;
    summary += `   High Confidence Wins: ${highConfidenceWins.length}\n`;
    summary += `   Medium Confidence Wins: ${mediumConfidenceWins.length}\n`;
    summary += `   Wins with Customer Names: ${customerWins.length}\n`;
    summary += `   Wins with Quantifiable Metrics: ${quantifiedWins.length}\n\n`;
    
    if (highConfidenceWins.length > 0) {
      summary += `${'─'.repeat(80)}\n`;
      summary += `⭐ HIGH CONFIDENCE WINS (Customer Name + Quantifiable Metrics)\n`;
      summary += `${'─'.repeat(80)}\n\n`;
      highConfidenceWins.forEach((win, idx) => {
        summary += `${idx + 1}. ${win.user} (${win.date})\n`;
        if (win.customerName) {
          summary += `   👤 Customer: ${win.customerName}\n`;
        }
        if (win.quantifiable) {
          summary += `   📊 Metrics: ${win.quantifiable}\n`;
        }
        summary += `   ${win.description.substring(0, 400)}${win.description.length > 400 ? '...' : ''}\n\n`;
      });
    }
    
    if (mediumConfidenceWins.length > 0) {
      summary += `${'─'.repeat(80)}\n`;
      summary += `📋 MEDIUM CONFIDENCE WINS (Customer Name OR Quantifiable Metrics)\n`;
      summary += `${'─'.repeat(80)}\n\n`;
      mediumConfidenceWins.forEach((win, idx) => {
        summary += `${idx + 1}. ${win.user} (${win.date})\n`;
        if (win.customerName) {
          summary += `   👤 Customer: ${win.customerName}\n`;
        }
        if (win.quantifiable) {
          summary += `   📊 Metrics: ${win.quantifiable}\n`;
        }
        summary += `   ${win.description.substring(0, 400)}${win.description.length > 400 ? '...' : ''}\n\n`;
      });
    }
    
    if (wins.length === 0) {
      summary += `\n⚠️  No significant wins identified with improved criteria.\n\n`;
      summary += `This suggests:\n`;
      summary += `   • Messages may focus on work-in-progress rather than completed deliverables\n`;
      summary += `   • Customer names may not be explicitly mentioned in status updates\n`;
      summary += `   • Quantifiable metrics may not be included in status messages\n`;
      summary += `   • Wins may be communicated in other channels or formats\n\n`;
      summary += `Recommendations:\n`;
      summary += `   • Encourage team to include customer names in status updates\n`;
      summary += `   • Request quantifiable metrics when reporting wins\n`;
      summary += `   • Focus on completed deliverables, not work-in-progress\n`;
      summary += `   • Consider reviewing other channels or meeting notes for wins\n\n`;
    }
    
    summary += `${'='.repeat(80)}\n`;
    
    console.log(summary);
    
    const outputFile = join(process.cwd(), `all_wins_analysis.txt`);
    writeFileSync(outputFile, summary, 'utf-8');
    console.log(`\n✅ Analysis saved to: ${outputFile}\n`);
    
    return { wins, summary };
    
  } catch (error: any) {
    console.error(`\n❌ Error: ${error.message}`);
    throw error;
  }
}

if (require.main === module) {
  analyzeAllWins()
    .then(() => {
      console.log('✅ Analysis complete\n');
      process.exit(0);
    })
    .catch(error => {
      console.error('\n❌ Fatal error:', error.message);
      process.exit(1);
    });
}

export { analyzeAllWins };
