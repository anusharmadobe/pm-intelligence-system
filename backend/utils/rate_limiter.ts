/**
 * Redis-based rate limiter for API endpoints.
 * Uses express-rate-limit with Redis store for distributed rate limiting.
 */

import rateLimit, { RateLimitRequestHandler } from 'express-rate-limit';
import RedisStore from 'rate-limit-redis';
import { getSharedRedis } from '../config/redis';
import { logger } from './logger';

interface RateLimitConfig {
  windowMs: number; // Time window in milliseconds
  maxRequests: number; // Maximum requests per window
  keyPrefix: string; // Redis key prefix
}

/**
 * Creates a Redis-based rate limiter middleware
 */
export function createRedisRateLimiter(config: RateLimitConfig): RateLimitRequestHandler {
  try {
    const redisClient = getSharedRedis();

    return rateLimit({
      store: new RedisStore({
        // @ts-expect-error - RedisStore types are slightly outdated
        client: redisClient,
        prefix: `ratelimit:${config.keyPrefix}:`
      }),
      windowMs: config.windowMs,
      max: config.maxRequests,
      message: {
        error: 'Too many requests',
        message: 'Rate limit exceeded. Please try again later.',
      },
      standardHeaders: true, // Return rate limit info in RateLimit-* headers
      legacyHeaders: false, // Disable X-RateLimit-* headers
      skipSuccessfulRequests: false,
      skipFailedRequests: false,
      handler: (req, res) => {
        const resetTime = new Date(Date.now() + config.windowMs).toISOString();
        logger.warn('Rate limit exceeded', {
          ip: req.ip,
          path: req.path,
          resetTime,
          keyPrefix: config.keyPrefix
        });

        res.status(429).json({
          error: 'Too many requests',
          message: `Rate limit exceeded. Try again after ${resetTime}`,
          retryAfter: Math.ceil(config.windowMs / 1000)
        });
      }
    });
  } catch (error: any) {
    logger.error('Failed to create Redis rate limiter, falling back to memory-based', {
      error: error.message,
      keyPrefix: config.keyPrefix
    });

    // Fallback to memory-based rate limiter if Redis is unavailable
    return rateLimit({
      windowMs: config.windowMs,
      max: config.maxRequests,
      message: {
        error: 'Too many requests',
        message: 'Rate limit exceeded. Please try again later.',
      },
      standardHeaders: true,
      legacyHeaders: false
    });
  }
}

// Default rate limiters for different endpoints
export const rateLimiters = {
  // General API: 100 requests per 15 minutes
  general: createRedisRateLimiter({
    windowMs: 15 * 60 * 1000, // 15 minutes
    maxRequests: 100,
    keyPrefix: 'general'
  }),

  // Signal ingestion: Reduced from 5000 to 100 requests per minute for production safety
  // Can be overridden with SIGNAL_INGESTION_RATE_LIMIT env variable
  signalIngestion: createRedisRateLimiter({
    windowMs: 60 * 1000, // 1 minute
    maxRequests: parseInt(process.env.SIGNAL_INGESTION_RATE_LIMIT || '100', 10),
    keyPrefix: 'ingest'
  }),

  // Opportunity detection: 10 requests per minute
  opportunityDetection: createRedisRateLimiter({
    windowMs: 60 * 1000, // 1 minute
    maxRequests: 10,
    keyPrefix: 'opportunity'
  }),

  // Webhooks: 200 requests per minute
  webhooks: createRedisRateLimiter({
    windowMs: 60 * 1000, // 1 minute
    maxRequests: 200,
    keyPrefix: 'webhooks'
  })
};

/**
 * Legacy middleware factory for backwards compatibility
 * @deprecated Use rateLimiters directly instead
 */
export function createRateLimitMiddleware(
  limiter: RateLimitRequestHandler,
  getKey?: (req: any) => string
): RateLimitRequestHandler {
  logger.warn('createRateLimitMiddleware is deprecated, use rateLimiters directly');
  return limiter;
}
