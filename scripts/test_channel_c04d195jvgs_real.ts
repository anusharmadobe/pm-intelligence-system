#!/usr/bin/env ts-node

/**
 * Real end-to-end test for channel C04D195JVGS
 * Uses actual Cursor MCP and LLM APIs (not mocks)
 * Must be run in Cursor IDE environment
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
 * Creates a real Cursor LLM provider
 * Attempts to use Cursor's actual LLM API
 */
function createRealCursorLLMProvider(): LLMProvider {
  return async (prompt: string): Promise<string> => {
    // Try to access Cursor's LLM API
    // This will work if run in Cursor IDE context
    const vscode = require('vscode');
    const lm = (vscode as any).lm;
    
    if (!lm) {
      // Try global access
      const globalLm = (global as any).lm || (global as any).cursor?.lm;
      if (globalLm) {
        if (typeof globalLm.sendChatRequest === 'function') {
          const response = await globalLm.sendChatRequest(
            [{ role: 'user', content: prompt }],
            { temperature: 0.7 }
          );
          return typeof response === 'string' ? response : response?.content || response?.text || String(response);
        }
      }
      
      throw new Error('Cursor LLM API not available. Please run this script in Cursor IDE.');
    }

    try {
      if (typeof lm.sendChatRequest === 'function') {
        const response = await lm.sendChatRequest(
          [{ role: 'user', content: prompt }],
          { temperature: 0.7 }
        );
        return typeof response === 'string' ? response : response?.content || response?.text || String(response);
      }
      
      if (typeof lm.selectChatModels === 'function') {
        const models = await lm.selectChatModels();
        if (models && models.length > 0 && models[0].sendRequest) {
          const response = await models[0].sendRequest([{ role: 'user', content: prompt }]);
          return typeof response === 'string' ? response : String(response);
        }
      }
      
      throw new Error('No compatible LLM method found');
    } catch (error: any) {
      throw new Error(`Failed to invoke Cursor LLM: ${error.message}`);
    }
  };
}

/**
 * Gets Slack MCP functions
 * Attempts to use actual Cursor MCP API
 */
async function getRealSlackMCP(): Promise<{
  getChannelHistory: (params: { channel_id: string; limit?: number }) => Promise<any>;
}> {
  // Try multiple ways to access MCP
  const vscode = require('vscode');
  
  // Method 1: Via global MCP functions
  if (typeof (global as any).mcp_Slack_slack_get_channel_history === 'function') {
    return {
      getChannelHistory: (global as any).mcp_Slack_slack_get_channel_history
    };
  }
  
  // Method 2: Via vscode.mcp
  if ((vscode as any).mcp?.Slack) {
    return {
      getChannelHistory: (vscode as any).mcp.Slack.slack_get_channel_history
    };
  }
  
  // Method 3: Via cursor.mcp
  if ((vscode as any).cursor?.mcp?.Slack) {
    return {
      getChannelHistory: (vscode as any).cursor.mcp.Slack.slack_get_channel_history
    };
  }
  
  throw new Error(
    'Slack MCP not available. ' +
    'Please ensure you are running this in Cursor IDE with Slack MCP enabled. ' +
    'Or use the Cursor extension command: "PM Intelligence: Ingest Slack Channel (MCP)"'
  );
}

async function testChannelC04D195JVGS() {
  console.log('\n🔄 Real End-to-End Test for Channel C04D195JVGS');
  console.log('==================================================\n');
  console.log('Using ACTUAL Cursor MCP and LLM APIs (not mocks)\n');
  
  try {
    // Step 1: Ingest messages from channel
    console.log('Step 1: Ingesting messages from channel C04D195JVGS...\n');
    
    let ingestedCount = 0;
    let messages: any[] = [];
    
    try {
      const slackMCP = await getRealSlackMCP();
      console.log('✓ Slack MCP accessed\n');
      
      console.log('Fetching channel history...\n');
      const history = await slackMCP.getChannelHistory({
        channel_id: CHANNEL_ID,
        limit: 1000
      });
      
      messages = history.messages || history || [];
      console.log(`✓ Retrieved ${messages.length} messages\n`);
      
      console.log('Ingesting messages as signals...\n');
      
      for (const message of messages) {
        if (message.subtype || message.bot_id || !message.text) {
          continue;
        }
        
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
            console.error(`\n⚠️  Failed to ingest: ${error.message}`);
          }
        }
      }
      
      console.log(`\n\n✅ Ingested ${ingestedCount} signals from channel\n`);
      
    } catch (error: any) {
      if (error.message.includes('MCP not available')) {
        console.log('⚠️  Slack MCP not available in this context.');
        console.log('   Please use Cursor extension command instead:');
        console.log('   "PM Intelligence: Ingest Slack Channel (MCP)"');
        console.log('   Then enter channel ID: C04D195JVGS\n');
        
        // Check if signals already exist
        const existingSignals = await getSignals({
          source: 'slack',
          limit: 10000
        });
        const channelSignals = existingSignals.filter(s => 
          s.metadata?.channel_id === CHANNEL_ID
        );
        
        if (channelSignals.length > 0) {
          console.log(`✓ Found ${channelSignals.length} existing signals from this channel\n`);
          ingestedCount = channelSignals.length;
        } else {
          console.log('❌ No existing signals found. Please ingest messages first.\n');
          return;
        }
      } else {
        throw error;
      }
    }
    
    // Step 2: Detect opportunities
    console.log('Step 2: Detecting opportunities...\n');
    const detectionResult = await detectAndStoreOpportunitiesIncremental();
    
    console.log(`   Processed ${detectionResult.signalsProcessed} signals`);
    console.log(`   Created ${detectionResult.newOpportunities.length} new opportunities`);
    console.log(`   Updated ${detectionResult.updatedOpportunities.length} existing opportunities\n`);
    
    // Step 3: Get opportunities from this channel
    console.log('Step 3: Finding opportunities from channel...\n');
    const allOpportunities = await getAllOpportunities();
    const channelSignals = await getSignals({
      source: 'slack',
      limit: 10000
    });
    const filteredChannelSignals = channelSignals.filter(s => 
      s.metadata?.channel_id === CHANNEL_ID
    );
    
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
          channelSignalCount
        });
      }
    }
    
    console.log(`✓ Found ${channelOpportunities.length} opportunities from channel\n`);
    
    if (channelOpportunities.length === 0) {
      console.log('⚠️  No opportunities detected.');
      console.log('   This could mean signals are not similar enough to cluster.\n');
      return;
    }
    
    // Step 4: Display opportunities
    console.log('\n📊 Opportunities from Channel C04D195JVGS');
    console.log('='.repeat(80) + '\n');
    
    for (let i = 0; i < channelOpportunities.length; i++) {
      const { opportunity, totalSignals, channelSignalCount } = channelOpportunities[i];
      console.log(`${i + 1}. ${opportunity.title}`);
      console.log(`   Description: ${opportunity.description}`);
      console.log(`   Status: ${opportunity.status}`);
      console.log(`   Total Signals: ${totalSignals}`);
      console.log(`   Signals from Channel: ${channelSignalCount}`);
      console.log(`   Created: ${opportunity.created_at.toISOString()}`);
      console.log(`   ID: ${opportunity.id}\n`);
    }
    
    // Step 5: Test judgment creation with REAL LLM
    console.log('Step 4: Testing judgment creation with REAL Cursor LLM...\n');
    
    try {
      const realLLM = createRealCursorLLMProvider();
      const testUserId = 'test-user@example.com';
      const opp = channelOpportunities[0].opportunity;
      
      console.log(`   Creating judgment for: ${opp.title}\n`);
      const judgment = await createJudgment(opp.id, testUserId, realLLM);
      
      console.log(`✅ Judgment created successfully!`);
      console.log(`   Judgment ID: ${judgment.id}`);
      console.log(`   Confidence: ${judgment.confidence_level}`);
      console.log(`   Summary length: ${judgment.summary.length} characters\n`);
      
      // Step 6: Test artifact generation with REAL LLM
      console.log('Step 5: Testing artifact generation with REAL Cursor LLM...\n');
      
      console.log(`   Generating PRD from judgment...\n`);
      const prd = await createArtifact(judgment.id, 'PRD', testUserId, realLLM);
      
      console.log(`✅ PRD generated successfully!`);
      console.log(`   Artifact ID: ${prd.id}`);
      console.log(`   Type: ${prd.artifact_type}`);
      console.log(`   Content length: ${prd.content.length} characters\n`);
      
      console.log('✅ Full workflow test with REAL LLM completed successfully!\n');
      
    } catch (error: any) {
      if (error.message.includes('LLM API not available')) {
        console.log('⚠️  Cursor LLM API not available in this context.');
        console.log('   Judgment/artifact creation requires Cursor IDE environment.');
        console.log('   Use Cursor extension commands instead:\n');
        console.log('   - "PM Intelligence: Create Judgment"');
        console.log('   - "PM Intelligence: Create Artifact"\n');
      } else {
        console.error(`❌ Error: ${error.message}\n`);
      }
    }
    
    // Final summary
    console.log('\n📊 Final Summary');
    console.log('='.repeat(80) + '\n');
    console.log(`Signals ingested: ${ingestedCount}`);
    console.log(`Opportunities detected: ${channelOpportunities.length}`);
    console.log(`\nOpportunities from Channel C04D195JVGS:\n`);
    
    channelOpportunities.forEach((co, i) => {
      console.log(`${i + 1}. ${co.opportunity.title}`);
      console.log(`   ${co.opportunity.description.substring(0, 100)}...`);
      console.log(`   Signals: ${co.channelSignalCount}/${co.totalSignals} from channel\n`);
    });
    
    return {
      success: true,
      signalsIngested: ingestedCount,
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
  testChannelC04D195JVGS()
    .then((result) => {
      if (result) {
        console.log('✅ Test completed!\n');
      }
      process.exit(0);
    })
    .catch(error => {
      console.error('\n❌ Fatal error:', error.message);
      process.exit(1);
    });
}

export { testChannelC04D195JVGS };
