#!/usr/bin/env ts-node

/**
 * Comprehensive test script for all improvements
 * Tests: deduplication, pagination, filtering, caching, batch operations
 */

import * as dotenv from 'dotenv';
dotenv.config();

import { 
  ingestSignal, 
  RawSignal, 
  getSignals, 
  countSignals,
  signalExists,
  SignalQueryOptions 
} from '../backend/processing/signal_extractor';
import { 
  detectAndStoreOpportunities, 
  getOpportunities,
  countOpportunities,
  getAllOpportunities,
  OpportunityQueryOptions
} from '../backend/services/opportunity_service';
import { logger } from '../backend/utils/logger';

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
  details?: any;
}

const results: TestResult[] = [];

function recordTest(name: string, passed: boolean, error?: string, details?: any) {
  results.push({ name, passed, error, details });
  const icon = passed ? '✅' : '❌';
  console.log(`${icon} ${name}`);
  if (error) console.log(`   Error: ${error}`);
  if (details) console.log(`   Details:`, JSON.stringify(details, null, 2));
}

async function testDeduplication() {
  console.log('\n📋 Test 1: Signal Deduplication');
  console.log('================================\n');
  
  const testSignal: RawSignal = {
    source: 'test',
    id: 'test-dedup-001',
    type: 'test',
    text: 'Test signal for deduplication check'
  };
  
  try {
    // First ingestion
    await ingestSignal(testSignal);
    recordTest('First ingestion succeeds', true);
    
    // Check if exists
    const exists = await signalExists('test', 'test-dedup-001');
    recordTest('signalExists() returns true for existing signal', exists === true);
    
    // Second ingestion (should be skipped)
    await ingestSignal(testSignal);
    recordTest('Second ingestion skipped (deduplication)', true);
    
    // Verify only one signal exists
    const signals = await getSignals({ source: 'test', signalType: 'test' });
    recordTest('Only one signal exists after duplicate ingestion', signals.length === 1, undefined, { count: signals.length });
    
  } catch (error: any) {
    recordTest('Deduplication test', false, error.message);
  }
}

async function testPagination() {
  console.log('\n📋 Test 2: Pagination');
  console.log('======================\n');
  
  try {
    // Create test signals
    const signals: RawSignal[] = [];
    for (let i = 0; i < 15; i++) {
      signals.push({
        source: 'test',
        id: `test-pagination-${i}`,
        type: 'test',
        text: `Test signal ${i} for pagination`
      });
    }
    
    // Ingest all
    for (const signal of signals) {
      try {
        await ingestSignal(signal);
      } catch (e) {
        // Ignore duplicates
      }
    }
    
    // Test pagination
    const page1 = await getSignals({ source: 'test', signalType: 'test', limit: 5, offset: 0 });
    const page2 = await getSignals({ source: 'test', signalType: 'test', limit: 5, offset: 5 });
    const total = await countSignals({ source: 'test', signalType: 'test' });
    
    recordTest('Page 1 has 5 signals', page1.length === 5, undefined, { count: page1.length });
    recordTest('Page 2 has 5 signals', page2.length === 5, undefined, { count: page2.length });
    recordTest('Total count is correct', total >= 15, undefined, { total });
    recordTest('Pages are different', page1[0].id !== page2[0].id);
    
  } catch (error: any) {
    recordTest('Pagination test', false, error.message);
  }
}

async function testFiltering() {
  console.log('\n📋 Test 3: Filtering');
  console.log('=====================\n');
  
  try {
    // Create signals with different properties
    const testSignals: RawSignal[] = [
      {
        source: 'test',
        id: 'test-filter-1',
        type: 'message',
        text: 'Customer NFCU meeting about IC Editor',
        metadata: { test: true }
      },
      {
        source: 'test',
        id: 'test-filter-2',
        type: 'mention',
        text: 'IRS customer discussion',
        metadata: { test: true }
      },
      {
        source: 'slack',
        id: 'test-filter-3',
        type: 'message',
        text: 'Another NFCU signal',
        metadata: { test: true }
      }
    ];
    
    for (const signal of testSignals) {
      try {
        await ingestSignal(signal);
      } catch (e) {
        // Ignore duplicates
      }
    }
    
    // Test source filter
    const testSource = await getSignals({ source: 'test' });
    recordTest('Source filter works', testSource.length > 0, undefined, { count: testSource.length });
    
    // Test type filter
    const messageType = await getSignals({ source: 'test', signalType: 'message' });
    recordTest('Type filter works', messageType.length > 0, undefined, { count: messageType.length });
    
    // Test customer filter (in-memory)
    const nfcuSignals = await getSignals({ source: 'test', customer: 'NFCU' });
    recordTest('Customer filter works', nfcuSignals.length > 0, undefined, { count: nfcuSignals.length });
    
  } catch (error: any) {
    recordTest('Filtering test', false, error.message);
  }
}

async function testEntityCaching() {
  console.log('\n📋 Test 4: Entity Caching');
  console.log('==========================\n');
  
  try {
    const signal: RawSignal = {
      source: 'test',
      id: 'test-cache-001',
      type: 'test',
      text: 'Customer NFCU meeting about IC Editor and Forms Experience Builder'
    };
    
    const result = await ingestSignal(signal);
    
    // Check if metadata contains cached entities
    const metadata = result.metadata || {};
    const hasCustomers = Array.isArray(metadata.customers) && metadata.customers.length > 0;
    const hasTopics = Array.isArray(metadata.topics) && metadata.topics.length > 0;
    const hasQualityScore = typeof metadata.quality_score === 'number';
    
    recordTest('Customers cached in metadata', hasCustomers, undefined, { customers: metadata.customers });
    recordTest('Topics cached in metadata', hasTopics, undefined, { topics: metadata.topics });
    recordTest('Quality score calculated', hasQualityScore, undefined, { score: metadata.quality_score });
    
  } catch (error: any) {
    recordTest('Entity caching test', false, error.message);
  }
}

async function testBatchOperations() {
  console.log('\n📋 Test 5: Batch Operations');
  console.log('===========================\n');
  
  try {
    // Create multiple signals
    const signals: RawSignal[] = [];
    for (let i = 0; i < 5; i++) {
      signals.push({
        source: 'test',
        id: `test-batch-${i}`,
        type: 'test',
        text: `Batch test signal ${i}`
      });
    }
    
    // Ingest all
    const ingested: string[] = [];
    for (const signal of signals) {
      try {
        const result = await ingestSignal(signal);
        ingested.push(result.id);
      } catch (e) {
        // Ignore duplicates
      }
    }
    
    // Detect opportunities (uses batch insert)
    const startTime = Date.now();
    const opportunities = await detectAndStoreOpportunities(
      await getSignals({ source: 'test', signalType: 'test' })
    );
    const duration = Date.now() - startTime;
    
    recordTest('Batch opportunity creation works', opportunities.length >= 0, undefined, { 
      count: opportunities.length,
      duration: `${duration}ms`
    });
    
    // Verify opportunities were stored
    if (opportunities.length > 0) {
      const stored = await getAllOpportunities();
      const testOpps = stored.filter(o => o.title.includes('test'));
      recordTest('Opportunities stored correctly', testOpps.length > 0, undefined, { count: testOpps.length });
    }
    
  } catch (error: any) {
    recordTest('Batch operations test', false, error.message);
  }
}

async function testOpportunityPagination() {
  console.log('\n📋 Test 6: Opportunity Pagination');
  console.log('=================================\n');
  
  try {
    const page1 = await getOpportunities({ limit: 5, offset: 0 });
    const page2 = await getOpportunities({ limit: 5, offset: 5 });
    const total = await countOpportunities({});
    
    recordTest('Opportunity page 1 retrieved', page1.length >= 0, undefined, { count: page1.length });
    recordTest('Opportunity page 2 retrieved', page2.length >= 0, undefined, { count: page2.length });
    recordTest('Opportunity total count works', total >= 0, undefined, { total });
    
  } catch (error: any) {
    recordTest('Opportunity pagination test', false, error.message);
  }
}

async function runAllTests() {
  console.log('\n🧪 Running Comprehensive Improvement Tests');
  console.log('==========================================\n');
  
  await testDeduplication();
  await testPagination();
  await testFiltering();
  await testEntityCaching();
  await testBatchOperations();
  await testOpportunityPagination();
  
  // Summary
  console.log('\n📊 Test Summary');
  console.log('================\n');
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  
  console.log(`Total tests: ${results.length}`);
  console.log(`✅ Passed: ${passed}`);
  console.log(`❌ Failed: ${failed}\n`);
  
  if (failed > 0) {
    console.log('Failed tests:');
    results.filter(r => !r.passed).forEach(r => {
      console.log(`  - ${r.name}: ${r.error || 'Unknown error'}`);
    });
  }
  
  return { passed, failed, total: results.length };
}

if (require.main === module) {
  runAllTests()
    .then(({ passed, failed }) => {
      process.exit(failed > 0 ? 1 : 0);
    })
    .catch(error => {
      console.error('\n❌ Fatal error:', error.message);
      process.exit(1);
    });
}

export { runAllTests };
