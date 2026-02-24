import { getDbPool } from '../db/connection';
import { config } from '../config/env';
import { logger } from '../utils/logger';
import { getNeo4jDriver } from '../neo4j/client';
import { parsePositiveInt } from '../utils/env_parsing';
import { CircuitBreaker, createCircuitBreaker } from '../utils/circuit_breaker';

type Neo4jOperation = 'signal_sync' | 'entity_merge' | 'entity_split' | 'relationship_add';

const DEFAULT_NEO4J_TIMEOUT_MS = 10000;
const MIN_NEO4J_TIMEOUT_MS = 1000;
const DEFAULT_CIRCUIT_TIMEOUT_THRESHOLD = 50;
const DEFAULT_CIRCUIT_OPEN_MS = 120000;
const MIN_CIRCUIT_OPEN_MS = 1000;
const DEFAULT_BACKLOG_MAX_RETRIES = 5;
const BACKLOG_MAX_RETRIES = Math.max(
  1,
  parsePositiveInt(process.env.NEO4J_BACKLOG_MAX_RETRIES, DEFAULT_BACKLOG_MAX_RETRIES)
);

// Hardened parsing accepts values like "1e4" and prevents unusably small timeouts.
const NEO4J_TIMEOUT_MS = Math.max(
  MIN_NEO4J_TIMEOUT_MS,
  parsePositiveInt(process.env.NEO4J_TIMEOUT_MS, DEFAULT_NEO4J_TIMEOUT_MS)
);

export class Neo4jSyncService {
  private unsupportedRelationshipCounts = new Map<string, number>();
  private backlogFailureCount = 0;
  private entitySyncBreaker: CircuitBreaker<void>;
  private relationshipSyncBreaker: CircuitBreaker<void>;
  /**
   * Executes a Neo4j query with timeout protection
   */
  private async runWithTimeout<T>(
    operation: () => Promise<T>,
    timeoutMs: number = NEO4J_TIMEOUT_MS
  ): Promise<T> {
    let timeoutHandle: NodeJS.Timeout | null = null;
    try {
      const timeoutPromise = new Promise<T>((_, reject) => {
        timeoutHandle = setTimeout(() => {
          reject(new Error('Neo4j operation timeout'));
        }, timeoutMs);
      });
      return await Promise.race([operation(), timeoutPromise]);
    } finally {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
    }
  }

  private static readonly allowedRelationships = new Set([
    'USES',
    'HAS_ISSUE',
    'RELATES_TO',
    'MENTIONS',
    'IMPACTS',
    'REQUESTED_BY',
    'ASSIGNED_TO',
    'DEPENDS_ON',
    'ASSOCIATED_WITH'
  ]);
  private static readonly relationshipCanonMap: Record<string, string> = {
    // Causality
    CAUSES: 'RELATES_TO',
    CAUSED_BY: 'RELATES_TO',
    RESULTS_IN: 'RELATES_TO',
    RESULTED_IN: 'RELATES_TO',
    THROWS: 'RELATES_TO',
    TRIGGER: 'RELATES_TO',
    TRIGGERS: 'RELATES_TO',

    // Integration & Usage
    INTEGRATION: 'RELATES_TO',
    INTEGRATES_WITH: 'RELATES_TO',
    'USED BY': 'USES',
    USED: 'USES',
    USING: 'USES',
    'SWITCHED TO': 'USES',
    AUTHORING: 'USES',
    DISABLING: 'USES',

    // Communication & Interaction
    COMMUNICATION: 'MENTIONS',
    RESPONSE: 'MENTIONS',
    INQUIRY: 'MENTIONS',
    INTERACTION: 'MENTIONS',
    'SPOKE TO': 'MENTIONS',
    'INFORMED ABOUT': 'MENTIONS',
    CONTACT: 'MENTIONS',
    QUESTION: 'MENTIONS',
    SUGGESTION: 'MENTIONS',
    INSTRUCTION: 'MENTIONS',

    // Dependencies
    SUPPORTS: 'DEPENDS_ON',
    REQUIRED_FOR: 'DEPENDS_ON',
    REQUIRES: 'DEPENDS_ON',
    DEPENDENCY: 'DEPENDS_ON',
    'PART OF': 'DEPENDS_ON',
    NEEDS: 'DEPENDS_ON',

    // Issues & Problems
    ISSUE: 'HAS_ISSUE',
    'HAS_ISSUE_WITH': 'HAS_ISSUE',
    FEATURE_ISSUE: 'HAS_ISSUE',
    IDENTIFIES_ISSUE: 'HAS_ISSUE',
    'NOT LOADING': 'HAS_ISSUE',
    'NOT SHOWING': 'HAS_ISSUE',

    // Relationships & Associations
    'RELATED TO': 'RELATES_TO',
    'APPLIES TO': 'RELATES_TO',
    SIMILARITY: 'RELATES_TO',
    ALTERNATIVE: 'RELATES_TO',
    'SEEKING_SUPPORT': 'RELATES_TO',
    REQUEST_FOR_CONFIRMATION: 'RELATES_TO',
    CONTAINS: 'RELATES_TO',
    INCLUDES: 'RELATES_TO',
    METHOD: 'RELATES_TO',
    FUNCTION_CALL: 'RELATES_TO',
    CREATES: 'RELATES_TO',
    COMPARISON: 'RELATES_TO',
    'NOT SUPPORT': 'RELATES_TO'
  };

  private mapEntityLabel(entityType: string): string {
    switch (entityType) {
      case 'customer':
        return 'Customer';
      case 'feature':
        return 'Feature';
      case 'issue':
        return 'Issue';
      case 'theme':
        return 'Theme';
      case 'stakeholder':
        return 'Stakeholder';
      default:
        return 'Entity';
    }
  }

  private isCircuitOpen(): boolean {
    return Date.now() < this.circuitOpenUntilMs;
  }

  private noteTimeout(operation: 'syncEntity' | 'syncRelationship'): void {
    this.consecutiveTimeouts += 1;
    if (
      this.consecutiveTimeouts >= Neo4jSyncService.CIRCUIT_TIMEOUT_THRESHOLD &&
      !this.isCircuitOpen()
    ) {
      this.circuitOpenUntilMs = Date.now() + Neo4jSyncService.CIRCUIT_OPEN_MS;
      logger.warn('Neo4j sync circuit opened after consecutive timeouts', {
        stage: 'neo4j_sync_circuit',
        status: 'open',
        operation,
        consecutiveTimeouts: this.consecutiveTimeouts,
        openForMs: Neo4jSyncService.CIRCUIT_OPEN_MS,
        threshold: Neo4jSyncService.CIRCUIT_TIMEOUT_THRESHOLD,
        nextAction: 'enqueue_only_until_recovery'
      });
    }
  }

  private noteSuccess(): void {
    this.consecutiveTimeouts = 0;
  }

  private async enqueue(operation: Neo4jOperation, payload: Record<string, unknown>): Promise<void> {
    const pool = getDbPool();
    try {
      // Check backlog size before enqueueing
      const sizeCheck = await pool.query(
        `SELECT COUNT(*)::int AS count FROM neo4j_sync_backlog WHERE status = 'pending'`
      );
      const currentSize = sizeCheck.rows[0]?.count || 0;

      if (currentSize >= BACKLOG_MAX_SIZE) {
        logger.error('Neo4j backlog size limit exceeded', {
          stage: 'neo4j_backlog',
          status: 'size_limit_exceeded',
          current_size: currentSize,
          max_size: BACKLOG_MAX_SIZE,
          operation,
          nextAction: 'drop_item'
        });
        throw new Error(
          `Backlog size limit exceeded (${currentSize}/${BACKLOG_MAX_SIZE}). Item dropped.`
        );
      }

      // Warn when approaching limit
      if (currentSize > BACKLOG_MAX_SIZE * 0.8) {
        logger.warn('Neo4j backlog approaching size limit', {
          stage: 'neo4j_backlog',
          status: 'size_warning',
          current_size: currentSize,
          max_size: BACKLOG_MAX_SIZE,
          utilization_pct: Math.round((currentSize / BACKLOG_MAX_SIZE) * 100)
        });
      }

      await pool.query(
        `INSERT INTO neo4j_sync_backlog (id, operation, payload, status)
         VALUES (gen_random_uuid(), $1, $2, 'pending')`,
        [operation, JSON.stringify(payload)]
      );
    } catch (error) {
      this.backlogFailureCount += 1;
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.warn('Failed to enqueue Neo4j backlog item', {
        stage: 'neo4j_backlog',
        status: 'error',
        operation,
        errorClass: error instanceof Error ? error.name : 'Error',
        errorMessage,
        backlogFailureCount: this.backlogFailureCount
      });
      throw error;
    }
  }

  async syncEntity(
    entity: { id: string; entity_type: string; canonical_name: string },
    options: { fromBacklog?: boolean } = {}
  ): Promise<void> {
    const fromBacklog = Boolean(options.fromBacklog);
    if (!config.featureFlags.neo4jSync) {
      if (!fromBacklog) {
        await this.enqueue('signal_sync', { entity });
      }
      return;
    }

    if (this.isCircuitOpen()) {
      if (fromBacklog) {
        throw new Error('Neo4j sync circuit is open');
      }
      this.circuitBypassCount += 1;
      if (
        this.circuitBypassCount === 1 ||
        this.circuitBypassCount % Neo4jSyncService.CIRCUIT_LOG_EVERY === 0
      ) {
        logger.warn('Neo4j sync circuit active; enqueueing entity without live sync', {
          stage: 'neo4j_sync_circuit',
          status: 'open',
          operation: 'syncEntity',
          entityId: entity.id,
          bypassCount: this.circuitBypassCount,
          remainingOpenMs: Math.max(0, this.circuitOpenUntilMs - Date.now()),
          nextAction: 'enqueue_only'
        });
      }
      await this.enqueue('signal_sync', { entity });
      return;
    }

    const driver = getNeo4jDriver();
    const session = driver.session({ database: config.neo4j.database });
    const label = this.mapEntityLabel(entity.entity_type);

    try {
      await this.runWithTimeout(() =>
        session.run(
          `MERGE (e:${label} {id: $id})
           SET e.canonical_name = $name, e.updated_at = datetime()`,
          { id: entity.id, name: entity.canonical_name }
        )
      );
      this.noteSuccess();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorClass = error instanceof Error ? error.name : 'Error';
      const isTimeout = errorMessage.toLowerCase().includes('timeout');
      if (isTimeout) {
        this.noteTimeout('syncEntity');
      }
      logger.warn('Neo4j entity sync failed, enqueueing to backlog', {
        stage: 'neo4j_entity_sync',
        status: 'error',
        errorClass,
        errorMessage,
        isTimeout,
        timeoutMs: NEO4J_TIMEOUT_MS,
        entityId: entity.id,
        entityType: entity.entity_type,
        operation: 'syncEntity',
        nextAction: 'enqueue_backlog'
      });
      if (fromBacklog) {
        throw error;
      }
      try {
        await this.enqueue('signal_sync', { entity });
      } catch (enqueueError) {
        const enqueueErrorMessage =
          enqueueError instanceof Error ? enqueueError.message : String(enqueueError);
        logger.error('Neo4j entity sync failed and backlog enqueue failed', {
          stage: 'neo4j_entity_sync',
          status: 'error',
          entityId: entity.id,
          entityType: entity.entity_type,
          errorClass: enqueueError instanceof Error ? enqueueError.name : 'Error',
          errorMessage: enqueueErrorMessage,
          nextAction: 'skip_entity'
        });
      }
    } finally {
      await session.close();
    }
  }

  async syncRelationship(
    params: {
      fromId: string;
      fromType: string;
      toId: string;
      toType: string;
      relationship: string;
    },
    options: { fromBacklog?: boolean } = {}
  ): Promise<void> {
    const fromBacklog = Boolean(options.fromBacklog);
    if (!config.featureFlags.neo4jSync) {
      if (!fromBacklog) {
        await this.enqueue('relationship_add', params);
      }
      return;
    }

    const rawRelationship = params.relationship?.toUpperCase();
    const relationship =
      Neo4jSyncService.relationshipCanonMap[rawRelationship] || rawRelationship;
    if (!relationship || !Neo4jSyncService.allowedRelationships.has(relationship)) {
      const count = (this.unsupportedRelationshipCounts.get(relationship || 'unknown') || 0) + 1;
      this.unsupportedRelationshipCounts.set(relationship || 'unknown', count);
      if (count === 1 || count % 50 === 0) {
        logger.warn('Unsupported relationship type for Neo4j sync', {
          stage: 'neo4j_relationship_sync',
          status: 'skipped',
          relationship,
          count,
          nextAction: 'skip_relationship'
        });
      }
      return;
    }
    if (rawRelationship !== relationship) {
      logger.debug('Canonicalized relationship type', { rawRelationship, relationship });
    }

    if (this.isCircuitOpen()) {
      if (fromBacklog) {
        throw new Error('Neo4j sync circuit is open');
      }
      this.circuitBypassCount += 1;
      if (
        this.circuitBypassCount === 1 ||
        this.circuitBypassCount % Neo4jSyncService.CIRCUIT_LOG_EVERY === 0
      ) {
        logger.warn('Neo4j sync circuit active; enqueueing relationship without live sync', {
          stage: 'neo4j_sync_circuit',
          status: 'open',
          operation: 'syncRelationship',
          fromId: params.fromId,
          toId: params.toId,
          relationship,
          bypassCount: this.circuitBypassCount,
          remainingOpenMs: Math.max(0, this.circuitOpenUntilMs - Date.now()),
          nextAction: 'enqueue_only'
        });
      }
      await this.enqueue('relationship_add', params as unknown as Record<string, unknown>);
      return;
    }

    const driver = getNeo4jDriver();
    const session = driver.session({ database: config.neo4j.database });
    const fromLabel = this.mapEntityLabel(params.fromType);
    const toLabel = this.mapEntityLabel(params.toType);

    try {
      await this.runWithTimeout(() =>
        session.run(
          `MATCH (a:${fromLabel} {id: $fromId})
           MATCH (b:${toLabel} {id: $toId})
           MERGE (a)-[r:${relationship}]->(b)
           SET r.updated_at = datetime()`,
          { fromId: params.fromId, toId: params.toId }
        )
      );
      this.noteSuccess();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorClass = error instanceof Error ? error.name : 'Error';
      const isTimeout = errorMessage.toLowerCase().includes('timeout');
      if (isTimeout) {
        this.noteTimeout('syncRelationship');
      }
      logger.warn('Neo4j relationship sync failed, enqueueing to backlog', {
        stage: 'neo4j_relationship_sync',
        status: 'error',
        errorClass,
        errorMessage,
        isTimeout,
        timeoutMs: NEO4J_TIMEOUT_MS,
        fromId: params.fromId,
        toId: params.toId,
        relationship,
        operation: 'syncRelationship',
        nextAction: 'enqueue_backlog'
      });
      if (fromBacklog) {
        throw error;
      }
      try {
        await this.enqueue('relationship_add', params as unknown as Record<string, unknown>);
      } catch (enqueueError) {
        const enqueueErrorMessage =
          enqueueError instanceof Error ? enqueueError.message : String(enqueueError);
        logger.error('Neo4j relationship sync failed and backlog enqueue failed', {
          stage: 'neo4j_relationship_sync',
          status: 'error',
          fromId: params.fromId,
          toId: params.toId,
          relationship,
          errorClass: enqueueError instanceof Error ? enqueueError.name : 'Error',
          errorMessage: enqueueErrorMessage,
          nextAction: 'skip_relationship'
        });
      }
    } finally {
      await session.close();
    }
  }

  async processBacklog(limit = 50): Promise<void> {
    const pool = getDbPool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query(
        `SELECT id, operation, payload, status, retry_count, error_message, created_at, processed_at
         FROM neo4j_sync_backlog
         WHERE status = 'pending'
         ORDER BY created_at ASC
         LIMIT $1
         FOR UPDATE SKIP LOCKED`,
        [limit]
      );

      for (const row of result.rows) {
        try {
          const payload = row.payload || {};
          if (row.operation === 'signal_sync' && payload.entity) {
            await this.syncEntity(payload.entity, { fromBacklog: true });
          }
          if (row.operation === 'relationship_add') {
            await this.syncRelationship(payload, { fromBacklog: true });
          }

          await client.query(
            `UPDATE neo4j_sync_backlog
             SET status = 'processed', processed_at = NOW(), error_message = NULL
             WHERE id = $1`,
            [row.id]
          );
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          const nextRetryCount = Number(row.retry_count || 0) + 1;
          const reachedRetryCap = nextRetryCount >= BACKLOG_MAX_RETRIES;

          if (reachedRetryCap) {
            // Move to dead letter queue
            await client.query(
              `INSERT INTO neo4j_sync_dead_letter
                 (id, operation, payload, retry_count, error_message, original_created_at, failed_at)
               VALUES ($1, $2, $3, $4, $5, $6, NOW())
               ON CONFLICT (id) DO UPDATE
                 SET error_message = EXCLUDED.error_message,
                     failed_at = EXCLUDED.failed_at`,
              [row.id, row.operation, row.payload, nextRetryCount, errorMessage, row.created_at]
            );

            // Delete from backlog
            await client.query(
              `DELETE FROM neo4j_sync_backlog WHERE id = $1`,
              [row.id]
            );

            logger.warn('Neo4j backlog item moved to dead letter queue', {
              stage: 'neo4j_backlog',
              status: 'dead_letter',
              errorClass: error instanceof Error ? error.name : 'Error',
              errorMessage,
              id: row.id,
              operation: row.operation,
              retryCount: nextRetryCount,
              maxRetries: BACKLOG_MAX_RETRIES,
              nextAction: 'moved_to_dlq'
            });
          } else {
            // Still has retries left - update retry count
            await client.query(
              `UPDATE neo4j_sync_backlog
               SET retry_count = $2,
                   error_message = $3
               WHERE id = $1`,
              [row.id, nextRetryCount, errorMessage]
            );

            logger.warn('Neo4j backlog item processing failed', {
              stage: 'neo4j_backlog',
              status: 'error',
              errorClass: error instanceof Error ? error.name : 'Error',
              errorMessage,
              id: row.id,
              operation: row.operation,
              retryCount: nextRetryCount,
              maxRetries: BACKLOG_MAX_RETRIES,
              nextAction: 'retry_backlog'
            });
          }
        }
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async runConsistencyCheck(): Promise<{ pgCount: number; neo4jCount: number }> {
    const pool = getDbPool();
    const driver = getNeo4jDriver();
    const session = driver.session({ database: config.neo4j.database });

    try {
      const pgResult = await pool.query(
        `SELECT COUNT(*)::int AS count FROM entity_registry WHERE is_active = true`
      );
      const neo4jResult = await this.runWithTimeout(() =>
        session.run('MATCH (n) RETURN count(n) AS count')
      );
      const neo4jCount = neo4jResult.records[0]?.get('count')?.toInt?.() || 0;
      return { pgCount: pgResult.rows[0].count, neo4jCount };
    } finally {
      await session.close();
    }
  }

  /**
   * Query dead letter queue items
   */
  async getDeadLetterItems(options: {
    limit?: number;
    unresolvedOnly?: boolean;
    operation?: Neo4jOperation;
  } = {}): Promise<any[]> {
    const { limit = 100, unresolvedOnly = true, operation } = options;
    const pool = getDbPool();

    let query = `
      SELECT id, operation, payload, retry_count, error_message,
             original_created_at, failed_at, last_retry_at,
             reprocess_count, resolved, resolved_at, resolved_by, notes
      FROM neo4j_sync_dead_letter
      WHERE 1=1
    `;
    const params: any[] = [];
    let paramIndex = 1;

    if (unresolvedOnly) {
      query += ` AND resolved = FALSE`;
    }

    if (operation) {
      query += ` AND operation = $${paramIndex}`;
      params.push(operation);
      paramIndex++;
    }

    query += ` ORDER BY failed_at DESC LIMIT $${paramIndex}`;
    params.push(limit);

    const result = await pool.query(query, params);
    return result.rows;
  }

  /**
   * Reprocess an item from the dead letter queue
   */
  async reprocessDeadLetterItem(itemId: string): Promise<{ success: boolean; error?: string }> {
    const pool = getDbPool();
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      // Fetch the item
      const result = await client.query(
        `SELECT id, operation, payload, reprocess_count
         FROM neo4j_sync_dead_letter
         WHERE id = $1 AND resolved = FALSE
         FOR UPDATE`,
        [itemId]
      );

      if (result.rows.length === 0) {
        await client.query('ROLLBACK');
        return { success: false, error: 'Item not found or already resolved' };
      }

      const item = result.rows[0];
      const payload = item.payload || {};

      // Attempt to sync
      try {
        if (item.operation === 'signal_sync' && payload.entity) {
          await this.syncEntity(payload.entity, { fromBacklog: true });
        } else if (item.operation === 'relationship_add') {
          await this.syncRelationship(payload, { fromBacklog: true });
        }

        // Success - remove from dead letter queue
        await client.query(
          `DELETE FROM neo4j_sync_dead_letter WHERE id = $1`,
          [itemId]
        );

        await client.query('COMMIT');

        logger.info('Dead letter item successfully reprocessed', {
          stage: 'neo4j_dead_letter',
          status: 'success',
          id: itemId,
          operation: item.operation,
          reprocessCount: item.reprocess_count
        });

        return { success: true };
      } catch (error) {
        // Update retry info
        const errorMessage = error instanceof Error ? error.message : String(error);
        await client.query(
          `UPDATE neo4j_sync_dead_letter
           SET last_retry_at = NOW(),
               reprocess_count = reprocess_count + 1,
               error_message = $2
           WHERE id = $1`,
          [itemId, errorMessage]
        );

        await client.query('COMMIT');

        logger.warn('Dead letter item reprocess failed', {
          stage: 'neo4j_dead_letter',
          status: 'retry_failed',
          errorClass: error instanceof Error ? error.name : 'Error',
          errorMessage,
          id: itemId,
          operation: item.operation,
          reprocessCount: item.reprocess_count + 1
        });

        return { success: false, error: errorMessage };
      }
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Mark a dead letter item as resolved
   */
  async resolveDeadLetterItem(
    itemId: string,
    resolvedBy: string,
    notes?: string
  ): Promise<boolean> {
    const pool = getDbPool();
    const result = await pool.query(
      `UPDATE neo4j_sync_dead_letter
       SET resolved = TRUE,
           resolved_at = NOW(),
           resolved_by = $2,
           notes = COALESCE($3, notes)
       WHERE id = $1 AND resolved = FALSE`,
      [itemId, resolvedBy, notes]
    );

    const updated = result.rowCount > 0;
    if (updated) {
      logger.info('Dead letter item marked as resolved', {
        stage: 'neo4j_dead_letter',
        status: 'resolved',
        id: itemId,
        resolvedBy,
        notes
      });
    }

    return updated;
  }

  /**
   * Get dead letter queue statistics
   */
  async getDeadLetterStats(): Promise<{
    total: number;
    unresolved: number;
    byOperation: Record<string, number>;
  }> {
    const pool = getDbPool();

    const [totalResult, unresolvedResult, byOpResult] = await Promise.all([
      pool.query(`SELECT COUNT(*)::int AS count FROM neo4j_sync_dead_letter`),
      pool.query(
        `SELECT COUNT(*)::int AS count FROM neo4j_sync_dead_letter WHERE resolved = FALSE`
      ),
      pool.query(`
        SELECT operation, COUNT(*)::int AS count
        FROM neo4j_sync_dead_letter
        WHERE resolved = FALSE
        GROUP BY operation
      `)
    ]);

    const byOperation: Record<string, number> = {};
    for (const row of byOpResult.rows) {
      byOperation[row.operation] = row.count;
    }

    return {
      total: totalResult.rows[0]?.count || 0,
      unresolved: unresolvedResult.rows[0]?.count || 0,
      byOperation
    };
  }

  /**
   * Clean up old processed and failed backlog items
   * Removes items older than BACKLOG_CLEANUP_DAYS
   */
  async cleanupOldBacklogItems(): Promise<{ deleted: number }> {
    const pool = getDbPool();

    try {
      const result = await pool.query(
        `DELETE FROM neo4j_sync_backlog
         WHERE status IN ('processed', 'failed')
           AND processed_at < NOW() - INTERVAL '1 day' * $1
         RETURNING id`,
        [BACKLOG_CLEANUP_DAYS]
      );

      const deleted = result.rowCount || 0;

      if (deleted > 0) {
        logger.info('Cleaned up old Neo4j backlog items', {
          stage: 'neo4j_backlog',
          status: 'cleanup',
          deleted_count: deleted,
          older_than_days: BACKLOG_CLEANUP_DAYS
        });
      }

      return { deleted };
    } catch (error: any) {
      logger.error('Failed to clean up old backlog items', {
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Get backlog statistics
   */
  async getBacklogStats(): Promise<{
    pending: number;
    processed: number;
    failed: number;
    total: number;
    maxSize: number;
    utilizationPct: number;
    oldestPending: Date | null;
  }> {
    const pool = getDbPool();

    const [statusResult, oldestResult] = await Promise.all([
      pool.query(`
        SELECT
          status,
          COUNT(*)::int AS count
        FROM neo4j_sync_backlog
        GROUP BY status
      `),
      pool.query(`
        SELECT created_at
        FROM neo4j_sync_backlog
        WHERE status = 'pending'
        ORDER BY created_at ASC
        LIMIT 1
      `)
    ]);

    const byStatus: Record<string, number> = {};
    for (const row of statusResult.rows) {
      byStatus[row.status] = row.count;
    }

    const pending = byStatus.pending || 0;
    const processed = byStatus.processed || 0;
    const failed = byStatus.failed || 0;
    const total = pending + processed + failed;

    return {
      pending,
      processed,
      failed,
      total,
      maxSize: BACKLOG_MAX_SIZE,
      utilizationPct: Math.round((pending / BACKLOG_MAX_SIZE) * 100),
      oldestPending: oldestResult.rows[0]?.created_at || null
    };
  }
}
