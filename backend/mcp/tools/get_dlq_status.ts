import * as z from 'zod/v4';
import { textResponse } from '../tool_utils';
import { getDbPool } from '../../db/connection';
import { logger } from '../../utils/logger';

export const tool = {
  name: 'get_dlq_status',
  description: 'Get DLQ status',
  inputSchema: {
    failure_stage: z.enum(['extraction', 'entity_resolution', 'neo4j_sync', 'embedding', 'all']).optional(),
    limit: z.number().int().min(1).max(50).optional()
  },
  handler: async ({
    failure_stage = 'all',
    limit = 10
  }: {
    failure_stage?: string;
    limit?: number;
  }) => {
    try {
      const pool = getDbPool();
      if (failure_stage === 'neo4j_sync' || failure_stage === 'all') {
        const result = await pool.query(
          `SELECT id, operation, retry_count, status, created_at
           FROM neo4j_sync_backlog
           WHERE retry_count >= 3 OR status = 'pending'
           ORDER BY created_at ASC
           LIMIT $1`,
          [limit]
        );
        return textResponse(
          JSON.stringify(
            {
              failure_stage: 'neo4j_sync',
              pending: result.rows.length,
              items: result.rows
            },
            null,
            2
          )
        );
      }

      return textResponse(
        JSON.stringify(
          {
            failure_stage,
            pending: 0,
            items: []
          },
          null,
          2
        )
      );
    } catch (error) {
      logger.error('get_dlq_status failed', { error, failure_stage });
      throw error;
    }
  }
};
