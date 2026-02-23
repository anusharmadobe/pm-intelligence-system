/**
 * Budget Alert Service
 *
 * Monitors agent budgets and sends alerts at threshold levels:
 * - 50% utilization (info)
 * - 75% utilization (warning)
 * - 90% utilization (critical)
 * - 100% utilization (critical - agent paused)
 */

import { getDbPool } from '../db/connection';
import { logger } from '../utils/logger';
import { getSlackNotificationService } from './slack_notification_service';

export interface BudgetAlert {
  agent_id: string;
  agent_name: string;
  threshold_pct: number;
  current_cost: number;
  budget_limit: number;
  utilization_pct: number;
  remaining: number;
  severity: 'info' | 'warning' | 'critical';
}

export class BudgetAlertService {
  private alertThresholds = [0.5, 0.75, 0.9, 1.0]; // 50%, 75%, 90%, 100%
  private recentAlerts = new Map<string, Set<number>>(); // Track which thresholds have been alerted for each agent
  private readonly ALERT_COOLDOWN_MS = 60 * 60 * 1000; // 1 hour cooldown per threshold

  constructor() {
    logger.info('Budget Alert Service initialized', {
      thresholds: this.alertThresholds.map(t => `${t * 100}%`)
    });
  }

  /**
   * Check all agents and send alerts for those approaching or exceeding budget limits
   */
  async checkBudgetAlerts(): Promise<BudgetAlert[]> {
    const pool = getDbPool();
    const alerts: BudgetAlert[] = [];

    try {
      // Query all active agents with their current budget status
      const result = await pool.query(`
        SELECT
          ar.id AS agent_id,
          ar.agent_name,
          ar.max_monthly_cost_usd AS budget_limit,
          COALESCE(acs.total_cost_usd, 0) AS current_cost,
          ar.max_monthly_cost_usd - COALESCE(acs.total_cost_usd, 0) AS remaining,
          CASE
            WHEN ar.max_monthly_cost_usd > 0 THEN
              (COALESCE(acs.total_cost_usd, 0) / ar.max_monthly_cost_usd)
            ELSE 0
          END AS utilization,
          ar.is_active
        FROM agent_registry ar
        LEFT JOIN agent_cost_summary acs
          ON ar.id = acs.agent_id
          AND acs.month = date_trunc('month', NOW())
        WHERE ar.max_monthly_cost_usd > 0
        ORDER BY utilization DESC
      `);

      for (const agent of result.rows) {
        const utilization = parseFloat(agent.utilization);

        // Check each threshold
        for (const threshold of this.alertThresholds) {
          // Agent has crossed this threshold
          if (utilization >= threshold) {
            // Check if we've already alerted for this threshold recently
            if (this.shouldSendAlert(agent.agent_id, threshold)) {
              const alert: BudgetAlert = {
                agent_id: agent.agent_id,
                agent_name: agent.agent_name,
                threshold_pct: threshold * 100,
                current_cost: parseFloat(agent.current_cost),
                budget_limit: parseFloat(agent.budget_limit),
                utilization_pct: utilization * 100,
                remaining: parseFloat(agent.remaining),
                severity: this.getSeverity(threshold)
              };

              alerts.push(alert);

              // Send the alert
              await this.sendAlert(alert);

              // Mark this threshold as alerted
              this.markAlertSent(agent.agent_id, threshold);
            }
          }
        }
      }

      if (alerts.length > 0) {
        logger.info('Budget alerts generated', {
          alert_count: alerts.length,
          by_severity: {
            info: alerts.filter(a => a.severity === 'info').length,
            warning: alerts.filter(a => a.severity === 'warning').length,
            critical: alerts.filter(a => a.severity === 'critical').length
          }
        });
      }

      return alerts;
    } catch (error: any) {
      logger.error('Failed to check budget alerts', {
        error: error.message,
        stack: error.stack
      });
      return [];
    }
  }

  /**
   * Send a budget alert
   */
  private async sendAlert(alert: BudgetAlert): Promise<void> {
    const pool = getDbPool();

    try {
      // Store alert in database
      await pool.query(`
        INSERT INTO alerts (alert_name, severity, message, metric_name, metric_value, threshold)
        VALUES ($1, $2, $3, $4, $5, $6)
      `, [
        'agent_budget_threshold',
        alert.severity,
        this.formatAlertMessage(alert),
        'agent_budget_utilization',
        alert.utilization_pct,
        alert.threshold_pct
      ]);

      // Log the alert
      logger.warn('Budget alert sent', {
        agent_id: alert.agent_id,
        agent_name: alert.agent_name,
        threshold_pct: alert.threshold_pct,
        utilization_pct: alert.utilization_pct.toFixed(2),
        severity: alert.severity,
        current_cost: alert.current_cost.toFixed(2),
        budget_limit: alert.budget_limit.toFixed(2),
        remaining: alert.remaining.toFixed(2)
      });

      // Send Slack notification
      try {
        const slackService = getSlackNotificationService();
        if (slackService.isEnabled()) {
          await slackService.sendBudgetAlert({
            agentName: alert.agent_name,
            threshold: alert.threshold_pct,
            currentCost: alert.current_cost,
            budgetLimit: alert.budget_limit,
            utilizationPct: alert.utilization_pct,
            severity: alert.severity
          });
          logger.debug('Slack notification sent for budget alert', {
            agent_name: alert.agent_name,
            threshold_pct: alert.threshold_pct
          });
        }
      } catch (error: any) {
        // Don't fail the alert if Slack notification fails
        logger.warn('Failed to send Slack notification for budget alert', {
          error: error.message,
          agent_name: alert.agent_name
        });
      }

      // TODO: Send email notification
      // await this.sendEmailNotification(alert);
    } catch (error: any) {
      logger.error('Failed to send budget alert', {
        error: error.message,
        alert
      });
    }
  }

  /**
   * Format alert message
   */
  private formatAlertMessage(alert: BudgetAlert): string {
    const utilizationStr = alert.utilization_pct.toFixed(1);
    const costStr = alert.current_cost.toFixed(2);
    const limitStr = alert.budget_limit.toFixed(2);
    const remainingStr = Math.abs(alert.remaining).toFixed(2);

    if (alert.threshold_pct >= 100) {
      return `CRITICAL: Agent "${alert.agent_name}" has exceeded budget limit! Used $${costStr} of $${limitStr} (${utilizationStr}%). Agent has been auto-paused.`;
    } else if (alert.threshold_pct >= 90) {
      return `CRITICAL: Agent "${alert.agent_name}" is at ${utilizationStr}% of budget. Used $${costStr} of $${limitStr}. Only $${remainingStr} remaining.`;
    } else if (alert.threshold_pct >= 75) {
      return `WARNING: Agent "${alert.agent_name}" is at ${utilizationStr}% of budget. Used $${costStr} of $${limitStr}. $${remainingStr} remaining.`;
    } else {
      return `INFO: Agent "${alert.agent_name}" has used ${utilizationStr}% of monthly budget ($${costStr} of $${limitStr}).`;
    }
  }

  /**
   * Determine alert severity based on threshold
   */
  private getSeverity(threshold: number): 'info' | 'warning' | 'critical' {
    if (threshold >= 0.9) return 'critical';
    if (threshold >= 0.75) return 'warning';
    return 'info';
  }

  /**
   * Check if we should send an alert for this agent/threshold combination
   */
  private shouldSendAlert(agentId: string, threshold: number): boolean {
    const key = agentId;
    const thresholds = this.recentAlerts.get(key);

    if (!thresholds) {
      return true; // No recent alerts for this agent
    }

    // Check if we've alerted for this specific threshold
    return !thresholds.has(threshold);
  }

  /**
   * Mark that we've sent an alert for this agent/threshold
   */
  private markAlertSent(agentId: string, threshold: number): void {
    const key = agentId;
    let thresholds = this.recentAlerts.get(key);

    if (!thresholds) {
      thresholds = new Set<number>();
      this.recentAlerts.set(key, thresholds);
    }

    thresholds.add(threshold);

    // Set a timeout to clear this threshold after cooldown period
    setTimeout(() => {
      const thresholds = this.recentAlerts.get(key);
      if (thresholds) {
        thresholds.delete(threshold);
        if (thresholds.size === 0) {
          this.recentAlerts.delete(key);
        }
      }
    }, this.ALERT_COOLDOWN_MS);
  }

  /**
   * Get recent alerts from database
   */
  async getRecentAlerts(hours: number = 24): Promise<any[]> {
    const pool = getDbPool();

    try {
      const result = await pool.query(`
        SELECT
          id,
          alert_name,
          severity,
          message,
          metric_name,
          metric_value,
          threshold,
          status,
          created_at,
          resolved_at
        FROM alerts
        WHERE alert_name = 'agent_budget_threshold'
          AND created_at >= NOW() - INTERVAL '${hours} hours'
        ORDER BY created_at DESC
      `);

      return result.rows;
    } catch (error: any) {
      logger.error('Failed to get recent alerts', {
        error: error.message
      });
      return [];
    }
  }

  /**
   * Mark an alert as resolved
   */
  async resolveAlert(alertId: string): Promise<void> {
    const pool = getDbPool();

    try {
      await pool.query(`
        UPDATE alerts
        SET status = 'resolved', resolved_at = NOW()
        WHERE id = $1
      `, [alertId]);

      logger.info('Alert resolved', { alert_id: alertId });
    } catch (error: any) {
      logger.error('Failed to resolve alert', {
        error: error.message,
        alert_id: alertId
      });
      throw error;
    }
  }

  /**
   * Clear alert history (for testing/maintenance)
   */
  clearAlertHistory(): void {
    this.recentAlerts.clear();
    logger.info('Alert history cleared');
  }
}

// Singleton instance
let budgetAlertService: BudgetAlertService | null = null;

/**
 * Get or create Budget Alert Service instance
 */
export function getBudgetAlertService(): BudgetAlertService {
  if (!budgetAlertService) {
    budgetAlertService = new BudgetAlertService();
  }
  return budgetAlertService;
}

/**
 * Schedule budget alert checks (call this from your job scheduler)
 * Recommended: Run every 15 minutes
 */
export async function scheduleBudgetAlertCheck(): Promise<void> {
  const service = getBudgetAlertService();
  await service.checkBudgetAlerts();
}
