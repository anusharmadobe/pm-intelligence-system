import { Pool, PoolClient } from 'pg';
import { config } from '../config/env';
import { withRetry, CircuitBreaker } from '../utils/retry';
import { logger } from '../utils/logger';

let pool: Pool | null = null;
let dbCircuitBreaker: CircuitBreaker | null = null;

export function getDbPool(): Pool {
  if (!pool) {
    // Read database config from process.env at runtime to support test overrides
    // This allows tests to set DB_NAME=pm_intelligence_test before creating the pool
    const host = process.env.DB_HOST || config.db.host;
    const port = process.env.DB_PORT ? parseInt(process.env.DB_PORT, 10) : config.db.port;
    const database = process.env.DB_NAME || config.db.database;
    const user = process.env.DB_USER || config.db.user;
    const password = process.env.DB_PASSWORD !== undefined ? process.env.DB_PASSWORD : config.db.password;

    const poolConfig: any = {
      host,
      port,
      database,
      user,
      // Connection pool settings for reliability
      max: 20, // Maximum number of clients in the pool
      idleTimeoutMillis: 30000, // Close idle clients after 30 seconds
      connectionTimeoutMillis: 10000, // Return an error after 10 seconds if connection cannot be established
    };

    // Only add password if it's not empty and is a valid string
    if (password && typeof password === 'string' && password.trim() !== '') {
      poolConfig.password = password.trim();
    }

    pool = new Pool(poolConfig);

    // Initialize circuit breaker for database operations
    // 5 failures within 60 seconds will open the circuit
    dbCircuitBreaker = new CircuitBreaker(5, 60000);

    // Log pool errors
    pool.on('error', (err: Error) => {
      logger.error('Unexpected error on idle database client', {
        error: err.message,
        errorClass: err.constructor.name,
        stack: err.stack
      });
    });

    // Log when pool is established
    pool.on('connect', () => {
      logger.debug('Database pool client connected');
    });

    // Log when client is removed from pool
    pool.on('remove', () => {
      logger.debug('Database pool client removed');
    });
  }
  return pool;
}

/**
 * Acquires a database client from the pool with retry logic
 * Uses exponential backoff for connection failures
 */
export async function getDbClient(): Promise<PoolClient> {
  const pool = getDbPool();
  const breaker = dbCircuitBreaker!;

  return await breaker.execute(async () => {
    return await withRetry(
      async () => {
        try {
          const client = await pool.connect();
          return client;
        } catch (error: any) {
          logger.warn('Failed to acquire database client', {
            error: error.message,
            errorCode: error.code,
            errorClass: error.constructor.name
          });
          throw error;
        }
      },
      {
        maxAttempts: 3,
        initialDelayMs: 500,
        maxDelayMs: 5000,
        backoffMultiplier: 2,
        retryableErrors: (error: any) => {
          // Retry on connection errors, timeouts, and transient database errors
          const retryableCodes = [
            'ECONNREFUSED',
            'ECONNRESET',
            'ETIMEDOUT',
            'ENOTFOUND',
            '08000', // connection_exception
            '08003', // connection_does_not_exist
            '08006', // connection_failure
            '08001', // sqlclient_unable_to_establish_sqlconnection
            '08004', // sqlserver_rejected_establishment_of_sqlconnection
            '57P03', // cannot_connect_now
            '53300', // too_many_connections
          ];

          return (
            retryableCodes.includes(error.code) ||
            error.message?.toLowerCase().includes('connection') ||
            error.message?.toLowerCase().includes('timeout')
          );
        },
        onRetry: (attempt: number, error: any) => {
          logger.info('Retrying database connection', {
            attempt,
            error: error.message,
            errorCode: error.code
          });
        }
      }
    );
  });
}

export async function closeDbPool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
    dbCircuitBreaker = null;
  }
}
