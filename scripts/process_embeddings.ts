#!/usr/bin/env ts-node
/**
 * Process embedding queue using Azure OpenAI
 * Generates contextual embeddings for signals stored in the queue
 */

import 'dotenv/config';
import { getDbPool, closeDbPool } from '../backend/db/connection';
import { createLLMProviderFromEnv, LLMProvider } from '../backend/services/llm_service';
import { createEmbeddingProviderFromEnv, EmbeddingProvider } from '../backend/services/embedding_provider';
import { processEmbeddingQueue, getEmbeddingStats } from '../backend/services/embedding_service';
import { logger } from '../backend/utils/logger';

// Configuration
const BATCH_SIZE = parseInt(process.env.EMBEDDING_BATCH_SIZE || '10', 10);
const MAX_BATCHES = parseInt(process.env.EMBEDDING_MAX_BATCHES || '0', 10);
const EMBEDDING_MODEL = process.env.AZURE_OPENAI_EMBEDDINGS_DEPLOYMENT || 'text-embedding-ada-002';
const EMBEDDING_DELAY_MS = parseInt(process.env.EMBEDDING_DELAY_MS || '200', 10);

async function main() {
  console.log('\n🔄 Starting Embedding Queue Processor\n');
  console.log('='.repeat(60));
  console.log(`   Batch Size: ${BATCH_SIZE}`);
  console.log(`   Max Batches: ${MAX_BATCHES}`);
  console.log(`   Model: ${EMBEDDING_MODEL}`);
  console.log('='.repeat(60));

  const pool = getDbPool();
  let llmProvider: LLMProvider | null = null;
  let embeddingProvider: EmbeddingProvider | null = null;

  try {
    // Initialize LLM provider (for contextual summaries)
    console.log('\n🤖 Initializing providers...');
    llmProvider = createLLMProviderFromEnv();
    console.log('   ✓ LLM provider initialized (Azure OpenAI GPT-4o)');

    embeddingProvider = createEmbeddingProviderFromEnv();
    if (!embeddingProvider) {
      throw new Error('Embedding provider not configured. Check EMBEDDING_PROVIDER in .env');
    }
    console.log(`   ✓ Embedding provider initialized (${EMBEDDING_MODEL})`);

    // Get initial stats
    console.log('\n📊 Queue Status:');
    const initialStats = await getEmbeddingStats();
    console.log(`   Total Signals: ${initialStats.totalSignals}`);
    console.log(`   Already Embedded: ${initialStats.embeddedSignals}`);
    console.log(`   Pending in Queue: ${initialStats.pendingQueue}`);
    console.log(`   Failed in Queue: ${initialStats.failedQueue}`);
    console.log(`   Coverage: ${initialStats.coveragePercent}%`);

    if (initialStats.pendingQueue === 0) {
      console.log('\n✅ No pending items in embedding queue. Nothing to process.');
      return;
    }

    // Process batches
    console.log('\n⚡ Processing embedding queue...');
    let totalProcessed = 0;
    let totalFailed = 0;
    let batchCount = 0;

    while (MAX_BATCHES === 0 || batchCount < MAX_BATCHES) {
      const result = await processEmbeddingQueue(llmProvider, embeddingProvider, {
        batchSize: BATCH_SIZE,
        model: EMBEDDING_MODEL
      });

      if (result.processed === 0 && result.failed === 0) {
        // Queue is empty
        break;
      }

      totalProcessed += result.processed;
      totalFailed += result.failed;
      batchCount++;

      console.log(`   Batch ${batchCount}: ${result.processed} processed, ${result.failed} failed`);

      // Small delay to avoid overwhelming the API
      if (MAX_BATCHES === 0 || batchCount < MAX_BATCHES) {
        await new Promise(resolve => setTimeout(resolve, EMBEDDING_DELAY_MS));
      }
    }

    // Final stats
    console.log('\n📊 Final Stats:');
    const finalStats = await getEmbeddingStats();
    console.log(`   Total Signals: ${finalStats.totalSignals}`);
    console.log(`   Embedded: ${finalStats.embeddedSignals}`);
    console.log(`   Pending: ${finalStats.pendingQueue}`);
    console.log(`   Failed: ${finalStats.failedQueue}`);
    console.log(`   Coverage: ${finalStats.coveragePercent}%`);

    console.log('\n' + '='.repeat(60));
    console.log('📈 PROCESSING SUMMARY');
    console.log('='.repeat(60));
    console.log(`   Batches Processed: ${batchCount}`);
    console.log(`   Total Embedded: ${totalProcessed}`);
    console.log(`   Total Failed: ${totalFailed}`);
    console.log(`   Success Rate: ${totalProcessed + totalFailed > 0 ? Math.round(totalProcessed / (totalProcessed + totalFailed) * 100) : 0}%`);

    // Show sample embedding
    if (totalProcessed > 0) {
      console.log('\n📋 Sample Embedding:');
      const sampleResult = await pool.query(`
        SELECT se.signal_id, se.contextual_summary, se.dimensions, s.content
        FROM signal_embeddings se
        JOIN signals s ON s.id = se.signal_id
        ORDER BY se.created_at DESC
        LIMIT 1
      `);
      if (sampleResult.rows.length > 0) {
        const sample = sampleResult.rows[0];
        console.log(`   Signal: ${sample.signal_id}`);
        console.log(`   Dimensions: ${sample.dimensions}`);
        console.log(`   Summary: ${sample.contextual_summary?.substring(0, 150)}...`);
      }
    }

    console.log('\n' + '='.repeat(60));
    console.log('✅ Embedding processing complete!');
    console.log('='.repeat(60));
    console.log('\nNext steps:');
    console.log('  • Run semantic search: curl "http://localhost:3000/api/search/semantic?q=pdf"');
    console.log('  • Generate JIRA issues: npm run generate-jira');
    console.log('  • Run full pipeline: npm run pipeline');

  } catch (error: any) {
    console.error('\n❌ Error:', error.message);
    logger.error('Embedding processor failed', { error: error.message });
    throw error;
  } finally {
    await closeDbPool();
  }
}

main().catch(console.error);
