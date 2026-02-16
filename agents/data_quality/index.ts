#!/usr/bin/env ts-node

/**
 * Data Quality Agent
 *
 * Monitors entity resolution accuracy and data quality metrics
 * Proposes cleanup actions
 *
 * Usage:
 *   npm run agent:data-quality
 */

import * as dotenv from 'dotenv';
dotenv.config();

import { getDbPool } from '../../backend/db/connection';
import { logger } from '../../backend/utils/logger';

interface QualityIssue {
  type: string;
  severity: 'low' | 'medium' | 'high';
  description: string;
  count: number;
  recommendation: string;
}

async function checkEntityResolutionAccuracy(): Promise<QualityIssue[]> {
  const pool = getDbPool();
  const issues: QualityIssue[] = [];

  // Check for low confidence auto-merges (potential false positives)
  const lowConfidenceQuery = await pool.query(
    `SELECT COUNT(*) as count
     FROM entity_resolution_log
     WHERE resolution_result = 'auto_merged'
       AND confidence < 0.9
       AND created_at >= NOW() - INTERVAL '7 days'`
  );

  const lowConfidenceCount = parseInt(lowConfidenceQuery.rows[0]?.count || '0');
  if (lowConfidenceCount > 10) {
    issues.push({
      type: 'low_confidence_merges',
      severity: 'medium',
      description: `${lowConfidenceCount} auto-merges with confidence < 0.9 in last 7 days`,
      count: lowConfidenceCount,
      recommendation: 'Review these merges and adjust confidence thresholds if needed'
    });
  }

  // Check for orphaned entities (no mentions in last 90 days)
  const orphanedQuery = await pool.query(
    `SELECT COUNT(*) as count
     FROM entity_registry e
     WHERE NOT EXISTS (
       SELECT 1 FROM entity_resolution_log erl
       WHERE erl.resolved_to_entity_id = e.id
         AND erl.created_at >= NOW() - INTERVAL '90 days'
     )`
  );

  const orphanedCount = parseInt(orphanedQuery.rows[0]?.count || '0');
  if (orphanedCount > 50) {
    issues.push({
      type: 'orphaned_entities',
      severity: 'low',
      description: `${orphanedCount} entities with no mentions in last 90 days`,
      count: orphanedCount,
      recommendation: 'Consider archiving inactive entities'
    });
  }

  // Check for duplicate entity names (potential merge candidates)
  const duplicatesQuery = await pool.query(
    `SELECT canonical_name, COUNT(*) as count
     FROM entity_registry
     GROUP BY LOWER(canonical_name)
     HAVING COUNT(*) > 1`
  );

  if (duplicatesQuery.rows.length > 0) {
    const totalDupes = duplicatesQuery.rows.reduce((sum, r) => sum + parseInt(r.count), 0);
    issues.push({
      type: 'potential_duplicates',
      severity: 'high',
      description: `${duplicatesQuery.rows.length} entity names with potential duplicates`,
      count: totalDupes,
      recommendation: 'Review and merge duplicate entities'
    });
  }

  return issues;
}

async function checkDataQuality(): Promise<QualityIssue[]> {
  const pool = getDbPool();
  const issues: QualityIssue[] = [];

  // Check for signals without extractions
  const unextractedQuery = await pool.query(
    `SELECT COUNT(*) as count
     FROM signals s
     WHERE NOT EXISTS (
       SELECT 1 FROM signal_extractions se WHERE se.signal_id = s.id
     )
     AND s.created_at >= NOW() - INTERVAL '7 days'`
  );

  const unextractedCount = parseInt(unextractedQuery.rows[0]?.count || '0');
  if (unextractedCount > 100) {
    issues.push({
      type: 'unextracted_signals',
      severity: 'high',
      description: `${unextractedCount} signals without extractions in last 7 days`,
      count: unextractedCount,
      recommendation: 'Run extraction pipeline to process these signals'
    });
  }

  // Check for failed extractions
  const failedQuery = await pool.query(
    `SELECT COUNT(*) as count
     FROM signal_extractions
     WHERE status = 'failed'
       AND created_at >= NOW() - INTERVAL '7 days'`
  );

  const failedCount = parseInt(failedQuery.rows[0]?.count || '0');
  if (failedCount > 50) {
    issues.push({
      type: 'failed_extractions',
      severity: 'high',
      description: `${failedCount} failed extractions in last 7 days`,
      count: failedCount,
      recommendation: 'Review extraction errors and retry failed signals'
    });
  }

  return issues;
}

async function main() {
  console.log('\n🔍 Data Quality Agent\n');
  console.log('Running data quality checks...\n');

  try {
    const erIssues = await checkEntityResolutionAccuracy();
    const dataIssues = await checkDataQuality();
    const allIssues = [...erIssues, ...dataIssues];

    if (allIssues.length === 0) {
      console.log('✅ No data quality issues detected\n');
      logger.info('Data quality check passed');
      return;
    }

    console.log(`⚠️  Found ${allIssues.length} data quality issue(s):\n`);

    for (const issue of allIssues) {
      const icon = issue.severity === 'high' ? '🔴' : issue.severity === 'medium' ? '🟡' : '🟢';
      console.log(`${icon} ${issue.type.toUpperCase()} (${issue.severity})`);
      console.log(`   ${issue.description}`);
      console.log(`   💡 ${issue.recommendation}\n`);
    }

    // Log to database for tracking
    const pool = getDbPool();
    for (const issue of allIssues) {
      try {
        await pool.query(
          `INSERT INTO feedback_log (feedback_type, system_output, status, created_at)
           VALUES ($1, $2, 'pending', NOW())`,
          ['data_quality', JSON.stringify(issue)]
        );
      } catch (error) {
        // Table might not exist, that's okay
        logger.debug('Could not log to feedback_log', { error });
      }
    }

    logger.info('Data quality issues detected', { count: allIssues.length, issues: allIssues });

  } catch (error: any) {
    console.error(`❌ Error: ${error.message}\n`);
    logger.error('Data quality check failed', { error: error.message });
    process.exit(1);
  }
}

main();
