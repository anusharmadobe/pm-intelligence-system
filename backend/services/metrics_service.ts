import { logger } from '../utils/logger';
import { getDbPool } from '../db/connection';

export interface AdoptionMetrics {
  total_signals: number;
  total_opportunities: number;
  total_judgments: number;
  total_artifacts: number;
  signals_by_source: Record<string, number>;
  opportunities_by_status: Record<string, number>;
  judgments_by_confidence: Record<string, number>;
  artifacts_by_type: Record<string, number>;
  signals_per_day: Array<{ date: string; count: number }>;
  opportunities_per_day: Array<{ date: string; count: number }>;
  judgments_per_day: Array<{ date: string; count: number }>;
  artifacts_per_day: Array<{ date: string; count: number }>;
}

/**
 * Retrieves adoption metrics for the PM Intelligence System.
 * Tracks usage across all layers without vanity metrics.
 */
export async function getAdoptionMetrics(): Promise<AdoptionMetrics> {
  const pool = getDbPool();

  // Total counts
  const signalsResult = await pool.query('SELECT COUNT(*) as count FROM signals');
  const opportunitiesResult = await pool.query('SELECT COUNT(*) as count FROM opportunities');
  const judgmentsResult = await pool.query('SELECT COUNT(*) as count FROM judgments');
  const artifactsResult = await pool.query('SELECT COUNT(*) as count FROM artifacts');

  // Signals by source
  const signalsBySourceResult = await pool.query(
    'SELECT source, COUNT(*) as count FROM signals GROUP BY source'
  );
  const signals_by_source: Record<string, number> = {};
  signalsBySourceResult.rows.forEach(row => {
    signals_by_source[row.source] = parseInt(row.count);
  });

  // Opportunities by status
  const opportunitiesByStatusResult = await pool.query(
    'SELECT status, COUNT(*) as count FROM opportunities GROUP BY status'
  );
  const opportunities_by_status: Record<string, number> = {};
  opportunitiesByStatusResult.rows.forEach(row => {
    opportunities_by_status[row.status] = parseInt(row.count);
  });

  // Judgments by confidence level
  const judgmentsByConfidenceResult = await pool.query(
    'SELECT confidence_level, COUNT(*) as count FROM judgments GROUP BY confidence_level'
  );
  const judgments_by_confidence: Record<string, number> = {};
  judgmentsByConfidenceResult.rows.forEach(row => {
    judgments_by_confidence[row.confidence_level] = parseInt(row.count);
  });

  // Artifacts by type
  const artifactsByTypeResult = await pool.query(
    'SELECT artifact_type, COUNT(*) as count FROM artifacts GROUP BY artifact_type'
  );
  const artifacts_by_type: Record<string, number> = {};
  artifactsByTypeResult.rows.forEach(row => {
    artifacts_by_type[row.artifact_type] = parseInt(row.count);
  });

  // Daily counts (last 30 days)
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const signalsPerDayResult = await pool.query(
    `SELECT DATE(created_at) as date, COUNT(*) as count 
     FROM signals 
     WHERE created_at >= $1 
     GROUP BY DATE(created_at) 
     ORDER BY date`,
    [thirtyDaysAgo]
  );
  const signals_per_day = signalsPerDayResult.rows.map(row => ({
    date: row.date.toISOString().split('T')[0],
    count: parseInt(row.count)
  }));

  const opportunitiesPerDayResult = await pool.query(
    `SELECT DATE(created_at) as date, COUNT(*) as count 
     FROM opportunities 
     WHERE created_at >= $1 
     GROUP BY DATE(created_at) 
     ORDER BY date`,
    [thirtyDaysAgo]
  );
  const opportunities_per_day = opportunitiesPerDayResult.rows.map(row => ({
    date: row.date.toISOString().split('T')[0],
    count: parseInt(row.count)
  }));

  const judgmentsPerDayResult = await pool.query(
    `SELECT DATE(created_at) as date, COUNT(*) as count 
     FROM judgments 
     WHERE created_at >= $1 
     GROUP BY DATE(created_at) 
     ORDER BY date`,
    [thirtyDaysAgo]
  );
  const judgments_per_day = judgmentsPerDayResult.rows.map(row => ({
    date: row.date.toISOString().split('T')[0],
    count: parseInt(row.count)
  }));

  const artifactsPerDayResult = await pool.query(
    `SELECT DATE(created_at) as date, COUNT(*) as count 
     FROM artifacts 
     WHERE created_at >= $1 
     GROUP BY DATE(created_at) 
     ORDER BY date`,
    [thirtyDaysAgo]
  );
  const artifacts_per_day = artifactsPerDayResult.rows.map(row => ({
    date: row.date.toISOString().split('T')[0],
    count: parseInt(row.count)
  }));

  return {
    total_signals: parseInt(signalsResult.rows[0].count),
    total_opportunities: parseInt(opportunitiesResult.rows[0].count),
    total_judgments: parseInt(judgmentsResult.rows[0].count),
    total_artifacts: parseInt(artifactsResult.rows[0].count),
    signals_by_source,
    opportunities_by_status,
    judgments_by_confidence,
    artifacts_by_type,
    signals_per_day,
    opportunities_per_day,
    judgments_per_day,
    artifacts_per_day
  };
}

/**
 * Formats metrics as a readable report.
 */
export function formatMetricsReport(metrics: AdoptionMetrics): string {
  return `
# PM Intelligence System - Adoption Metrics

## Overview
- Total Signals: ${metrics.total_signals}
- Total Opportunities: ${metrics.total_opportunities}
- Total Judgments: ${metrics.total_judgments}
- Total Artifacts: ${metrics.total_artifacts}

## Signals by Source
${Object.entries(metrics.signals_by_source)
  .map(([source, count]) => `- ${source}: ${count}`)
  .join('\n')}

## Opportunities by Status
${Object.entries(metrics.opportunities_by_status)
  .map(([status, count]) => `- ${status}: ${count}`)
  .join('\n')}

## Judgments by Confidence Level
${Object.entries(metrics.judgments_by_confidence)
  .map(([level, count]) => `- ${level}: ${count}`)
  .join('\n')}

## Artifacts by Type
${Object.entries(metrics.artifacts_by_type)
  .map(([type, count]) => `- ${type}: ${count}`)
  .join('\n')}

## Daily Activity (Last 30 Days)
### Signals
${metrics.signals_per_day.map(d => `- ${d.date}: ${d.count}`).join('\n') || 'No data'}

### Opportunities
${metrics.opportunities_per_day.map(d => `- ${d.date}: ${d.count}`).join('\n') || 'No data'}

### Judgments
${metrics.judgments_per_day.map(d => `- ${d.date}: ${d.count}`).join('\n') || 'No data'}

### Artifacts
${metrics.artifacts_per_day.map(d => `- ${d.date}: ${d.count}`).join('\n') || 'No data'}
`.trim();
}
