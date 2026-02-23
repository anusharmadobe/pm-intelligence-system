/**
 * Cost Query API Routes
 *
 * Provides endpoints for querying cost data and budgets
 */

import { Router, Request, Response } from 'express';
import { getDbPool } from '../db/connection';
import { getCostTrackingService } from '../services/cost_tracking_service';
import { logger } from '../utils/logger';

const router = Router();
const pool = getDbPool();

/**
 * GET /api/cost/summary
 * Get aggregated cost summary with optional filtering
 *
 * Query params:
 * - agent_id: Filter by agent
 * - signal_id: Filter by signal
 * - date_from: Start date (ISO format)
 * - date_to: End date (ISO format)
 * - group_by: Grouping (day|week|month)
 */
router.get('/summary', async (req: Request, res: Response) => {
  try {
    const { agent_id, signal_id, date_from, date_to, group_by = 'day' } = req.query;

    const costService = getCostTrackingService();

    // Build cost summary
    const summary = await costService.getCostSummary({
      agentId: agent_id as string,
      signalId: signal_id as string,
      dateFrom: date_from ? new Date(date_from as string) : undefined,
      dateTo: date_to ? new Date(date_to as string) : undefined
    });

    // Get trending data if date range specified
    let trend = null;
    if (date_from && date_to) {
      const trendQuery = await pool.query(`
        SELECT
          date_trunc($1, created_at) AS period,
          SUM(cost_usd) AS cost_usd,
          COUNT(*) AS operation_count,
          SUM(tokens_input + tokens_output) AS total_tokens
        FROM llm_cost_log
        WHERE created_at >= $2 AND created_at <= $3
          ${agent_id ? 'AND agent_id = $4' : ''}
        GROUP BY period
        ORDER BY period ASC
      `, agent_id
        ? [group_by, date_from, date_to, agent_id]
        : [group_by, date_from, date_to]
      );

      trend = trendQuery.rows.map(row => ({
        period: row.period,
        cost_usd: parseFloat(row.cost_usd),
        operation_count: parseInt(row.operation_count, 10),
        total_tokens: parseInt(row.total_tokens, 10)
      }));
    }

    res.json({
      success: true,
      data: {
        summary,
        trend
      }
    });
  } catch (error: any) {
    logger.error('Failed to get cost summary', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve cost summary'
    });
  }
});

/**
 * GET /api/cost/agents
 * Get cost summary for all agents
 */
router.get('/agents', async (req: Request, res: Response) => {
  try {
    const { month } = req.query;
    const targetMonth = month
      ? new Date(month as string)
      : new Date();

    const result = await pool.query(`
      SELECT
        ar.id AS agent_id,
        ar.agent_name,
        ar.max_monthly_cost_usd AS budget_limit,
        COALESCE(acs.total_cost_usd, 0) AS current_cost,
        ar.max_monthly_cost_usd - COALESCE(acs.total_cost_usd, 0) AS remaining,
        CASE
          WHEN ar.max_monthly_cost_usd > 0 THEN
            ROUND((COALESCE(acs.total_cost_usd, 0) / ar.max_monthly_cost_usd * 100)::numeric, 2)
          ELSE 0
        END AS utilization_pct,
        COALESCE(acs.operation_count, 0) AS operation_count,
        COALESCE(acs.total_input_tokens, 0) AS total_input_tokens,
        COALESCE(acs.total_output_tokens, 0) AS total_output_tokens,
        ar.is_active,
        ar.cost_reset_at
      FROM agent_registry ar
      LEFT JOIN agent_cost_summary acs
        ON ar.id = acs.agent_id
        AND acs.month = date_trunc('month', $1::timestamp)
      ORDER BY current_cost DESC
    `, [targetMonth]);

    res.json({
      success: true,
      data: {
        agents: result.rows.map(row => ({
          agent_id: row.agent_id,
          agent_name: row.agent_name,
          budget_limit: parseFloat(row.budget_limit),
          current_cost: parseFloat(row.current_cost),
          remaining: parseFloat(row.remaining),
          utilization_pct: parseFloat(row.utilization_pct),
          operation_count: parseInt(row.operation_count, 10),
          total_input_tokens: parseInt(row.total_input_tokens, 10),
          total_output_tokens: parseInt(row.total_output_tokens, 10),
          is_active: row.is_active,
          cost_reset_at: row.cost_reset_at
        })),
        month: targetMonth.toISOString().substring(0, 7)
      }
    });
  } catch (error: any) {
    logger.error('Failed to get agent costs', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve agent costs'
    });
  }
});

/**
 * GET /api/cost/models
 * Get cost breakdown by model
 */
router.get('/models', async (req: Request, res: Response) => {
  try {
    const { date_from, date_to } = req.query;

    const dateFrom = date_from
      ? new Date(date_from as string)
      : new Date(new Date().getFullYear(), new Date().getMonth(), 1);

    const dateTo = date_to
      ? new Date(date_to as string)
      : new Date();

    const result = await pool.query(`
      SELECT
        provider,
        model,
        SUM(tokens_input) AS total_input_tokens,
        SUM(tokens_output) AS total_output_tokens,
        SUM(cost_usd) AS total_cost_usd,
        COUNT(*) AS operation_count,
        AVG(response_time_ms) AS avg_response_time_ms,
        MIN(created_at) AS first_use,
        MAX(created_at) AS last_use
      FROM llm_cost_log
      WHERE created_at >= $1 AND created_at <= $2
      GROUP BY provider, model
      ORDER BY total_cost_usd DESC
    `, [dateFrom, dateTo]);

    res.json({
      success: true,
      data: {
        models: result.rows.map(row => ({
          provider: row.provider,
          model: row.model,
          total_input_tokens: parseInt(row.total_input_tokens, 10),
          total_output_tokens: parseInt(row.total_output_tokens, 10),
          total_cost_usd: parseFloat(row.total_cost_usd),
          operation_count: parseInt(row.operation_count, 10),
          avg_response_time_ms: parseFloat(row.avg_response_time_ms),
          first_use: row.first_use,
          last_use: row.last_use
        })),
        period: {
          from: dateFrom,
          to: dateTo
        }
      }
    });
  } catch (error: any) {
    logger.error('Failed to get model costs', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve model costs'
    });
  }
});

/**
 * GET /api/cost/operations
 * Get cost breakdown by operation type
 */
router.get('/operations', async (req: Request, res: Response) => {
  try {
    const { date_from, date_to } = req.query;

    const dateFrom = date_from
      ? new Date(date_from as string)
      : new Date(new Date().getFullYear(), new Date().getMonth(), 1);

    const dateTo = date_to
      ? new Date(date_to as string)
      : new Date();

    const result = await pool.query(`
      SELECT
        operation,
        SUM(tokens_input) AS total_input_tokens,
        SUM(tokens_output) AS total_output_tokens,
        SUM(cost_usd) AS total_cost_usd,
        COUNT(*) AS operation_count,
        AVG(cost_usd) AS avg_cost_per_operation,
        AVG(response_time_ms) AS avg_response_time_ms
      FROM llm_cost_log
      WHERE created_at >= $1 AND created_at <= $2
      GROUP BY operation
      ORDER BY total_cost_usd DESC
    `, [dateFrom, dateTo]);

    res.json({
      success: true,
      data: {
        operations: result.rows.map(row => ({
          operation: row.operation,
          total_input_tokens: parseInt(row.total_input_tokens, 10),
          total_output_tokens: parseInt(row.total_output_tokens, 10),
          total_cost_usd: parseFloat(row.total_cost_usd),
          operation_count: parseInt(row.operation_count, 10),
          avg_cost_per_operation: parseFloat(row.avg_cost_per_operation),
          avg_response_time_ms: parseFloat(row.avg_response_time_ms)
        })),
        period: {
          from: dateFrom,
          to: dateTo
        }
      }
    });
  } catch (error: any) {
    logger.error('Failed to get operation costs', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve operation costs'
    });
  }
});

/**
 * GET /api/cost/trends
 * Get cost trends with projection
 */
router.get('/trends', async (req: Request, res: Response) => {
  try {
    const days = parseInt(req.query.days as string) || 30;

    // Get daily cost for last N days
    const result = await pool.query(`
      SELECT
        date_trunc('day', created_at) AS day,
        SUM(cost_usd) AS cost_usd,
        COUNT(*) AS operation_count,
        SUM(tokens_input + tokens_output) AS total_tokens
      FROM llm_cost_log
      WHERE created_at >= NOW() - INTERVAL '${days} days'
      GROUP BY day
      ORDER BY day ASC
    `);

    const dailyTrend = result.rows.map(row => ({
      day: row.day,
      cost_usd: parseFloat(row.cost_usd),
      operation_count: parseInt(row.operation_count, 10),
      total_tokens: parseInt(row.total_tokens, 10)
    }));

    // Calculate projection for rest of month
    const currentMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    const daysInMonth = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate();
    const dayOfMonth = new Date().getDate();

    const monthToDateCost = dailyTrend
      .filter(d => new Date(d.day) >= currentMonth)
      .reduce((sum, d) => sum + d.cost_usd, 0);

    const avgDailyCost = monthToDateCost / dayOfMonth;
    const projectedMonthlyCost = avgDailyCost * daysInMonth;

    res.json({
      success: true,
      data: {
        daily_trend: dailyTrend,
        projection: {
          month_to_date_cost: monthToDateCost,
          avg_daily_cost: avgDailyCost,
          projected_monthly_cost: projectedMonthlyCost,
          days_remaining: daysInMonth - dayOfMonth,
          confidence: dayOfMonth >= 7 ? 'high' : dayOfMonth >= 3 ? 'medium' : 'low'
        }
      }
    });
  } catch (error: any) {
    logger.error('Failed to get cost trends', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve cost trends'
    });
  }
});

/**
 * GET /api/cost/dashboard
 * Get comprehensive dashboard data
 */
router.get('/dashboard', async (req: Request, res: Response) => {
  try {
    const currentMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);

    // Current month total
    const monthTotal = await pool.query(`
      SELECT SUM(cost_usd) AS total_cost
      FROM llm_cost_log
      WHERE created_at >= date_trunc('month', NOW())
    `);

    // Today's cost
    const todayCost = await pool.query(`
      SELECT SUM(cost_usd) AS total_cost
      FROM llm_cost_log
      WHERE created_at >= date_trunc('day', NOW())
    `);

    // Top agents by cost
    const topAgents = await pool.query(`
      SELECT
        ar.agent_name,
        acs.total_cost_usd,
        acs.operation_count
      FROM agent_cost_summary acs
      JOIN agent_registry ar ON ar.id = acs.agent_id
      WHERE acs.month = date_trunc('month', NOW())
      ORDER BY acs.total_cost_usd DESC
      LIMIT 5
    `);

    // Top models by cost
    const topModels = await pool.query(`
      SELECT
        provider,
        model,
        SUM(cost_usd) AS total_cost,
        COUNT(*) AS operation_count
      FROM llm_cost_log
      WHERE created_at >= date_trunc('month', NOW())
      GROUP BY provider, model
      ORDER BY total_cost DESC
      LIMIT 5
    `);

    res.json({
      success: true,
      data: {
        current_month: {
          total_cost: parseFloat(monthTotal.rows[0]?.total_cost || 0),
          month: currentMonth.toISOString().substring(0, 7)
        },
        today: {
          total_cost: parseFloat(todayCost.rows[0]?.total_cost || 0),
          date: new Date().toISOString().substring(0, 10)
        },
        top_agents: topAgents.rows.map(row => ({
          agent_name: row.agent_name,
          cost_usd: parseFloat(row.total_cost_usd),
          operation_count: parseInt(row.operation_count, 10)
        })),
        top_models: topModels.rows.map(row => ({
          provider: row.provider,
          model: row.model,
          cost_usd: parseFloat(row.total_cost),
          operation_count: parseInt(row.operation_count, 10)
        }))
      }
    });
  } catch (error: any) {
    logger.error('Failed to get dashboard data', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve dashboard data'
    });
  }
});

export default router;
