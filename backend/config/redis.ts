import IORedis from 'ioredis';
import { config } from './env';
import { createModuleLogger } from '../utils/logger';

const logger = createModuleLogger('redis', 'LOG_LEVEL_REDIS');

let sharedRedis: IORedis | null = null;
let isShuttingDown = false;
let reconnectionAttempts = 0;
const MAX_RECONNECTION_ATTEMPTS = 10;

export function getSharedRedis(): IORedis {
  if (isShuttingDown) {
    throw new Error('Redis client is shutting down, cannot create new connections');
  }

  if (!sharedRedis) {
    logger.info('Initializing Redis connection', {
      url: config.redis.url.replace(/:[^:]*@/, ':***@') // Mask password in logs
    });

    const options: IORedis.RedisOptions = {
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
      enableOfflineQueue: true,

      // Reconnection strategy with exponential backoff
      retryStrategy(times: number) {
        if (times > MAX_RECONNECTION_ATTEMPTS) {
          logger.error('Redis max reconnection attempts reached', {
            attempts: times
          });
          return null; // Stop retrying
        }

        const delay = Math.min(times * 200, 5000); // Max 5 second delay
        logger.warn('Redis reconnection attempt', {
          attempt: times,
          delayMs: delay
        });

        reconnectionAttempts = times;
        return delay;
      },

      // Reconnect on specific errors
      reconnectOnError(err: Error) {
        const targetErrors = ['READONLY', 'ECONNRESET', 'ETIMEDOUT', 'EPIPE'];
        const shouldReconnect = targetErrors.some(target =>
          err.message.includes(target)
        );

        if (shouldReconnect) {
          logger.warn('Redis error triggered reconnection', {
            error: err.message
          });
        }

        return shouldReconnect;
      }
    };

    // Add password if provided
    if (config.redis.password) {
      options.password = config.redis.password;
    }

    logger.debug('Redis client initialized with options', {
      host: config.redis.url.includes('@') ? '***' : config.redis.url,
      max_retries: options.maxRetriesPerRequest,
      retry_strategy: 'exponential_backoff',
      reconnect_on_error: true
    });

    sharedRedis = new IORedis(config.redis.url, options);

    // Event handlers for monitoring and debugging
    sharedRedis.on('connect', () => {
      logger.info('Redis connected');
      reconnectionAttempts = 0;
    });

    sharedRedis.on('ready', () => {
      logger.info('Redis ready to accept commands');
    });

    sharedRedis.on('error', (err: Error) => {
      logger.error('Redis error', {
        error: err.message,
        errorClass: err.constructor.name,
        stack: err.stack
      });
    });

    sharedRedis.on('close', () => {
      if (!isShuttingDown) {
        logger.warn('Redis connection closed unexpectedly');
      } else {
        logger.info('Redis connection closed');
      }
    });

    sharedRedis.on('reconnecting', (timeToReconnect?: number) => {
      logger.info('Redis reconnecting', {
        timeToReconnect,
        attempt: reconnectionAttempts + 1
      });
    });

    sharedRedis.on('end', () => {
      logger.info('Redis connection ended');
    });
  }

  return sharedRedis;
}

/**
 * Check if Redis is connected and healthy
 */
export async function checkRedisHealth(): Promise<boolean> {
  const startTime = Date.now();
  try {
    const redis = getSharedRedis();
    const pong = await redis.ping();
    const responseTime = Date.now() - startTime;

    logger.trace('Redis health check executed', {
      healthy: true,
      response_time_ms: responseTime
    });

    return pong === 'PONG';
  } catch (error: any) {
    logger.error('Redis health check failed', {
      error: error.message
    });
    return false;
  }
}

/**
 * Gracefully close Redis connection
 */
export async function closeSharedRedis(): Promise<void> {
  if (sharedRedis) {
    isShuttingDown = true;

    logger.info('Closing Redis connection');

    try {
      // Use quit() for graceful shutdown (waits for pending commands)
      await Promise.race([
        sharedRedis.quit(),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Redis quit timeout')), 5000)
        )
      ]);

      logger.info('Redis connection closed gracefully');
    } catch (error: any) {
      logger.error('Error during Redis shutdown, forcing disconnect', {
        error: error.message
      });

      // Force disconnect if graceful shutdown fails
      sharedRedis.disconnect();
    } finally {
      sharedRedis = null;
      isShuttingDown = false;
      reconnectionAttempts = 0;
    }
  }
}

/**
 * Get Redis connection status
 */
export function getRedisStatus(): {
  connected: boolean;
  shuttingDown: boolean;
  reconnectionAttempts: number;
} {
  return {
    connected: sharedRedis?.status === 'ready',
    shuttingDown: isShuttingDown,
    reconnectionAttempts
  };
}
