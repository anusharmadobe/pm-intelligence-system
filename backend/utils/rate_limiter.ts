/**
 * Simple in-memory rate limiter for API endpoints.
 * Uses sliding window algorithm.
 */

interface RateLimitConfig {
  windowMs: number; // Time window in milliseconds
  maxRequests: number; // Maximum requests per window
}

interface RequestRecord {
  count: number;
  resetTime: number;
}

export class RateLimiter {
  private requests: Map<string, RequestRecord> = new Map();
  private config: RateLimitConfig;
  private cleanupInterval: NodeJS.Timeout;

  constructor(config: RateLimitConfig) {
    this.config = config;
    
    // Cleanup old entries every minute
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, 60000);
  }

  /**
   * Checks if a request should be allowed.
   * Returns { allowed: boolean, remaining: number, resetTime: number }
   */
  check(key: string): { allowed: boolean; remaining: number; resetTime: number } {
    const now = Date.now();
    const record = this.requests.get(key);

    if (!record || now > record.resetTime) {
      // New window or expired window
      this.requests.set(key, {
        count: 1,
        resetTime: now + this.config.windowMs
      });
      return {
        allowed: true,
        remaining: this.config.maxRequests - 1,
        resetTime: now + this.config.windowMs
      };
    }

    if (record.count >= this.config.maxRequests) {
      // Rate limit exceeded
      return {
        allowed: false,
        remaining: 0,
        resetTime: record.resetTime
      };
    }

    // Increment count
    record.count++;
    return {
      allowed: true,
      remaining: this.config.maxRequests - record.count,
      resetTime: record.resetTime
    };
  }

  /**
   * Cleans up expired entries.
   */
  private cleanup(): void {
    const now = Date.now();
    for (const [key, record] of this.requests.entries()) {
      if (now > record.resetTime) {
        this.requests.delete(key);
      }
    }
  }

  /**
   * Clears all rate limit data.
   */
  clear(): void {
    this.requests.clear();
  }

  /**
   * Stops the cleanup interval.
   */
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    this.clear();
  }
}

// Default rate limiters for different endpoints
export const rateLimiters = {
  // General API: 100 requests per 15 minutes
  general: new RateLimiter({
    windowMs: 15 * 60 * 1000, // 15 minutes
    maxRequests: 100
  }),
  
  // Signal ingestion: 5000 requests per minute (high limit for bulk ingestion)
  // Can be overridden with SIGNAL_INGESTION_RATE_LIMIT env variable
  signalIngestion: new RateLimiter({
    windowMs: 60 * 1000, // 1 minute
    maxRequests: parseInt(process.env.SIGNAL_INGESTION_RATE_LIMIT || '5000', 10)
  }),
  
  // Opportunity detection: 10 requests per minute
  opportunityDetection: new RateLimiter({
    windowMs: 60 * 1000, // 1 minute
    maxRequests: 10
  }),
  
  // Webhooks: 200 requests per minute
  webhooks: new RateLimiter({
    windowMs: 60 * 1000, // 1 minute
    maxRequests: 200
  })
};

/**
 * Express middleware factory for rate limiting.
 */
export function createRateLimitMiddleware(limiter: RateLimiter, getKey?: (req: any) => string) {
  return (req: any, res: any, next: any) => {
    const key = getKey ? getKey(req) : req.ip || 'unknown';
    const result = limiter.check(key);

    // Set rate limit headers
    res.setHeader('X-RateLimit-Limit', limiter['config'].maxRequests);
    res.setHeader('X-RateLimit-Remaining', result.remaining);
    res.setHeader('X-RateLimit-Reset', new Date(result.resetTime).toISOString());

    if (!result.allowed) {
      return res.status(429).json({
        error: 'Too many requests',
        message: `Rate limit exceeded. Try again after ${new Date(result.resetTime).toISOString()}`,
        retryAfter: Math.ceil((result.resetTime - Date.now()) / 1000)
      });
    }

    next();
  };
}
