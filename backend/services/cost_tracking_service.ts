/**
 * Cost Tracking Service
 *
 * Central service for tracking LLM and embedding costs with:
 * - Actual token usage capture from API responses
 * - Real-time cost calculation using pricing tables
 * - Budget enforcement with auto-pause for agents
 * - Async database persistence (non-blocking)
 * - Batch recording for performance
 */

import { Pool } from 'pg';
import { getDbPool } from '../db/connection';
import { logger } from '../utils/logger';
import { calculateLLMCost, calculateEmbeddingCost, getPricingTier } from '../config/pricing';
import { getRunMetrics } from '../utils/run_metrics';
import { LRUCache } from '../utils/lru_cache';

/**
 * Cost record for a single LLM or embedding operation
 */
export interface CostRecord {
  correlation_id: string;
  signal_id?: string;
  agent_id?: string;
  operation: string;        // 'llm_chat', 'llm_extraction', 'embedding', 'synthesis', etc.
  provider: string;         // 'openai', 'azure_openai', 'cohere'
  model: string;
  tokens_input: number;
  tokens_output: number;
  cost_usd: number;
  response_time_ms?: number;
  timestamp: Date;
}

/**
 * Budget status for an agent
 */
export interface BudgetStatus {
  allowed: boolean;
  remaining: number;
  limit: number;
  current_cost: number;
  utilization_pct: number;
}

/**
 * Cost summary for reporting
 */
export interface CostSummary {
  total_cost_usd: number;
  total_operations: number;
  total_input_tokens: number;
  total_output_tokens: number;
  by_operation: Record<string, number>;
  by_model: Record<string, number>;
  period_start: Date;
  period_end: Date;
}

/**
 * Cost Tracking Service - Singleton
 */
class CostTrackingService {
  private pool: Pool;
  private costBuffer: CostRecord[] = [];
  private readonly BATCH_SIZE: number;
  private readonly FLUSH_INTERVAL_MS: number;
  private flushTimer: NodeJS.Timeout | null = null;
  private shutdownInProgress = false;

  // Budget cache to avoid DB queries on every request (5 minute TTL)
  private budgetCache = new LRUCache<string, BudgetStatus & { cachedAt: number }>(100);
  private readonly BUDGET_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

  constructor() {
    this.pool = getDbPool();
    this.BATCH_SIZE = parseInt(process.env.COST_BATCH_SIZE || '50', 10);
    this.FLUSH_INTERVAL_MS = parseInt(process.env.COST_FLUSH_INTERVAL_MS || '5000', 10);

    // Start periodic flush timer
    this.startFlushTimer();

    // Log initialization
    logger.info('Cost Tracking Service initialized', {
      batch_size: this.BATCH_SIZE,
      flush_interval_ms: this.FLUSH_INTERVAL_MS,
      pricing_tier: getPricingTier()
    });
  }

  /**
   * Record a cost entry (async, non-blocking)
   * Buffers records and flushes in batches for performance
   */
  async recordCost(record: CostRecord): Promise<void> {
    try {
      // Skip if cost tracking is disabled
      if (process.env.FF_COST_TRACKING === 'false') {
        return;
      }

      // Add to buffer
      this.costBuffer.push(record);

      // Update in-memory metrics
      const metrics = getRunMetrics();
      metrics.addTokenUsage(record.tokens_input, record.tokens_output);
      metrics.addEstimatedCost(record.cost_usd);

      // Flush immediately if buffer is full
      if (this.costBuffer.length >= this.BATCH_SIZE) {
        await this.flushCostBuffer();
      }
    } catch (error: any) {
      // Cost tracking failures should NOT break the application
      logger.warn('Cost recording failed (non-blocking)', {
        error: error.message,
        operation: record.operation,
        correlation_id: record.correlation_id
      });
    }
  }

  /**
   * Calculate cost for LLM usage
   */
  calculateCostForLLM(
    provider: string,
    model: string,
    tokensInput: number,
    tokensOutput: number
  ): number {
    return calculateLLMCost(provider, model, tokensInput, tokensOutput);
  }

  /**
   * Calculate cost for embedding generation
   */
  calculateCostForEmbedding(
    provider: string,
    model: string,
    tokensInput: number
  ): number {
    return calculateEmbeddingCost(provider, model, tokensInput);
  }

  /**
   * Check if agent has budget remaining
   * Uses cache to avoid frequent DB queries
   */
  async checkAgentBudget(agentId: string): Promise<BudgetStatus> {
    try {
      // Check cache first
      const cached = this.budgetCache.get(agentId);
      if (cached && Date.now() - cached.cachedAt < this.BUDGET_CACHE_TTL_MS) {
        logger.debug('Agent budget check (cached)', {
          agent_id: agentId,
          allowed: cached.allowed,
          remaining: cached.remaining
        });
        return {
          allowed: cached.allowed,
          remaining: cached.remaining,
          limit: cached.limit,
          current_cost: cached.current_cost,
          utilization_pct: cached.utilization_pct
        };
      }

      // Query database
      const result = await this.pool.query(`
        SELECT
          ar.max_monthly_cost_usd AS budget_limit,
          COALESCE(acs.total_cost_usd, 0) AS current_cost,
          ar.cost_reset_at
        FROM agent_registry ar
        LEFT JOIN agent_cost_summary acs
          ON ar.id = acs.agent_id
          AND acs.month = date_trunc('month', NOW())
        WHERE ar.id = $1
      `, [agentId]);

      if (result.rows.length === 0) {
        throw new Error(`Agent not found: ${agentId}`);
      }

      const { budget_limit, current_cost, cost_reset_at } = result.rows[0];

      // Check if we need to reset monthly counter
      const now = new Date();
      const resetAt = new Date(cost_reset_at);
      if (now > resetAt) {
        await this.resetAgentMonthlyCost(agentId);
        const status: BudgetStatus = {
          allowed: true,
          remaining: budget_limit,
          limit: budget_limit,
          current_cost: 0,
          utilization_pct: 0
        };
        this.budgetCache.set(agentId, { ...status, cachedAt: Date.now() });
        return status;
      }

      const remaining = budget_limit - current_cost;
      const gracePeriod = budget_limit * 0.1; // 10% grace period
      const allowed = remaining > -gracePeriod;
      const utilization_pct = budget_limit > 0 ? (current_cost / budget_limit) * 100 : 0;

      const status: BudgetStatus = {
        allowed,
        remaining,
        limit: budget_limit,
        current_cost,
        utilization_pct
      };

      // Cache the status
      this.budgetCache.set(agentId, { ...status, cachedAt: Date.now() });

      logger.debug('Agent budget check (from DB)', {
        agent_id: agentId,
        allowed,
        remaining,
        limit: budget_limit,
        current_cost,
        utilization_pct: utilization_pct.toFixed(2)
      });

      return status;
    } catch (error: any) {
      // Fail open on errors - don't block operations
      logger.error('Budget check failed (allowing request)', {
        error: error.message,
        agent_id: agentId
      });
      return {
        allowed: true,
        remaining: 0,
        limit: 0,
        current_cost: 0,
        utilization_pct: 0
      };
    }
  }

  /**
   * Pause agent due to budget exceeded
   */
  async pauseAgent(agentId: string, reason: string): Promise<void> {
    try {
      await this.pool.query(`
        UPDATE agent_registry
        SET is_active = false, updated_at = NOW()
        WHERE id = $1
      `, [agentId]);

      logger.warn('Agent auto-paused', { agent_id: agentId, reason });

      // Insert alert
      await this.pool.query(`
        INSERT INTO alerts (alert_name, severity, message, metric_name, metric_value)
        VALUES ($1, $2, $3, $4, $5)
      `, [
        'agent_budget_exceeded',
        'critical',
        `Agent ${agentId} has been auto-paused due to budget exceeded`,
        'agent_budget_utilization',
        100
      ]);

      // Clear cache entry
      this.budgetCache.delete(agentId);
    } catch (error: any) {
      logger.error('Failed to pause agent', {
        error: error.message,
        agent_id: agentId,
        reason
      });
    }
  }

  /**
   * Unpause agent (admin action)
   */
  async unpauseAgent(agentId: string): Promise<void> {
    try {
      await this.pool.query(`
        UPDATE agent_registry
        SET is_active = true, updated_at = NOW()
        WHERE id = $1
      `, [agentId]);

      logger.info('Agent unpaused by admin', { agent_id: agentId });

      // Clear cache entry
      this.budgetCache.delete(agentId);
    } catch (error: any) {
      logger.error('Failed to unpause agent', {
        error: error.message,
        agent_id: agentId
      });
      throw error;
    }
  }

  /**
   * Reset monthly cost counter for an agent
   */
  async resetAgentMonthlyCost(agentId: string): Promise<void> {
    try {
      await this.pool.query(`
        UPDATE agent_registry
        SET cost_reset_at = date_trunc('month', NOW() + interval '1 month'),
            current_month_cost_usd = 0,
            updated_at = NOW()
        WHERE id = $1
      `, [agentId]);

      logger.info('Agent monthly cost reset', { agent_id: agentId });

      // Clear cache entry
      this.budgetCache.delete(agentId);
    } catch (error: any) {
      logger.error('Failed to reset agent monthly cost', {
        error: error.message,
        agent_id: agentId
      });
      throw error;
    }
  }

  /**
   * Update agent budget limit (admin action)
   */
  async updateAgentBudget(agentId: string, newLimit: number): Promise<void> {
    try {
      await this.pool.query(`
        UPDATE agent_registry
        SET max_monthly_cost_usd = $2, updated_at = NOW()
        WHERE id = $1
      `, [agentId, newLimit]);

      logger.info('Agent budget limit updated', { agent_id: agentId, new_limit: newLimit });

      // Clear cache entry
      this.budgetCache.delete(agentId);
    } catch (error: any) {
      logger.error('Failed to update agent budget', {
        error: error.message,
        agent_id: agentId,
        new_limit: newLimit
      });
      throw error;
    }
  }

  /**
   * Get cost summary for an agent, signal, or time period
   */
  async getCostSummary(params: {
    agentId?: string;
    signalId?: string;
    dateFrom?: Date;
    dateTo?: Date;
  }): Promise<CostSummary> {
    try {
      const conditions: string[] = [];
      const values: any[] = [];
      let paramIndex = 1;

      if (params.agentId) {
        conditions.push(`agent_id = $${paramIndex++}`);
        values.push(params.agentId);
      }

      if (params.signalId) {
        conditions.push(`signal_id = $${paramIndex++}`);
        values.push(params.signalId);
      }

      if (params.dateFrom) {
        conditions.push(`created_at >= $${paramIndex++}`);
        values.push(params.dateFrom);
      }

      if (params.dateTo) {
        conditions.push(`created_at <= $${paramIndex++}`);
        values.push(params.dateTo);
      }

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

      const result = await this.pool.query(`
        SELECT
          SUM(cost_usd) AS total_cost_usd,
          COUNT(*) AS total_operations,
          SUM(tokens_input) AS total_input_tokens,
          SUM(tokens_output) AS total_output_tokens,
          MIN(created_at) AS period_start,
          MAX(created_at) AS period_end,
          jsonb_object_agg(operation, operation_cost) AS by_operation,
          jsonb_object_agg(model, model_cost) AS by_model
        FROM (
          SELECT
            cost_usd,
            tokens_input,
            tokens_output,
            created_at,
            operation,
            model,
            SUM(cost_usd) OVER (PARTITION BY operation) AS operation_cost,
            SUM(cost_usd) OVER (PARTITION BY model) AS model_cost
          FROM llm_cost_log
          ${whereClause}
        ) subquery
        GROUP BY by_operation, by_model
      `, values);

      if (result.rows.length === 0) {
        return {
          total_cost_usd: 0,
          total_operations: 0,
          total_input_tokens: 0,
          total_output_tokens: 0,
          by_operation: {},
          by_model: {},
          period_start: params.dateFrom || new Date(),
          period_end: params.dateTo || new Date()
        };
      }

      const row = result.rows[0];
      return {
        total_cost_usd: parseFloat(row.total_cost_usd || 0),
        total_operations: parseInt(row.total_operations || 0, 10),
        total_input_tokens: parseInt(row.total_input_tokens || 0, 10),
        total_output_tokens: parseInt(row.total_output_tokens || 0, 10),
        by_operation: row.by_operation || {},
        by_model: row.by_model || {},
        period_start: row.period_start,
        period_end: row.period_end
      };
    } catch (error: any) {
      logger.error('Failed to get cost summary', {
        error: error.message,
        params
      });
      throw error;
    }
  }

  /**
   * Flush buffered cost records to database (batched)
   */
  private async flushCostBuffer(): Promise<void> {
    if (this.costBuffer.length === 0 || this.shutdownInProgress) {
      return;
    }

    const batch = this.costBuffer.splice(0, this.BATCH_SIZE);

    try {
      // Batch insert using unnest for performance
      const correlationIds = batch.map(r => r.correlation_id);
      const signalIds = batch.map(r => r.signal_id || null);
      const agentIds = batch.map(r => r.agent_id || null);
      const operations = batch.map(r => r.operation);
      const providers = batch.map(r => r.provider);
      const models = batch.map(r => r.model);
      const tokensInput = batch.map(r => r.tokens_input);
      const tokensOutput = batch.map(r => r.tokens_output);
      const costs = batch.map(r => r.cost_usd);
      const responseTimes = batch.map(r => r.response_time_ms || null);

      await this.pool.query(`
        INSERT INTO llm_cost_log
          (correlation_id, signal_id, agent_id, operation, provider, model,
           tokens_input, tokens_output, cost_usd, response_time_ms)
        SELECT * FROM unnest(
          $1::text[], $2::uuid[], $3::uuid[], $4::text[], $5::text[], $6::text[],
          $7::int[], $8::int[], $9::numeric[], $10::int[]
        )
      `, [
        correlationIds, signalIds, agentIds, operations, providers, models,
        tokensInput, tokensOutput, costs, responseTimes
      ]);

      logger.debug('Cost batch flushed', {
        count: batch.length,
        total_cost: costs.reduce((sum, cost) => sum + cost, 0).toFixed(6)
      });
    } catch (error: any) {
      logger.error('Cost batch flush failed', {
        error: error.message,
        batch_size: batch.length
      });

      // Put failed records back in buffer for retry
      this.costBuffer.unshift(...batch);
    }
  }

  /**
   * Start periodic flush timer
   */
  private startFlushTimer(): void {
    this.flushTimer = setInterval(() => {
      this.flushCostBuffer().catch(err =>
        logger.warn('Scheduled cost flush failed', { error: err.message })
      );
    }, this.FLUSH_INTERVAL_MS);
  }

  /**
   * Graceful shutdown - flush remaining buffer
   */
  async shutdown(): Promise<void> {
    if (this.shutdownInProgress) {
      return;
    }

    this.shutdownInProgress = true;

    logger.info('Cost Tracking Service shutting down...');

    // Stop flush timer
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }

    // Flush remaining buffer
    await this.flushCostBuffer();

    logger.info('Cost Tracking Service shutdown complete');
  }
}

// Singleton instance
let costTrackingService: CostTrackingService | null = null;

/**
 * Get or create Cost Tracking Service instance
 */
export function getCostTrackingService(): CostTrackingService {
  if (!costTrackingService) {
    costTrackingService = new CostTrackingService();
  }
  return costTrackingService;
}

/**
 * Shutdown cost tracking service (for graceful shutdown)
 */
export async function shutdownCostTracking(): Promise<void> {
  if (costTrackingService) {
    await costTrackingService.shutdown();
    costTrackingService = null;
  }
}
