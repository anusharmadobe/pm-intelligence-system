import { getDbPool } from '../db/connection';
import { config } from '../config/env';
import { logger } from '../utils/logger';
import { getNeo4jDriver } from '../neo4j/client';
import { parsePositiveInt } from '../utils/env_parsing';

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
  private consecutiveTimeouts = 0;
  private circuitOpenUntilMs = 0;
  private static readonly CIRCUIT_TIMEOUT_THRESHOLD = parsePositiveInt(
    process.env.NEO4J_CIRCUIT_TIMEOUT_THRESHOLD,
    DEFAULT_CIRCUIT_TIMEOUT_THRESHOLD
  );
  private static readonly CIRCUIT_OPEN_MS = Math.max(
    MIN_CIRCUIT_OPEN_MS,
    parsePositiveInt(process.env.NEO4J_CIRCUIT_OPEN_MS, DEFAULT_CIRCUIT_OPEN_MS)
  );
  private static readonly CIRCUIT_LOG_EVERY = 100;
  private circuitBypassCount = 0;
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
          await client.query(
            `UPDATE neo4j_sync_backlog
             SET retry_count = $2,
                 status = CASE WHEN $3 THEN 'failed' ELSE status END,
                 processed_at = CASE WHEN $3 THEN NOW() ELSE processed_at END,
                 error_message = $4
             WHERE id = $1`,
            [row.id, nextRetryCount, reachedRetryCap, errorMessage]
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
            nextAction: reachedRetryCap ? 'mark_failed' : 'retry_backlog'
          });
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
}
