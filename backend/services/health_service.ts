import { Queue } from 'bullmq';
import { getDbPool } from '../db/connection';
import { getNeo4jDriver } from '../neo4j/client';
import { config } from '../config/env';
import { logger } from '../utils/logger';
import { getSharedRedis } from '../config/redis';

export async function getSystemHealth() {
  const pool = getDbPool();
  let pgStatus = 'healthy';
  try {
    await pool.query('SELECT 1');
  } catch {
    pgStatus = 'unhealthy';
  }

  let redisStatus = 'healthy';
  let ingestionQueue = { waiting: 0, failed: 0 };
  try {
    const redis = getSharedRedis();
    await redis.ping();
    const queue = new Queue('ingestion_pipeline', { connection: redis });
    ingestionQueue = {
      waiting: await queue.getWaitingCount(),
      failed: await queue.getFailedCount()
    };
  } catch {
    redisStatus = 'unhealthy';
  }

  let neo4jStatus = 'healthy';
  try {
    const session = getNeo4jDriver().session({ database: config.neo4j.database });
    await session.run('RETURN 1');
    await session.close();
  } catch {
    neo4jStatus = 'unhealthy';
  }

  let backlogPending = 0;
  let lastPipelineRun: string | null = null;
  try {
    const backlogResult = await pool.query(
      `SELECT COUNT(*)::int AS count FROM neo4j_sync_backlog WHERE status = 'pending'`
    );
    backlogPending = backlogResult.rows[0]?.count || 0;

    const lastRun = await pool.query(`SELECT MAX(created_at) AS last_run FROM signal_extractions`);
    lastPipelineRun = lastRun.rows[0]?.last_run || null;
  } catch (error) {
    logger.warn('Health aggregation query failed', { error });
  }

  return {
    postgresql: pgStatus,
    redis: redisStatus,
    neo4j: neo4jStatus,
    ingestion_queue: ingestionQueue,
    entity_resolution_queue: 0,
    neo4j_backlog_pending: backlogPending,
    last_pipeline_run: lastPipelineRun
  };
}
