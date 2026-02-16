import * as z from 'zod/v4';
import { textResponse } from '../tool_utils';
import { getDbPool } from '../../db/connection';
import { logger } from '../../utils/logger';

export const tool = {
  name: 'configure_stakeholder_access',
  description: 'Configure stakeholder access scope',
  inputSchema: {
    stakeholder: z.string(),
    scope: z.string().refine((value) => {
      try {
        JSON.parse(value);
        return true;
      } catch {
        return false;
      }
    }, { message: 'scope must be valid JSON' })
  },
  handler: async ({ stakeholder, scope }: { stakeholder: string; scope: string }) => {
    try {
      const pool = getDbPool();
      const scopeJson = JSON.parse(scope);
      const existing = await pool.query(
        `SELECT id FROM entity_registry
         WHERE entity_type = 'stakeholder' AND canonical_name ILIKE $1
         LIMIT 1`,
        [stakeholder]
      );

      if (existing.rows[0]) {
        await pool.query(
          `UPDATE entity_registry
           SET metadata = jsonb_set(COALESCE(metadata, '{}'::jsonb), '{access_scope}', $2::jsonb, true),
               updated_at = NOW()
           WHERE id = $1`,
          [existing.rows[0].id, JSON.stringify(scopeJson)]
        );
      } else {
        await pool.query(
          `INSERT INTO entity_registry (id, entity_type, canonical_name, metadata, created_by)
           VALUES (gen_random_uuid(), 'stakeholder', $1, $2, 'system')`,
          [stakeholder, JSON.stringify({ access_scope: scopeJson })]
        );
      }

      return textResponse(`Stakeholder access updated for ${stakeholder}: ${scope}`);
    } catch (error) {
      logger.error('configure_stakeholder_access failed', { error, stakeholder });
      throw error;
    }
  }
};
