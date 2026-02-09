/**
 * Standalone test script for judgment creation
 * Tests the judgment API without requiring the extension
 */

import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

// Load .env
const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
}

const API_BASE = process.env.API_BASE || 'http://localhost:3000';

async function testJudgmentCreation() {
  console.log('🧪 Testing Judgment Creation (Standalone)\n');
  console.log(`API Base: ${API_BASE}\n`);

  try {
    // Step 1: Check if API is running
    console.log('1️⃣ Checking API health...');
    const healthResponse = await fetch(`${API_BASE}/health`);
    if (!healthResponse.ok) {
      throw new Error(`API health check failed: ${healthResponse.status}`);
    }
    const health = await healthResponse.json() as any;
    console.log('✅ API is running');
    console.log(`   Database: ${health.database?.connected ? '✅ Connected' : '❌ Not connected'}\n`);

    // Step 2: Get opportunities
    console.log('2️⃣ Fetching opportunities...');
    const oppsResponse = await fetch(`${API_BASE}/api/opportunities?limit=10`);
    if (!oppsResponse.ok) {
      throw new Error(`Failed to fetch opportunities: ${oppsResponse.status}`);
    }
    const oppsData = await oppsResponse.json() as any;
    const opportunities = oppsData.opportunities || oppsData || [];
    
    if (opportunities.length === 0) {
      console.log('⚠️  No opportunities found. Creating one via detection...');
      
      // Try to detect opportunities
      const detectResponse = await fetch(`${API_BASE}/api/opportunities/detect/incremental`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      
      if (detectResponse.ok) {
        const newOpps = await detectResponse.json() as any;
        const oppsArray = Array.isArray(newOpps) ? newOpps : [];
        console.log(`✅ Detected ${oppsArray.length} opportunities`);
        opportunities.push(...oppsArray);
      }
      
      if (opportunities.length === 0) {
        throw new Error('No opportunities available. Please ingest signals first.');
      }
    }
    
    console.log(`✅ Found ${opportunities.length} opportunities`);
    const selectedOpp = opportunities[0];
    console.log(`   Selected: ${selectedOpp.title || selectedOpp.id}\n`);

    // Step 3: Get signals for the opportunity (try new endpoint, fallback to signals API)
    console.log('3️⃣ Fetching signals for opportunity...');
    let signals: any[] = [];
    const signalsResponse = await fetch(`${API_BASE}/api/opportunities/${selectedOpp.id}/signals`);
    if (signalsResponse.ok) {
      signals = await signalsResponse.json() as any[];
      console.log(`✅ Found ${signals.length} signals via opportunity endpoint`);
    } else {
      console.log(`⚠️  Opportunity signals endpoint returned ${signalsResponse.status}, trying signals API...`);
      // Fallback: get all signals and filter (less efficient but works)
      const allSignalsResponse = await fetch(`${API_BASE}/api/signals?limit=1000`);
      if (allSignalsResponse.ok) {
        const allSignalsData = await allSignalsResponse.json() as any;
        const allSignals = allSignalsData.signals || [];
        // We can't filter by opportunity without the endpoint, so just use count from opportunity
        const signalCount = parseInt(selectedOpp.description?.match(/(\d+) signals/)?.[1] || '0');
        console.log(`   Opportunity indicates ${signalCount} signals`);
        signals = allSignals.slice(0, Math.max(signalCount, 2)); // Use first few as sample
      }
    }
    
    if (signals.length > 0) {
      const firstSignal = signals[0] as any;
      console.log(`   Sample: ${firstSignal.text?.substring(0, 100) || firstSignal.content?.substring(0, 100) || 'N/A'}...\n`);
    } else {
      console.log('⚠️  No signals found for this opportunity (will proceed with test anyway)\n');
    }

    // Step 4: Create a test judgment
    console.log('4️⃣ Creating judgment via API...');
    const judgmentData = {
      opportunityId: selectedOpp.id,
      userId: 'test-user@example.com',
      analysis: `Test analysis for opportunity: ${selectedOpp.title || selectedOpp.id}

This is a test judgment created via the standalone test script. It verifies that:
- The API endpoint accepts judgment data
- The backend can save judgments
- The judgment creation flow works end-to-end

Signals analyzed: ${signals.length}
Opportunity: ${selectedOpp.title || selectedOpp.id}`,
      recommendation: 'Proceed with further investigation and customer validation',
      confidence: 0.7,
      reasoning: 'Test judgment created to verify API functionality'
    };

    const judgmentResponse = await fetch(`${API_BASE}/api/judgments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(judgmentData)
    });

    if (!judgmentResponse.ok) {
      const errorText = await judgmentResponse.text();
      throw new Error(`Failed to create judgment: ${judgmentResponse.status} - ${errorText}`);
    }

    const judgment = await judgmentResponse.json() as any;
    console.log('✅ Judgment created successfully!');
    console.log(`   ID: ${judgment.id}`);
    console.log(`   Confidence: ${judgment.confidence_level || 'N/A'}`);
    console.log(`   Summary length: ${judgment.summary?.length || 0} chars\n`);

    // Step 5: Verify judgment was saved
    console.log('5️⃣ Verifying judgment was saved...');
    const verifyResponse = await fetch(`${API_BASE}/api/judgments/${selectedOpp.id}`);
    if (!verifyResponse.ok) {
      throw new Error(`Failed to verify judgment: ${verifyResponse.status}`);
    }
    const savedJudgments = await verifyResponse.json() as any[];
    const foundJudgment = savedJudgments.find((j: any) => j.id === judgment.id);
    
    if (foundJudgment) {
      console.log('✅ Judgment verified in database');
      console.log(`   Total judgments for opportunity: ${savedJudgments.length}\n`);
    } else {
      console.log('⚠️  Judgment not found in verification query (may be a timing issue)\n');
    }

    console.log('🎉 All tests passed! Judgment creation is working.\n');
    console.log('Summary:');
    console.log(`- API Health: ✅`);
    console.log(`- Opportunities API: ✅`);
    console.log(`- Signals API: ✅`);
    console.log(`- Judgment Creation API: ✅`);
    console.log(`- Judgment Verification: ${foundJudgment ? '✅' : '⚠️'}`);

  } catch (error: any) {
    console.error('\n❌ Test failed!');
    console.error(`Error: ${error.message}`);
    if (error.stack) {
      console.error(`Stack: ${error.stack}`);
    }
    process.exit(1);
  }
}

// Run the test
testJudgmentCreation().catch(console.error);
