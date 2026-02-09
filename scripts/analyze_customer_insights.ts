#!/usr/bin/env ts-node

/**
 * Script to analyze Slack signals for actionable items and customer insights
 */

import * as dotenv from 'dotenv';
dotenv.config();

import { getSignalsBySource } from '../backend/processing/signal_extractor';
import { logger } from '../backend/utils/logger';

interface ActionableItem {
  signalId: string;
  customer: string;
  type: string;
  item: string;
  assignee?: string;
  dueDate?: string;
}

interface CustomerInsight {
  customer: string;
  signalId: string;
  insight: string;
  category: string;
}

async function analyzeCustomerInsights() {
  console.log('\n🔍 Analyzing Customer Signals for Actionable Items & Insights');
  console.log('==============================================================\n');
  
  try {
    const signals = await getSignalsBySource('slack');
    
    // Filter out test signals
    const customerSignals = signals.filter(s => 
      !s.content.toLowerCase().includes('test message') &&
      !s.content.toLowerCase().includes('test signal')
    );
    
    console.log(`Analyzing ${customerSignals.length} customer-related signals...\n`);
    
    const actionableItems: ActionableItem[] = [];
    const insights: CustomerInsight[] = [];
    
    // Analyze each signal
    for (const signal of customerSignals) {
      const content = signal.content;
      
      // Extract customer name
      const customerMatch = content.match(/(?:Customer Name|customer)[\s:]*([A-Z][A-Za-z\s]+)/i);
      const customer = customerMatch ? customerMatch[1].trim() : 'Unknown';
      
      // Extract actionable items (Next Action, Follow-up tasks, etc.)
      const nextActionMatch = content.match(/:todo_done:\s*\*Next Action\*(.*?)(?=\n\n|\n:|\n\*|$)/is);
      const followUpMatch = content.match(/Follow-up tasks?:(.*?)(?=\n\n|$)/is);
      
      if (nextActionMatch || followUpMatch) {
        const actionText = (nextActionMatch?.[1] || followUpMatch?.[1] || '').trim();
        const actionItems = actionText.split(/\n/).filter(line => 
          line.trim().startsWith('•') || 
          line.trim().startsWith('-') ||
          line.match(/^\s*\d+\./)
        );
        
        actionItems.forEach(item => {
          const cleanItem = item.replace(/^[•\-\d\.\s]+/, '').trim();
          if (cleanItem.length > 10) {
            // Extract assignee
            const assigneeMatch = cleanItem.match(/\(([^)]+)\)$/);
            const assignee = assigneeMatch ? assigneeMatch[1] : undefined;
            
            // Extract due date or timeline
            const dateMatch = cleanItem.match(/(\d{4}-\d{2}-\d{2}|next week|next call|mid June)/i);
            const dueDate = dateMatch ? dateMatch[1] : undefined;
            
            actionableItems.push({
              signalId: signal.id,
              customer: customer,
              type: nextActionMatch ? 'Next Action' : 'Follow-up Task',
              item: cleanItem.replace(/\s*\([^)]+\)$/, '').trim(),
              assignee: assignee,
              dueDate: dueDate
            });
          }
        });
      }
      
      // Extract insights by category
      if (content.match(/NFCU|IRS|LPL Financial|Clark County/i)) {
        // Customer adoption/expansion insights
        if (content.match(/adoption|expanding|adopt/i)) {
          insights.push({
            customer: customer,
            signalId: signal.id,
            insight: extractInsight(content, 'adoption'),
            category: 'Adoption/Expansion'
          });
        }
        
        // Product feature requests
        if (content.match(/requirement|need|want|request/i)) {
          insights.push({
            customer: customer,
            signalId: signal.id,
            insight: extractInsight(content, 'requirements'),
            category: 'Feature Request'
          });
        }
        
        // Customer success/win
        if (content.match(/went live|go-live|successful|golive/i)) {
          insights.push({
            customer: customer,
            signalId: signal.id,
            insight: extractInsight(content, 'success'),
            category: 'Customer Success'
          });
        }
        
        // Issues/blockers
        if (content.match(/issue|problem|blocked|fail|error/i)) {
          insights.push({
            customer: customer,
            signalId: signal.id,
            insight: extractInsight(content, 'issue'),
            category: 'Issue/Blocker'
          });
        }
      }
    }
    
    // Display results
    console.log('📋 ACTIONABLE ITEMS');
    console.log('===================\n');
    
    if (actionableItems.length === 0) {
      console.log('No actionable items found in structured format.\n');
    } else {
      actionableItems.forEach((item, i) => {
        console.log(`${i+1}. [${item.customer}] ${item.type}`);
        console.log(`   Item: ${item.item}`);
        if (item.assignee) console.log(`   Assignee: ${item.assignee}`);
        if (item.dueDate) console.log(`   Timeline: ${item.dueDate}`);
        console.log('');
      });
    }
    
    console.log('\n💡 CUSTOMER INSIGHTS');
    console.log('====================\n');
    
    if (insights.length === 0) {
      console.log('No structured insights found.\n');
    } else {
      const byCategory: Record<string, CustomerInsight[]> = {};
      insights.forEach(insight => {
        if (!byCategory[insight.category]) {
          byCategory[insight.category] = [];
        }
        byCategory[insight.category].push(insight);
      });
      
      Object.entries(byCategory).forEach(([category, items]) => {
        console.log(`${category}:`);
        items.forEach((insight, i) => {
          console.log(`  ${i+1}. [${insight.customer}] ${insight.insight.substring(0, 150)}...`);
        });
        console.log('');
      });
    }
    
    // Summary
    console.log('\n📊 SUMMARY');
    console.log('==========\n');
    console.log(`Total Signals Analyzed: ${customerSignals.length}`);
    console.log(`Actionable Items Found: ${actionableItems.length}`);
    console.log(`Customer Insights Found: ${insights.length}`);
    
    // Group by customer
    const byCustomer: Record<string, { items: number, insights: number }> = {};
    actionableItems.forEach(item => {
      if (!byCustomer[item.customer]) {
        byCustomer[item.customer] = { items: 0, insights: 0 };
      }
      byCustomer[item.customer].items++;
    });
    insights.forEach(insight => {
      if (!byCustomer[insight.customer]) {
        byCustomer[insight.customer] = { items: 0, insights: 0 };
      }
      byCustomer[insight.customer].insights++;
    });
    
    console.log('\nBy Customer:');
    Object.entries(byCustomer).forEach(([customer, counts]) => {
      console.log(`  ${customer}: ${counts.items} items, ${counts.insights} insights`);
    });
    console.log('');
    
  } catch (error: any) {
    console.error('\n❌ Error:', error.message);
    logger.error('Analysis failed', { error: error.message });
    throw error;
  }
}

function extractInsight(content: string, type: string): string {
  // Extract relevant sentences based on type
  const sentences = content.split(/[.!?]\s+/);
  
  if (type === 'adoption') {
    const adoptionSentences = sentences.filter(s => 
      s.match(/adoption|expanding|adopt/i)
    );
    return adoptionSentences[0] || sentences[0] || content.substring(0, 200);
  }
  
  if (type === 'requirements') {
    const reqSentences = sentences.filter(s => 
      s.match(/requirement|need|want|request/i)
    );
    return reqSentences[0] || sentences[0] || content.substring(0, 200);
  }
  
  if (type === 'success') {
    const successSentences = sentences.filter(s => 
      s.match(/went live|go-live|successful|golive/i)
    );
    return successSentences[0] || sentences[0] || content.substring(0, 200);
  }
  
  if (type === 'issue') {
    const issueSentences = sentences.filter(s => 
      s.match(/issue|problem|blocked|fail|error/i)
    );
    return issueSentences[0] || sentences[0] || content.substring(0, 200);
  }
  
  return content.substring(0, 200);
}

if (require.main === module) {
  analyzeCustomerInsights()
    .then(() => {
      console.log('\n✅ Analysis complete!\n');
      process.exit(0);
    })
    .catch(error => {
      console.error('\n❌ Analysis failed:', error.message);
      process.exit(1);
    });
}

export { analyzeCustomerInsights };
