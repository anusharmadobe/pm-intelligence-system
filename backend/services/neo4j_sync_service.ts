import { getDbPool } from '../db/connection';
import { config } from '../config/env';
import { logger } from '../utils/logger';
import { getNeo4jDriver } from '../neo4j/client';

type Neo4jOperation = 'signal_sync' | 'entity_merge' | 'entity_split' | 'relationship_add';

// Timeout for Neo4j operations (10 seconds default)
const NEO4J_TIMEOUT_MS = parseInt(process.env.NEO4J_TIMEOUT_MS || '10000', 10);

export class Neo4jSyncService {
  private unsupportedRelationshipCounts = new Map<string, number>();
  private backlogFailureCount = 0;
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
    REQUEST_FOR_CONFIRMATION: 'RELATES_TO'
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

  async syncEntity(entity: { id: string; entity_type: string; canonical_name: string }): Promise<void> {
    if (!config.featureFlags.neo4jSync) {
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
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorClass = error instanceof Error ? error.name : 'Error';
      const isTimeout = errorMessage.toLowerCase().includes('timeout');
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

  async syncRelationship(params: {
    fromId: string;
    fromType: string;
    toId: string;
    toType: string;
    relationship: string;
  }): Promise<void> {
    if (!config.featureFlags.neo4jSync) {
      await this.enqueue('relationship_add', params);
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
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorClass = error instanceof Error ? error.name : 'Error';
      const isTimeout = errorMessage.toLowerCase().includes('timeout');
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
        `SELECT id, operation, payload, status, retry_count, created_at, processed_at
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
            await this.syncEntity(payload.entity);
          }
          if (row.operation === 'relationship_add') {
            await this.syncRelationship(payload);
          }

          await client.query(
            `UPDATE neo4j_sync_backlog SET status = 'processed', processed_at = NOW() WHERE id = $1`,
            [row.id]
          );
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          await client.query(
            `UPDATE neo4j_sync_backlog
             SET retry_count = retry_count + 1
             WHERE id = $1`,
            [row.id]
          );
          logger.warn('Neo4j backlog item processing failed', {
            stage: 'neo4j_backlog',
            status: 'error',
            errorClass: error instanceof Error ? error.name : 'Error',
            errorMessage,
            id: row.id,
            operation: row.operation,
            retryCount: row.retry_count,
            nextAction: 'retry_backlog'
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
      const neo4jResult = await session.run('MATCH (n) RETURN count(n) AS count');
      const neo4jCount = neo4jResult.records[0]?.get('count')?.toInt?.() || 0;
      return { pgCount: pgResult.rows[0].count, neo4jCount };
    } finally {
      await session.close();
    }
  }
}
