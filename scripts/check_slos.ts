#!/usr/bin/env ts-node

/**
 * SLO Breach Detection Script
 *
 * Checks for SLO breaches and logs alerts
 * Intended to run every 5 minutes via cron
 *
 * Usage:
 *   npm run slo:check
 *
 * Cron setup (run every 5 minutes):
 *   */5 * * * * cd /path/to/project && npm run slo:check >> logs/slo_check.log 2>&1
 */

import * as dotenv from 'dotenv';
dotenv.config();

import { SLOMonitoringService } from '../backend/services/slo_monitoring_service';
import { logger } from '../backend/utils/logger';
import { getDbPool } from '../backend/db/connection';

async function logAlert(breach: any): Promise<void> {
  const pool = getDbPool();

  try {
    await pool.query(
      `INSERT INTO alerts (alert_name, severity, message, metric_name, metric_value, threshold, status, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'open', NOW())`,
      [
        `SLO Breach: ${breach.slo_name}`,
        breach.breach_severity,
        `SLO "${breach.slo_name}" is breached. Current: ${breach.current_value.toFixed(4)}, Target: ${breach.target.toFixed(4)}`,
        breach.slo_name,
        breach.current_value,
        breach.target
      ]
    );

    logger.warn('SLO breach detected', {
      slo_name: breach.slo_name,
      severity: breach.breach_severity,
      current_value: breach.current_value,
      target: breach.target,
      breach_duration_minutes: breach.breach_duration_minutes
    });
  } catch (error: any) {
    logger.error('Failed to log alert', { error: error.message });
  }
}

async function checkAndResolveOldAlerts(): Promise<void> {
  const pool = getDbPool();
  const sloService = new SLOMonitoringService();

  try {
    // Get all open SLO alerts
    const openAlerts = await pool.query(
      `SELECT id, alert_name, metric_name
       FROM alerts
       WHERE status = 'open'
         AND alert_name LIKE 'SLO Breach:%'`
    );

    // Get current SLO status
    const statuses = await sloService.checkAllSLOs();

    // Resolve alerts for SLOs that are now healthy
    for (const alert of openAlerts.rows) {
      const sloName = alert.metric_name;
      const sloStatus = statuses.find(s => s.slo_name === sloName);

      if (sloStatus && sloStatus.status === 'healthy') {
        await pool.query(
          `UPDATE alerts
           SET status = 'resolved',
               resolved_at = NOW()
           WHERE id = $1`,
          [alert.id]
        );

        logger.info('SLO breach resolved', {
          slo_name: sloName,
          alert_id: alert.id
        });
      }
    }
  } catch (error: any) {
    logger.error('Failed to check/resolve old alerts', { error: error.message });
  }
}

async function main() {
  try {
    logger.info('Running SLO breach check...');

    const sloService = new SLOMonitoringService();
    const breaches = await sloService.getSLOBreaches();

    if (breaches.length === 0) {
      logger.info('No SLO breaches detected');
      console.log(`[${new Date().toISOString()}] ✅ All SLOs healthy`);
    } else {
      logger.warn('SLO breaches detected', { breach_count: breaches.length });
      console.log(`[${new Date().toISOString()}] ⚠️  ${breaches.length} SLO breach(es) detected`);

      // Log each breach
      for (const breach of breaches) {
        await logAlert(breach);
        console.log(`  • ${breach.slo_name}: ${breach.breach_severity.toUpperCase()} (${breach.breach_duration_minutes}min)`);
      }

      // Print summary
      const criticalCount = breaches.filter(b => b.breach_severity === 'critical').length;
      const warningCount = breaches.filter(b => b.breach_severity === 'warning').length;

      console.log(`\nSummary:`);
      console.log(`  Critical: ${criticalCount}`);
      console.log(`  Warning:  ${warningCount}`);
      console.log(`\nRun 'npm run slo:dashboard' for detailed status\n`);
    }

    // Check and resolve old alerts
    await checkAndResolveOldAlerts();

    logger.info('SLO breach check complete');

  } catch (error: any) {
    logger.error('SLO breach check failed', {
      error: error.message,
      stack: error.stack
    });
    console.error(`[${new Date().toISOString()}] ❌ SLO check failed: ${error.message}`);
    process.exit(1);
  }
}

main();
