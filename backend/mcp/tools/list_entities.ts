import * as z from 'zod/v4';
import { textResponse } from '../tool_utils';
import { getDbPool } from '../../db/connection';
import { logger } from '../../utils/logger';

export const tool = {
  name: 'list_entities',
  description: 'List entities from the registry',
  inputSchema: {
    entity_type: z.string().optional(),
    limit: z.number().int().min(1).max(100).optional()
  },
  handler: async ({ entity_type, limit = 25 }: { entity_type?: string; limit?: number }) => {
    try {
      const pool = getDbPool();
      const result = await pool.query(
        `SELECT id, canonical_name, entity_type, is_active
         FROM entity_registry
         WHERE ($1::text IS NULL OR entity_type = $1)
         ORDER BY canonical_name ASC
         LIMIT $2`,
        [entity_type || null, limit]
      );
      return textResponse(JSON.stringify(result.rows, null, 2));
    } catch (error) {
      logger.error('list_entities failed', { error, entity_type });
      throw error;
    }
  }
};
