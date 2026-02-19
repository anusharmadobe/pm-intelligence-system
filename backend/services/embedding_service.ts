import { getDbPool } from '../db/connection';
import { Signal } from '../processing/signal_extractor';
import { LLMProvider } from './llm_service';
import { EmbeddingProvider, createOpenAIBatchEmbeddingProvider } from './embedding_provider';
import { logger } from '../utils/logger';

/**
 * Result of contextual embedding generation
 */
export interface ContextualEmbeddingResult {
  signalId: string;
  embedding: number[];
  contextualSummary: string;
  model: string;
}

/**
 * Generates a contextual summary of a signal for better embedding quality
 * Key insight: Embed LLM-generated summaries, not raw text
 */
export async function generateContextualSummary(
  signal: Signal,
  llmProvider: LLMProvider
): Promise<string> {
  const customers = signal.metadata?.customers?.join(', ') || 'Unknown';
  const topics = signal.metadata?.topics?.join(', ') || 'Not specified';
  
  const contextPrompt = `Summarize this customer signal for product insights in 2-3 sentences.
Focus on: product implications, customer needs, issues, or feature requests.

Source: ${signal.source}
Customer: ${customers}
Topics: ${topics}
Signal Type: ${signal.signal_type}

Content:
${signal.content.substring(0, 2000)}

Summary (focus on product implications):`;

  try {
    const summary = await llmProvider(contextPrompt);
    return summary.trim();
  } catch (error: any) {
    logger.warn('Failed to generate contextual summary, using fallback', { 
      error: error.message, 
      signalId: signal.id 
    });
    // Fallback: use a simplified version of the content
    return `Signal from ${signal.source} about ${topics}. Customer: ${customers}. ${signal.content.substring(0, 200)}`;
  }
}

/**
 * Generates embedding for a signal with contextual summary
 */
export async function generateContextualEmbedding(
  signal: Signal,
  llmProvider: LLMProvider,
  embeddingProvider: EmbeddingProvider,
  model: string = 'text-embedding-3-large'
): Promise<ContextualEmbeddingResult> {
  const startTime = Date.now();

  try {
    // Step 1: Generate contextual summary using LLM
    const contextualSummary = await generateContextualSummary(signal, llmProvider);

    // Step 2: Generate embedding from the contextual summary (not raw text)
    const embedding = await embeddingProvider(contextualSummary);

    logger.debug('Contextual embedding generated', {
      signalId: signal.id,
      summaryLength: contextualSummary.length,
      embeddingDimensions: embedding.length,
      durationMs: Date.now() - startTime
    });

    return {
      signalId: signal.id,
      embedding,
      contextualSummary,
      model
    };
  } catch (error: any) {
    logger.error('Failed to generate contextual embedding', {
      signalId: signal.id,
      error: error.message,
      errorClass: error.constructor.name,
      stack: error.stack,
      durationMs: Date.now() - startTime
    });
    throw error;
  }
}

/**
 * Stores a signal embedding in the database
 */
export async function storeSignalEmbedding(
  signalId: string,
  embedding: number[],
  contextualSummary: string,
  model: string
): Promise<void> {
  const pool = getDbPool();
  
  try {
    // Format embedding as PostgreSQL vector string
    const embeddingStr = `[${embedding.join(',')}]`;
    
    await pool.query(
      `INSERT INTO signal_embeddings (signal_id, embedding, contextual_summary, model, dimensions)
       VALUES ($1, $2::vector, $3, $4, $5)
       ON CONFLICT (signal_id) DO UPDATE SET
         embedding = EXCLUDED.embedding,
         contextual_summary = EXCLUDED.contextual_summary,
         model = EXCLUDED.model,
         dimensions = EXCLUDED.dimensions,
         created_at = NOW()`,
      [signalId, embeddingStr, contextualSummary, model, embedding.length]
    );
    
    logger.debug('Signal embedding stored', { signalId, model, dimensions: embedding.length });
  } catch (error: any) {
    logger.error('Failed to store signal embedding', { error: error.message, signalId });
    throw error;
  }
}

/**
 * Generates and stores embedding for a single signal
 */
export async function embedSignal(
  signal: Signal,
  llmProvider: LLMProvider,
  embeddingProvider: EmbeddingProvider,
  model: string = 'text-embedding-3-large'
): Promise<void> {
  try {
    const result = await generateContextualEmbedding(signal, llmProvider, embeddingProvider, model);
    await storeSignalEmbedding(result.signalId, result.embedding, result.contextualSummary, result.model);
    logger.debug('Signal embedding completed', { signalId: signal.id, model });
  } catch (error: any) {
    logger.error('Failed to embed signal', {
      signalId: signal.id,
      error: error.message,
      errorClass: error.constructor.name,
      stack: error.stack
    });
    throw error;
  }
}

/**
 * Batch generates embeddings for multiple signals
 * More efficient than individual embedding calls
 */
export async function batchGenerateEmbeddings(
  signals: Signal[],
  llmProvider: LLMProvider,
  embeddingProvider: EmbeddingProvider,
  options?: {
    batchSize?: number;
    model?: string;
    onProgress?: (completed: number, total: number) => void;
  }
): Promise<{ successful: number; failed: number; errors: string[] }> {
  const { batchSize = 10, model = 'text-embedding-3-large', onProgress } = options || {};
  
  let successful = 0;
  let failed = 0;
  const errors: string[] = [];
  const batchStartTime = Date.now();

  logger.info('Starting batch embedding generation', {
    signalCount: signals.length,
    batchSize,
    total_batches: Math.ceil(signals.length / batchSize)
  });

  // Process in batches
  for (let i = 0; i < signals.length; i += batchSize) {
    const batchNum = Math.floor(i / batchSize) + 1;
    const totalBatches = Math.ceil(signals.length / batchSize);
    const batchIterStartTime = Date.now();

    const batch = signals.slice(i, i + batchSize);

    logger.debug('Processing embedding batch', {
      stage: 'embedding_generation',
      status: 'batch_start',
      batch_number: batchNum,
      total_batches: totalBatches,
      batch_size: batch.length,
      progress_pct: ((i / signals.length) * 100).toFixed(1)
    });

    // Generate contextual summaries in parallel
    const summaryResults = await Promise.allSettled(
      batch.map(signal => generateContextualSummary(signal, llmProvider))
    );

    // Collect successful summaries
    const validSummaries: { signal: Signal; summary: string }[] = [];
    for (let j = 0; j < batch.length; j++) {
      const result = summaryResults[j];
      if (result.status === 'fulfilled') {
        validSummaries.push({ signal: batch[j], summary: result.value });
      } else {
        failed++;
        errors.push(`Signal ${batch[j].id}: ${result.reason?.message || 'Summary generation failed'}`);
      }
    }

    // Generate embeddings for valid summaries
    const embeddingResults = await Promise.allSettled(
      validSummaries.map(async ({ signal, summary }) => {
        const embedding = await embeddingProvider(summary);
        return { signalId: signal.id, embedding, summary };
      })
    );

    // Store embeddings
    for (let j = 0; j < embeddingResults.length; j++) {
      const result = embeddingResults[j];
      if (result.status === 'fulfilled') {
        try {
          await storeSignalEmbedding(
            result.value.signalId,
            result.value.embedding,
            result.value.summary,
            model
          );
          successful++;
        } catch (storeError: any) {
          failed++;
          errors.push(`Signal ${result.value.signalId}: ${storeError.message}`);
        }
      } else {
        failed++;
        errors.push(`Embedding failed: ${result.reason?.message || 'Unknown error'}`);
      }
    }

    const batchDuration = Date.now() - batchIterStartTime;
    const totalElapsed = Date.now() - batchStartTime;
    const processed = i + batch.length;
    const rate = processed / (totalElapsed / 1000);
    const remaining = signals.length - processed;
    const etaSeconds = remaining > 0 && rate > 0 ? (remaining / rate).toFixed(0) : 'N/A';

    logger.info('Embedding batch complete', {
      stage: 'embedding_generation',
      status: 'batch_complete',
      batch_number: batchNum,
      total_batches: totalBatches,
      batch_duration_ms: batchDuration,
      successful_so_far: successful,
      failed_so_far: failed,
      total_processed: processed,
      total_signals: signals.length,
      progress_pct: ((processed / signals.length) * 100).toFixed(1),
      rate_per_sec: rate.toFixed(2),
      eta_seconds: etaSeconds,
      total_elapsed_ms: totalElapsed
    });

    if (onProgress) {
      onProgress(i + batch.length, signals.length);
    }
  }
  
  logger.info('Batch embedding generation complete', { successful, failed });
  
  return { successful, failed, errors };
}

/**
 * Gets signals that don't have embeddings yet
 */
export async function getSignalsWithoutEmbeddings(limit: number = 100): Promise<Signal[]> {
  const pool = getDbPool();

  try {
    const result = await pool.query(
      `SELECT s.* FROM signals s
       LEFT JOIN signal_embeddings se ON s.id = se.signal_id
       WHERE se.signal_id IS NULL
       ORDER BY s.created_at DESC
       LIMIT $1`,
      [limit]
    );

    return result.rows.map((row) => ({
      ...row,
      metadata: row.metadata
        ? typeof row.metadata === 'string'
          ? JSON.parse(row.metadata)
          : row.metadata
        : null,
      created_at: new Date(row.created_at)
    }));
  } catch (error: any) {
    logger.error('Failed to get signals without embeddings', {
      error: error.message,
      errorClass: error.constructor.name,
      stack: error.stack,
      limit
    });
    throw error;
  }
}

/**
 * Gets embedding for a signal
 */
export async function getSignalEmbedding(signalId: string): Promise<{
  embedding: number[];
  contextualSummary: string;
  model: string;
} | null> {
  const pool = getDbPool();

  try {
    const result = await pool.query(
      `SELECT embedding::text, contextual_summary, model
       FROM signal_embeddings
       WHERE signal_id = $1`,
      [signalId]
    );

    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0];

    // Parse embedding from PostgreSQL vector format
    const embeddingStr = row.embedding.replace('[', '').replace(']', '');
    const embedding = embeddingStr.split(',').map((v: string) => parseFloat(v.trim()));

    return {
      embedding,
      contextualSummary: row.contextual_summary,
      model: row.model
    };
  } catch (error: any) {
    logger.error('Failed to get signal embedding', {
      signalId,
      error: error.message,
      errorClass: error.constructor.name,
      stack: error.stack
    });
    throw error;
  }
}

/**
 * Adds a signal to the embedding queue for async processing
 */
export async function queueSignalForEmbedding(
  signalId: string,
  priority: number = 5
): Promise<void> {
  const pool = getDbPool();

  try {
    await pool.query(
      `INSERT INTO embedding_queue (entity_type, entity_id, priority, status)
       VALUES ('signal', $1, $2, 'pending')
       ON CONFLICT (entity_type, entity_id) DO UPDATE SET
         priority = LEAST(embedding_queue.priority, EXCLUDED.priority),
         status = CASE WHEN embedding_queue.status = 'failed' THEN 'pending' ELSE embedding_queue.status END`,
      [signalId, priority]
    );
    logger.debug('Signal queued for embedding', { signalId, priority });
  } catch (error: any) {
    logger.error('Failed to queue signal for embedding', {
      signalId,
      priority,
      error: error.message,
      errorClass: error.constructor.name,
      stack: error.stack
    });
    throw error;
  }
}

/**
 * Processes pending items from the embedding queue
 */
export async function processEmbeddingQueue(
  llmProvider: LLMProvider,
  embeddingProvider: EmbeddingProvider,
  options?: {
    batchSize?: number;
    model?: string;
  }
): Promise<{ processed: number; failed: number }> {
  const pool = getDbPool();
  const { batchSize = 10, model = 'text-embedding-3-large' } = options || {};

  try {
    // Get pending items
    const pendingResult = await pool.query(
      `SELECT entity_id FROM embedding_queue
       WHERE entity_type = 'signal' AND status = 'pending'
       ORDER BY priority ASC, created_at ASC
       LIMIT $1`,
      [batchSize]
    );

    if (pendingResult.rows.length === 0) {
      return { processed: 0, failed: 0 };
    }

    const signalIds = pendingResult.rows.map((r) => r.entity_id);

    // Mark as processing
    await pool.query(
      `UPDATE embedding_queue SET status = 'processing'
       WHERE entity_type = 'signal' AND entity_id = ANY($1)`,
      [signalIds]
    );

    // Get signal data
    const signalsResult = await pool.query(`SELECT * FROM signals WHERE id = ANY($1)`, [signalIds]);

    const signals: Signal[] = signalsResult.rows.map((row) => ({
      ...row,
      metadata: row.metadata
        ? typeof row.metadata === 'string'
          ? JSON.parse(row.metadata)
          : row.metadata
        : null,
      created_at: new Date(row.created_at)
    }));

    let processed = 0;
    let failed = 0;

    for (const signal of signals) {
      try {
        await embedSignal(signal, llmProvider, embeddingProvider, model);

        await pool.query(
          `UPDATE embedding_queue SET status = 'completed', processed_at = NOW()
           WHERE entity_type = 'signal' AND entity_id = $1`,
          [signal.id]
        );

        processed++;
      } catch (error: any) {
        failed++;

        logger.error('Failed to embed signal from queue', {
          signalId: signal.id,
          error: error.message,
          errorClass: error.constructor.name
        });

        await pool.query(
          `UPDATE embedding_queue
           SET status = 'failed', attempts = attempts + 1, error_message = $2
           WHERE entity_type = 'signal' AND entity_id = $1`,
          [signal.id, error.message]
        );
      }
    }

    logger.info('Embedding queue processed', { processed, failed });

    return { processed, failed };
  } catch (error: any) {
    logger.error('Failed to process embedding queue', {
      error: error.message,
      errorClass: error.constructor.name,
      stack: error.stack,
      batchSize
    });
    throw error;
  }
}

/**
 * Gets embedding statistics
 */
export async function getEmbeddingStats(): Promise<{
  totalSignals: number;
  embeddedSignals: number;
  pendingQueue: number;
  failedQueue: number;
  coveragePercent: number;
}> {
  const pool = getDbPool();

  try {
    const [signalCount, embeddingCount, queueStats] = await Promise.all([
      pool.query('SELECT COUNT(*) as count FROM signals'),
      pool.query('SELECT COUNT(*) as count FROM signal_embeddings'),
      pool.query(`
        SELECT
          SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
          SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed
        FROM embedding_queue
        WHERE entity_type = 'signal'
      `)
    ]);

    const totalSignals = parseInt(signalCount.rows[0].count);
    const embeddedSignals = parseInt(embeddingCount.rows[0].count);
    const pendingQueue = parseInt(queueStats.rows[0].pending || 0);
    const failedQueue = parseInt(queueStats.rows[0].failed || 0);

    return {
      totalSignals,
      embeddedSignals,
      pendingQueue,
      failedQueue,
      coveragePercent: totalSignals > 0 ? Math.round((embeddedSignals / totalSignals) * 100) : 0
    };
  } catch (error: any) {
    logger.error('Failed to get embedding stats', {
      error: error.message,
      errorClass: error.constructor.name,
      stack: error.stack
    });
    throw error;
  }
}
