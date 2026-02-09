#!/usr/bin/env ts-node

/**
 * List opportunities identified from messages in channel C04D195JVGS
 */

import * as dotenv from 'dotenv';
dotenv.config();

import { getSignals } from '../backend/processing/signal_extractor';
import { 
  getAllOpportunities,
  getSignalsForOpportunity 
} from '../backend/services/opportunity_service';

const CHANNEL_ID = 'C04D195JVGS';

async function listOpportunitiesFromChannel() {
  console.log('\n📊 Opportunities from Channel C04D195JVGS');
  console.log('==========================================\n');
  
  try {
    // Get all signals from the channel
    const allSignals = await getSignals({
      source: 'slack',
      limit: 10000
    });
    
    const channelSignals = allSignals.filter(s => 
      s.metadata?.channel_id === CHANNEL_ID
    );
    
    console.log(`Found ${channelSignals.length} signals from channel ${CHANNEL_ID}\n`);
    
    if (channelSignals.length === 0) {
      console.log('⚠️  No signals found from this channel.');
      console.log('   Please ingest messages first:');
      console.log('   npm run ingest-channel-c04d195jvgs\n');
      return;
    }
    
    // Get all opportunities
    const allOpportunities = await getAllOpportunities();
    
    // Find opportunities that contain signals from this channel
    const channelOpportunities = [];
    
    for (const opp of allOpportunities) {
      const oppSignals = await getSignalsForOpportunity(opp.id);
      const channelSignalIds = new Set(channelSignals.map(s => s.id));
      const matchingSignals = oppSignals.filter(s => channelSignalIds.has(s.id));
      
      if (matchingSignals.length > 0) {
        channelOpportunities.push({
          opportunity: opp,
          totalSignals: oppSignals.length,
          channelSignals: matchingSignals.length,
          channelSignalIds: matchingSignals.map(s => s.id)
        });
      }
    }
    
    console.log(`Found ${channelOpportunities.length} opportunities containing signals from this channel\n`);
    
    if (channelOpportunities.length === 0) {
      console.log('No opportunities detected yet.');
      console.log('This could mean:');
      console.log('  1. Signals are not similar enough to cluster');
      console.log('  2. Need more signals to form clusters (minimum 2)');
      console.log('  3. Similarity threshold may need adjustment');
      console.log('\nTry running:');
      console.log('  npm run test-channel-workflow\n');
      return;
    }
    
    // Display opportunities
    console.log('Opportunities:\n');
    console.log('='.repeat(80));
    
    for (let i = 0; i < channelOpportunities.length; i++) {
      const { opportunity, totalSignals, channelSignals: channelSignalCount } = channelOpportunities[i];
      
      console.log(`\n${i + 1}. ${opportunity.title}`);
      console.log(`   Description: ${opportunity.description}`);
      console.log(`   Status: ${opportunity.status}`);
      console.log(`   Total Signals: ${totalSignals}`);
      console.log(`   Signals from Channel: ${channelSignalCount}`);
      console.log(`   Created: ${opportunity.created_at.toISOString()}`);
      console.log(`   ID: ${opportunity.id}`);
    }
    
    console.log('\n' + '='.repeat(80));
    console.log(`\nTotal: ${channelOpportunities.length} opportunities\n`);
    
    return {
      channelId: CHANNEL_ID,
      signalsFound: channelSignals.length,
      opportunitiesFound: channelOpportunities.length,
      opportunities: channelOpportunities.map(co => ({
        id: co.opportunity.id,
        title: co.opportunity.title,
        description: co.opportunity.description,
        status: co.opportunity.status,
        totalSignals: co.totalSignals,
        channelSignals: co.channelSignals,
        created_at: co.opportunity.created_at
      }))
    };
    
  } catch (error: any) {
    console.error('\n❌ Error:', error.message);
    console.error(error.stack);
    throw error;
  }
}

if (require.main === module) {
  listOpportunitiesFromChannel()
    .then((result) => {
      if (result) {
        console.log('✅ Listing complete!\n');
      }
      process.exit(0);
    })
    .catch(error => {
      console.error('\n❌ Fatal error:', error.message);
      process.exit(1);
    });
}

export { listOpportunitiesFromChannel };
