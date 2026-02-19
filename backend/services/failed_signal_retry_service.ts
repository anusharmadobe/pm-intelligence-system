import { getDbPool } from '../db/connection';
import { createModuleLogger } from '../utils/logger';
import { IngestionPipelineService } from './ingestion_pipeline_service';
import { RawSignal } from '../ingestion/signal_types';

const logger = createModuleLogger('failed_signal_retry', 'LOG_LEVEL_FAILED_SIGNAL_RETRY');

/**
 * Failed signal retry service
 * Automatically retries failed signals with exponential backoff
 * Moves permanently failed signals to dead letter queue
 */

export interface FailedSignalAttempt {
  signal_id: string;
  source_ref: string;
  run_id: string;
  error_type: string;
  error_message: string;
  status: string;
  attempt_count: number;
  failed_at: Date;
  next_retry_at: Date;
  max_retries: number;
}

export interface RetryStats {
  total_pending: number;
  retried: number;
  succeeded: number;
  failed: number;
  moved_to_dlq: number;
}

/**
 * Get failed signals ready for retry
 * Uses exponential backoff based on attempt count
 */
export async function getFailedSignalsForRetry(
  limit: number = 100
): Promise<FailedSignalAttempt[]> {
  const pool = getDbPool();

  try {
    const result = await pool.query<FailedSignalAttempt>(
      `SELECT
         fsa.signal_id,
         fsa.source_ref,
         fsa.run_id,
         fsa.error_type,
         fsa.error_message,
         fsa.status,
         fsa.attempt_count,
         fsa.failed_at,
         fsa.next_retry_at,
         fsa.max_retries
       FROM failed_signal_attempts fsa
       WHERE fsa.status = 'pending'
         AND fsa.next_retry_at <= NOW()
         AND fsa.attempt_count < fsa.max_retries
       ORDER BY fsa.failed_at ASC
       LIMIT $1`,
      [limit]
    );

    return result.rows;
  } catch (error: any) {
    logger.error('Failed to get signals for retry', {
      error: error.message,
      errorClass: error.constructor.name,
      stack: error.stack
    });
    throw error;
  }
}

/**
 * Calculate next retry time using exponential backoff
 * Formula: baseDelay * 2^(attempt - 1) with jitter
 */
function calculateNextRetryTime(attemptCount: number): Date {
  const baseDelayMinutes = 5; // Start with 5 minutes
  const maxDelayMinutes = 1440; // Cap at 24 hours

  // Exponential backoff: 5, 10, 20, 40, 80, 160, 320, 640, 1280, 1440 (max)
  const exponentialDelay = baseDelayMinutes * Math.pow(2, attemptCount - 1);
  const delayMinutes = Math.min(exponentialDelay, maxDelayMinutes);

  // Add jitter (±20%) to prevent thundering herd
  const jitter = delayMinutes * 0.2 * (Math.random() * 2 - 1);
  const finalDelayMinutes = Math.max(1, delayMinutes + jitter);

  const nextRetry = new Date();
  nextRetry.setMinutes(nextRetry.getMinutes() + finalDelayMinutes);

  logger.debug('Calculated next retry time', {
    attempt_count: attemptCount,
    base_delay_minutes: baseDelayMinutes,
    exponential_delay_minutes: exponentialDelay,
    jitter_minutes: jitter.toFixed(2),
    final_delay_minutes: finalDelayMinutes,
    next_retry_at: nextRetry.toISOString()
  });

  return nextRetry;
}

/**
 * Retry a failed signal
 */
async function retryFailedSignal(
  attempt: FailedSignalAttempt,
  pipeline: IngestionPipelineService
): Promise<boolean> {
  const pool = getDbPool();

  try {
    // Mark as retrying
    await pool.query(
      `UPDATE failed_signal_attempts
       SET status = 'retrying', updated_at = NOW()
       WHERE signal_id = $1`,
      [attempt.signal_id]
    );

    // Get the original signal
    const signalResult = await pool.query(
      `SELECT id, source, content, metadata, created_at
       FROM signals
       WHERE id = $1`,
      [attempt.signal_id]
    );

    if (signalResult.rows.length === 0) {
      logger.warn('Signal not found for retry', {
        signalId: attempt.signal_id
      });
      // Mark as permanent_fail since signal is gone
      await moveToDLQ(attempt, 'Signal not found in database');
      return false;
    }

    const signal = signalResult.rows[0];

    // Create raw signal for reprocessing
    const rawSignal: RawSignal = {
      source: signal.source,
      content: signal.content,
      metadata: signal.metadata,
      timestamp: signal.created_at
    };

    // Retry processing
    await pipeline.ingest([rawSignal]);

    // Mark as recovered
    await pool.query(
      `UPDATE failed_signal_attempts
       SET status = 'recovered',
           replayed_at = NOW(),
           updated_at = NOW()
       WHERE signal_id = $1`,
      [attempt.signal_id]
    );

    logger.info('Failed signal retry succeeded', {
      signalId: attempt.signal_id,
      attemptCount: attempt.attempt_count,
      originalError: attempt.error_message
    });

    return true;
  } catch (error: any) {
    logger.error('Failed signal retry failed', {
      signalId: attempt.signal_id,
      attemptCount: attempt.attempt_count,
      error: error.message,
      errorClass: error.constructor.name
    });

    // Update attempt count and schedule next retry
    const newAttemptCount = attempt.attempt_count + 1;

    if (newAttemptCount >= attempt.max_retries) {
      // Move to DLQ
      await moveToDLQ(attempt, error.message);
      return false;
    } else {
      // Schedule next retry with exponential backoff
      const nextRetryAt = calculateNextRetryTime(newAttemptCount);

      await pool.query(
        `UPDATE failed_signal_attempts
         SET status = 'pending',
             attempt_count = $1,
             error_message = $2,
             next_retry_at = $3,
             updated_at = NOW()
         WHERE signal_id = $4`,
        [newAttemptCount, error.message, nextRetryAt, attempt.signal_id]
      );

      logger.info('Failed signal retry scheduled', {
        signalId: attempt.signal_id,
        attemptCount: newAttemptCount,
        maxRetries: attempt.max_retries,
        nextRetryAt: nextRetryAt.toISOString()
      });

      return false;
    }
  }
}

/**
 * Move a failed signal to the dead letter queue
 */
async function moveToDLQ(
  attempt: FailedSignalAttempt,
  finalError: string
): Promise<void> {
  const pool = getDbPool();

  try {
    // Insert into DLQ
    await pool.query(
      `INSERT INTO dead_letter_queue (
         signal_id, source_ref, run_id, attempts,
         final_error_type, final_error_message, failed_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (signal_id) DO UPDATE SET
         attempts = EXCLUDED.attempts,
         final_error_type = EXCLUDED.final_error_type,
         final_error_message = EXCLUDED.final_error_message,
         moved_to_dlq_at = NOW()`,
      [
        attempt.signal_id,
        attempt.source_ref,
        attempt.run_id,
        attempt.attempt_count,
        attempt.error_type,
        finalError,
        attempt.failed_at
      ]
    );

    // Update failed_signal_attempts status
    await pool.query(
      `UPDATE failed_signal_attempts
       SET status = 'moved_to_dlq', updated_at = NOW()
       WHERE signal_id = $1`,
      [attempt.signal_id]
    );

    logger.warn('Signal moved to dead letter queue', {
      signalId: attempt.signal_id,
      attempts: attempt.attempt_count,
      maxRetries: attempt.max_retries,
      finalError: finalError
    });
  } catch (error: any) {
    logger.error('Failed to move signal to DLQ', {
      signalId: attempt.signal_id,
      error: error.message,
      errorClass: error.constructor.name,
      stack: error.stack
    });
    throw error;
  }
}

/**
 * Retry all failed signals that are ready
 * Main entry point for scheduled job
 */
export async function retryFailedSignals(
  options: {
    batchSize?: number;
    concurrency?: number;
  } = {}
): Promise<RetryStats> {
  const { batchSize = 100, concurrency = 5 } = options;
  const startTime = Date.now();

  logger.info('Starting failed signal retry job', {
    batchSize,
    concurrency
  });

  const stats: RetryStats = {
    total_pending: 0,
    retried: 0,
    succeeded: 0,
    failed: 0,
    moved_to_dlq: 0
  };

  try {
    // Get pending count
    const pool = getDbPool();
    const countResult = await pool.query(
      `SELECT COUNT(*) as count
       FROM failed_signal_attempts
       WHERE status = 'pending'
         AND next_retry_at <= NOW()
         AND attempt_count < max_retries`
    );
    stats.total_pending = parseInt(countResult.rows[0].count);

    if (stats.total_pending === 0) {
      logger.info('No failed signals ready for retry');
      return stats;
    }

    // Get signals to retry
    const attempts = await getFailedSignalsForRetry(batchSize);
    stats.retried = attempts.length;

    logger.info('Retrieved failed signals for retry', {
      total_pending: stats.total_pending,
      batch_size: attempts.length
    });

    // Create pipeline for retries
    const pipeline = new IngestionPipelineService();

    // Process in batches with concurrency limit
    for (let i = 0; i < attempts.length; i += concurrency) {
      const batch = attempts.slice(i, i + concurrency);

      logger.trace('Processing retry batch', {
        batch_start: i + 1,
        batch_end: Math.min(i + concurrency, attempts.length),
        batch_size: batch.length,
        total_attempts: attempts.length,
        progress_percent: ((i / attempts.length) * 100).toFixed(1)
      });

      const results = await Promise.allSettled(
        batch.map(attempt => retryFailedSignal(attempt, pipeline))
      );

      // Count results
      for (const result of results) {
        if (result.status === 'fulfilled') {
          if (result.value) {
            stats.succeeded++;
          } else {
            stats.failed++;
          }
        } else {
          stats.failed++;
          logger.error('Retry promise rejected', {
            reason: result.reason
          });
        }
      }
    }

    // Calculate moved to DLQ
    stats.moved_to_dlq = stats.failed - (stats.retried - stats.succeeded - stats.moved_to_dlq);

    logger.info('Failed signal retry job complete', {
      ...stats,
      duration_ms: Date.now() - startTime,
      success_rate: stats.retried > 0 ? ((stats.succeeded / stats.retried) * 100).toFixed(1) + '%' : 'N/A'
    });

    return stats;
  } catch (error: any) {
    logger.error('Failed signal retry job failed', {
      error: error.message,
      errorClass: error.constructor.name,
      stack: error.stack,
      duration_ms: Date.now() - startTime
    });
    throw error;
  }
}

/**
 * Get dead letter queue statistics
 */
export async function getDLQStats(): Promise<{
  total_dlq: number;
  unreviewed: number;
  by_error_type: { error_type: string; count: number }[];
}> {
  const pool = getDbPool();

  try {
    const [totalResult, unreviewedResult, byTypeResult] = await Promise.all([
      pool.query('SELECT COUNT(*) as count FROM dead_letter_queue'),
      pool.query('SELECT COUNT(*) as count FROM dead_letter_queue WHERE NOT reviewed'),
      pool.query(`
        SELECT final_error_type as error_type, COUNT(*) as count
        FROM dead_letter_queue
        GROUP BY final_error_type
        ORDER BY count DESC
        LIMIT 10
      `)
    ]);

    return {
      total_dlq: parseInt(totalResult.rows[0].count),
      unreviewed: parseInt(unreviewedResult.rows[0].count),
      by_error_type: byTypeResult.rows.map(row => ({
        error_type: row.error_type,
        count: parseInt(row.count)
      }))
    };
  } catch (error: any) {
    logger.error('Failed to get DLQ stats', {
      error: error.message,
      errorClass: error.constructor.name,
      stack: error.stack
    });
    throw error;
  }
}
