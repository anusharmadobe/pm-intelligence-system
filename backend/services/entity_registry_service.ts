import { v4 as uuidv4 } from 'uuid';
import { getDbPool } from '../db/connection';
import { logger } from '../utils/logger';
import { eventBus } from '../agents/event_bus';
import { config } from '../config/env';

export interface EntityRegistryRecord {
  id: string;
  entity_type: string;
  canonical_name: string;
  description: string | null;
  metadata: Record<string, unknown> | null;
  confidence: number;
  created_by: string;
  last_validated_by: string | null;
  last_validated_at: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface EntityAliasRecord {
  id: string;
  canonical_entity_id: string;
  alias: string;
  alias_normalized: string;
  alias_source: string;
  confidence: number;
  signal_id: string | null;
  confirmed_by_human: boolean;
  is_active: boolean;
  created_at: string;
}

export class EntityRegistryService {
  private normalizeAlias(alias: string): string {
    return alias
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  async createEntity(params: {
    entityType: string;
    canonicalName: string;
    description?: string;
    metadata?: Record<string, unknown>;
    createdBy?: string;
  }): Promise<EntityRegistryRecord> {
    const pool = getDbPool();
    const id = uuidv4();
    const createdBy = params.createdBy || 'system';

    try {
      const result = await pool.query(
        `INSERT INTO entity_registry
          (id, entity_type, canonical_name, description, metadata, created_by)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [
          id,
          params.entityType,
          params.canonicalName,
          params.description || null,
          params.metadata ? JSON.stringify(params.metadata) : null,
          createdBy
        ]
      );

      // Add canonical name as alias
      await pool.query(
        `INSERT INTO entity_aliases
          (id, canonical_entity_id, alias, alias_normalized, alias_source, confidence, confirmed_by_human)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (alias_normalized, canonical_entity_id) DO NOTHING`,
        [
          uuidv4(),
          id,
          params.canonicalName,
          this.normalizeAlias(params.canonicalName),
          'manual',
          1.0,
          createdBy === 'human'
        ]
      );

      if (config.featureFlags.eventBus) {
        await eventBus.publish({
          event_type: 'entity.created',
          source_service: 'entity_registry_service',
          payload: {
            entity_id: result.rows[0].id,
            entity_type: params.entityType,
            canonical_name: params.canonicalName
          },
          metadata: {
            entity_ids: [result.rows[0].id],
            severity: 'info'
          }
        });
      }

      return result.rows[0];
    } catch (error) {
      logger.error('Failed to create entity', { error, params });
      throw error;
    }
  }

  async findByName(canonicalName: string): Promise<EntityRegistryRecord | null> {
    const pool = getDbPool();
    const result = await pool.query<EntityRegistryRecord>(
      `SELECT id, entity_type, canonical_name, description, metadata, confidence,
              created_by, last_validated_by, last_validated_at, is_active,
              created_at, updated_at
       FROM entity_registry
       WHERE canonical_name ILIKE $1 AND is_active = true
       LIMIT 1`,
      [canonicalName]
    );
    return result.rows[0] || null;
  }

  async findByAlias(alias: string): Promise<EntityRegistryRecord | null> {
    const pool = getDbPool();
    const normalized = this.normalizeAlias(alias);
    const result = await pool.query(
      `SELECT er.*
       FROM entity_aliases ea
       JOIN entity_registry er ON ea.canonical_entity_id = er.id
       WHERE ea.is_active = true
         AND er.is_active = true
         AND (
           ea.alias_normalized = $1
           OR ea.alias_normalized LIKE $1 || '%'
           OR $1 LIKE ea.alias_normalized || '%'
         )
       ORDER BY LENGTH(ea.alias_normalized) DESC
       LIMIT 1`,
      [normalized]
    );

    return result.rows[0] || null;
  }

  async search(query: string, limit = 20): Promise<EntityRegistryRecord[]> {
    const pool = getDbPool();
    const result = await pool.query<EntityRegistryRecord>(
      `SELECT id, entity_type, canonical_name, description, metadata, confidence,
              created_by, last_validated_by, last_validated_at, is_active,
              created_at, updated_at
       FROM entity_registry
       WHERE canonical_name ILIKE $1 AND is_active = true
       ORDER BY canonical_name ASC
       LIMIT $2`,
      [`%${query}%`, limit]
    );
    return result.rows;
  }

  async deactivate(entityId: string, performedBy = 'system'): Promise<void> {
    const pool = getDbPool();
    await pool.query(
      `UPDATE entity_registry
       SET is_active = false, updated_at = NOW(), last_validated_by = $2, last_validated_at = NOW()
       WHERE id = $1`,
      [entityId, performedBy]
    );
  }

  async addAlias(entityId: string, alias: string, options: {
    aliasSource?: string;
    confidence?: number;
    signalId?: string | null;
  } = {}): Promise<void> {
    const pool = getDbPool();
    const aliasNormalized = this.normalizeAlias(alias);

    // Use INSERT ... ON CONFLICT to avoid race condition
    // Assumes there's a unique constraint on (canonical_entity_id, alias_normalized, is_active)
    await pool.query(
      `INSERT INTO entity_aliases (
        id, canonical_entity_id, alias, alias_normalized, alias_source,
        confidence, signal_id, confirmed_by_human, is_active, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, false, true, NOW())
      ON CONFLICT (canonical_entity_id, alias_normalized)
        WHERE is_active = true
        DO NOTHING`,
      [
        uuidv4(),
        entityId,
        alias,
        aliasNormalized,
        options.aliasSource || 'auto_detected',
        options.confidence || 0.9,
        options.signalId || null
      ]
    );
  }

  async getWithAliases(entityId: string): Promise<{
    entity: EntityRegistryRecord | null;
    aliases: EntityAliasRecord[];
  }> {
    const pool = getDbPool();
    const entityResult = await pool.query<EntityRegistryRecord>(
      `SELECT id, entity_type, canonical_name, description, metadata, confidence,
              created_by, last_validated_by, last_validated_at, is_active,
              created_at, updated_at
       FROM entity_registry WHERE id = $1`,
      [entityId]
    );
    const aliasResult = await pool.query<EntityAliasRecord>(
      `SELECT id, canonical_entity_id, alias, alias_normalized, alias_source,
              confidence, signal_id, confirmed_by_human, is_active, created_at
       FROM entity_aliases WHERE canonical_entity_id = $1 AND is_active = true`,
      [entityId]
    );

    return {
      entity: entityResult.rows[0] || null,
      aliases: aliasResult.rows
    };
  }
}
