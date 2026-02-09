#!/usr/bin/env ts-node

/**
 * Complete test workflow for channel C04D195JVGS
 * This script orchestrates the full workflow using available APIs
 * For MCP/LLM access, use Cursor extension commands
 */

import * as dotenv from 'dotenv';
dotenv.config();

import { getSignals } from '../backend/processing/signal_extractor';
import { 
  detectAndStoreOpportunitiesIncremental,
  getAllOpportunities,
  getSignalsForOpportunity 
} from '../backend/services/opportunity_service';
import { logger } from '../backend/utils/logger';

const CHANNEL_ID = 'C04D195JVGS';
const API_BASE = process.env.API_BASE || 'http://localhost:3000';

async function checkAPIServer() {
  try {
    const response = await fetch(`${API_BASE}/health`);
    if (response.ok) {
      const health = await response.json();
      console.log('✓ API server is running');
      console.log(`  Database: ${health.database?.connected ? 'Connected' : 'Disconnected'}\n`);
      return true;
    }
  } catch (error) {
    console.log('⚠️  API server not running. Start it with: npm start\n');
    return false;
  }
  return false;
}

async function ingestViaAPI(messages: any[]) {
  console.log(`Ingesting ${messages.length} messages via API...\n`);
  
  let ingested = 0;
  let errors = 0;
  
  for (const message of messages) {
    if (message.subtype || message.bot_id || !message.text) continue;
    
    try {
      const response = await fetch(`${API_BASE}/api/signals`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source: 'slack',
          id: message.ts || message.event_ts,
          type: 'message',
          text: message.text,
          metadata: {
            channel_id: CHANNEL_ID,
            user: message.user,
            timestamp: message.ts
          }
        })
      });
      
      if (response.ok) {
        ingested++;
        process.stdout.write('.');
      } else {
        const error = await response.json();
        if (!error.error?.includes('duplicate')) {
          errors++;
        }
      }
    } catch (error: any) {
      errors++;
    }
  }
  
  console.log(`\n\n✅ Ingested ${ingested} signals (${errors} errors)\n`);
  return ingested;
}

async function runFullTest() {
  console.log('\n🔄 Complete Test Workflow for Channel C04D195JVGS');
  console.log('==================================================\n');
  
  // Check API server
  const apiRunning = await checkAPIServer();
  if (!apiRunning) {
    console.log('Please start the API server first: npm start\n');
    return;
  }
  
  // Step 1: Check for existing signals or prompt for ingestion
  console.log('Step 1: Checking for signals from channel...\n');
  const allSignals = await getSignals({ source: 'slack', limit: 10000 });
  const channelSignals = allSignals.filter(s => 
    s.metadata?.channel_id === CHANNEL_ID
  );
  
  console.log(`Found ${channelSignals.length} existing signals from channel ${CHANNEL_ID}\n`);
  
  if (channelSignals.length === 0) {
    console.log('⚠️  No signals found from this channel.');
    console.log('\nTo ingest messages, use one of these methods:\n');
    console.log('1. Cursor Extension (Recommended):');
    console.log('   - Press Cmd+Shift+P');
    console.log('   - Run: "PM Intelligence: Ingest Slack Channel (MCP)"');
    console.log('   - Enter channel ID: C04D195JVGS\n');
    console.log('2. Or manually via API (if you have message data):');
    console.log('   curl -X POST http://localhost:3000/api/signals \\');
    console.log('     -H "Content-Type: application/json" \\');
    console.log('     -d \'{"source":"slack","id":"msg_ts","type":"message","text":"Message text","metadata":{"channel_id":"C04D195JVGS"}}\'\n');
    return;
  }
  
  // Step 2: Detect opportunities
  console.log('Step 2: Detecting opportunities...\n');
  try {
    const detectionResult = await detectAndStoreOpportunitiesIncremental();
    console.log(`✓ Processed ${detectionResult.signalsProcessed} signals`);
    console.log(`✓ Created ${detectionResult.newOpportunities.length} new opportunities`);
    console.log(`✓ Updated ${detectionResult.updatedOpportunities.length} existing opportunities\n`);
  } catch (error: any) {
    console.error(`❌ Error detecting opportunities: ${error.message}\n`);
    return;
  }
  
  // Step 3: Find opportunities from this channel
  console.log('Step 3: Finding opportunities from channel...\n');
  const allOpportunities = await getAllOpportunities();
  const channelOpportunities = [];
  
  for (const opp of allOpportunities) {
    const oppSignals = await getSignalsForOpportunity(opp.id);
    const hasChannelSignal = oppSignals.some(s => 
      s.metadata?.channel_id === CHANNEL_ID
    );
    if (hasChannelSignal) {
      const channelSignalCount = oppSignals.filter(s => 
        s.metadata?.channel_id === CHANNEL_ID
      ).length;
      channelOpportunities.push({
        opportunity: opp,
        totalSignals: oppSignals.length,
        channelSignalCount,
        signals: oppSignals.filter(s => s.metadata?.channel_id === CHANNEL_ID)
      });
    }
  }
  
  console.log(`✓ Found ${channelOpportunities.length} opportunities\n`);
  
  // Step 4: Display opportunities
  console.log('\n📊 Opportunities from Channel C04D195JVGS');
  console.log('='.repeat(80) + '\n');
  
  if (channelOpportunities.length === 0) {
    console.log('No opportunities detected from this channel.');
    console.log('\nPossible reasons:');
    console.log('  1. Signals are not similar enough to cluster (similarity threshold: 0.15)');
    console.log('  2. Need at least 2 related signals to form an opportunity');
    console.log('  3. Try ingesting more messages or adjusting similarity threshold\n');
    return;
  }
  
  for (let i = 0; i < channelOpportunities.length; i++) {
    const { opportunity, totalSignals, channelSignalCount, signals } = channelOpportunities[i];
    console.log(`${i + 1}. ${opportunity.title}`);
    console.log(`   Description: ${opportunity.description}`);
    console.log(`   Status: ${opportunity.status}`);
    console.log(`   Total Signals: ${totalSignals}`);
    console.log(`   Signals from Channel: ${channelSignalCount}`);
    console.log(`   Created: ${opportunity.created_at.toISOString()}`);
    console.log(`   ID: ${opportunity.id}`);
    
    // Show sample signals
    if (signals.length > 0) {
      console.log(`\n   Sample signals from channel:`);
      signals.slice(0, 3).forEach((sig, idx) => {
        const preview = sig.content.substring(0, 80).replace(/\n/g, ' ');
        console.log(`     ${idx + 1}. ${preview}...`);
      });
    }
    console.log('');
  }
  
  // Step 5: Instructions for judgment/artifact creation
  console.log('\n📝 Next Steps (Require Cursor Extension):');
  console.log('='.repeat(80) + '\n');
  console.log('To create judgments and artifacts with REAL Cursor LLM:\n');
  console.log('1. Open Cursor IDE');
  console.log('2. Press Cmd+Shift+P (Mac) or Ctrl+Shift+P (Windows/Linux)');
  console.log('3. Run: "PM Intelligence: Create Judgment"');
  console.log('   - Select an opportunity from above');
  console.log('   - Enter your user ID');
  console.log('   - Review the generated judgment\n');
  console.log('4. Run: "PM Intelligence: Create Artifact"');
  console.log('   - Select the opportunity');
  console.log('   - Select the judgment');
  console.log('   - Choose PRD or RFC');
  console.log('   - Review the generated artifact\n');
  
  return {
    success: true,
    signalsFound: channelSignals.length,
    opportunitiesFound: channelOpportunities.length,
    opportunities: channelOpportunities.map(co => ({
      id: co.opportunity.id,
      title: co.opportunity.title,
      description: co.opportunity.description,
      status: co.opportunity.status,
      totalSignals: co.totalSignals,
      channelSignals: co.channelSignalCount,
      created_at: co.opportunity.created_at
    }))
  };
}

if (require.main === module) {
  // Check if fetch is available (Node 18+)
  if (typeof fetch === 'undefined') {
    const { default: fetch } = await import('node-fetch');
    (global as any).fetch = fetch;
  }
  
  runFullTest()
    .then((result) => {
      if (result) {
        console.log('✅ Test workflow completed!\n');
      }
      process.exit(0);
    })
    .catch(error => {
      console.error('\n❌ Fatal error:', error.message);
      console.error(error.stack);
      process.exit(1);
    });
}

export { runFullTest };
