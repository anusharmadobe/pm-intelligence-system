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

  server = app.listen(config.api.port, config.api.host, () => {
    logger.info('PM Intelligence API server started', {
      host: config.api.host,
      port: config.api.port,
      healthCheck: `http://localhost:${config.api.port}/health`
    });
  });
}

async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info('Shutting down server', { signal });

  try {
    if (server) {
      await new Promise((resolve) => server?.close(() => resolve(true)));
    }
  } catch (error: any) {
    logger.warn('Failed to close HTTP server', { error: error?.message || error });
  }

  try {
    await closeDbPool();
  } catch (error: any) {
    logger.warn('Failed to close database pool', { error: error?.message || error });
  }

  try {
    await closeNeo4jDriver();
  } catch (error: any) {
    logger.warn('Failed to close Neo4j driver', { error: error?.message || error });
  }

  try {
    await closeSharedRedis();
  } catch (error: any) {
    logger.warn('Failed to close Redis connection', { error: error?.message || error });
  }

  process.exit(0);
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
