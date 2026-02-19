#!/usr/bin/env ts-node

/**
 * Pipeline Status Monitoring Script
 *
 * Polls and displays real-time progress of the ingestion pipeline
 * Can monitor:
 * - Ingestion pipeline (signal processing)
 * - Clustering progress
 * - Embedding generation
 * - Entity resolution
 * - Neo4j sync
 *
 * Usage:
 *   npm run monitor-pipeline         # Monitor all stages
 *   npm run monitor-pipeline --stage clustering
 *   npm run monitor-pipeline --tail  # Follow mode
 */

import * as fs from 'fs';
import * as path from 'path';
import { getDbPool } from '../backend/db/connection';

// Color codes for terminal output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m'
};

interface PipelineStatus {
  stage: string;
  status: string;
  progress_pct?: string;
  processed?: number;
  total?: number;
  rate_per_sec?: string;
  eta_seconds?: string;
  elapsed_ms?: number;
  duration_ms?: number;
  success_count?: number;
  failure_count?: number;
  pairs_checked?: number;
  merge_count?: number;
  restart_count?: number;
  clusters_formed?: number;
  run_id?: string;
  timestamp: Date;
  metadata?: Record<string, any>;
}

interface DatabaseStats {
  total_signals: number;
  signals_with_extractions: number;
  signals_with_embeddings: number;
  total_opportunities: number;
  entities_resolved: number;
  neo4j_synced: number;
}

/**
 * Parse structured JSON logs from combined.log
 */
function parseRecentLogs(logFilePath: string, minutes: number = 5): PipelineStatus[] {
  if (!fs.existsSync(logFilePath)) {
    console.log(`${colors.yellow}⚠ Log file not found: ${logFilePath}${colors.reset}`);
    return [];
  }

  const cutoffTime = new Date(Date.now() - minutes * 60 * 1000);
  const logContent = fs.readFileSync(logFilePath, 'utf-8');
  const lines = logContent.split('\n').filter(line => line.trim().length > 0);

  const statuses: PipelineStatus[] = [];

  const readNumber = (entry: Record<string, any>, keys: string[]): number | undefined => {
    for (const key of keys) {
      const value = entry[key];
      if (value === undefined || value === null || value === '') continue;
      const numeric = Number(value);
      if (!Number.isNaN(numeric)) return numeric;
    }
    return undefined;
  };

  const readString = (entry: Record<string, any>, keys: string[]): string | undefined => {
    for (const key of keys) {
      const value = entry[key];
      if (value === undefined || value === null || value === '') continue;
      return String(value);
    }
    return undefined;
  };

  for (const line of lines) {
    try {
      const logEntry = JSON.parse(line);
      const timestampRaw = logEntry.timestamp || logEntry.ts;
      if (!timestampRaw) continue;
      const timestamp = new Date(timestampRaw);
      if (Number.isNaN(timestamp.getTime())) continue;

      if (timestamp < cutoffTime) continue;

      // Look for pipeline progress logs
      const stage = logEntry.stage || logEntry.module;
      const status = logEntry.status ? String(logEntry.status) : '';

      if (!stage || !status) continue;

      // Filter for progress-related logs
      if (
        status.includes('progress') ||
        status === 'in_progress' ||
        status === 'start' ||
        status === 'success' ||
        status === 'complete' ||
        status === 'batch_complete' ||
        status === 'failed' ||
        status === 'skipped' ||
        status === 'slow_cycle'
      ) {
        statuses.push({
          stage,
          status,
          progress_pct: readString(logEntry, ['progress_pct', 'progressPercent']),
          processed: readNumber(logEntry, ['processed', 'completed', 'processedCount', 'processed_seeds']),
          total: readNumber(logEntry, ['total', 'total_signals', 'totalSignals', 'selected']),
          rate_per_sec: readString(logEntry, ['rate_per_sec', 'throughput_per_sec']),
          eta_seconds: readString(logEntry, ['eta_seconds']),
          elapsed_ms: readNumber(logEntry, ['elapsed_ms', 'elapsedMs', 'duration_ms']),
          duration_ms: readNumber(logEntry, ['duration_ms']),
          success_count: readNumber(logEntry, ['success_count']),
          failure_count: readNumber(logEntry, ['failure_count']),
          pairs_checked: readNumber(logEntry, ['pairs_checked']),
          merge_count: readNumber(logEntry, ['merge_count']),
          restart_count: readNumber(logEntry, ['restart_count']),
          clusters_formed: readNumber(logEntry, ['clusters_formed']),
          run_id: readString(logEntry, ['runId', 'run_id']),
          timestamp,
          metadata: logEntry
        });
      }
    } catch (error) {
      // Skip malformed JSON lines
      continue;
    }
  }

  return statuses;
}

/**
 * Get current database statistics
 */
async function getDatabaseStats(): Promise<DatabaseStats> {
  const pool = getDbPool();

  const [
    signalsResult,
    extractionsResult,
    embeddingsResult,
    opportunitiesResult,
    entitiesResult
  ] = await Promise.all([
    pool.query('SELECT COUNT(*) as count FROM signals'),
    pool.query('SELECT COUNT(*) as count FROM signal_extractions'),
    pool.query('SELECT COUNT(*) as count FROM signal_embeddings'),
    pool.query('SELECT COUNT(*) as count FROM opportunities'),
    pool.query('SELECT COUNT(*) as count FROM entity_registry')
  ]);

  return {
    total_signals: parseInt(signalsResult.rows[0].count),
    signals_with_extractions: parseInt(extractionsResult.rows[0].count),
    signals_with_embeddings: parseInt(embeddingsResult.rows[0].count),
    total_opportunities: parseInt(opportunitiesResult.rows[0].count),
    entities_resolved: parseInt(entitiesResult.rows[0].count),
    neo4j_synced: 0 // Would need Neo4j query
  };
}

/**
 * Format duration in human-readable format
 */
function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 3600000) return `${(ms / 60000).toFixed(1)}m`;
  return `${(ms / 3600000).toFixed(1)}h`;
}

/**
 * Format ETA
 */
function formatETA(seconds: string): string {
  if (seconds === 'N/A') return 'N/A';
  const sec = parseInt(seconds);
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ${sec % 60}s`;
  return `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m`;
}

/**
 * Get status color based on stage status
 */
function getStatusColor(status: string): string {
  if (status.includes('success') || status.includes('complete')) return colors.green;
  if (status.includes('error') || status.includes('failed')) return colors.red;
  if (status.includes('slow') || status.includes('warn')) return colors.yellow;
  if (status.includes('progress') || status.includes('in_progress')) return colors.cyan;
  if (status === 'start') return colors.yellow;
  return colors.white;
}

/**
 * Get progress bar
 */
function getProgressBar(percent: number, width: number = 30): string {
  const filled = Math.floor((percent / 100) * width);
  const empty = width - filled;
  return `[${colors.green}${'█'.repeat(filled)}${colors.dim}${'░'.repeat(empty)}${colors.reset}]`;
}

/**
 * Display current pipeline status
 */
async function displayStatus(statuses: PipelineStatus[], dbStats: DatabaseStats) {
  // Clear console
  console.clear();

  // Header
  console.log(`${colors.bright}${colors.cyan}╔═══════════════════════════════════════════════════════════════════════════╗${colors.reset}`);
  console.log(`${colors.bright}${colors.cyan}║${colors.reset}             ${colors.bright}PM Intelligence Pipeline Status Monitor${colors.reset}                ${colors.bright}${colors.cyan}║${colors.reset}`);
  console.log(`${colors.bright}${colors.cyan}╚═══════════════════════════════════════════════════════════════════════════╝${colors.reset}`);
  console.log();

  // Database Stats
  console.log(`${colors.bright}${colors.yellow}📊 Database Statistics:${colors.reset}`);
  const extractionPct = dbStats.total_signals > 0
    ? ((dbStats.signals_with_extractions / dbStats.total_signals) * 100).toFixed(1)
    : '0.0';
  const embeddingPct = dbStats.total_signals > 0
    ? ((dbStats.signals_with_embeddings / dbStats.total_signals) * 100).toFixed(1)
    : '0.0';
  console.log(`   ${colors.dim}Total Signals:${colors.reset}          ${colors.bright}${dbStats.total_signals.toLocaleString()}${colors.reset}`);
  console.log(`   ${colors.dim}With Extractions:${colors.reset}       ${colors.bright}${dbStats.signals_with_extractions.toLocaleString()}${colors.reset} ${colors.dim}(${extractionPct}%)${colors.reset}`);
  console.log(`   ${colors.dim}With Embeddings:${colors.reset}        ${colors.bright}${dbStats.signals_with_embeddings.toLocaleString()}${colors.reset} ${colors.dim}(${embeddingPct}%)${colors.reset}`);
  console.log(`   ${colors.dim}Total Opportunities:${colors.reset}    ${colors.bright}${dbStats.total_opportunities.toLocaleString()}${colors.reset}`);
  console.log(`   ${colors.dim}Entities Resolved:${colors.reset}      ${colors.bright}${dbStats.entities_resolved.toLocaleString()}${colors.reset}`);
  console.log();

  // Group statuses by stage
  const stageMap = new Map<string, PipelineStatus[]>();
  for (const status of statuses) {
    if (!stageMap.has(status.stage)) {
      stageMap.set(status.stage, []);
    }
    stageMap.get(status.stage)!.push(status);
  }

  if (stageMap.size === 0) {
    console.log(`${colors.dim}No recent pipeline activity (last 5 minutes)${colors.reset}`);
    console.log(`${colors.dim}Waiting for pipeline to start...${colors.reset}`);
    return;
  }

  // Display each stage
  console.log(`${colors.bright}${colors.yellow}🔄 Active Pipeline Stages:${colors.reset}`);
  console.log();

  for (const [stageName, stageStatuses] of stageMap.entries()) {
    // Get most recent status for this stage
    const latest = stageStatuses[stageStatuses.length - 1];
    const statusColor = getStatusColor(latest.status);

    // Stage header
    console.log(`${colors.bright}${statusColor}▸ ${stageName.toUpperCase()}${colors.reset}`);

    // Status
    console.log(`  Status: ${statusColor}${latest.status}${colors.reset}`);

    // Progress bar if available
    if (latest.progress_pct !== undefined && latest.processed !== undefined && latest.total !== undefined) {
      const percent = parseFloat(latest.progress_pct);
      console.log(`  Progress: ${getProgressBar(percent, 40)} ${colors.bright}${latest.progress_pct}%${colors.reset}`);
      console.log(`  ${colors.dim}Processed: ${latest.processed.toLocaleString()} / ${latest.total.toLocaleString()}${colors.reset}`);
    }

    // Rate and ETA
    if (latest.rate_per_sec) {
      console.log(`  ${colors.dim}Rate: ${colors.reset}${colors.bright}${latest.rate_per_sec}${colors.reset}${colors.dim} items/sec${colors.reset}`);
    }

    if (latest.eta_seconds && latest.eta_seconds !== 'N/A') {
      console.log(`  ${colors.dim}ETA: ${colors.reset}${colors.bright}${formatETA(latest.eta_seconds)}${colors.reset}`);
    }

    if (latest.success_count !== undefined || latest.failure_count !== undefined) {
      const success = latest.success_count ?? 0;
      const failure = latest.failure_count ?? 0;
      console.log(`  ${colors.dim}Success/Failure: ${colors.reset}${colors.bright}${success}${colors.reset}/${colors.bright}${failure}${colors.reset}`);
    }

    if (latest.pairs_checked !== undefined) {
      console.log(`  ${colors.dim}Pairs Checked: ${colors.reset}${colors.bright}${latest.pairs_checked.toLocaleString()}${colors.reset}`);
    }

    if (latest.merge_count !== undefined || latest.restart_count !== undefined) {
      const mergeCount = latest.merge_count ?? 0;
      const restartCount = latest.restart_count ?? 0;
      console.log(`  ${colors.dim}Merges/Restarts: ${colors.reset}${colors.bright}${mergeCount}${colors.reset}/${colors.bright}${restartCount}${colors.reset}`);
    }

    if (latest.clusters_formed !== undefined) {
      console.log(`  ${colors.dim}Clusters Formed: ${colors.reset}${colors.bright}${latest.clusters_formed.toLocaleString()}${colors.reset}`);
    }

    // Elapsed time
    if (latest.elapsed_ms) {
      console.log(`  ${colors.dim}Elapsed: ${formatDuration(latest.elapsed_ms)}${colors.reset}`);
    }

    if (latest.run_id) {
      console.log(`  ${colors.dim}Run ID: ${latest.run_id}${colors.reset}`);
    }

    // Timestamp
    console.log(`  ${colors.dim}Last Update: ${latest.timestamp.toLocaleTimeString()}${colors.reset}`);

    console.log();
  }

  // Footer
  console.log(`${colors.dim}Press Ctrl+C to exit${colors.reset}`);
  console.log(`${colors.dim}Last refreshed: ${new Date().toLocaleTimeString()}${colors.reset}`);
}

/**
 * Main monitoring loop
 */
async function monitorPipeline(options: { interval?: number; follow?: boolean } = {}) {
  const logFilePath = path.join(process.cwd(), 'logs', 'combined.log');
  const interval = options.interval || 5000; // 5 seconds
  const follow = options.follow !== false;

  console.log(`${colors.cyan}Starting pipeline monitor...${colors.reset}`);
  console.log(`${colors.dim}Log file: ${logFilePath}${colors.reset}`);
  console.log();

  const monitor = async () => {
    try {
      const statuses = parseRecentLogs(logFilePath, 5);
      const dbStats = await getDatabaseStats();
      await displayStatus(statuses, dbStats);
    } catch (error: any) {
      console.error(`${colors.red}Error: ${error.message}${colors.reset}`);
    }
  };

  // Initial display
  await monitor();

  if (follow) {
    // Set up interval
    const intervalId = setInterval(monitor, interval);

    // Handle cleanup
    process.on('SIGINT', () => {
      clearInterval(intervalId);
      console.log(`\n${colors.cyan}Monitoring stopped.${colors.reset}`);
      process.exit(0);
    });
  }
}

// Parse command line arguments
const args = process.argv.slice(2);
const options: { interval?: number; follow?: boolean } = {};

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--interval' && args[i + 1]) {
    options.interval = parseInt(args[i + 1]) * 1000;
    i++;
  } else if (args[i] === '--no-follow') {
    options.follow = false;
  }
}

// Run
monitorPipeline(options).catch(error => {
  console.error(`${colors.red}Fatal error: ${error.message}${colors.reset}`);
  process.exit(1);
});
