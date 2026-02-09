#!/usr/bin/env ts-node

/**
 * Script to test opportunity detection from ingested Slack signals
 */

import * as dotenv from 'dotenv';
dotenv.config();

import { getAllSignals, getSignalsBySource } from '../backend/processing/signal_extractor';
import { detectAndStoreOpportunities, getAllOpportunities, getSignalsForOpportunity } from '../backend/services/opportunity_service';
import { logger } from '../backend/utils/logger';

async function testOpportunityDetection() {
  console.log('\n🔍 Testing Opportunity Detection');
  console.log('================================\n');
  
  try {
    // Step 1: Get all Slack signals
    console.log('Step 1: Retrieving Slack signals...');
    const slackSignals = await getSignalsBySource('slack');
    console.log(`   Found ${slackSignals.length} Slack signals\n`);
    
    if (slackSignals.length === 0) {
      console.log('⚠️  No signals found. Please ingest signals first.');
      console.log('   Run: npx ts-node scripts/ingest_messages_now.ts\n');
      return;
    }
    
    // Step 2: Display signal summary
    console.log('Step 2: Signal Summary');
    console.log('   Signals by type:');
    const byType: Record<string, number> = {};
    slackSignals.forEach(s => {
      byType[s.signal_type] = (byType[s.signal_type] || 0) + 1;
    });
    Object.entries(byType).forEach(([type, count]) => {
      console.log(`     ${type}: ${count}`);
    });
    console.log('');
    
    // Step 3: Detect opportunities
    console.log('Step 3: Detecting opportunities...');
    const opportunities = await detectAndStoreOpportunities(slackSignals);
    console.log(`   Detected ${opportunities.length} opportunities\n`);
    
    if (opportunities.length === 0) {
      console.log('ℹ️  No opportunities detected.');
      console.log('   This means signals are not similar enough to cluster.');
      console.log('   (Need at least 2 related signals to create an opportunity)\n');
      
      // Show signal content previews
      console.log('   Signal previews:');
      slackSignals.slice(0, 3).forEach((sig, i) => {
        console.log(`   ${i+1}. ${sig.content.substring(0, 80)}...`);
      });
      console.log('');
      return;
    }
    
    // Step 4: Display opportunities
    console.log('Step 4: Detected Opportunities');
    console.log('===============================\n');
    
    for (let i = 0; i < opportunities.length; i++) {
      const opp = opportunities[i];
      const signals = await getSignalsForOpportunity(opp.id);
      
      console.log(`${i+1}. ${opp.title}`);
      console.log(`   Description: ${opp.description}`);
      console.log(`   Status: ${opp.status}`);
      console.log(`   Signals: ${signals.length}`);
      console.log(`   Created: ${opp.created_at}`);
      console.log('');
      
      // Show related signals
      if (signals.length > 0) {
        console.log('   Related signals:');
        signals.forEach((sig, j) => {
          const preview = sig.content.substring(0, 60).replace(/\n/g, ' ');
          console.log(`     ${j+1}. ${preview}...`);
        });
        console.log('');
      }
    }
    
    // Step 5: Summary
    console.log('📊 Summary');
    console.log('==========');
    console.log(`   Total signals analyzed: ${slackSignals.length}`);
    console.log(`   Opportunities detected: ${opportunities.length}`);
    console.log(`   Average signals per opportunity: ${(slackSignals.length / opportunities.length).toFixed(1)}\n`);
    
    logger.info('Opportunity detection test completed', {
      signalsAnalyzed: slackSignals.length,
      opportunitiesDetected: opportunities.length
    });
    
  } catch (error: any) {
    console.error('\n❌ Error:', error.message);
    logger.error('Opportunity detection test failed', {
      error: error.message,
      stack: error.stack
    });
    throw error;
  }
}

if (require.main === module) {
  testOpportunityDetection()
    .then(() => {
      console.log('✅ Test completed successfully!\n');
      process.exit(0);
    })
    .catch(error => {
      console.error('\n❌ Test failed:', error.message);
      process.exit(1);
    });
}

export { testOpportunityDetection };
