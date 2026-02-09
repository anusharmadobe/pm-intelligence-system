#!/usr/bin/env ts-node

/**
 * End-to-end test of the complete PM Intelligence workflow:
 * Signals → Opportunities → Judgments → Artifacts
 */

import * as dotenv from 'dotenv';
dotenv.config();

import { ingestSignal, RawSignal, getAllSignals } from '../backend/processing/signal_extractor';
import { 
  detectAndStoreOpportunities, 
  getAllOpportunities,
  getSignalsForOpportunity 
} from '../backend/services/opportunity_service';
import { createJudgment, getJudgmentsForOpportunity } from '../backend/services/judgment_service';
import { createArtifact, getArtifactsForJudgment } from '../backend/services/artifact_service';
import { createMockLLMProvider } from '../backend/utils/mock_llm_provider';
import { logger } from '../backend/utils/logger';

interface TestResult {
  step: string;
  passed: boolean;
  error?: string;
  details?: any;
}

const results: TestResult[] = [];

function recordStep(step: string, passed: boolean, error?: string, details?: any) {
  results.push({ step, passed, error, details });
  const icon = passed ? '✅' : '❌';
  console.log(`${icon} ${step}`);
  if (error) console.log(`   Error: ${error}`);
  if (details) console.log(`   Details:`, JSON.stringify(details, null, 2));
}

async function testFullWorkflow() {
  console.log('\n🔄 Testing Complete PM Intelligence Workflow');
  console.log('============================================\n');
  
  const mockLLM = createMockLLMProvider();
  const testUserId = 'test-user@example.com';
  
  try {
    // Step 1: Ingest Signals
    console.log('Step 1: Ingesting Test Signals...\n');
    const testSignals: RawSignal[] = [
      {
        source: 'test-workflow',
        id: 'workflow-test-1',
        type: 'message',
        text: 'Customer NFCU meeting: They want to expand IC Editor usage across departments. Two projects starting mid-June.'
      },
      {
        source: 'test-workflow',
        id: 'workflow-test-2',
        type: 'message',
        text: 'NFCU follow-up: Major requirement is data binding from APIs. Need to showcase current IC Editor status.'
      },
      {
        source: 'test-workflow',
        id: 'workflow-test-3',
        type: 'message',
        text: 'IRS customer discussed Automated Forms Conversion Service. Demo went well. Core component support needed.'
      }
    ];
    
    const ingestedIds: string[] = [];
    for (const signal of testSignals) {
      try {
        const result = await ingestSignal(signal);
        ingestedIds.push(result.id);
      } catch (e: any) {
        if (!e.message.includes('duplicate')) throw e;
      }
    }
    
    recordStep('Signal Ingestion', ingestedIds.length > 0, undefined, { ingested: ingestedIds.length });
    
    // Step 2: Detect Opportunities
    console.log('\nStep 2: Detecting Opportunities...\n');
    const allSignals = await getAllSignals();
    const workflowSignals = allSignals.filter(s => s.source === 'test-workflow');
    const opportunities = await detectAndStoreOpportunities(workflowSignals);
    
    recordStep('Opportunity Detection', opportunities.length > 0, undefined, { 
      opportunities: opportunities.length,
      signalsAnalyzed: workflowSignals.length
    });
    
    if (opportunities.length === 0) {
      console.log('⚠️  No opportunities detected. Cannot continue workflow test.');
      return { success: false, reason: 'No opportunities detected' };
    }
    
    // Step 3: Create Judgment
    console.log('\nStep 3: Creating Judgment with LLM...\n');
    const opportunity = opportunities[0];
    const judgment = await createJudgment(opportunity.id, testUserId, mockLLM);
    
    recordStep('Judgment Creation', !!judgment, undefined, {
      judgmentId: judgment.id,
      confidenceLevel: judgment.confidence_level,
      hasSummary: !!judgment.summary,
      hasAssumptions: !!judgment.assumptions,
      hasMissingEvidence: !!judgment.missing_evidence
    });
    
    // Step 4: Generate Artifact
    console.log('\nStep 4: Generating Artifact (PRD)...\n');
    const prd = await createArtifact(judgment.id, 'PRD', testUserId, mockLLM);
    
    recordStep('Artifact Generation (PRD)', !!prd, undefined, {
      artifactId: prd.id,
      artifactType: prd.artifact_type,
      contentLength: prd.content.length,
      hasContent: prd.content.length > 0
    });
    
    // Step 5: Generate RFC
    console.log('\nStep 5: Generating Artifact (RFC)...\n');
    const rfc = await createArtifact(judgment.id, 'RFC', testUserId, mockLLM);
    
    recordStep('Artifact Generation (RFC)', !!rfc, undefined, {
      artifactId: rfc.id,
      artifactType: rfc.artifact_type,
      contentLength: rfc.content.length
    });
    
    // Step 6: Verify Data Integrity
    console.log('\nStep 6: Verifying Data Integrity...\n');
    const oppSignals = await getSignalsForOpportunity(opportunity.id);
    const oppJudgments = await getJudgmentsForOpportunity(opportunity.id);
    const judgmentArtifacts = await getArtifactsForJudgment(judgment.id);
    
    recordStep('Data Integrity Check', 
      oppSignals.length > 0 && 
      oppJudgments.length > 0 && 
      judgmentArtifacts.length > 0,
      undefined,
      {
        signalsLinked: oppSignals.length,
        judgmentsLinked: oppJudgments.length,
        artifactsLinked: judgmentArtifacts.length
      }
    );
    
    // Summary
    console.log('\n📊 Workflow Test Summary');
    console.log('========================\n');
    const passed = results.filter(r => r.passed).length;
    const failed = results.filter(r => !r.passed).length;
    
    console.log(`Total steps: ${results.length}`);
    console.log(`✅ Passed: ${passed}`);
    console.log(`❌ Failed: ${failed}\n`);
    
    if (failed > 0) {
      console.log('Failed steps:');
      results.filter(r => !r.passed).forEach(r => {
        console.log(`  - ${r.step}: ${r.error || 'Unknown error'}`);
      });
    }
    
    return {
      success: failed === 0,
      passed,
      failed,
      total: results.length,
      opportunityId: opportunity.id,
      judgmentId: judgment.id,
      artifactIds: [prd.id, rfc.id]
    };
    
  } catch (error: any) {
    console.error('\n❌ Workflow test failed:', error.message);
    console.error(error.stack);
    recordStep('Workflow Test', false, error.message);
    return { success: false, error: error.message };
  }
}

if (require.main === module) {
  testFullWorkflow()
    .then((result) => {
      if (result.success) {
        console.log('\n✅ Full workflow test completed successfully!\n');
        process.exit(0);
      } else {
        console.log('\n❌ Workflow test failed\n');
        process.exit(1);
      }
    })
    .catch(error => {
      console.error('\n❌ Fatal error:', error.message);
      process.exit(1);
    });
}

export { testFullWorkflow };
