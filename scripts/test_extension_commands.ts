#!/usr/bin/env ts-node

/**
 * Test script to verify extension commands work correctly
 * Tests all backend functions that the extension uses
 */

import * as dotenv from 'dotenv';
dotenv.config();

import { getAllOpportunities } from '../backend/services/opportunity_service';
import { createJudgment, getJudgmentsForOpportunity } from '../backend/services/judgment_service';
import { getAllSignals } from '../backend/processing/signal_extractor';
import { getAdoptionMetrics, formatMetricsReport } from '../backend/services/metrics_service';
import { detectAndStoreOpportunities } from '../backend/services/opportunity_service';

async function testGetAllOpportunities() {
  console.log('\n🧪 Testing getAllOpportunities...');
  try {
    const opportunities = await getAllOpportunities();
    console.log(`✅ Success: Found ${opportunities.length} opportunities`);
    if (opportunities.length > 0) {
      console.log(`   Sample: ${opportunities[0].title}`);
    }
    return true;
  } catch (error: any) {
    console.error(`❌ Error: ${error.message}`);
    console.error(`   Stack: ${error.stack}`);
    return false;
  }
}

async function testGetAllSignals() {
  console.log('\n🧪 Testing getAllSignals...');
  try {
    const signals = await getAllSignals();
    console.log(`✅ Success: Found ${signals.length} signals`);
    return true;
  } catch (error: any) {
    console.error(`❌ Error: ${error.message}`);
    console.error(`   Stack: ${error.stack}`);
    return false;
  }
}

async function testGetAdoptionMetrics() {
  console.log('\n🧪 Testing getAdoptionMetrics...');
  try {
    const metrics = await getAdoptionMetrics();
    console.log(`✅ Success: Metrics retrieved`);
    console.log(`   Total signals: ${metrics.total_signals}`);
    console.log(`   Total opportunities: ${metrics.total_opportunities}`);
    return true;
  } catch (error: any) {
    console.error(`❌ Error: ${error.message}`);
    console.error(`   Stack: ${error.stack}`);
    return false;
  }
}

async function testCreateJudgment() {
  console.log('\n🧪 Testing createJudgment (without LLM)...');
  try {
    const opportunities = await getAllOpportunities();
    if (opportunities.length === 0) {
      console.log('⚠️  Skipped: No opportunities available');
      return true;
    }

    // Test with mock LLM provider that throws error (to test error handling)
    const mockLLMProvider = async (prompt: string): Promise<string> => {
      throw new Error('Mock LLM provider - LLM not available in test context');
    };

    try {
      await createJudgment(opportunities[0].id, 'test-user', mockLLMProvider);
      console.log('❌ Unexpected: Should have thrown error');
      return false;
    } catch (error: any) {
      if (error.message.includes('LLM')) {
        console.log(`✅ Success: Properly handled LLM error: ${error.message}`);
        return true;
      }
      throw error;
    }
  } catch (error: any) {
    console.error(`❌ Error: ${error.message}`);
    console.error(`   Stack: ${error.stack}`);
    return false;
  }
}

async function testDetectOpportunities() {
  console.log('\n🧪 Testing detectAndStoreOpportunities...');
  try {
    const signals = await getAllSignals();
    if (signals.length === 0) {
      console.log('⚠️  Skipped: No signals available');
      return true;
    }

    // Test with small subset to avoid long execution
    const testSignals = signals.slice(0, 10);
    const opportunities = await detectAndStoreOpportunities(testSignals);
    console.log(`✅ Success: Detected ${opportunities.length} opportunities from ${testSignals.length} signals`);
    return true;
  } catch (error: any) {
    console.error(`❌ Error: ${error.message}`);
    console.error(`   Stack: ${error.stack}`);
    return false;
  }
}

async function runAllTests() {
  console.log('='.repeat(60));
  console.log('EXTENSION COMMAND TESTS');
  console.log('='.repeat(60));

  const results = {
    getAllOpportunities: await testGetAllOpportunities(),
    getAllSignals: await testGetAllSignals(),
    getAdoptionMetrics: await testGetAdoptionMetrics(),
    createJudgment: await testCreateJudgment(),
    detectOpportunities: await testDetectOpportunities()
  };

  console.log('\n' + '='.repeat(60));
  console.log('TEST RESULTS');
  console.log('='.repeat(60));
  
  const passed = Object.values(results).filter(r => r).length;
  const total = Object.keys(results).length;
  
  Object.entries(results).forEach(([test, passed]) => {
    console.log(`${passed ? '✅' : '❌'} ${test}`);
  });

  console.log(`\n${passed}/${total} tests passed`);

  if (passed === total) {
    console.log('\n✅ All extension backend functions work correctly!');
    process.exit(0);
  } else {
    console.log('\n❌ Some tests failed. Check errors above.');
    process.exit(1);
  }
}

if (require.main === module) {
  runAllTests().catch(error => {
    console.error('\n❌ Fatal error:', error);
    process.exit(1);
  });
}

export { runAllTests };
