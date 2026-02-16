#!/usr/bin/env ts-node

/**
 * Report Scheduler Agent
 *
 * Generates weekly digest reports automatically
 * Can be run manually or via cron job
 *
 * Usage:
 *   npm run agent:report-scheduler
 *   npm run agent:report-scheduler -- --weekly  # Generate weekly report
 *   npm run agent:report-scheduler -- --days 30  # Custom time range
 */

import * as dotenv from 'dotenv';
dotenv.config();

import { getDbPool } from '../../backend/db/connection';
import { logger } from '../../backend/utils/logger';
import * as fs from 'fs';
import * as path from 'path';

interface ReportOptions {
  days: number;
  format: 'markdown' | 'json';
}

async function generateReport(options: ReportOptions) {
  const pool = getDbPool();
  const startDate = new Date(Date.now() - options.days * 24 * 60 * 60 * 1000);
  const endDate = new Date();

  logger.info('Generating report', { startDate, endDate });

  // Fetch signals
  const signalsQuery = await pool.query(
    `SELECT COUNT(*) as total, source FROM signals WHERE created_at >= $1 GROUP BY source`,
    [startDate]
  );

  const report = {
    period: { start: startDate, end: endDate, days: options.days },
    signals: signalsQuery.rows,
    generated_at: new Date()
  };

  return report;
}

async function main() {
  const args = process.argv.slice(2);
  const options: ReportOptions = { days: 7, format: 'markdown' };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--days') options.days = parseInt(args[i + 1]);
    if (args[i] === '--json') options.format = 'json';
  }

  console.log(`\n📊 Generating ${options.days}-day report...\n`);
  const report = await generateReport(options);

  const outputDir = path.join(process.cwd(), 'output');
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  const timestamp = new Date().toISOString().split('T')[0];
  const filename = `weekly_digest_${timestamp}.json`;
  fs.writeFileSync(path.join(outputDir, filename), JSON.stringify(report, null, 2));

  console.log(`✅ Report saved to: output/${filename}\n`);
  logger.info('Report generated', { filename });
}

main().catch(err => {
  console.error(`❌ Error: ${err.message}`);
  process.exit(1);
});
