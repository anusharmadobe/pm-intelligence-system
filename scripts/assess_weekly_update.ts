#!/usr/bin/env ts-node

/**
 * Weekly Update Assessment Script
 * Analyzes if a weekly update qualifies as a customer win
 * Asks clarifying questions to improve the update
 * Designed for Slack bot integration
 */

interface AssessmentResult {
  qualifiesAsWin: boolean;
  confidence: 'high' | 'medium' | 'low';
  category: 'customer' | 'productivity' | 'business' | 'other' | 'none';
  score: number; // 0-100
  strengths: string[];
  weaknesses: string[];
  clarifyingQuestions: string[];
  suggestions: string[];
  customerName?: string;
  quantifiableMetrics?: string;
  businessImpact?: string;
}

interface WeeklyUpdate {
  text: string;
  user?: string;
  date?: string;
}

function extractCustomerName(text: string): string | undefined {
  const knownCustomers = [
    'NFCU', 'UBS', 'Deutshe bank', 'Deutsche Bank', 'Lumen', 'Burnswick', 
    'Micron', 'Travel Port', 'South African Police Service', 'MoD', 
    'LPL', 'Jet2', 'Adobe Consulting', 'Deutshe Bank', 'EDS', 'EXL'
  ];
  
  for (const customer of knownCustomers) {
    const pattern = new RegExp(`\\b${customer.replace(/\s+/g, '\\s+')}\\b`, 'i');
    if (pattern.test(text)) {
      return customer;
    }
  }
  
  const patterns = [
    /(?:with|for|to|at|unblocked|pitched|discussed|helped|delivered|shipped|launched|deployed)\s+(?:customer|client|organization|enterprise)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/i,
    /(?:customer|client)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/i,
    /([A-Z][A-Z]+)\s+(?:deployment|implementation|rollout|launch|enrollment|evaluation)/i,
  ];
  
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      const name = match[1].trim();
      const falsePositives = ['AEM', 'Forms', 'Cloud', 'Service', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December', 'JEE', 'LTS', 'SP1', 'PDF', 'API', 'UI', 'IC', 'CS'];
      if (!falsePositives.includes(name)) {
        return name;
      }
    }
  }
  
  return undefined;
}

function extractQuantifiableMetrics(text: string): { metrics: string; hasRealNumbers: boolean; score: number } {
  const realMetricPatterns = [
    /(\d+)\s*(?:new\s+)?(?:enrollments?|customers?|prospects?|evaluations?|deals?|wins?)\s*(?:for|in|added|gained|onboarded)/gi,
    /(?:authored|created|published|completed|delivered|shipped|updated|closed)\s+(\d+)\s*(?:Setup\s+Guide|Troubleshooting|articles?|pdfs?|guides?|features?|tickets?|documents?|pages?)/gi,
    /(\d+)\s*(?:Setup\s+Guide|Troubleshooting|articles?|pdfs?|guides?|features?|tickets?|documents?|pages?)\s*(?:published|created|authored|updated|completed|closed|delivered|shipped)/gi,
    /(\d+)\s*(?:hours?|days?|weeks?|months?)\s*(?:saved|reduced|faster|improved|decreased|cut|eliminated)/gi,
    /(\d+)\s*(?:%|percent)\s*(?:increase|decrease|improvement|growth|reduction|savings|adoption|usage|efficiency)/gi,
    /(\$|USD)\s*(\d+[,\d]*)\s*(?:saved|revenue|cost|reduction|savings|generated)/gi,
    /(\d+)\s*(?:x|times)\s*(?:faster|more|less|improvement|increase|better)/gi,
    /reduced\s+(?:by|to)\s+(\d+)\s*(?:%|hours?|days?|cost)/gi,
    /increased\s+(?:by|to)\s+(\d+)\s*(?:%|users?|customers?|revenue|adoption|usage)/gi,
    /(\d+)\s*(?:million|billion|k|thousand)\s*(?:users?|customers?|revenue|dollars?|requests?)/gi,
    /first\s+(?:in|across|team|organization|company|industry)/gi,
  ];
  
  const matches: string[] = [];
  let hasRealNumbers = false;
  let score = 0;
  
  realMetricPatterns.forEach(pattern => {
    const found = text.match(pattern);
    if (found) {
      matches.push(...found);
      found.forEach(match => {
        const numMatch = match.match(/\d+/);
        if (numMatch) {
          const num = parseInt(numMatch[0]);
          if (num < 1900 || num > 2100 || match.includes('%') || match.includes('$') || 
              match.includes('hours') || match.includes('days') || match.includes('x') || 
              match.includes('times') || match.includes('first')) {
            hasRealNumbers = true;
            score += 20; // Each metric adds 20 points
          }
        }
      });
    }
  });
  
  return {
    metrics: matches.length > 0 ? matches.join(', ') : '',
    hasRealNumbers: hasRealNumbers,
    score: Math.min(score, 40) // Cap at 40 points
  };
}

function hasCompletionLanguage(text: string): { hasCompletion: boolean; score: number } {
  const completionKeywords = [
    'launched', 'deployed', 'shipped', 'released', 'delivered', 'completed',
    'achieved', 'exceeded', 'closed', 'signed', 'won', 'adopted',
    'handed over', 'published', 'migrated', 'implemented', 'shared',
    'incorporated', 'created', 'built', 'unblocked', 'pitched', 'enabled',
    'finalized', 'authored', 'enrollments', 'evaluation', 'modernization',
    'renewal', 'evangelised', 'validated'
  ];
  
  const hasCompletion = completionKeywords.some(kw => text.toLowerCase().includes(kw));
  return {
    hasCompletion: hasCompletion,
    score: hasCompletion ? 20 : 0
  };
}

function hasBusinessImpact(text: string): { hasImpact: boolean; score: number } {
  const lowerText = text.toLowerCase();
  
  const impactKeywords = [
    'launched', 'deployed', 'shipped', 'released', 'delivered', 'completed',
    'achieved', 'exceeded', 'closed', 'signed', 'won', 'adopted',
    'revenue', 'cost savings', 'time saved', 'efficiency', 'productivity',
    'customer success', 'adoption', 'usage', 'growth', 'increase',
    'reduced', 'eliminated', 'solved', 'resolved', 'fixed', 'published',
    'migrated', 'handed over', 'shared', 'incorporated', 'unblocked',
    'enrollments', 'evaluation', 'modernization', 'renewal', 'prospects'
  ];
  
  const routineKeywords = [
    'working on', 'preparing', 'discussing', 'planning', 'analyzing',
    'reviewing', 'drafting', 'defining', 'exploring', 'researching',
    'considering', 'thinking about', 'looking into'
  ];
  
  const hasImpact = impactKeywords.some(kw => lowerText.includes(kw));
  const isRoutine = routineKeywords.some(kw => lowerText.includes(kw)) && !hasImpact;
  
  return {
    hasImpact: hasImpact && !isRoutine,
    score: hasImpact && !isRoutine ? 20 : 0
  };
}

function generateClarifyingQuestions(
  text: string,
  hasCustomer: boolean,
  hasMetrics: boolean,
  hasCompletion: boolean,
  hasImpact: boolean
): string[] {
  const questions: string[] = [];
  
  if (!hasCustomer) {
    questions.push("❓ **Customer Name Missing:** Did this work involve a specific customer or client? If yes, please mention the customer name (e.g., 'Delivered X to Customer Y').");
    questions.push("❓ **Customer Impact:** What was the customer's problem or need that this work addressed?");
  }
  
  if (!hasMetrics) {
    questions.push("❓ **Quantifiable Impact Missing:** Can you add specific numbers? For example:");
    questions.push("   • How many customers/users were impacted?");
    questions.push("   • How much time/money was saved?");
    questions.push("   • How many articles/features/deliverables were completed?");
    questions.push("   • What percentage improvement was achieved?");
  }
  
  if (!hasCompletion) {
    questions.push("❓ **Completion Status Unclear:** Is this work completed or still in progress?");
    questions.push("   • If completed: Use past tense verbs like 'delivered', 'shipped', 'completed', 'launched'");
    questions.push("   • If in progress: Consider moving to 'Next Week' section or clarify completion date");
  }
  
  if (!hasImpact) {
    questions.push("❓ **Business Impact Unclear:** What was the business or customer impact of this work?");
    questions.push("   • Did it unblock a customer?");
    questions.push("   • Did it improve productivity or efficiency?");
    questions.push("   • Did it generate revenue or cost savings?");
    questions.push("   • Did it enable a new capability?");
  }
  
  // Additional quality checks
  if (text.toLowerCase().includes('working on') && !text.toLowerCase().includes('completed')) {
    questions.push("⚠️ **Work-in-Progress:** This appears to be work-in-progress. For 'wins', focus on completed deliverables. Consider:");
    questions.push("   • Moving this to a 'Next Week' or 'In Progress' section");
    questions.push("   • Or clarifying what was actually completed/delivered this week");
  }
  
  if (text.length < 50) {
    questions.push("⚠️ **Too Brief:** This update is quite brief. Consider adding:");
    questions.push("   • What was accomplished");
    questions.push("   • Who it impacted (customer name)");
    questions.push("   • Quantifiable results");
  }
  
  // Check for vague language
  const vaguePatterns = [
    /worked on/i,
    /preparing/i,
    /discussing/i,
    /planning/i,
    /analyzing/i,
    /reviewing/i
  ];
  
  const hasVagueLanguage = vaguePatterns.some(pattern => pattern.test(text)) && 
                           !text.toLowerCase().includes('completed') &&
                           !text.toLowerCase().includes('delivered');
  
  if (hasVagueLanguage) {
    questions.push("⚠️ **Vague Language Detected:** Phrases like 'worked on', 'preparing', 'discussing' are activity-focused, not outcome-focused.");
    questions.push("   • Instead of 'worked on X', try 'delivered X' or 'completed X'");
    questions.push("   • Instead of 'preparing Y', try 'prepared and shared Y' or 'delivered Y'");
  }
  
  return questions;
}

function generateSuggestions(
  text: string,
  hasCustomer: boolean,
  hasMetrics: boolean,
  hasCompletion: boolean,
  hasImpact: boolean
): string[] {
  const suggestions: string[] = [];
  
  if (!hasCustomer && !hasMetrics) {
    suggestions.push("💡 **Add Customer or Metrics:** To qualify as a strong win, include either:");
    suggestions.push("   • A customer name (e.g., 'Delivered X to Customer Y')");
    suggestions.push("   • Quantifiable metrics (e.g., 'Completed 5 articles', 'Saved 20 hours', 'Increased adoption by 30%')");
  }
  
  if (hasCustomer && !hasMetrics) {
    suggestions.push("💡 **Add Quantifiable Impact:** Great that you mentioned a customer! Now add metrics:");
    suggestions.push("   • How many customers/users were impacted?");
    suggestions.push("   • What was the quantifiable result? (time saved, revenue generated, issues resolved, etc.)");
  }
  
  if (!hasCompletion) {
    suggestions.push("💡 **Use Completion Language:** Replace activity verbs with completion verbs:");
    suggestions.push("   • 'Working on' → 'Completed' or 'Delivered'");
    suggestions.push("   • 'Preparing' → 'Prepared and shared'");
    suggestions.push("   • 'Discussing' → 'Discussed and finalized'");
  }
  
  if (hasCompletion && hasCustomer && hasMetrics) {
    suggestions.push("✅ **Strong Win!** This update has all key elements. Consider adding:");
    suggestions.push("   • Specific business impact (e.g., 'unblocked customer', 'enabled renewal', 'drove adoption')");
    suggestions.push("   • Timeline or context (e.g., 'ahead of schedule', 'critical for Q1 goals')");
  }
  
  return suggestions;
}

export function assessWeeklyUpdate(update: WeeklyUpdate): AssessmentResult {
  const text = update.text || '';
  
  // Extract components
  const customerName = extractCustomerName(text);
  const metrics = extractQuantifiableMetrics(text);
  const completion = hasCompletionLanguage(text);
  const impact = hasBusinessImpact(text);
  
  // Calculate scores
  let score = 0;
  score += customerName ? 30 : 0;
  score += metrics.score;
  score += completion.score;
  score += impact.score;
  
  // Determine if qualifies as win
  let qualifiesAsWin = false;
  let confidence: 'high' | 'medium' | 'low' = 'low';
  let category: 'customer' | 'productivity' | 'business' | 'other' | 'none' = 'none';
  
  if (customerName && metrics.hasRealNumbers && completion.hasCompletion && impact.hasImpact) {
    qualifiesAsWin = true;
    confidence = 'high';
    category = 'customer';
  } else if ((customerName || metrics.hasRealNumbers) && completion.hasCompletion && impact.hasImpact) {
    qualifiesAsWin = true;
    confidence = 'medium';
    category = customerName ? 'customer' : (metrics.hasRealNumbers ? 'business' : 'other');
  } else if (completion.hasCompletion && impact.hasImpact && score >= 40) {
    qualifiesAsWin = true;
    confidence = 'medium';
    category = 'other';
  } else {
    qualifiesAsWin = false;
    confidence = 'low';
  }
  
  // Identify strengths and weaknesses
  const strengths: string[] = [];
  const weaknesses: string[] = [];
  
  if (customerName) {
    strengths.push(`✅ Mentions customer: ${customerName}`);
  } else {
    weaknesses.push('❌ No customer name mentioned');
  }
  
  if (metrics.hasRealNumbers) {
    strengths.push(`✅ Includes quantifiable metrics: ${metrics.metrics}`);
  } else {
    weaknesses.push('❌ No quantifiable metrics (numbers, percentages, counts)');
  }
  
  if (completion.hasCompletion) {
    strengths.push('✅ Uses completion language (delivered, shipped, completed, etc.)');
  } else {
    weaknesses.push('❌ Uses activity language (working on, preparing, discussing) instead of completion language');
  }
  
  if (impact.hasImpact) {
    strengths.push('✅ Demonstrates business impact');
  } else {
    weaknesses.push('❌ Business impact not clearly stated');
  }
  
  // Generate clarifying questions and suggestions
  const clarifyingQuestions = generateClarifyingQuestions(
    text,
    !!customerName,
    metrics.hasRealNumbers,
    completion.hasCompletion,
    impact.hasImpact
  );
  
  const suggestions = generateSuggestions(
    text,
    !!customerName,
    metrics.hasRealNumbers,
    completion.hasCompletion,
    impact.hasImpact
  );
  
  return {
    qualifiesAsWin,
    confidence,
    category,
    score,
    strengths,
    weaknesses,
    clarifyingQuestions,
    suggestions,
    customerName: customerName || undefined,
    quantifiableMetrics: metrics.metrics || undefined,
    businessImpact: impact.hasImpact ? 'Impact identified' : undefined
  };
}

export function formatAssessmentForSlack(result: AssessmentResult, update: WeeklyUpdate): string {
  let output = `\n${'='.repeat(60)}\n`;
  output += `📊 WEEKLY UPDATE ASSESSMENT\n`;
  output += `${'='.repeat(60)}\n\n`;
  
  if (update.user) {
    output += `👤 **User:** ${update.user}\n`;
  }
  if (update.date) {
    output += `📅 **Date:** ${update.date}\n`;
  }
  
  output += `\n**Assessment:** ${result.qualifiesAsWin ? '✅ QUALIFIES AS WIN' : '❌ DOES NOT QUALIFY AS WIN'}\n`;
  output += `**Confidence:** ${result.confidence.toUpperCase()}\n`;
  output += `**Category:** ${result.category}\n`;
  output += `**Score:** ${result.score}/100\n\n`;
  
  if (result.strengths.length > 0) {
    output += `**Strengths:**\n`;
    result.strengths.forEach(s => output += `  ${s}\n`);
    output += `\n`;
  }
  
  if (result.weaknesses.length > 0) {
    output += `**Areas for Improvement:**\n`;
    result.weaknesses.forEach(w => output += `  ${w}\n`);
    output += `\n`;
  }
  
  if (result.customerName) {
    output += `👤 **Customer:** ${result.customerName}\n`;
  }
  
  if (result.quantifiableMetrics) {
    output += `📊 **Metrics:** ${result.quantifiableMetrics}\n`;
  }
  
  if (result.clarifyingQuestions.length > 0) {
    output += `\n**Clarifying Questions:**\n`;
    result.clarifyingQuestions.forEach(q => output += `  ${q}\n`);
    output += `\n`;
  }
  
  if (result.suggestions.length > 0) {
    output += `**Suggestions:**\n`;
    result.suggestions.forEach(s => output += `  ${s}\n`);
    output += `\n`;
  }
  
  output += `${'='.repeat(60)}\n`;
  
  return output;
}

// CLI interface
if (require.main === module) {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.log(`
Usage: npx ts-node scripts/assess_weekly_update.ts "<weekly update text>" [--user <name>] [--date <date>]

Example:
  npx ts-node scripts/assess_weekly_update.ts "Delivered 5 articles to NFCU customer" --user "John Doe" --date "2026-01-24"
    `);
    process.exit(1);
  }
  
  const text = args[0];
  let user: string | undefined;
  let date: string | undefined;
  
  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--user' && i + 1 < args.length) {
      user = args[i + 1];
      i++;
    } else if (args[i] === '--date' && i + 1 < args.length) {
      date = args[i + 1];
      i++;
    }
  }
  
  const update: WeeklyUpdate = { text, user, date };
  const result = assessWeeklyUpdate(update);
  const formatted = formatAssessmentForSlack(result, update);
  
  console.log(formatted);
  
  // Also output JSON for programmatic use
  console.log('\n--- JSON Output (for Slack bot) ---\n');
  console.log(JSON.stringify(result, null, 2));
}
