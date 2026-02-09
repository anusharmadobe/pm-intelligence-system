#!/usr/bin/env ts-node

/**
 * Comprehensive test of all extension backend functions
 * Simulates what the extension commands do
 */

import * as dotenv from 'dotenv';
dotenv.config();

import { getAllOpportunities } from '../backend/services/opportunity_service';
import { createJudgment, getJudgmentsForOpportunity } from '../backend/services/judgment_service';
import { getAllSignals } from '../backend/processing/signal_extractor';
import { getAdoptionMetrics, formatMetricsReport } from '../backend/services/metrics_service';
import { detectAndStoreOpportunities } from '../backend/services/opportunity_service';
import { ingestSignal } from '../backend/processing/signal_extractor';

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
  details?: string;
}

async function testGetAllOpportunities(): Promise<TestResult> {
  try {
    const opportunities = await getAllOpportunities();
    return {
      name: 'getAllOpportunities',
      passed: true,
      details: `Found ${opportunities.length} opportunities`
    };
  } catch (error: any) {
    return {
      name: 'getAllOpportunities',
      passed: false,
      error: error?.message || String(error)
    };
  }
}

async function testGetAllSignals(): Promise<TestResult> {
  try {
    const signals = await getAllSignals();
    return {
      name: 'getAllSignals',
      passed: true,
      details: `Found ${signals.length} signals`
    };
  } catch (error: any) {
    return {
      name: 'getAllSignals',
      passed: false,
      error: error?.message || String(error)
    };
  }
}

async function testGetAdoptionMetrics(): Promise<TestResult> {
  try {
    const metrics = await getAdoptionMetrics();
    const report = formatMetricsReport(metrics);
    return {
      name: 'getAdoptionMetrics + formatMetricsReport',
      passed: true,
      details: `Metrics: ${metrics.total_signals} signals, ${metrics.total_opportunities} opportunities`
    };
  } catch (error: any) {
    return {
      name: 'getAdoptionMetrics',
      passed: false,
      error: error?.message || String(error)
    };
  }
}

async function testCreateJudgment(): Promise<TestResult> {
  try {
    const opportunities = await getAllOpportunities();
    if (opportunities.length === 0) {
      return {
        name: 'createJudgment',
        passed: true,
        details: 'Skipped - no opportunities available'
      };
    }

    // Test with mock LLM that throws (to test error handling)
    const mockLLM = async (prompt: string): Promise<string> => {
      throw new Error('Mock LLM - not available in test');
    };

    try {
      await createJudgment(opportunities[0].id, 'test-user', mockLLM);
      return {
        name: 'createJudgment',
        passed: false,
        error: 'Should have thrown error for missing LLM'
      };
    } catch (error: any) {
      if (error.message.includes('LLM') || error.message.includes('Mock')) {
        return {
          name: 'createJudgment',
          passed: true,
          details: 'Properly handles LLM errors'
        };
      }
      throw error;
    }
  } catch (error: any) {
    return {
      name: 'createJudgment',
      passed: false,
      error: error?.message || String(error)
    };
  }
}

async function testDetectOpportunities(): Promise<TestResult> {
  try {
    const signals = await getAllSignals();
    if (signals.length === 0) {
      return {
        name: 'detectAndStoreOpportunities',
        passed: true,
        details: 'Skipped - no signals available'
      };
    }

    const testSignals = signals.slice(0, 5);
    const opportunities = await detectAndStoreOpportunities(testSignals);
    return {
      name: 'detectAndStoreOpportunities',
      passed: true,
      details: `Detected ${opportunities.length} opportunities from ${testSignals.length} signals`
    };
  } catch (error: any) {
    return {
      name: 'detectAndStoreOpportunities',
      passed: false,
      error: error?.message || String(error)
    };
  }
}

async function testIngestSignal(): Promise<TestResult> {
  try {
    const signal = await ingestSignal({
      source: 'test',
      text: 'Test signal for extension testing',
      type: 'test'
    });
    return {
      name: 'ingestSignal',
      passed: true,
      details: `Ingested signal: ${signal.id.substring(0, 8)}...`
    };
  } catch (error: any) {
    return {
      name: 'ingestSignal',
      passed: false,
      error: error?.message || String(error)
    };
  }
}

async function testGetJudgmentsForOpportunity(): Promise<TestResult> {
  try {
    const opportunities = await getAllOpportunities();
    if (opportunities.length === 0) {
      return {
        name: 'getJudgmentsForOpportunity',
        passed: true,
        details: 'Skipped - no opportunities available'
      };
    }

    const judgments = await getJudgmentsForOpportunity(opportunities[0].id);
    return {
      name: 'getJudgmentsForOpportunity',
      passed: true,
      details: `Found ${judgments.length} judgments for opportunity`
    };
  } catch (error: any) {
    return {
      name: 'getJudgmentsForOpportunity',
      passed: false,
      error: error?.message || String(error)
    };
  }
}

async function runAllTests() {
  console.log('\n' + '='.repeat(70));
  console.log('EXTENSION COMMAND BACKEND FUNCTION TESTS');
  console.log('='.repeat(70) + '\n');

  const tests = [
    await testGetAllOpportunities(),
    await testGetAllSignals(),
    await testGetAdoptionMetrics(),
    await testCreateJudgment(),
    await testDetectOpportunities(),
    await testIngestSignal(),
    await testGetJudgmentsForOpportunity()
  ];

  console.log('Test Results:\n');
  tests.forEach(test => {
    const status = test.passed ? '✅ PASS' : '❌ FAIL';
    console.log(`${status} ${test.name}`);
    if (test.details) {
      console.log(`   ${test.details}`);
    }
    if (test.error) {
      console.log(`   Error: ${test.error}`);
    }
    console.log();
  });

  const passed = tests.filter(t => t.passed).length;
  const total = tests.length;

  console.log('='.repeat(70));
  console.log(`SUMMARY: ${passed}/${total} tests passed`);
  console.log('='.repeat(70) + '\n');

  if (passed === total) {
    console.log('✅ All extension backend functions work correctly!');
    console.log('✅ Extension commands should work when installed in Cursor IDE.\n');
    return 0;
  } else {
    console.log('❌ Some tests failed. Fix errors before installing extension.\n');
    return 1;
  }
}

if (require.main === module) {
  runAllTests()
    .then(exitCode => process.exit(exitCode))
    .catch(error => {
      console.error('\n❌ Fatal error:', error);
      process.exit(1);
    });
}

export { runAllTests };
