/**
 * Budget Enforcement Middleware
 *
 * Checks agent budgets before expensive operations (LLM/embedding calls)
 * Auto-pauses agents that exceed their monthly budget limits
 */

import { Request, Response, NextFunction } from 'express';
import { getCostTrackingService } from '../services/cost_tracking_service';
import { logger } from '../utils/logger';
import { getCorrelationContext } from '../utils/correlation';
import { LRUCache } from '../utils/lru_cache';

// Cache budget status to avoid DB queries on every request (5 minute TTL)
const budgetCache = new LRUCache<string, { allowed: boolean; remaining: number; cachedAt: number }>(100);
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Budget check middleware
 * Validates agent has remaining budget before processing expensive operations
 *
 * Usage:
 *   app.post('/api/agents/v1/ingest', budgetCheckMiddleware, handler);
 */
export async function budgetCheckMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    // Skip if cost tracking is disabled
    if (process.env.FF_COST_TRACKING === 'false') {
      return next();
    }

    // Extract agent ID from request (could be in auth, body, or query)
    const agentId = (req as any).agent?.id || req.body?.agent_id || req.query.agent_id;

    // If no agent ID, this is not an agent request - allow it
    if (!agentId) {
      logger.debug('Budget check skipped - no agent ID found');
      return next();
    }

    const context = getCorrelationContext();
    const costService = getCostTrackingService();

    // Check cache first to avoid frequent DB queries
    const cached = budgetCache.get(agentId);
    if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
      if (!cached.allowed) {
        logger.warn('Agent budget exceeded (cached)', {
          agent_id: agentId,
          correlation_id: context?.correlationId,
          remaining: cached.remaining
        });

        res.status(429).json({
          success: false,
          error: 'Monthly budget exceeded',
          details: {
            remaining_usd: cached.remaining,
            message: 'Agent has been auto-paused due to budget exceeded. Contact admin to reset budget or increase limit.'
          }
        });
        return;
      }

      // Budget OK from cache - proceed
      logger.debug('Budget check passed (cached)', {
        agent_id: agentId,
        remaining: cached.remaining
      });
      return next();
    }

    // Check actual budget from database
    const budgetStatus = await costService.checkAgentBudget(agentId);

    // Update cache
    budgetCache.set(agentId, {
      allowed: budgetStatus.allowed,
      remaining: budgetStatus.remaining,
      cachedAt: Date.now()
    });

    if (!budgetStatus.allowed) {
      // Auto-pause agent if budget exceeded
      await costService.pauseAgent(agentId, 'budget_exceeded');

      logger.warn('Agent budget exceeded, auto-paused', {
        agent_id: agentId,
        correlation_id: context?.correlationId,
        current_cost: budgetStatus.current_cost,
        limit: budgetStatus.limit,
        utilization_pct: budgetStatus.utilization_pct
      });

      res.status(429).json({
        success: false,
        error: 'Monthly budget exceeded',
        details: {
          current_cost_usd: budgetStatus.current_cost,
          budget_limit_usd: budgetStatus.limit,
          utilization_pct: budgetStatus.utilization_pct,
          remaining_usd: budgetStatus.remaining,
          message: 'Agent has been auto-paused due to budget exceeded. Contact admin to reset budget or increase limit.'
        }
      });
      return;
    }

    // Budget check passed
    logger.debug('Budget check passed (from DB)', {
      agent_id: agentId,
      current_cost: budgetStatus.current_cost,
      limit: budgetStatus.limit,
      remaining: budgetStatus.remaining,
      utilization_pct: budgetStatus.utilization_pct.toFixed(2)
    });

    next();
  } catch (error: any) {
    // Budget check failure should NOT block operations (fail open)
    // Log the error but allow the request to proceed
    logger.error('Budget check failed (allowing request - fail open)', {
      error: error.message,
      agent_id: (req as any).agent?.id,
      correlation_id: getCorrelationContext()?.correlationId,
      stack: error.stack
    });

    // Allow request to proceed even if budget check fails
    next();
  }
}

/**
 * Clear budget cache for an agent (call after budget updates)
 */
export function clearBudgetCache(agentId: string): void {
  budgetCache.delete(agentId);
  logger.debug('Budget cache cleared', { agent_id: agentId });
}

/**
 * Clear all budget cache entries (useful for testing)
 */
export function clearAllBudgetCache(): void {
  budgetCache.clear();
  logger.info('All budget cache cleared');
}

/**
 * Get budget cache stats (for monitoring)
 */
export function getBudgetCacheStats(): { size: number; maxSize: number } {
  return {
    size: budgetCache.size(),
    maxSize: 100
  };
}
