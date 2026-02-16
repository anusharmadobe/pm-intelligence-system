import * as z from 'zod/v4';
import { textResponse } from '../tool_utils';
import { getDbPool } from '../../db/connection';
import { logger } from '../../utils/logger';

export const tool = {
  name: 'retry_dlq_item',
  description: 'Retry a DLQ item',
  inputSchema: {
    dlq_id: z.string()
  },
  handler: async ({ dlq_id }: { dlq_id: string }) => {
    try {
      const pool = getDbPool();
      await pool.query(
        `UPDATE neo4j_sync_backlog
         SET status = 'pending', retry_count = 0
         WHERE id = $1`,
        [dlq_id]
      );
      return textResponse(`DLQ item retried: ${dlq_id}`);
    } catch (error) {
      logger.error('retry_dlq_item failed', { error, dlq_id });
      throw error;
    }
  }
};
