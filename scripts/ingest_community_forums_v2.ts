#!/usr/bin/env ts-node
/**
 * Ingest community forum threads into the V2 pipeline.
 * Supports:
 * - content-hash dedup
 * - boilerplate filtering
 * - checkpoint/resume cursor
 * - replay of failed signals
 */
import 'dotenv/config';

import { readFileSync, readdirSync, writeFileSync, existsSync, mkdirSync, unlinkSync } from 'fs';
import { join, basename } from 'path';
import { mapForumThreadToRawSignals, ForumThread } from '../backend/processing/community_forum_mapper';
import { AdapterOutput, NormalizerService, RawSignal } from '../backend/ingestion/normalizer_service';
import { IngestionPipelineService } from '../backend/services/ingestion_pipeline_service';
import { closeDbPool, getDbPool } from '../backend/db/connection';
import { logger } from '../backend/utils/logger';
import { isBoilerplateMessage } from '../backend/utils/boilerplate_filter';
import {
  recordFailedSignalAttempt,
  markFailedSignalRecovered
} from '../backend/services/failed_signal_service';
import { getRunMetrics } from '../backend/utils/run_metrics';
import { shutdownCostTracking } from '../backend/services/cost_tracking_service';
import { closeNeo4jDriver } from '../backend/neo4j/client';

type IngestConfig = {
  limitThreads?: number;
  limitSignals?: number;
  batchSize: number;
  delayMs: number;
  skipShort: boolean;
  minLength: number;
  skipBoilerplate: boolean;
  includeComments: boolean;
  maxCommentsPerThread?: number;
  resume: boolean;
  resetCursor: boolean;
  replayFailures: boolean;
  replayOnly: boolean;
  replayLimit: number;
  replayBatchSize: number;
};

type IngestCursor = {
  fileIndex: number;
  threadIndex: number;
  batchIndex: number;
  updatedAt: string;
};

type IngestStats = {
  files: number;
  threads: number;
  signals: number;
  ingested: number;
  skippedShort: number;
  skippedInvalid: number;
  skippedBoilerplate: number;
  skippedDuplicate: number;
  errors: number;
  batches: number;
  replayAttempted: number;
  replayRecovered: number;
  replayStillFailed: number;
  replaySkippedAlreadyExtracted: number;
  runId: string;
  startedAt: string;
  completedAt?: string;
};

const DATA_DIR = join(process.cwd(), 'data', 'raw', 'community_forums');
const OUTPUT_FILE = join(process.cwd(), 'output', 'forum_ingestion_summary.json');
const CURSOR_FILE = join(process.cwd(), 'output', 'ingestion_cursor.json');
const REPLAY_CURSOR_FILE = join(process.cwd(), 'output', 'replay_failures_cursor.json');

function parseArgs(): IngestConfig {
  const args = process.argv.slice(2);
  const config: IngestConfig = {
    batchSize: 50,
    delayMs: 0,
    skipShort: false,
    minLength: 50,
    skipBoilerplate: false,
    includeComments: true,
    resume: false,
    resetCursor: false,
    replayFailures: false,
    replayOnly: false,
    replayLimit: 0,
    replayBatchSize: 25
  };

  for (const arg of args) {
    if (arg.startsWith('--limit=')) {
      config.limitThreads = parseInt(arg.split('=')[1], 10);
    } else if (arg.startsWith('--limit-signals=')) {
      config.limitSignals = parseInt(arg.split('=')[1], 10);
    } else if (arg.startsWith('--batch-size=')) {
      config.batchSize = parseInt(arg.split('=')[1], 10);
    } else if (arg.startsWith('--delay-ms=')) {
      config.delayMs = parseInt(arg.split('=')[1], 10);
    } else if (arg === '--skip-short') {
      config.skipShort = true;
    } else if (arg.startsWith('--min-length=')) {
      config.minLength = parseInt(arg.split('=')[1], 10);
    } else if (arg === '--skip-boilerplate') {
      config.skipBoilerplate = true;
    } else if (arg === '--no-comments') {
      config.includeComments = false;
    } else if (arg.startsWith('--max-comments-per-thread=')) {
      config.maxCommentsPerThread = parseInt(arg.split('=')[1], 10);
    } else if (arg === '--resume') {
      config.resume = true;
    } else if (arg === '--reset') {
      config.resetCursor = true;
    } else if (arg === '--replay-failures') {
      config.replayFailures = true;
      config.replayOnly = true;
    } else if (arg === '--replay-after-ingest') {
      config.replayFailures = true;
      config.replayOnly = false;
    } else if (arg.startsWith('--replay-limit=')) {
      config.replayLimit = parseInt(arg.split('=')[1], 10);
    } else if (arg.startsWith('--replay-batch-size=')) {
      config.replayBatchSize = parseInt(arg.split('=')[1], 10);
    }
  }

  return config;
}

function pickTimestamp(metadata: Record<string, unknown> | undefined): string | undefined {
  if (!metadata) return undefined;
  const commentDate = metadata.comment_date as string | undefined;
  const answerDate = metadata.answer_date as string | undefined;
  const postedDate = metadata.date_posted as string | undefined;
  return commentDate || answerDate || postedDate;
}

function sleep(ms: number): Promise<void> {
  if (!ms) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function saveCursor(cursor: IngestCursor): void {
  if (!existsSync(join(process.cwd(), 'output'))) {
    mkdirSync(join(process.cwd(), 'output'), { recursive: true });
  }
  writeFileSync(CURSOR_FILE, JSON.stringify(cursor, null, 2));
}

function loadCursor(): IngestCursor | null {
  if (!existsSync(CURSOR_FILE)) {
    return null;
  }
  try {
    return JSON.parse(readFileSync(CURSOR_FILE, 'utf-8')) as IngestCursor;
  } catch {
    return null;
  }
}

type ReplayCursor = {
  processed: number;
  updatedAt: string;
};

function saveReplayCursor(cursor: ReplayCursor): void {
  if (!existsSync(join(process.cwd(), 'output'))) {
    mkdirSync(join(process.cwd(), 'output'), { recursive: true });
  }
  writeFileSync(REPLAY_CURSOR_FILE, JSON.stringify(cursor, null, 2));
}

function loadReplayCursor(): ReplayCursor | null {
  if (!existsSync(REPLAY_CURSOR_FILE)) {
    return null;
  }
  try {
    return JSON.parse(readFileSync(REPLAY_CURSOR_FILE, 'utf-8')) as ReplayCursor;
  } catch {
    return null;
  }
}

function clearReplayCursor(): void {
  if (existsSync(REPLAY_CURSOR_FILE)) {
    unlinkSync(REPLAY_CURSOR_FILE);
  }
}

function shouldSkipByCursor(cursor: IngestCursor | null, fileIndex: number, threadIndex: number): boolean {
  if (!cursor) return false;
  if (fileIndex < cursor.fileIndex) return true;
  if (fileIndex > cursor.fileIndex) return false;
  return threadIndex < cursor.threadIndex;
}

async function processBatch(params: {
  pipeline: IngestionPipelineService;
  batch: RawSignal[];
  stats: IngestStats;
  runId: string;
  batchIndex: number;
  signalSourceRefs: Map<string, string>;
}): Promise<void> {
  const { pipeline, batch, stats, runId, batchIndex, signalSourceRefs } = params;
  if (batch.length === 0) return;
  const batchStartedAt = Date.now();
  logger.info('Ingestion batch start', {
    runId,
    batchIndex,
    stage: 'batch',
    status: 'start',
    batchSize: batch.length,
    totalSignals: stats.signals,
    ingested: stats.ingested,
    errors: stats.errors
  });
  try {
    await pipeline.ingest(batch);
    stats.ingested += batch.length;
    logger.info('Ingestion batch complete', {
      runId,
      batchIndex,
      stage: 'batch',
      status: 'success',
      batchSize: batch.length,
      ingested: stats.ingested,
      errors: stats.errors,
      elapsedMs: Date.now() - batchStartedAt
    });
  } catch (error: any) {
    logger.warn('Batch ingestion failed, retrying per signal', {
      runId,
      batchIndex,
      stage: 'batch',
      status: 'error',
      errorClass: error?.name || 'Error',
      errorMessage: error.message,
      nextAction: 'retry_per_signal'
    });
    for (const signal of batch) {
      try {
        await pipeline.ingest([signal]);
        stats.ingested += 1;
      } catch (innerError: any) {
        stats.errors += 1;
        logger.error('Signal ingestion failed', {
          runId,
          batchIndex,
          stage: 'signal',
          status: 'error',
          errorClass: innerError?.name || 'Error',
          error: innerError.message,
          signalId: signal.id,
          nextAction: 'record_failed_signal'
        });
        try {
          await recordFailedSignalAttempt({
            signalId: signal.id,
            sourceRef: signalSourceRefs.get(signal.id) || null,
            runId,
            errorType: 'ingestion_signal_failure',
            errorMessage: innerError.message || 'unknown error',
            status: 'pending'
          });
        } catch (ledgerError: any) {
          logger.warn('Failed to write failed-signal ledger entry; continuing ingestion', {
            runId,
            batchIndex,
            stage: 'failed_signal_ledger',
            status: 'error',
            signalId: signal.id,
            error: ledgerError.message,
            nextAction: 'continue_batch'
          });
        }
      }
    }
    logger.info('Ingestion batch complete after per-signal retries', {
      runId,
      batchIndex,
      stage: 'batch',
      status: 'success_with_retries',
      batchSize: batch.length,
      ingested: stats.ingested,
      errors: stats.errors,
      elapsedMs: Date.now() - batchStartedAt
    });
  }
}

async function replayFailedSignals(config: IngestConfig, runId: string): Promise<{
  attempted: number;
  recovered: number;
  stillFailed: number;
  skippedAlreadyExtracted: number;
}> {
  const pool = getDbPool();
  const pipeline = new IngestionPipelineService();
  const replayCursor = config.resume ? loadReplayCursor() : null;
  const replayOffset = replayCursor?.processed || 0;
  const replayRows = await pool.query(
    `
      SELECT
        f.signal_id,
        s.source,
        s.content,
        s.normalized_content,
        s.metadata,
        s.created_at,
        se.signal_id AS has_extraction
      FROM failed_signal_attempts f
      JOIN signals s ON s.id = f.signal_id
      LEFT JOIN signal_extractions se ON se.signal_id = s.id
      WHERE f.status = 'pending'
      ORDER BY f.failed_at ASC
      ${config.replayLimit > 0 ? 'LIMIT $1 OFFSET $2' : 'OFFSET $1'}
    `,
    config.replayLimit > 0 ? [config.replayLimit, replayOffset] : [replayOffset]
  );

  let attempted = 0;
  let recovered = 0;
  let stillFailed = 0;
  let skippedAlreadyExtracted = 0;
  let processed = 0;
  const replayBatchSize = Math.max(1, config.replayBatchSize || config.batchSize || 25);

  logger.info('Starting failed-signal replay', {
    stage: 'failed_signal_replay',
    status: 'start',
    runId,
    replayOffset,
    replayLimit: config.replayLimit || null,
    replayBatchSize,
    rowsSelected: replayRows.rows.length
  });

  for (const row of replayRows.rows) {
    processed += 1;
    if (row.has_extraction) {
      skippedAlreadyExtracted += 1;
      try {
        await markFailedSignalRecovered(row.signal_id);
      } catch (recoveredError: any) {
        logger.warn('Failed to mark already-extracted signal as recovered', {
          stage: 'failed_signal_replay',
          signalId: row.signal_id,
          error: recoveredError.message
        });
      }
      continue;
    }

    attempted += 1;
    const rawSignal: RawSignal = {
      id: row.signal_id,
      source: row.source,
      content: row.content,
      normalized_content: row.normalized_content,
      metadata: row.metadata || {},
      content_hash: (row.metadata?.content_hash as string) || '',
      created_at: new Date(row.created_at).toISOString()
    };
    try {
      await pipeline.ingest([rawSignal]);
      await markFailedSignalRecovered(rawSignal.id);
      recovered += 1;
    } catch (error: any) {
      stillFailed += 1;
      try {
        await recordFailedSignalAttempt({
          signalId: rawSignal.id,
          sourceRef: (row.metadata?.source_ref as string) || null,
          runId,
          errorType: 'replay_failure',
          errorMessage: error.message || 'unknown replay error',
          status: 'pending'
        });
      } catch (ledgerError: any) {
        logger.warn('Failed to write replay failure ledger entry', {
          signalId: rawSignal.id,
          error: ledgerError.message
        });
      }
    }

    if (processed % replayBatchSize === 0) {
      saveReplayCursor({
        processed: replayOffset + processed,
        updatedAt: new Date().toISOString()
      });
      logger.info('Failed-signal replay progress', {
        stage: 'failed_signal_replay',
        status: 'in_progress',
        processed,
        selected: replayRows.rows.length,
        attempted,
        recovered,
        stillFailed,
        skippedAlreadyExtracted
      });
    }
  }

  if (config.replayLimit > 0 && processed > 0) {
    saveReplayCursor({
      processed: replayOffset + processed,
      updatedAt: new Date().toISOString()
    });
  } else {
    clearReplayCursor();
  }

  logger.info('Failed-signal replay complete', {
    stage: 'failed_signal_replay',
    status: 'success',
    selected: replayRows.rows.length,
    attempted,
    recovered,
    stillFailed,
    skippedAlreadyExtracted
  });

  return { attempted, recovered, stillFailed, skippedAlreadyExtracted };
}

async function ingestCommunityForumsV2() {
  const config = parseArgs();
  const runId = `forum_ingest_${Date.now()}`;
  const files = config.replayOnly
    ? []
    : readdirSync(DATA_DIR).filter((file) => file.endsWith('.json'));

  if (config.resetCursor && existsSync(CURSOR_FILE)) {
    unlinkSync(CURSOR_FILE);
  }
  if (config.resetCursor && existsSync(REPLAY_CURSOR_FILE)) {
    unlinkSync(REPLAY_CURSOR_FILE);
  }

  if (!config.replayOnly && files.length === 0) {
    throw new Error(`No JSON files found in ${DATA_DIR}`);
  }

  const normalizer = new NormalizerService();
  const pipeline = new IngestionPipelineService();
  const metrics = getRunMetrics();
  const seenHashes = new Set<string>();
  const cursor = config.resume ? loadCursor() : null;
  const signalSourceRefs = new Map<string, string>();

  const stats: IngestStats = {
    files: files.length,
    threads: 0,
    signals: 0,
    ingested: 0,
    skippedShort: 0,
    skippedInvalid: 0,
    skippedBoilerplate: 0,
    skippedDuplicate: 0,
    errors: 0,
    batches: 0,
    replayAttempted: 0,
    replayRecovered: 0,
    replayStillFailed: 0,
    replaySkippedAlreadyExtracted: 0,
    runId,
    startedAt: new Date().toISOString()
  };

  console.log(`\n📥 ${config.replayOnly ? 'Replaying failed forum signals via V2 pipeline' : 'Ingesting community forums via V2 pipeline'}`);
  console.log('='.repeat(70));
  const commentMode = config.includeComments
    ? config.maxCommentsPerThread !== undefined
      ? `yes (max ${config.maxCommentsPerThread}/thread)`
      : 'yes (all)'
    : 'no';
  console.log(
    `Files: ${files.length} | Batch size: ${config.batchSize} | Delay: ${config.delayMs}ms | Limit threads: ${
      config.limitThreads ?? 'none'
    } | Limit signals: ${config.limitSignals ?? 'none'} | Include comments: ${commentMode} | Skip short: ${
      config.skipShort ? `yes (min ${config.minLength})` : 'no'
    } | Skip boilerplate: ${
      config.skipBoilerplate ? 'yes' : 'no'
    } | Replay mode: ${config.replayFailures ? (config.replayOnly ? 'only' : 'after-ingest') : 'off'} | Resume: ${
      config.resume ? 'yes' : 'no'
    }\n`
  );

  const threadCapLabel = config.limitThreads ?? 'unbounded';
  const signalCapLabel = config.limitSignals ?? 'unbounded';
  const commentCapLabel = config.includeComments ? config.maxCommentsPerThread ?? 'all' : 0;
  const batchProgressLabel = () =>
    `threads=${stats.threads}/${threadCapLabel}, signals=${stats.signals}/${signalCapLabel}, ingested=${stats.ingested}, errors=${stats.errors}`;

  console.log(`Caps: threads=${threadCapLabel}, signals=${signalCapLabel}, comments=${commentCapLabel}`);

  if (config.replayOnly) {
    const replayResult = await replayFailedSignals(config, runId);
    stats.replayAttempted = replayResult.attempted;
    stats.replayRecovered = replayResult.recovered;
    stats.replayStillFailed = replayResult.stillFailed;
    stats.replaySkippedAlreadyExtracted = replayResult.skippedAlreadyExtracted;
    stats.completedAt = new Date().toISOString();
    writeFileSync(OUTPUT_FILE, JSON.stringify(stats, null, 2));
    getRunMetrics().exportToFile(join(process.cwd(), 'output', 'run_metrics.json'));
    console.log('\n✅ Failed-signal replay complete');
    console.log(`Replay attempted/recovered/still_failed/skipped_already_extracted: ${stats.replayAttempted}/${stats.replayRecovered}/${stats.replayStillFailed}/${stats.replaySkippedAlreadyExtracted}`);
    console.log(`Summary written to: ${OUTPUT_FILE}`);
    return;
  }

  let batch: RawSignal[] = [];
  let batchIndex = cursor?.batchIndex || 0;
  let nextBatchIndex = batchIndex + 1;
  let stopRequested = false;

  for (let fileIndex = 0; fileIndex < files.length; fileIndex += 1) {
    const file = files[fileIndex];
    const filePath = join(DATA_DIR, file);
    const raw = readFileSync(filePath, 'utf-8');
    const threads: ForumThread[] = JSON.parse(raw);

    for (let threadIndex = 0; threadIndex < threads.length; threadIndex += 1) {
      if (config.limitThreads && stats.threads >= config.limitThreads) {
        stopRequested = true;
        break;
      }
      if (config.limitSignals && stats.signals >= config.limitSignals) {
        stopRequested = true;
        break;
      }
      if (shouldSkipByCursor(cursor, fileIndex, threadIndex)) continue;

      const thread = threads[threadIndex];
      stats.threads += 1;
      const v1Signals = mapForumThreadToRawSignals(thread, basename(file), {
        includeComments: config.includeComments,
        maxCommentsPerThread: config.maxCommentsPerThread
      });

      for (const v1Signal of v1Signals) {
        if (config.limitSignals && stats.signals >= config.limitSignals) {
          stopRequested = true;
          break;
        }

        const text = v1Signal.text || '';
        if (config.skipShort && text.trim().length < config.minLength) {
          stats.skippedShort += 1;
          continue;
        }
        if (config.skipBoilerplate && isBoilerplateMessage(text)) {
          stats.skippedBoilerplate += 1;
          continue;
        }

        const adapterOutput: AdapterOutput = {
          source: 'manual',
          content: text,
          metadata: {
            ...(v1Signal.metadata || {}),
            signal_type: v1Signal.type,
            source_ref: v1Signal.id,
            run_id: runId,
            batch_index: nextBatchIndex,
            file_index: fileIndex,
            thread_index: threadIndex
          },
          timestamp: pickTimestamp(v1Signal.metadata)
        };

        try {
          const v2Signal = normalizer.normalize(adapterOutput);
          if (seenHashes.has(v2Signal.content_hash)) {
            stats.skippedDuplicate += 1;
            continue;
          }
          seenHashes.add(v2Signal.content_hash);
          if (v1Signal.id) {
            signalSourceRefs.set(v2Signal.id, v1Signal.id);
          }
          batch.push(v2Signal);
          stats.signals += 1;
        } catch (error: any) {
          stats.skippedInvalid += 1;
          logger.warn('Skipping invalid forum signal', {
            runId,
            batchIndex: nextBatchIndex,
            stage: 'normalize',
            status: 'skipped',
            error: error.message,
            sourceRef: v1Signal.id,
            file,
            nextAction: 'skip_signal'
          });
        }

        if (batch.length >= config.batchSize) {
          batchIndex = nextBatchIndex;
          stats.batches = batchIndex;
          console.log(`Processing batch ${batchIndex} (${batchProgressLabel()})`);
          await processBatch({ pipeline, batch, stats, runId, batchIndex, signalSourceRefs });
          metrics.increment('signals_processed', batch.length);
          batch = [];
          saveCursor({
            fileIndex,
            threadIndex: threadIndex + 1,
            batchIndex,
            updatedAt: new Date().toISOString()
          });
          await sleep(config.delayMs);
          nextBatchIndex = batchIndex + 1;
        }

        if (config.limitSignals && stats.signals >= config.limitSignals) {
          stopRequested = true;
          break;
        }
      }

      if (stats.threads % 25 === 0) {
        console.log(`Progress: ${batchProgressLabel()}`);
      }

      if (stopRequested) break;
    }
    if (stopRequested) break;
  }

  if (batch.length > 0) {
    batchIndex = nextBatchIndex;
    stats.batches = batchIndex;
    console.log(`Processing batch ${batchIndex} (${batchProgressLabel()})`);
    await processBatch({ pipeline, batch, stats, runId, batchIndex, signalSourceRefs });
    metrics.increment('signals_processed', batch.length);
  }

  if (config.replayFailures) {
    const replayResult = await replayFailedSignals(config, runId);
    stats.replayAttempted = replayResult.attempted;
    stats.replayRecovered = replayResult.recovered;
    stats.replayStillFailed = replayResult.stillFailed;
    stats.replaySkippedAlreadyExtracted = replayResult.skippedAlreadyExtracted;
  }

  stats.completedAt = new Date().toISOString();
  writeFileSync(OUTPUT_FILE, JSON.stringify(stats, null, 2));
  getRunMetrics().exportToFile(join(process.cwd(), 'output', 'run_metrics.json'));

  console.log('\n✅ Community forums V2 ingestion complete');
  console.log(`Threads processed: ${stats.threads}`);
  console.log(`Signals normalized: ${stats.signals}`);
  console.log(`Signals ingested: ${stats.ingested}`);
  console.log(`Skipped (short): ${stats.skippedShort}`);
  console.log(`Skipped (boilerplate): ${stats.skippedBoilerplate}`);
  console.log(`Skipped (duplicate): ${stats.skippedDuplicate}`);
  console.log(`Skipped (invalid): ${stats.skippedInvalid}`);
  console.log(`Errors: ${stats.errors}`);
  console.log(`Replay attempted/recovered/still_failed/skipped_already_extracted: ${stats.replayAttempted}/${stats.replayRecovered}/${stats.replayStillFailed}/${stats.replaySkippedAlreadyExtracted}`);
  console.log(`Summary written to: ${OUTPUT_FILE}`);
  console.log(`Cursor written to: ${CURSOR_FILE}\n`);
}

if (require.main === module) {
  ingestCommunityForumsV2()
    .then(() => 0)
    .catch((error) => {
      console.error('❌ Community forums ingestion failed:', error.message);
      return 1;
    })
    .then(async (exitCode) => {
      try {
        await shutdownCostTracking();
        await closeNeo4jDriver();
        await closeDbPool();
      } catch (cleanupError: any) {
        console.error('❌ Community forums ingestion cleanup failed:', cleanupError?.message || cleanupError);
        exitCode = 1;
      }
      process.exit(exitCode);
    });
}

export { ingestCommunityForumsV2 };
