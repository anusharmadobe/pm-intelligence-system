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
import { createCircuitBreaker, CircuitBreaker, CircuitState } from '../utils/circuit_breaker';

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
  private flushInProgress = false; // Prevent concurrent flushes
  private flushPromise: Promise<void> | null = null; // Track in-flight flush

  // Budget cache to avoid DB queries on every request (5 minute TTL)
  private budgetCache = new LRUCache<string, BudgetStatus & { cachedAt: number}>(100);
  private readonly BUDGET_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

  // Circuit breaker for budget checks (prevents cascading failures)
  private budgetCheckBreaker: CircuitBreaker<BudgetStatus>;

  constructor() {
    this.pool = getDbPool();
    this.BATCH_SIZE = parseInt(process.env.COST_BATCH_SIZE || '50', 10);
    this.FLUSH_INTERVAL_MS = parseInt(process.env.COST_FLUSH_INTERVAL_MS || '5000', 10);

    // Initialize circuit breaker for budget checks
    this.budgetCheckBreaker = createCircuitBreaker<BudgetStatus>({
      name: 'budget_check',
      failureThreshold: 5,        // Open after 5 failures
      successThreshold: 2,         // Close after 2 successes in half-open
      timeout: 3000,               // 3 second timeout for budget checks
      resetTimeout: 30000,         // Try again after 30 seconds
      onStateChange: (oldState, newState) => {
        logger.warn('Budget check circuit breaker state changed', {
          old_state: oldState,
          new_state: newState
        });
      }
    });

    // Start periodic flush timer
    this.startFlushTimer();

    // Log initialization
    logger.info('Cost Tracking Service initialized', {
      batch_size: this.BATCH_SIZE,
      flush_interval_ms: this.FLUSH_INTERVAL_MS,
      pricing_tier: getPricingTier(),
      circuit_breaker: 'enabled'
    });
  }

  /**
   * Validate cost record inputs
   */
  private validateCostRecord(record: CostRecord): void {
    // Validate cost_usd
    if (typeof record.cost_usd !== 'number' || !isFinite(record.cost_usd)) {
      throw new Error(`Invalid cost_usd: ${record.cost_usd} (must be a finite number)`);
    }
    if (record.cost_usd < 0) {
      throw new Error(`Invalid cost_usd: ${record.cost_usd} (cannot be negative)`);
    }
    if (record.cost_usd > 1000000) {
      // Sanity check: reject costs > $1M
      throw new Error(`Invalid cost_usd: ${record.cost_usd} (exceeds maximum of $1M)`);
    }

    // Validate tokens_input
    if (typeof record.tokens_input !== 'number' || !isFinite(record.tokens_input)) {
      throw new Error(`Invalid tokens_input: ${record.tokens_input} (must be a finite number)`);
    }
    if (record.tokens_input < 0) {
      throw new Error(`Invalid tokens_input: ${record.tokens_input} (cannot be negative)`);
    }

    // Validate tokens_output
    if (typeof record.tokens_output !== 'number' || !isFinite(record.tokens_output)) {
      throw new Error(`Invalid tokens_output: ${record.tokens_output} (must be a finite number)`);
    }
    if (record.tokens_output < 0) {
      throw new Error(`Invalid tokens_output: ${record.tokens_output} (cannot be negative)`);
    }

    // Validate required string fields
    if (!record.correlation_id || typeof record.correlation_id !== 'string') {
      throw new Error('correlation_id is required and must be a string');
    }
    if (!record.operation || typeof record.operation !== 'string') {
      throw new Error('operation is required and must be a string');
    }
    if (!record.provider || typeof record.provider !== 'string') {
      throw new Error('provider is required and must be a string');
    }
    if (!record.model || typeof record.model !== 'string') {
      throw new Error('model is required and must be a string');
    }

    // Validate timestamp
    if (!(record.timestamp instanceof Date) || isNaN(record.timestamp.getTime())) {
      throw new Error('timestamp must be a valid Date object');
    }
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

      // CRITICAL: Validate all inputs before recording
      this.validateCostRecord(record);

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
   * Internal method to check budget from database
   * Used by circuit breaker wrapper
   */
  private async checkAgentBudgetInternal(agentId: string): Promise<BudgetStatus> {
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
      return {
        allowed: true,
        remaining: budget_limit,
        limit: budget_limit,
        current_cost: 0,
        utilization_pct: 0
      };
    }

    const remaining = budget_limit - current_cost;
    const gracePeriod = budget_limit * 0.1; // 10% grace period
    const allowed = remaining > -gracePeriod;
    const utilization_pct = budget_limit > 0 ? (current_cost / budget_limit) * 100 : 0;

    return {
      allowed,
      remaining,
      limit: budget_limit,
      current_cost,
      utilization_pct
    };
  }

  /**
   * Check if agent has budget remaining
   * Uses cache, circuit breaker, and fails open on errors
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

      // Use circuit breaker to protect against database failures
      const status = await this.budgetCheckBreaker.execute(
        () => this.checkAgentBudgetInternal(agentId)
      );

      // Cache the status
      this.budgetCache.set(agentId, { ...status, cachedAt: Date.now() });

      logger.debug('Agent budget check (from DB)', {
        agent_id: agentId,
        allowed: status.allowed,
        remaining: status.remaining,
        limit: status.limit,
        current_cost: status.current_cost,
        utilization_pct: status.utilization_pct.toFixed(2),
        circuit_state: this.budgetCheckBreaker.getState()
      });

      return status;
    } catch (error: any) {
      // Check if circuit breaker is open
      if (error.circuitBreakerOpen) {
        logger.warn('Budget check blocked by circuit breaker (failing open)', {
          agent_id: agentId,
          circuit_state: this.budgetCheckBreaker.getState()
        });
      } else {
        logger.error('Budget check failed (failing open)', {
          error: error.message,
          agent_id: agentId,
          circuit_state: this.budgetCheckBreaker.getState()
        });
      }

      // CRITICAL DECISION: Fail open (allow request) vs fail closed (deny request)
      // We fail OPEN to prevent blocking legitimate operations during outages
      // Budget reconciliation will catch overspend in background jobs
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
        WITH filtered AS (
          SELECT cost_usd, tokens_input, tokens_output, created_at, operation, model
          FROM llm_cost_log
          ${whereClause}
        ),
        operation_totals AS (
          SELECT COALESCE(jsonb_object_agg(operation, total_cost), '{}'::jsonb) AS by_operation
          FROM (
            SELECT operation, SUM(cost_usd) AS total_cost
            FROM filtered
            GROUP BY operation
          ) ops
        ),
        model_totals AS (
          SELECT COALESCE(jsonb_object_agg(model, total_cost), '{}'::jsonb) AS by_model
          FROM (
            SELECT model, SUM(cost_usd) AS total_cost
            FROM filtered
            GROUP BY model
          ) models
        )
        SELECT
          COALESCE(SUM(filtered.cost_usd), 0) AS total_cost_usd,
          COUNT(filtered.*) AS total_operations,
          COALESCE(SUM(filtered.tokens_input), 0) AS total_input_tokens,
          COALESCE(SUM(filtered.tokens_output), 0) AS total_output_tokens,
          MIN(filtered.created_at) AS period_start,
          MAX(filtered.created_at) AS period_end,
          (SELECT by_operation FROM operation_totals) AS by_operation,
          (SELECT by_model FROM model_totals) AS by_model
        FROM filtered
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
   * CRITICAL: Uses mutex pattern to prevent concurrent flushes and pool-after-end errors
   */
  private async flushCostBuffer(): Promise<void> {
    // Skip if no records or shutdown in progress
    if (this.costBuffer.length === 0 || this.shutdownInProgress) {
      return;
    }

    // Prevent concurrent flushes - wait for existing flush to complete
    if (this.flushInProgress) {
      logger.debug('Flush already in progress, skipping');
      return;
    }

    // Set mutex and create promise for tracking
    this.flushInProgress = true;
    this.flushPromise = (async () => {
      const batch = this.costBuffer.splice(0, this.BATCH_SIZE);

      // Double-check buffer isn't empty after splice
      if (batch.length === 0) {
        return;
      }

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

        // Put failed records back in buffer for retry (unless shutting down)
        if (!this.shutdownInProgress) {
          this.costBuffer.unshift(...batch);
        }
      } finally {
        // Release mutex
        this.flushInProgress = false;
        this.flushPromise = null;
      }
    })();

    return this.flushPromise;
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
   * CRITICAL: Waits for in-flight flush to complete before shutdown
   */
  async shutdown(): Promise<void> {
    if (this.shutdownInProgress) {
      return;
    }

    logger.info('Cost Tracking Service shutting down...');

    // Stop flush timer FIRST to prevent new flushes
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
      logger.debug('Flush timer stopped');
    }

    // CRITICAL: Wait for any in-flight flush to complete before proceeding
    if (this.flushPromise) {
      logger.debug('Waiting for in-flight flush to complete...');
      await this.flushPromise;
      logger.debug('In-flight flush completed');
    }

    // Now set shutdown flag (after in-flight flush completes)
    this.shutdownInProgress = true;

    // Flush remaining buffer one last time
    if (this.costBuffer.length > 0) {
      logger.info('Flushing remaining cost buffer', {
        buffer_size: this.costBuffer.length
      });
      await this.flushCostBuffer();
    }

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
