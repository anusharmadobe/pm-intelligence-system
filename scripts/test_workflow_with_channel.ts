#!/usr/bin/env ts-node

/**
 * Test end-to-end workflow with messages from channel C04D195JVGS
 */

import * as dotenv from 'dotenv';
dotenv.config();

import { getSignals, SignalQueryOptions } from '../backend/processing/signal_extractor';
import { 
  detectAndStoreOpportunitiesIncremental,
  getAllOpportunities,
  getSignalsForOpportunity 
} from '../backend/services/opportunity_service';
import { createJudgment, getJudgmentsForOpportunity } from '../backend/services/judgment_service';
import { createArtifact } from '../backend/services/artifact_service';
import { createMockLLMProvider } from '../backend/utils/mock_llm_provider';
import { logger } from '../backend/utils/logger';

const CHANNEL_ID = 'C04D195JVGS';

async function testWorkflowWithChannel() {
  console.log('\n🔄 Testing End-to-End Workflow with Channel C04D195JVGS');
  console.log('==========================================================\n');
  
  try {
    // Step 1: Get signals from the channel
    console.log('Step 1: Retrieving signals from channel...\n');
    const channelSignals = await getSignals({
      source: 'slack',
      customer: undefined, // Will filter in memory
      limit: 1000
    });
    
    // Filter by channel ID in metadata
    const filteredSignals = channelSignals.filter(s => 
      s.metadata?.channel_id === CHANNEL_ID
    );
    
    console.log(`   Found ${filteredSignals.length} signals from channel ${CHANNEL_ID}\n`);
    
    if (filteredSignals.length === 0) {
      console.log('⚠️  No signals found. Please ingest messages first.');
      console.log('   Run: ts-node scripts/ingest_channel_c04d195jvgs.ts\n');
      return;
    }
    
    // Step 2: Detect opportunities incrementally
    console.log('Step 2: Detecting opportunities...\n');
    const detectionResult = await detectAndStoreOpportunitiesIncremental();
    
    console.log(`   Processed ${detectionResult.signalsProcessed} signals`);
    console.log(`   Created ${detectionResult.newOpportunities.length} new opportunities`);
    console.log(`   Updated ${detectionResult.updatedOpportunities.length} existing opportunities\n`);
    
    // Step 3: Get all opportunities (including those from this channel)
    const allOpportunities = await getAllOpportunities();
    
    // Find opportunities that contain signals from this channel
    const channelOpportunities = [];
    for (const opp of allOpportunities) {
      const oppSignals = await getSignalsForOpportunity(opp.id);
      const hasChannelSignal = oppSignals.some(s => 
        s.metadata?.channel_id === CHANNEL_ID
      );
      if (hasChannelSignal) {
        channelOpportunities.push({
          opportunity: opp,
          signalCount: oppSignals.length,
          channelSignalCount: oppSignals.filter(s => 
            s.metadata?.channel_id === CHANNEL_ID
          ).length
        });
      }
    }
    
    console.log(`\n📊 Opportunities from Channel ${CHANNEL_ID}`);
    console.log('==========================================\n');
    
    if (channelOpportunities.length === 0) {
      console.log('No opportunities detected from this channel yet.');
      console.log('This could mean:');
      console.log('  1. Signals are not similar enough to cluster');
      console.log('  2. Need more signals to form clusters');
      console.log('  3. Similarity threshold may need adjustment\n');
    } else {
      for (let i = 0; i < channelOpportunities.length; i++) {
        const { opportunity, signalCount, channelSignalCount } = channelOpportunities[i];
        console.log(`${i + 1}. ${opportunity.title}`);
        console.log(`   Description: ${opportunity.description}`);
        console.log(`   Status: ${opportunity.status}`);
        console.log(`   Total Signals: ${signalCount}`);
        console.log(`   Signals from Channel: ${channelSignalCount}`);
        console.log(`   Created: ${opportunity.created_at}`);
        console.log('');
      }
    }
    
    // Step 4: Test judgment creation (optional, requires LLM)
    if (channelOpportunities.length > 0 && process.env.TEST_WITH_LLM === 'true') {
      console.log('\nStep 3: Testing judgment creation...\n');
      const mockLLM = createMockLLMProvider();
      const testUserId = 'test-user@example.com';
      
      try {
        const opp = channelOpportunities[0].opportunity;
        const judgment = await createJudgment(opp.id, testUserId, mockLLM);
        console.log(`✅ Created judgment: ${judgment.id}`);
        console.log(`   Confidence: ${judgment.confidence_level}\n`);
        
        // Test artifact generation
        const prd = await createArtifact(judgment.id, 'PRD', testUserId, mockLLM);
        console.log(`✅ Created PRD: ${prd.id}`);
        console.log(`   Content length: ${prd.content.length} characters\n`);
      } catch (error: any) {
        console.log(`⚠️  Judgment/Artifact test skipped: ${error.message}\n`);
      }
    }
    
    return {
      success: true,
      signalsFound: filteredSignals.length,
      opportunitiesFound: channelOpportunities.length,
      opportunities: channelOpportunities.map(co => ({
        id: co.opportunity.id,
        title: co.opportunity.title,
        description: co.opportunity.description,
        signalCount: co.signalCount,
        channelSignalCount: co.channelSignalCount
      }))
    };
    
  } catch (error: any) {
    console.error('\n❌ Workflow test failed:', error.message);
    logger.error('Workflow test failed', { error: error.message, stack: error.stack });
    throw error;
  }
}

if (require.main === module) {
  testWorkflowWithChannel()
    .then((result) => {
      console.log('\n✅ Workflow test completed!\n');
      process.exit(0);
    })
    .catch(error => {
      console.error('\n❌ Fatal error:', error.message);
      process.exit(1);
    });
}

export { testWorkflowWithChannel };
