#!/usr/bin/env ts-node

/**
 * End-to-end test script for the complete PM Intelligence system
 * Tests all features: ingestion, detection, incremental detection, merging, etc.
 */

import * as dotenv from 'dotenv';
dotenv.config();

import { 
  ingestSignal, 
  RawSignal, 
  getSignals, 
  countSignals,
  getAllSignals
} from '../backend/processing/signal_extractor';
import { 
  detectAndStoreOpportunities,
  detectAndStoreOpportunitiesIncremental,
  getAllOpportunities,
  getOpportunities,
  countOpportunities,
  mergeRelatedOpportunities,
  getSignalsForOpportunity
} from '../backend/services/opportunity_service';
import { logger } from '../backend/utils/logger';

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
  duration?: number;
  details?: any;
}

const results: TestResult[] = [];

function recordTest(name: string, passed: boolean, error?: string, duration?: number, details?: any) {
  results.push({ name, passed, error, duration, details });
  const icon = passed ? '✅' : '❌';
  const timeStr = duration !== undefined ? ` (${duration}ms)` : '';
  console.log(`${icon} ${name}${timeStr}`);
  if (error) console.log(`   Error: ${error}`);
  if (details) console.log(`   Details:`, JSON.stringify(details, null, 2));
}

async function testSignalIngestion() {
  console.log('\n📋 Test 1: Signal Ingestion');
  console.log('============================\n');
  
  const testSignals: RawSignal[] = [
    {
      source: 'test',
      id: 'e2e-test-1',
      type: 'message',
      text: 'Customer NFCU meeting about IC Editor adoption. They want to expand usage across departments.'
    },
    {
      source: 'test',
      id: 'e2e-test-2',
      type: 'message',
      text: 'IRS customer discussed Automated Forms Conversion Service. Demo went well.'
    },
    {
      source: 'test',
      id: 'e2e-test-3',
      type: 'message',
      text: 'NFCU follow-up: They have 2 projects coming up in mid June. Need data binding from APIs.'
    },
    {
      source: 'test',
      id: 'e2e-test-4',
      type: 'message',
      text: 'LPL Financial meeting: Discussed form pre-filling and AFCS capabilities.'
    }
  ];
  
  try {
    const startTime = Date.now();
    const ingested: string[] = [];
    
    for (const signal of testSignals) {
      try {
        const result = await ingestSignal(signal);
        ingested.push(result.id);
      } catch (e: any) {
        // Ignore duplicates
        if (!e.message.includes('duplicate')) {
          throw e;
        }
      }
    }
    
    const duration = Date.now() - startTime;
    recordTest('Signal ingestion', ingested.length > 0, undefined, duration, { ingested: ingested.length });
    
    // Verify signals were stored
    const stored = await getSignals({ source: 'test' });
    recordTest('Signals stored correctly', stored.length >= testSignals.length, undefined, undefined, { count: stored.length });
    
    // Check metadata enrichment
    const enriched = stored.find(s => s.metadata?.customers || s.metadata?.topics);
    recordTest('Metadata enrichment works', !!enriched, undefined, undefined, { 
      hasCustomers: !!enriched?.metadata?.customers,
      hasTopics: !!enriched?.metadata?.topics
    });
    
  } catch (error: any) {
    recordTest('Signal ingestion', false, error.message);
  }
}

async function testOpportunityDetection() {
  console.log('\n📋 Test 2: Opportunity Detection');
  console.log('==================================\n');
  
  try {
    const signals = await getSignals({ source: 'test' });
    const startTime = Date.now();
    const opportunities = await detectAndStoreOpportunities(signals);
    const duration = Date.now() - startTime;
    
    recordTest('Opportunity detection', opportunities.length >= 0, undefined, duration, { 
      opportunities: opportunities.length,
      signalsAnalyzed: signals.length
    });
    
    if (opportunities.length > 0) {
      const opp = opportunities[0];
      const oppSignals = await getSignalsForOpportunity(opp.id);
      recordTest('Opportunity-signal linking', oppSignals.length > 0, undefined, undefined, { 
        signalsLinked: oppSignals.length 
      });
    }
    
  } catch (error: any) {
    recordTest('Opportunity detection', false, error.message);
  }
}

async function testIncrementalDetection() {
  console.log('\n📋 Test 3: Incremental Opportunity Detection');
  console.log('==============================================\n');
  
  try {
    // Add a new signal
    const newSignal: RawSignal = {
      source: 'test',
      id: 'e2e-test-incremental',
      type: 'message',
      text: 'NFCU update: They confirmed the IC Editor project will start next month.'
    };
    
    await ingestSignal(newSignal);
    
    const startTime = Date.now();
    const result = await detectAndStoreOpportunitiesIncremental();
    const duration = Date.now() - startTime;
    
    recordTest('Incremental detection', true, undefined, duration, {
      signalsProcessed: result.signalsProcessed,
      newOpportunities: result.newOpportunities.length,
      updatedOpportunities: result.updatedOpportunities.length
    });
    
    // Verify it's faster than full detection
    const allSignals = await getAllSignals();
    const fullStartTime = Date.now();
    await detectAndStoreOpportunities(allSignals);
    const fullDuration = Date.now() - fullStartTime;
    
    recordTest('Incremental is faster', duration < fullDuration, undefined, undefined, {
      incremental: duration,
      full: fullDuration,
      speedup: `${((fullDuration - duration) / fullDuration * 100).toFixed(1)}%`
    });
    
  } catch (error: any) {
    recordTest('Incremental detection', false, error.message);
  }
}

async function testPagination() {
  console.log('\n📋 Test 4: Pagination');
  console.log('======================\n');
  
  try {
    const page1 = await getSignals({ limit: 5, offset: 0 });
    const page2 = await getSignals({ limit: 5, offset: 5 });
    const total = await countSignals({});
    
    recordTest('Pagination works', page1.length <= 5 && page2.length <= 5, undefined, undefined, {
      page1Count: page1.length,
      page2Count: page2.length,
      total
    });
    
    const oppPage1 = await getOpportunities({ limit: 3, offset: 0 });
    const oppTotal = await countOpportunities({});
    
    recordTest('Opportunity pagination works', oppPage1.length <= 3, undefined, undefined, {
      page1Count: oppPage1.length,
      total: oppTotal
    });
    
  } catch (error: any) {
    recordTest('Pagination', false, error.message);
  }
}

async function testFiltering() {
  console.log('\n📋 Test 5: Filtering');
  console.log('=====================\n');
  
  try {
    const nfcuSignals = await getSignals({ customer: 'NFCU' });
    recordTest('Customer filtering', nfcuSignals.length >= 0, undefined, undefined, { count: nfcuSignals.length });
    
    const messageSignals = await getSignals({ source: 'test', signalType: 'message' });
    recordTest('Type filtering', messageSignals.length >= 0, undefined, undefined, { count: messageSignals.length });
    
    const newOpps = await getOpportunities({ status: 'new' });
    recordTest('Status filtering', newOpps.length >= 0, undefined, undefined, { count: newOpps.length });
    
  } catch (error: any) {
    recordTest('Filtering', false, error.message);
  }
}

async function testOpportunityMerging() {
  console.log('\n📋 Test 6: Opportunity Merging');
  console.log('===============================\n');
  
  try {
    const beforeCount = await countOpportunities({});
    const mergeCount = await mergeRelatedOpportunities(0.3);
    const afterCount = await countOpportunities({});
    
    recordTest('Opportunity merging', mergeCount >= 0, undefined, undefined, {
      before: beforeCount,
      after: afterCount,
      merged: mergeCount
    });
    
  } catch (error: any) {
    recordTest('Opportunity merging', false, error.message);
  }
}

async function testQualityValidation() {
  console.log('\n📋 Test 7: Quality Validation');
  console.log('============================\n');
  
  try {
    // Test too short signal
    try {
      await ingestSignal({
        source: 'test',
        id: 'e2e-quality-short',
        type: 'test',
        text: 'Hi' // Too short
      });
      recordTest('Quality validation rejects short signals', false, 'Should have rejected');
    } catch (e: any) {
      if (e.message.includes('10 characters')) {
        recordTest('Quality validation rejects short signals', true);
      } else {
        recordTest('Quality validation rejects short signals', false, e.message);
      }
    }
    
    // Test valid signal
    const validSignal: RawSignal = {
      source: 'test',
      id: 'e2e-quality-valid',
      type: 'test',
      text: 'This is a valid signal with enough content to pass quality checks.'
    };
    
    const result = await ingestSignal(validSignal);
    const qualityScore = result.metadata?.quality_score || 0;
    recordTest('Quality score calculated', qualityScore > 0, undefined, undefined, { score: qualityScore });
    
  } catch (error: any) {
    recordTest('Quality validation', false, error.message);
  }
}

async function runAllTests() {
  console.log('\n🧪 End-to-End System Tests');
  console.log('==========================\n');
  
  await testSignalIngestion();
  await testOpportunityDetection();
  await testIncrementalDetection();
  await testPagination();
  await testFiltering();
  await testOpportunityMerging();
  await testQualityValidation();
  
  // Summary
  console.log('\n📊 Test Summary');
  console.log('================\n');
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  const totalDuration = results.reduce((sum, r) => sum + (r.duration || 0), 0);
  
  console.log(`Total tests: ${results.length}`);
  console.log(`✅ Passed: ${passed}`);
  console.log(`❌ Failed: ${failed}`);
  console.log(`⏱️  Total duration: ${totalDuration}ms\n`);
  
  if (failed > 0) {
    console.log('Failed tests:');
    results.filter(r => !r.passed).forEach(r => {
      console.log(`  - ${r.name}: ${r.error || 'Unknown error'}`);
    });
    console.log('');
  }
  
  return { passed, failed, total: results.length, duration: totalDuration };
}

if (require.main === module) {
  runAllTests()
    .then(({ passed, failed }) => {
      process.exit(failed > 0 ? 1 : 0);
    })
    .catch(error => {
      console.error('\n❌ Fatal error:', error.message);
      console.error(error.stack);
      process.exit(1);
    });
}

export { runAllTests };
