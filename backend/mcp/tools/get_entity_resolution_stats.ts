import * as z from 'zod/v4';
import { textResponse } from '../tool_utils';
import { getDbPool } from '../../db/connection';
import { logger } from '../../utils/logger';

export const tool = {
  name: 'get_entity_resolution_stats',
  description: 'Get entity resolution statistics',
  inputSchema: {},
  handler: async () => {
    try {
      const pool = getDbPool();
      const result = await pool.query(
        `SELECT resolution_result, COUNT(*)::int AS count
         FROM entity_resolution_log
         GROUP BY resolution_result
         ORDER BY count DESC`
      );
      return textResponse(JSON.stringify(result.rows, null, 2));
    } catch (error) {
      logger.error('get_entity_resolution_stats failed', { error });
      throw error;
    }
  }
};
