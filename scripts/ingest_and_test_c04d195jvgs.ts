#!/usr/bin/env ts-node

/**
 * Complete ingestion and test for channel C04D195JVGS
 * This script attempts to use real MCP/LLM if available in Cursor IDE context
 * Provides clear instructions if MCP/LLM not available
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
 * Attempts to access real Slack MCP functions
 */
async function getSlackMCPFunctions(): Promise<{
  getChannelHistory: (params: { channel_id: string; limit?: number }) => Promise<any>;
} | null> {
  // Try multiple ways to access MCP
  // Method 1: Global MCP functions (available in Cursor IDE)
  if (typeof (global as any).mcp_Slack_slack_get_channel_history === 'function') {
    logger.info('Found MCP via global functions');
    return {
      getChannelHistory: (global as any).mcp_Slack_slack_get_channel_history
    };
  }
  
  // Method 2: Global mcp object
  if ((global as any).mcp?.Slack?.slack_get_channel_history) {
    logger.info('Found MCP via global.mcp');
    return {
      getChannelHistory: (global as any).mcp.Slack.slack_get_channel_history
    };
  }
  
  // Method 3: Process environment (might be set by Cursor)
  if (process.env.CURSOR_MCP_SLACK) {
    // MCP might be available through environment
    logger.info('MCP might be available through environment');
  }
  
  return null;
}

/**
 * Attempts to create real Cursor LLM provider
 */
function createRealLLMProvider(): LLMProvider | null {
  // Try to access LLM through global
  const globalLm = (global as any).lm || (global as any).cursor?.lm;
  
  if (globalLm) {
    if (typeof globalLm.sendChatRequest === 'function') {
      logger.info('Found LLM via global');
      return async (prompt: string): Promise<string> => {
        const response = await globalLm.sendChatRequest(
          [{ role: 'user', content: prompt }],
          { temperature: 0.7 }
        );
        return typeof response === 'string' ? response : response?.content || response?.text || String(response);
      };
    }
    
    if (typeof globalLm.selectChatModels === 'function') {
      logger.info('Found LLM via selectChatModels');
      return async (prompt: string): Promise<string> => {
        const models = await globalLm.selectChatModels();
        if (models && models.length > 0 && models[0].sendRequest) {
          const response = await models[0].sendRequest([{ role: 'user', content: prompt }]);
          return typeof response === 'string' ? response : String(response);
        }
        throw new Error('No LLM models available');
      };
    }
  }
  
  return null;
}

async function ingestAndTest() {
  console.log('\n🔄 Complete Ingestion & Test - Channel C04D195JVGS');
  console.log('====================================================\n');
  console.log('Attempting to use REAL Cursor MCP and LLM APIs\n');
  
  let ingestedCount = 0;
  
  // Step 1: Try to ingest using real MCP
  console.log('Step 1: Attempting to ingest messages using REAL Slack MCP...\n');
  
  const slackMCP = await getSlackMCPFunctions();
  
  if (slackMCP) {
    console.log('✅ Real Slack MCP accessed!\n');
    try {
      console.log(`Fetching messages from channel ${CHANNEL_ID}...\n`);
      const history = await slackMCP.getChannelHistory({
        channel_id: CHANNEL_ID,
        limit: 1000
      });
      
      const messages = history.messages || history || [];
      console.log(`✓ Retrieved ${messages.length} messages\n`);
      
      if (messages.length > 0) {
        console.log('Ingesting messages as signals...\n');
        
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
              thread_ts: message.thread_ts,
              client_msg_id: message.client_msg_id
            }
          };
          
          try {
            await ingestSignal(signal);
            ingestedCount++;
            if (ingestedCount % 10 === 0) process.stdout.write('.');
          } catch (error: any) {
            if (!error.message.includes('duplicate')) {
              logger.warn('Failed to ingest message', { error: error.message, ts: message.ts });
            }
          }
        }
        
        console.log(`\n\n✅ Successfully ingested ${ingestedCount} signals using REAL MCP!\n`);
      } else {
        console.log('⚠️  No messages found in channel\n');
      }
    } catch (error: any) {
      console.log(`❌ MCP error: ${error.message}\n`);
      console.log('   Falling back to check existing signals...\n');
    }
  } else {
    console.log('⚠️  Slack MCP not available in this context.');
    console.log('   This script needs to run in Cursor IDE with Slack MCP enabled.\n');
    console.log('   Alternative: Use Cursor extension command:');
    console.log('   "PM Intelligence: Ingest Slack Channel (MCP)"');
    console.log('   Then enter: C04D195JVGS\n');
  }
  
  // Check existing signals
  const allSignals = await getSignals({ source: 'slack', limit: 10000 });
  const channelSignals = allSignals.filter(s => 
    s.metadata?.channel_id === CHANNEL_ID
  );
  
  console.log(`\nCurrent status: ${channelSignals.length} signals from channel ${CHANNEL_ID}\n`);
  
  if (channelSignals.length === 0) {
    console.log('❌ No signals found. Cannot proceed without signals.\n');
    console.log('To ingest messages, use one of these methods:\n');
    console.log('1. Cursor Extension (Recommended - uses REAL MCP):');
    console.log('   - Press Cmd+Shift+P');
    console.log('   - Run: "PM Intelligence: Ingest Slack Channel (MCP)"');
    console.log('   - Enter: C04D195JVGS\n');
    console.log('2. Or run this script in Cursor IDE terminal (may have MCP access)\n');
    return;
  }
  
  // Step 2: Detect opportunities
  console.log('Step 2: Detecting opportunities...\n');
  const detectionResult = await detectAndStoreOpportunitiesIncremental();
  
  console.log(`✓ Processed ${detectionResult.signalsProcessed} signals`);
  console.log(`✓ Created ${detectionResult.newOpportunities.length} new opportunities`);
  console.log(`✓ Updated ${detectionResult.updatedOpportunities.length} existing opportunities\n`);
  
  // Step 3: Find and display opportunities
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
  
  // Display opportunities
  console.log('\n📊 Opportunities from Channel C04D195JVGS');
  console.log('='.repeat(80) + '\n');
  
  if (channelOpportunities.length === 0) {
    console.log('No opportunities detected from this channel.');
    console.log('\nPossible reasons:');
    console.log('  1. Signals are not similar enough (similarity threshold: 0.15)');
    console.log('  2. Need at least 2 related signals to form an opportunity');
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
      console.log(`\n   Sample signals:`);
      signals.slice(0, 2).forEach((sig, idx) => {
        const preview = sig.content.substring(0, 120).replace(/\n/g, ' ');
        console.log(`     ${idx + 1}. ${preview}...`);
      });
    }
    console.log('');
  }
  
  // Step 4: Test with REAL LLM
  console.log('Step 4: Testing with REAL Cursor LLM...\n');
  
  const realLLM = createRealLLMProvider();
  const testUserId = 'test-user@example.com';
  
  if (realLLM && channelOpportunities.length > 0) {
    console.log('✅ Real Cursor LLM accessed!\n');
    try {
      const opp = channelOpportunities[0].opportunity;
      console.log(`Creating judgment for: ${opp.title}\n`);
      
      const judgment = await createJudgment(opp.id, testUserId, realLLM);
      console.log(`✅ Judgment created with REAL LLM!`);
      console.log(`   ID: ${judgment.id}`);
      console.log(`   Confidence: ${judgment.confidence_level}`);
      console.log(`   Summary preview: ${judgment.summary.substring(0, 200)}...\n`);
      
      if (judgment.assumptions && typeof judgment.assumptions === 'object') {
        const assumptions = (judgment.assumptions as any).items || [];
        if (assumptions.length > 0) {
          console.log(`   Assumptions: ${assumptions.length}`);
          assumptions.slice(0, 2).forEach((a: string, i: number) => {
            console.log(`     ${i + 1}. ${a.substring(0, 80)}...`);
          });
        }
      }
      
      console.log(`\nGenerating PRD from judgment...\n`);
      const prd = await createArtifact(judgment.id, 'PRD', testUserId, realLLM);
      console.log(`✅ PRD generated with REAL LLM!`);
      console.log(`   ID: ${prd.id}`);
      console.log(`   Type: ${prd.artifact_type}`);
      console.log(`   Content length: ${prd.content.length} characters`);
      console.log(`   Preview: ${prd.content.substring(0, 200)}...\n`);
      
      console.log('✅ Full workflow completed with REAL LLM!\n');
    } catch (error: any) {
      console.log(`❌ LLM error: ${error.message}`);
      console.log('   Use Cursor extension commands for LLM features\n');
    }
  } else {
    console.log('⚠️  Cursor LLM not available in this context.');
    console.log('\nTo use REAL LLM:');
    console.log('1. Open Cursor IDE');
    console.log('2. Press Cmd+Shift+P');
    console.log('3. Run: "PM Intelligence: Create Judgment"');
    console.log('4. Select an opportunity from above');
    console.log('5. Run: "PM Intelligence: Create Artifact"\n');
  }
  
  // Final summary
  console.log('\n📊 Final Summary');
  console.log('='.repeat(80) + '\n');
  console.log(`Channel: C04D195JVGS`);
  console.log(`Signals found: ${channelSignals.length}`);
  console.log(`Opportunities detected: ${channelOpportunities.length}\n`);
  
  if (channelOpportunities.length > 0) {
    console.log('Opportunities Identified:\n');
    channelOpportunities.forEach((co, i) => {
      console.log(`${i + 1}. ${co.opportunity.title}`);
      console.log(`   ${co.channelSignalCount}/${co.totalSignals} signals from channel`);
      console.log(`   ${co.opportunity.description.substring(0, 100)}...`);
      console.log(`   ID: ${co.opportunity.id}\n`);
    });
  }
  
  return {
    success: true,
    signalsIngested: ingestedCount,
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
  ingestAndTest()
    .then((result) => {
      if (result) {
        console.log('✅ Complete test finished!\n');
      }
      process.exit(0);
    })
    .catch(error => {
      console.error('\n❌ Fatal error:', error.message);
      console.error(error.stack);
      process.exit(1);
    });
}

export { ingestAndTest };
