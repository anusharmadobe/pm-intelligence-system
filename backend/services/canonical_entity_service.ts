import { v4 as uuidv4 } from 'uuid';
import { logger } from '../utils/logger';
import { getDbPool } from '../db/connection';
import { EntityRegistryService } from './entity_registry_service';

export class CanonicalEntityService {
  private registry = new EntityRegistryService();
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
  }) {
    return this.registry.createEntity(params);
  }

  async renameEntity(entityId: string, newName: string): Promise<void> {
    const pool = getDbPool();
    const existing = await pool.query(`SELECT canonical_name FROM entity_registry WHERE id = $1`, [
      entityId
    ]);
    const oldName = existing.rows[0]?.canonical_name;
    await pool.query(
      `UPDATE entity_registry SET canonical_name = $2, updated_at = NOW() WHERE id = $1`,
      [entityId, newName]
    );
    if (oldName && oldName !== newName) {
      const normalized = this.normalizeAlias(oldName);
      await pool.query(
        `INSERT INTO entity_aliases
          (id, canonical_entity_id, alias, alias_normalized, alias_source, confidence, confirmed_by_human)
         VALUES ($1, $2, $3, $4, 'rename', 1.0, true)
         ON CONFLICT (alias_normalized, canonical_entity_id) DO NOTHING`,
        [uuidv4(), entityId, oldName, normalized]
      );
    }
  }
}
