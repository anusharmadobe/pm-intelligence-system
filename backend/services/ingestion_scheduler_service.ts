import { Queue, Worker } from 'bullmq';
import crypto from 'crypto';
import { config } from '../config/env';
import { getDbPool } from '../db/connection';
import { IngestionPipelineService } from './ingestion_pipeline_service';
import { WebsiteCrawlerService } from './website_crawler_service';
import { logger } from '../utils/logger';
import { getSharedRedis } from '../config/redis';

const intervalMinutes = parseInt(process.env.INGESTION_SCHEDULER_INTERVAL_MINUTES || '60', 10);

export function startIngestionScheduler(): void {
  const connection = getSharedRedis();
  const queue = new Queue('ingestion_scheduler', { connection });

  queue.add(
    'scheduled_ingestion',
    {},
    {
      repeat: { every: intervalMinutes * 60 * 1000 }
    }
  );

  // Add website crawling job (runs every 6 hours)
  if (process.env.ENABLE_WEBSITE_CRAWLING === 'true') {
    queue.add(
      'crawl_websites',
      {},
      {
        repeat: { every: 6 * 60 * 60 * 1000 } // 6 hours
      }
    );
    logger.info('Website crawling scheduled', { interval: '6 hours' });
  }

  const worker = new Worker(
    'ingestion_scheduler',
    async (job) => {
      // Handle website crawling jobs
      if (job.name === 'crawl_websites') {
        const crawler = new WebsiteCrawlerService();
        try {
          const results = await crawler.crawlAllConfigured();
          logger.info('Scheduled website crawl complete', { results });
        } finally {
          await crawler.close();
        }
        return;
      }

      // Handle regular signal ingestion
      const pool = getDbPool();
      const result = await pool.query(
        `SELECT s.*
         FROM signals s
         LEFT JOIN signal_extractions se ON s.id = se.signal_id
         WHERE se.signal_id IS NULL
         ORDER BY s.created_at DESC
         LIMIT 200`
      );
      if (result.rows.length === 0) return;

      const rawSignals = result.rows.map((row) => ({
        id: row.id,
        source: row.source,
        content: row.content,
        normalized_content: row.normalized_content,
        metadata: row.metadata || {},
        content_hash: crypto
          .createHash('sha256')
          .update(row.normalized_content || row.content)
          .digest('hex'),
        created_at: row.created_at.toISOString()
      }));

      const pipeline = new IngestionPipelineService();
      await pipeline.ingest(rawSignals);
      logger.info('Scheduled ingestion completed', { count: rawSignals.length });
    },
    { connection }
  );

  worker.on('failed', (job, error) => {
    logger.error('Scheduled ingestion failed', { job: job?.id, error });
  });
}
