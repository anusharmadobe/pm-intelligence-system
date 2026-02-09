import * as dotenv from 'dotenv';
dotenv.config();

import app from './server';
import { getDbPool } from '../db/connection';
import { config } from '../config/env';
import { logger } from '../utils/logger';

const RETRY_DELAY_MS = 5000;

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForDatabase() {
  while (true) {
    try {
      const pool = getDbPool();
      await pool.query('SELECT 1');
      logger.info('Database connection established');
      return;
    } catch (error: any) {
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

  // Test database connection
  await waitForDatabase();

  app.listen(config.api.port, config.api.host, () => {
    logger.info('PM Intelligence API server started', {
      host: config.api.host,
      port: config.api.port,
      healthCheck: `http://localhost:${config.api.port}/health`
    });
  });
}

process.on('unhandledRejection', (reason: any) => {
  logger.error('Unhandled promise rejection', { reason: reason?.message || String(reason) });
});

process.on('uncaughtException', (error: any) => {
  logger.error('Uncaught exception', { error: error?.message || String(error) });
});

startServer();
