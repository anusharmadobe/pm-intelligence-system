#!/usr/bin/env ts-node

/**
 * SLO Dashboard Script
 *
 * Displays current status of all 6 critical SLOs
 *
 * Usage:
 *   npm run slo:dashboard
 *   npm run slo:dashboard -- --json  # JSON output
 */

import * as dotenv from 'dotenv';
dotenv.config();

import { SLOMonitoringService } from '../backend/services/slo_monitoring_service';
import { logger } from '../backend/utils/logger';

interface DashboardOptions {
  json: boolean;
}

function parseArgs(): DashboardOptions {
  const args = process.argv.slice(2);
  return {
    json: args.includes('--json')
  };
}

function getStatusEmoji(status: string): string {
  switch (status) {
    case 'healthy':
      return '✅';
    case 'warning':
      return '⚠️';
    case 'critical':
      return '❌';
    default:
      return '❓';
  }
}

function formatValue(value: number, sloName: string): string {
  if (sloName.includes('accuracy') || sloName.includes('rate') || sloName.includes('uptime')) {
    return `${(value * 100).toFixed(2)}%`;
  } else if (sloName.includes('latency')) {
    return `${Math.round(value)}ms`;
  } else if (sloName.includes('consistency')) {
    return `${(value * 100).toFixed(2)}%`;
  }
  return value.toString();
}

function formatTarget(target: number, sloName: string): string {
  if (sloName.includes('accuracy') || sloName.includes('rate') || sloName.includes('uptime')) {
    return `>${(target * 100).toFixed(0)}%`;
  } else if (sloName.includes('latency')) {
    return `<${Math.round(target)}ms`;
  } else if (sloName.includes('consistency')) {
    return `<${(target * 100).toFixed(0)}%`;
  }
  return target.toString();
}

function printTextDashboard(statuses: any[], breaches: any[]): void {
  console.log('\n╔══════════════════════════════════════════════════════════════════════╗');
  console.log('║                      SLO MONITORING DASHBOARD                        ║');
  console.log('╚══════════════════════════════════════════════════════════════════════╝\n');

  console.log(`Last Updated: ${new Date().toLocaleString()}\n`);

  // Overall Health Summary
  const healthyCount = statuses.filter(s => s.status === 'healthy').length;
  const warningCount = statuses.filter(s => s.status === 'warning').length;
  const criticalCount = statuses.filter(s => s.status === 'critical').length;

  console.log('OVERALL HEALTH:');
  console.log(`  ✅ Healthy:  ${healthyCount}/${statuses.length}`);
  console.log(`  ⚠️  Warning:  ${warningCount}/${statuses.length}`);
  console.log(`  ❌ Critical: ${criticalCount}/${statuses.length}\n`);

  // SLO Status Table
  console.log('SLO STATUS:');
  console.log('─'.repeat(100));
  console.log(
    `${'SLO Name'.padEnd(40)} ${'Target'.padEnd(15)} ${'Current'.padEnd(15)} ${'Status'.padEnd(10)} ${'Window'.padEnd(15)}`
  );
  console.log('─'.repeat(100));

  for (const slo of statuses) {
    const emoji = getStatusEmoji(slo.status);
    const name = slo.slo_name.replace(/_/g, ' ').toUpperCase();
    const target = formatTarget(slo.target, slo.slo_name);
    const current = formatValue(slo.current_value, slo.slo_name);
    const statusText = `${emoji} ${slo.status}`;
    const window = slo.measurement_window;

    console.log(
      `${name.padEnd(40)} ${target.padEnd(15)} ${current.padEnd(15)} ${statusText.padEnd(15)} ${window.padEnd(15)}`
    );
  }
  console.log('─'.repeat(100));

  // Active Breaches
  if (breaches.length > 0) {
    console.log('\n⚠️  ACTIVE SLO BREACHES:');
    console.log('─'.repeat(100));

    for (const breach of breaches) {
      const name = breach.slo_name.replace(/_/g, ' ').toUpperCase();
      const severity = breach.breach_severity.toUpperCase();
      const duration = Math.round(breach.breach_duration_minutes);

      console.log(`\n  ${name}`);
      console.log(`    Severity:     ${severity}`);
      console.log(`    Target:       ${formatTarget(breach.target, breach.slo_name)}`);
      console.log(`    Current:      ${formatValue(breach.current_value, breach.slo_name)}`);
      console.log(`    Duration:     ${duration} minutes`);
      console.log(`    First Breach: ${new Date(breach.first_breached_at).toLocaleString()}`);
    }
    console.log();
  } else {
    console.log('\n✅ No active SLO breaches\n');
  }

  // Recommendations
  if (breaches.length > 0) {
    console.log('RECOMMENDED ACTIONS:');
    console.log('─'.repeat(100));

    for (const breach of breaches) {
      if (breach.slo_name.includes('entity_resolution')) {
        console.log('  • Review golden dataset and retrain entity resolution models');
        console.log('  • Check LLM provider status and API rate limits');
      } else if (breach.slo_name.includes('ingestion')) {
        console.log('  • Check ingestion queue for stuck jobs');
        console.log('  • Verify source system connectivity');
      } else if (breach.slo_name.includes('mcp_tool')) {
        console.log('  • Investigate slow MCP tool queries');
        console.log('  • Check database query performance');
      } else if (breach.slo_name.includes('neo4j')) {
        console.log('  • Check Neo4j sync backlog');
        console.log('  • Verify Neo4j server resources');
      } else if (breach.slo_name.includes('extraction')) {
        console.log('  • Review failed signal extractions');
        console.log('  • Check LLM provider availability');
      } else if (breach.slo_name.includes('consistency')) {
        console.log('  • Run manual consistency check');
        console.log('  • Trigger full Neo4j resync if needed');
      }
    }
    console.log();
  }
}

async function main() {
  const options = parseArgs();

  try {
    const sloService = new SLOMonitoringService();

    logger.info('Fetching SLO status...');
    const statuses = await sloService.checkAllSLOs();
    const breaches = await sloService.getSLOBreaches();

    if (options.json) {
      // JSON output
      console.log(JSON.stringify({
        timestamp: new Date().toISOString(),
        slos: statuses,
        breaches,
        summary: {
          total: statuses.length,
          healthy: statuses.filter(s => s.status === 'healthy').length,
          warning: statuses.filter(s => s.status === 'warning').length,
          critical: statuses.filter(s => s.status === 'critical').length
        }
      }, null, 2));
    } else {
      // Text dashboard
      printTextDashboard(statuses, breaches);
    }

    // Exit with error code if any breaches
    if (breaches.length > 0) {
      process.exit(1);
    }

  } catch (error: any) {
    console.error('\n❌ Failed to fetch SLO status:', error.message);
    logger.error('SLO dashboard error', { error: error.message, stack: error.stack });
    process.exit(1);
  }
}

main();
