import express from 'express';
import { AgentRegistryService, AgentRecord } from './agent_registry_service';
import { config } from '../config/env';
import { getSharedRedis } from '../config/redis';

export type AgentRequest = express.Request & { agent?: AgentRecord; correlationId?: string };

export function getApiKey(req: express.Request): string | null {
  const headerKey = req.headers['x-api-key'];
  if (typeof headerKey === 'string' && headerKey.trim()) return headerKey.trim();
  const auth = req.headers.authorization;
  if (typeof auth === 'string' && auth.toLowerCase().startsWith('bearer ')) {
    return auth.slice(7).trim();
  }
  return null;
}

export function createAgentAuthMiddleware(registryService: AgentRegistryService) {
  return async (req: AgentRequest, res: express.Response, next: express.NextFunction) => {
    const apiKey = getApiKey(req);
    if (!apiKey) {
      return res.status(401).json({ error: 'Missing API key' });
    }
    const agent = await registryService.authenticate(apiKey, req.correlationId);
    if (!agent) {
      return res.status(401).json({ error: 'Invalid API key' });
    }
    req.agent = agent;
    next();
  };
}

export function createAgentRateLimitMiddleware() {
  return async (req: AgentRequest, res: express.Response, next: express.NextFunction) => {
    if (!req.agent) return res.status(401).json({ error: 'Unauthorized' });
    const agentId = req.agent.id;
    const maxRequests = req.agent.rate_limit_per_minute || config.agent.rateLimitRpm;
    const windowMs = 60 * 1000;
    const now = Date.now();
    const bucket = Math.floor(now / windowMs);
    const key = `ratelimit:${agentId}:${bucket}`;

    try {
      const redis = getSharedRedis();
      const count = await redis.incr(key);
      if (count === 1) {
        await redis.expire(key, Math.ceil(windowMs / 1000));
      }
      const remaining = Math.max(0, maxRequests - count);
      const resetTime = (bucket + 1) * windowMs;

      res.setHeader('X-RateLimit-Limit', maxRequests);
      res.setHeader('X-RateLimit-Remaining', remaining);
      res.setHeader('X-RateLimit-Reset', new Date(resetTime).toISOString());

      if (count > maxRequests) {
        return res.status(429).json({
          error: 'Too many requests',
          message: `Rate limit exceeded. Try again after ${new Date(resetTime).toISOString()}`,
          retryAfter: Math.ceil((resetTime - Date.now()) / 1000)
        });
      }
      next();
    } catch (error) {
      next();
    }
  };
}
