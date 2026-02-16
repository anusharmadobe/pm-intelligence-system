import { getDbPool } from '../db/connection';
import { config } from '../config/env';
import { logger } from '../utils/logger';
import { getNeo4jDriver } from '../neo4j/client';

type Neo4jOperation = 'signal_sync' | 'entity_merge' | 'entity_split' | 'relationship_add';

export class Neo4jSyncService {
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
    CAUSES: 'RELATES_TO',
    CAUSED_BY: 'RELATES_TO',
    RESULTS_IN: 'RELATES_TO',
    RESULTED_IN: 'RELATES_TO',
    THROWS: 'RELATES_TO',
    INTEGRATION: 'RELATES_TO',
    INTEGRATES_WITH: 'RELATES_TO',
    COMMUNICATION: 'MENTIONS',
    RESPONSE: 'MENTIONS',
    INQUIRY: 'MENTIONS',
    SUPPORTS: 'DEPENDS_ON',
    REQUIRED_FOR: 'DEPENDS_ON'
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
    await pool.query(
      `INSERT INTO neo4j_sync_backlog (id, operation, payload, status)
       VALUES (gen_random_uuid(), $1, $2, 'pending')`,
      [operation, JSON.stringify(payload)]
    );
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
      await session.run(
        `MERGE (e:${label} {id: $id})
         SET e.canonical_name = $name, e.updated_at = datetime()`,
        { id: entity.id, name: entity.canonical_name }
      );
    } catch (error) {
      logger.warn('Neo4j sync failed, enqueueing backlog', { error });
      await this.enqueue('signal_sync', { entity });
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
      logger.warn('Unsupported relationship type for Neo4j sync', { relationship });
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
      await session.run(
        `MATCH (a:${fromLabel} {id: $fromId})
         MATCH (b:${toLabel} {id: $toId})
         MERGE (a)-[r:${relationship}]->(b)
         SET r.updated_at = datetime()`,
        { fromId: params.fromId, toId: params.toId }
      );
    } catch (error) {
      logger.warn('Neo4j relationship sync failed, enqueueing backlog', { error });
      await this.enqueue('relationship_add', params as unknown as Record<string, unknown>);
    } finally {
      await session.close();
    }
  }

  async processBacklog(limit = 50): Promise<void> {
    const pool = getDbPool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await pool.query(
        `SELECT id, entity_type, entity_id, operation, payload, status,
                attempt_count, last_error, created_at, updated_at, processed_at
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
          await client.query(
            `UPDATE neo4j_sync_backlog
             SET retry_count = retry_count + 1
             WHERE id = $1`,
            [row.id]
          );
          logger.warn('Neo4j backlog processing failed', { error, id: row.id });
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
