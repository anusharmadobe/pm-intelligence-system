#!/usr/bin/env ts-node

/**
 * Complete test for channel C04D195JVGS using REAL services
 * Tries to use actual Cursor MCP and LLM APIs if available
 * Falls back gracefully if not available
 */

import * as dotenv from 'dotenv';
dotenv.config();

import { ingestSignal, RawSignal, getSignals } from '../backend/processing/signal_extractor';
import { 
  detectAndStoreOpportunitiesIncremental,
  getAllOpportunities,
  getSignalsForOpportunity 
} from '../backend/services/opportunity_service';
import { createJudgment, getJudgmentsForOpportunity } from '../backend/services/judgment_service';
import { createArtifact } from '../backend/services/artifact_service';
import { LLMProvider } from '../backend/services/llm_service';
import { logger } from '../backend/utils/logger';

const CHANNEL_ID = 'C04D195JVGS';

/**
 * Try to get real Slack MCP functions
 * Works if run in Cursor IDE context
 */
async function tryGetSlackMCP(): Promise<{
  getChannelHistory: (params: { channel_id: string; limit?: number }) => Promise<any>;
} | null> {
  // Try global MCP functions (available in Cursor IDE)
  if (typeof (global as any).mcp_Slack_slack_get_channel_history === 'function') {
    return {
      getChannelHistory: (global as any).mcp_Slack_slack_get_channel_history
    };
  }
  
  // Try other global patterns
  if ((global as any).mcp?.Slack?.slack_get_channel_history) {
    return {
      getChannelHistory: (global as any).mcp.Slack.slack_get_channel_history
    };
  }
  
  return null;
}

/**
 * Try to create real Cursor LLM provider
 * Works if run in Cursor IDE context
 */
function tryCreateRealLLMProvider(): LLMProvider | null {
  // Try to access LLM through global (might be available in Cursor IDE)
  const globalLm = (global as any).lm || (global as any).cursor?.lm;
  
  if (globalLm && typeof globalLm.sendChatRequest === 'function') {
    return async (prompt: string): Promise<string> => {
      const response = await globalLm.sendChatRequest(
        [{ role: 'user', content: prompt }],
        { temperature: 0.7 }
      );
      return typeof response === 'string' ? response : response?.content || response?.text || String(response);
    };
  }
  
  return null;
}

async function completeTest() {
  console.log('\n🔄 Complete Test - Channel C04D195JVGS');
  console.log('========================================\n');
  console.log('Using REAL Cursor MCP and LLM APIs (if available)\n');
  
  try {
    // Step 1: Try to ingest messages using real MCP
    console.log('Step 1: Ingesting messages from channel C04D195JVGS...\n');
    
    let ingestedCount = 0;
    const slackMCP = await tryGetSlackMCP();
    
    if (slackMCP) {
      console.log('✓ Real Slack MCP accessed!\n');
      try {
        console.log('Fetching channel history...\n');
        const history = await slackMCP.getChannelHistory({
          channel_id: CHANNEL_ID,
          limit: 1000
        });
        
        const messages = history.messages || history || [];
        console.log(`✓ Retrieved ${messages.length} messages\n`);
        
        console.log('Ingesting messages...\n');
        for (const message of messages) {
          if (message.subtype || message.bot_id || !message.text) continue;
          
          const signal: RawSignal = {
            source: 'slack',
            id: message.ts || message.event_ts || Date.now().toString(),
            type: 'message',
            text: message.text,
            metadata: {
              channel_id: CHANNEL_ID,
              user: message.user,
              timestamp: message.ts,
              thread_ts: message.thread_ts
            }
          };
          
          try {
            await ingestSignal(signal);
            ingestedCount++;
            process.stdout.write('.');
          } catch (error: any) {
            if (!error.message.includes('duplicate')) {
              console.error(`\n⚠️  ${error.message}`);
            }
          }
        }
        console.log(`\n\n✅ Ingested ${ingestedCount} new signals\n`);
      } catch (error: any) {
        console.log(`⚠️  MCP error: ${error.message}`);
        console.log('   Continuing with existing signals...\n');
      }
    } else {
      console.log('⚠️  Slack MCP not available in this context.');
      console.log('   Checking for existing signals...\n');
    }
    
    // Check existing signals
    const allSignals = await getSignals({ source: 'slack', limit: 10000 });
    const channelSignals = allSignals.filter(s => 
      s.metadata?.channel_id === CHANNEL_ID
    );
    
    console.log(`Found ${channelSignals.length} total signals from channel ${CHANNEL_ID}\n`);
    
    if (channelSignals.length === 0) {
      console.log('❌ No signals found. Please ingest messages first.');
      console.log('\nTo ingest messages:');
      console.log('1. Use Cursor extension: "PM Intelligence: Ingest Slack Channel (MCP)"');
      console.log('2. Enter channel ID: C04D195JVGS\n');
      return;
    }
    
    // Step 2: Detect opportunities
    console.log('Step 2: Detecting opportunities...\n');
    const detectionResult = await detectAndStoreOpportunitiesIncremental();
    
    console.log(`✓ Processed ${detectionResult.signalsProcessed} signals`);
    console.log(`✓ Created ${detectionResult.newOpportunities.length} new opportunities`);
    console.log(`✓ Updated ${detectionResult.updatedOpportunities.length} existing opportunities\n`);
    
    // Step 3: Find opportunities from channel
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
      console.log('  1. Signals are not similar enough (threshold: 0.15)');
      console.log('  2. Need at least 2 related signals');
      console.log('  3. Try ingesting more messages\n');
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
      
      if (signals.length > 0) {
        console.log(`\n   Signals from channel:`);
        signals.slice(0, 2).forEach((sig, idx) => {
          const preview = sig.content.substring(0, 100).replace(/\n/g, ' ');
          console.log(`     ${idx + 1}. ${preview}...`);
        });
      }
      console.log('');
    }
    
    // Step 5: Test with REAL LLM
    console.log('Step 4: Testing with REAL Cursor LLM...\n');
    
    const realLLM = tryCreateRealLLMProvider();
    const testUserId = 'test-user@example.com';
    
    if (realLLM && channelOpportunities.length > 0) {
      console.log('✓ Real Cursor LLM accessed!\n');
      try {
        const opp = channelOpportunities[0].opportunity;
        console.log(`Creating judgment for: ${opp.title}\n`);
        
        const judgment = await createJudgment(opp.id, testUserId, realLLM);
        console.log(`✅ Judgment created with REAL LLM!`);
        console.log(`   ID: ${judgment.id}`);
        console.log(`   Confidence: ${judgment.confidence_level}`);
        console.log(`   Summary: ${judgment.summary.substring(0, 150)}...\n`);
        
        console.log(`Generating PRD from judgment...\n`);
        const prd = await createArtifact(judgment.id, 'PRD', testUserId, realLLM);
        console.log(`✅ PRD generated with REAL LLM!`);
        console.log(`   ID: ${prd.id}`);
        console.log(`   Content length: ${prd.content.length} characters\n`);
        
        console.log('✅ Full workflow completed with REAL LLM!\n');
      } catch (error: any) {
        console.log(`⚠️  LLM error: ${error.message}`);
        console.log('   Use Cursor extension commands for LLM features\n');
      }
    } else {
      console.log('⚠️  Cursor LLM not available in this context.');
      console.log('\nTo use REAL LLM:');
      console.log('1. Open Cursor IDE');
      console.log('2. Run: "PM Intelligence: Create Judgment"');
      console.log('3. Select an opportunity');
      console.log('4. Run: "PM Intelligence: Create Artifact"\n');
    }
    
    // Final summary
    console.log('\n📊 Final Summary');
    console.log('='.repeat(80) + '\n');
    console.log(`Channel: C04D195JVGS`);
    console.log(`Signals found: ${channelSignals.length}`);
    console.log(`Opportunities detected: ${channelOpportunities.length}\n`);
    
    if (channelOpportunities.length > 0) {
      console.log('Opportunities:\n');
      channelOpportunities.forEach((co, i) => {
        console.log(`${i + 1}. ${co.opportunity.title}`);
        console.log(`   ${co.channelSignalCount}/${co.totalSignals} signals from channel`);
        console.log(`   ${co.opportunity.description.substring(0, 80)}...\n`);
      });
    }
    
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
    
  } catch (error: any) {
    console.error('\n❌ Test failed:', error.message);
    console.error(error.stack);
    throw error;
  }
}

if (require.main === module) {
  completeTest()
    .then((result) => {
      if (result) {
        console.log('✅ Complete test finished!\n');
      }
      process.exit(0);
    })
    .catch(error => {
      console.error('\n❌ Fatal error:', error.message);
      process.exit(1);
    });
}

export { completeTest };
