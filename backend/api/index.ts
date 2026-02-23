import * as dotenv from 'dotenv';
dotenv.config();

import app from './server';
import { closeDbPool, getDbPool } from '../db/connection';
import { config } from '../config/env';
import { logger } from '../utils/logger';
import { initializeNeo4jSchema } from '../neo4j/schema';
import { startCleanupJobs } from '../jobs/cleanup_jobs';
import { startEventDispatcher } from '../agents/event_dispatcher';
import { startIngestionScheduler } from '../services/ingestion_scheduler_service';
import { closeNeo4jDriver } from '../neo4j/client';
import { closeSharedRedis } from '../config/redis';
import { validateLLMProviderEnv } from '../services/llm_service';
import { startCostMonitoringJobs, stopCostMonitoringJobs } from '../jobs/cost_monitoring_jobs';
import { shutdownCostTracking } from '../services/cost_tracking_service';

const RETRY_DELAY_MS = 5000;
const MAX_DB_RETRIES = parseInt(process.env.DB_CONNECT_MAX_RETRIES || '10', 10);

let server: ReturnType<typeof app.listen> | null = null;
let shuttingDown = false;

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForDatabase() {
  let attempts = 0;
  while (true) {
    try {
      const pool = getDbPool();
      await pool.query('SELECT 1');
      logger.info('Database connection established');
      return;
    } catch (error: any) {
      attempts += 1;
      if (attempts >= MAX_DB_RETRIES) {
        logger.error('Database connection failed after max retries', {
          attempts,
          error: error.message
        });
        throw error;
      }
      logger.error('Failed to connect to database, retrying', { error: error.message });
      await delay(RETRY_DELAY_MS);
    }
  }
}

async function startServer() {
  logger.info('Starting PM Intelligence API server', {
    host: config.api.host,
    port: config.api.port
  });

  try {
    validateLLMProviderEnv();
  } catch (error: any) {
    logger.error('LLM provider configuration invalid', { error: error?.message || error });
    throw error;
  }

  // Test database connection
  await waitForDatabase();

  // Initialize Neo4j schema if enabled
  try {
    if (config.featureFlags.neo4jSync) {
      await initializeNeo4jSchema();
    }
  } catch (error: any) {
    logger.warn('Neo4j schema initialization skipped', { error: error?.message || error });
  }

  if (process.env.START_CLEANUP_JOBS === 'true') {
    startCleanupJobs();
    logger.info('Cleanup jobs scheduled');
  }

  if (process.env.START_EVENT_DISPATCHER === 'true') {
    startEventDispatcher();
    logger.info('Event dispatcher started');
  }

  if (process.env.START_INGESTION_SCHEDULER === 'true') {
    startIngestionScheduler();
    logger.info('Ingestion scheduler started');
  }

  // Start cost monitoring jobs (refresh views, check budgets, emit metrics)
  if (process.env.FF_COST_TRACKING !== 'false') {
    startCostMonitoringJobs();
    logger.info('Cost monitoring jobs started');
  }

  server = app.listen(config.api.port, config.api.host, () => {
    logger.info('PM Intelligence API server started', {
      host: config.api.host,
      port: config.api.port,
      healthCheck: `http://localhost:${config.api.port}/health`
    });
  });
}

async function shutdown(signal: string) {
  if (shuttingDown) {
    logger.warn('Shutdown already in progress');
    return;
  }

  shuttingDown = true;
  const shutdownStart = Date.now();

  logger.info('Graceful shutdown initiated', {
    signal,
    pid: process.pid
  });

  // Force shutdown after 30 seconds
  const forceShutdownTimer = setTimeout(() => {
    logger.error('Forced shutdown after timeout', {
      elapsedMs: Date.now() - shutdownStart
    });
    process.exit(1);
  }, 30000);

  try {
    // Step 1: Stop accepting new requests
    if (server) {
      logger.info('Stopping HTTP server from accepting new connections');
      await new Promise((resolve, reject) => {
        server?.close((err) => {
          if (err) reject(err);
          else resolve(true);
        });
      });
      logger.info('HTTP server stopped accepting connections');
    }

    // Step 2: Stop background workers and queues
    try {
      const { IngestionPipelineService } = await import('../services/ingestion_pipeline_service');
      const pipeline = new IngestionPipelineService();
      await pipeline.cleanup();
      logger.info('Ingestion pipeline cleaned up');
    } catch (error: any) {
      logger.warn('Failed to cleanup ingestion pipeline', {
        error: error?.message || error
      });
    }

    // Step 3: Close browser instances
    try {
      const { WebsiteCrawlerService } = await import('../services/website_crawler_service');
      const crawler = new WebsiteCrawlerService();
      await crawler.close();
      logger.info('Website crawler cleaned up');
    } catch (error: any) {
      logger.warn('Failed to cleanup website crawler', {
        error: error?.message || error
      });
    }

    // Step 4: Shutdown cost tracking (flush remaining buffer)
    try {
      stopCostMonitoringJobs();
      await shutdownCostTracking();
      logger.info('Cost tracking shutdown complete');
    } catch (error: any) {
      logger.warn('Failed to shutdown cost tracking', {
        error: error?.message || error
      });
    }

    // Step 5: Close Redis connection
    try {
      await closeSharedRedis();
      logger.info('Redis connection closed');
    } catch (error: any) {
      logger.warn('Failed to close Redis connection', {
        error: error?.message || error
      });
    }

    // Step 6: Close database pool
    try {
      await closeDbPool();
      logger.info('Database pool closed');
    } catch (error: any) {
      logger.warn('Failed to close database pool', {
        error: error?.message || error
      });
    }

    // Step 7: Close Neo4j driver
    try {
      await closeNeo4jDriver();
      logger.info('Neo4j driver closed');
    } catch (error: any) {
      logger.warn('Failed to close Neo4j driver', {
        error: error?.message || error
      });
    }

    clearTimeout(forceShutdownTimer);

    logger.info('Graceful shutdown complete', {
      elapsedMs: Date.now() - shutdownStart
    });

    process.exit(0);
  } catch (error: any) {
    clearTimeout(forceShutdownTimer);

    logger.error('Error during shutdown', {
      error: error?.message || error,
      stack: error?.stack,
      elapsedMs: Date.now() - shutdownStart
    });

    process.exit(1);
  }
}

process.on('unhandledRejection', (reason: any) => {
  logger.error('Unhandled promise rejection', { reason: reason?.message || String(reason) });
});

process.on('uncaughtException', (error: any) => {
  logger.error('Uncaught exception', { error: error?.message || String(error) });
});

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

startServer();
