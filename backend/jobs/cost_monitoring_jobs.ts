/**
 * Cost Monitoring Jobs
 *
 * Periodic jobs for cost tracking and budget monitoring:
 * 1. Refresh agent_cost_summary materialized view (every 10 minutes)
 * 2. Check budget alerts (every 15 minutes)
 * 3. Emit cost metrics (every 15 minutes)
 */

import { getDbPool } from '../db/connection';
import { logger } from '../utils/logger';
import { getBudgetAlertService } from '../services/budget_alert_service';

/**
 * Refresh the agent_cost_summary materialized view
 * This provides fast aggregated cost queries for agents
 *
 * Run frequency: Every 10 minutes
 */
export async function refreshAgentCostSummary(): Promise<void> {
  const pool = getDbPool();
  const startTime = Date.now();

  try {
    // Call the database function that refreshes the materialized view
    await pool.query('SELECT refresh_agent_cost_summary()');

    const duration = Date.now() - startTime;

    logger.info('Agent cost summary refreshed', {
      duration_ms: duration,
      timestamp: new Date().toISOString()
    });

    // Log to system_metrics for monitoring
    await pool.query(`
      INSERT INTO system_metrics (metric_name, metric_value, labels)
      VALUES ('agent_cost_summary_refresh_duration_ms', $1, '{"job": "refresh_agent_cost_summary"}'::jsonb)
    `, [duration]);
  } catch (error: any) {
    logger.error('Failed to refresh agent cost summary', {
      error: error.message,
      stack: error.stack,
      duration_ms: Date.now() - startTime
    });

    // Log failure metric
    try {
      await pool.query(`
        INSERT INTO system_metrics (metric_name, metric_value, labels)
        VALUES ('agent_cost_summary_refresh_errors', 1, '{"job": "refresh_agent_cost_summary"}'::jsonb)
      `);
    } catch (metricError) {
      // Ignore metric logging errors
    }
  }
}

/**
 * Check budget alerts for all agents
 * Sends alerts for agents approaching or exceeding budget limits
 *
 * Run frequency: Every 15 minutes
 */
export async function checkBudgetAlerts(): Promise<void> {
  const startTime = Date.now();

  try {
    const alertService = getBudgetAlertService();
    const alerts = await alertService.checkBudgetAlerts();

    const duration = Date.now() - startTime;

    logger.info('Budget alerts checked', {
      alert_count: alerts.length,
      duration_ms: duration,
      by_severity: {
        info: alerts.filter(a => a.severity === 'info').length,
        warning: alerts.filter(a => a.severity === 'warning').length,
        critical: alerts.filter(a => a.severity === 'critical').length
      }
    });

    // Log metric
    const pool = getDbPool();
    await pool.query(`
      INSERT INTO system_metrics (metric_name, metric_value, labels)
      VALUES ('budget_alerts_checked', $1, $2::jsonb)
    `, [alerts.length, JSON.stringify({
      job: 'check_budget_alerts',
      info: alerts.filter(a => a.severity === 'info').length,
      warning: alerts.filter(a => a.severity === 'warning').length,
      critical: alerts.filter(a => a.severity === 'critical').length
    })]);
  } catch (error: any) {
    logger.error('Failed to check budget alerts', {
      error: error.message,
      stack: error.stack,
      duration_ms: Date.now() - startTime
    });
  }
}

/**
 * Emit cost metrics to system_metrics table
 * Tracks daily/monthly costs for monitoring
 *
 * Run frequency: Every 15 minutes
 */
export async function emitCostMetrics(): Promise<void> {
  const pool = getDbPool();
  const startTime = Date.now();

  try {
    // Total cost today
    const todayResult = await pool.query(`
      SELECT SUM(cost_usd) AS total_cost
      FROM llm_cost_log
      WHERE created_at >= date_trunc('day', NOW())
    `);
    const todayCost = parseFloat(todayResult.rows[0]?.total_cost || 0);

    // Total cost this month
    const monthResult = await pool.query(`
      SELECT SUM(cost_usd) AS total_cost
      FROM llm_cost_log
      WHERE created_at >= date_trunc('month', NOW())
    `);
    const monthCost = parseFloat(monthResult.rows[0]?.total_cost || 0);

    // Cost by provider
    const providerResult = await pool.query(`
      SELECT provider, SUM(cost_usd) AS cost
      FROM llm_cost_log
      WHERE created_at >= date_trunc('day', NOW())
      GROUP BY provider
    `);

    // Emit metrics
    await pool.query(`
      INSERT INTO system_metrics (metric_name, metric_value, labels)
      VALUES
        ('llm_cost_daily_usd', $1, '{"period": "today"}'::jsonb),
        ('llm_cost_monthly_usd', $2, '{"period": "current_month"}'::jsonb)
    `, [todayCost, monthCost]);

    // Emit provider-specific metrics
    for (const row of providerResult.rows) {
      await pool.query(`
        INSERT INTO system_metrics (metric_name, metric_value, labels)
        VALUES ('llm_cost_by_provider_usd', $1, $2::jsonb)
      `, [parseFloat(row.cost), JSON.stringify({
        provider: row.provider,
        period: 'today'
      })]);
    }

    const duration = Date.now() - startTime;

    logger.debug('Cost metrics emitted', {
      today_cost: todayCost.toFixed(2),
      month_cost: monthCost.toFixed(2),
      providers: providerResult.rows.length,
      duration_ms: duration
    });
  } catch (error: any) {
    logger.error('Failed to emit cost metrics', {
      error: error.message,
      stack: error.stack
    });
  }
}

/**
 * Start all cost monitoring jobs
 * Call this from your main server file to schedule periodic jobs
 */
export function startCostMonitoringJobs(): void {
  // Skip if cost tracking is disabled
  if (process.env.FF_COST_TRACKING === 'false') {
    logger.info('Cost monitoring jobs disabled (FF_COST_TRACKING=false)');
    return;
  }

  logger.info('Starting cost monitoring jobs');

  // Refresh agent cost summary every 10 minutes
  setInterval(() => {
    refreshAgentCostSummary().catch(err =>
      logger.error('Agent cost summary refresh job failed', { error: err.message })
    );
  }, 10 * 60 * 1000);

  // Check budget alerts every 15 minutes
  setInterval(() => {
    checkBudgetAlerts().catch(err =>
      logger.error('Budget alert check job failed', { error: err.message })
    );
  }, 15 * 60 * 1000);

  // Emit cost metrics every 15 minutes
  setInterval(() => {
    emitCostMetrics().catch(err =>
      logger.error('Cost metrics emission job failed', { error: err.message })
    );
  }, 15 * 60 * 1000);

  // Run once immediately on startup
  setTimeout(() => {
    refreshAgentCostSummary().catch(err =>
      logger.error('Initial agent cost summary refresh failed', { error: err.message })
    );
    checkBudgetAlerts().catch(err =>
      logger.error('Initial budget alert check failed', { error: err.message })
    );
    emitCostMetrics().catch(err =>
      logger.error('Initial cost metrics emission failed', { error: err.message })
    );
  }, 5000); // Wait 5 seconds after startup

  logger.info('Cost monitoring jobs started', {
    refresh_interval_min: 10,
    alert_check_interval_min: 15,
    metrics_interval_min: 15
  });
}

/**
 * Stop all cost monitoring jobs (for graceful shutdown)
 * Note: This currently doesn't track intervals, so it's a placeholder
 * In a production system, you'd want to track and clear intervals
 */
export function stopCostMonitoringJobs(): void {
  logger.info('Stopping cost monitoring jobs');
  // TODO: Track interval IDs and clear them
}
