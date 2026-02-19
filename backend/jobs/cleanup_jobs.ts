import { Queue, Worker } from 'bullmq';
import { promises as fs } from 'fs';
import path from 'path';
import { getDbPool } from '../db/connection';
import { config } from '../config/env';
import { logger } from '../utils/logger';
import { eventBus } from '../agents/event_bus';
import { getSharedRedis } from '../config/redis';
import { retryFailedSignals } from '../services/failed_signal_retry_service';

const uploadRetentionHours = parseInt(process.env.UPLOAD_RETENTION_HOURS || '24', 10);
const metricsRetentionDays = parseInt(process.env.METRICS_RETENTION_DAYS || '30', 10);
const signalRetentionDays = parseInt(process.env.SIGNAL_RETENTION_DAYS || '365', 10);
const eventRetentionDays = parseInt(process.env.EVENT_TTL_DAYS || '7', 10);

const archiveBaseDir = path.join(process.cwd(), 'data', 'archive', 'signals');

async function cleanupUploadedFiles(): Promise<void> {
  const dir = config.ingestion.uploadDir;
  const retentionMs = uploadRetentionHours * 60 * 60 * 1000;
  const now = Date.now();

  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      if (entry.name === '.gitkeep') continue;
      const filePath = path.join(dir, entry.name);
      const stats = await fs.stat(filePath);
      if (now - stats.mtimeMs > retentionMs) {
        await fs.unlink(filePath);
      }
    }
    logger.info('Cleanup uploaded files completed');
  } catch (error) {
    logger.warn('Cleanup uploaded files failed', { error });
  }
}

async function cleanupRawMetrics(): Promise<void> {
  const pool = getDbPool();
  try {
    await pool.query(
      `WITH aggregated AS (
        SELECT metric_name,
               date_trunc('day', recorded_at) AS day,
               AVG(metric_value) AS avg_value,
               SUM(metric_value) AS sum_value,
               COUNT(*)::int AS count
        FROM system_metrics
        WHERE recorded_at < NOW() - ($1 || ' days')::interval
          AND COALESCE(labels->>'aggregated', 'false') <> 'true'
        GROUP BY metric_name, day
      )
      INSERT INTO system_metrics (metric_name, metric_value, labels, recorded_at)
      SELECT
        CONCAT('daily_', metric_name),
        avg_value,
        jsonb_build_object('aggregated', true, 'count', count, 'sum', sum_value),
        day
      FROM aggregated`,
      [metricsRetentionDays]
    );

    await pool.query(
      `DELETE FROM system_metrics
       WHERE recorded_at < NOW() - ($1 || ' days')::interval
         AND COALESCE(labels->>'aggregated', 'false') <> 'true'`,
      [metricsRetentionDays]
    );
    logger.info('Cleanup raw metrics completed');
  } catch (error) {
    logger.warn('Cleanup raw metrics failed', { error });
  }
}

async function archiveOldSignals(): Promise<void> {
  const pool = getDbPool();
  const client = await pool.connect();

  try {
    await fs.mkdir(archiveBaseDir, { recursive: true });
    const fileName = `${new Date().toISOString().split('T')[0]}.jsonl`;
    const filePath = path.join(archiveBaseDir, fileName);

    await client.query('BEGIN');
    const result = await client.query(
      `SELECT s.*, se.extraction
       FROM signals s
       LEFT JOIN signal_extractions se ON s.id = se.signal_id
       WHERE s.created_at < NOW() - ($1 || ' days')::interval
       ORDER BY s.created_at ASC
       LIMIT 500`,
      [signalRetentionDays]
    );

    if (result.rows.length === 0) {
      await client.query('COMMIT');
      return;
    }

    const lines = result.rows.map((row) => JSON.stringify(row)).join('\n') + '\n';
    await fs.appendFile(filePath, lines, 'utf8');

    const ids = result.rows.map((row) => row.id);
    await client.query(`DELETE FROM signals WHERE id = ANY($1)`, [ids]);
    await client.query('COMMIT');
    logger.info('Archive old signals completed', { count: ids.length });
  } catch (error) {
    await client.query('ROLLBACK');
    logger.warn('Archive old signals failed', { error });
  } finally {
    client.release();
  }
}

async function trimEventBus(): Promise<void> {
  const retentionMs = eventRetentionDays * 24 * 60 * 60 * 1000;
  const minId = `${Date.now() - retentionMs}-0`;
  try {
    await eventBus.trimByMinId(minId);
    logger.info('Event bus trim completed', { minId });
  } catch (error) {
    logger.warn('Event bus trim failed', { error });
  }
}

async function cleanupIdempotencyKeys(): Promise<void> {
  const pool = getDbPool();
  try {
    await pool.query(`DELETE FROM idempotency_keys WHERE expires_at < NOW()`);
    logger.info('Idempotency key cleanup completed');
  } catch (error) {
    logger.warn('Idempotency key cleanup failed', { error });
  }
}

async function retryFailedSignalsJob(): Promise<void> {
  try {
    const stats = await retryFailedSignals({
      batchSize: 100,
      concurrency: 5
    });

    logger.info('Failed signal retry job completed', {
      total_pending: stats.total_pending,
      retried: stats.retried,
      succeeded: stats.succeeded,
      failed: stats.failed,
      moved_to_dlq: stats.moved_to_dlq
    });
  } catch (error: any) {
    logger.error('Failed signal retry job failed', {
      error: error.message,
      errorClass: error.constructor.name
    });
  }
}

export function startCleanupJobs(): void {
  const connection = getSharedRedis();
  const cleanupQueue = new Queue('cleanup', { connection });

  cleanupQueue.add('cleanup_uploaded_files', {}, {
    repeat: { every: 6 * 60 * 60 * 1000 }
  });

  cleanupQueue.add('cleanup_raw_metrics', {}, {
    repeat: { pattern: '30 3 * * *' }
  });

  cleanupQueue.add('archive_old_signals', {}, {
    repeat: { pattern: '0 2 * * 0' }
  });

  cleanupQueue.add('trim_event_bus', {}, {
    repeat: { pattern: '15 2 * * *' }
  });

  cleanupQueue.add('cleanup_idempotency_keys', {}, {
    repeat: { pattern: '45 2 * * *' }
  });

  // Retry failed signals every 15 minutes
  cleanupQueue.add('retry_failed_signals', {}, {
    repeat: { every: 15 * 60 * 1000 }
  });

  const worker = new Worker(
    'cleanup',
    async (job) => {
      switch (job.name) {
        case 'cleanup_uploaded_files':
          await cleanupUploadedFiles();
          break;
        case 'cleanup_raw_metrics':
          await cleanupRawMetrics();
          break;
        case 'archive_old_signals':
          await archiveOldSignals();
          break;
        case 'trim_event_bus':
          await trimEventBus();
          break;
        case 'cleanup_idempotency_keys':
          await cleanupIdempotencyKeys();
          break;
        case 'retry_failed_signals':
          await retryFailedSignalsJob();
          break;
        default:
          logger.warn('Unknown cleanup job', { job: job.name });
      }
    },
    { connection }
  );

  worker.on('failed', (job, error) => {
    logger.error('Cleanup job failed', { job: job?.name, error });
  });
}

if (require.main === module) {
  startCleanupJobs();
}
