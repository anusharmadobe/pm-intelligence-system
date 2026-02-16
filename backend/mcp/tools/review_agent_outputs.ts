import * as z from 'zod/v4';
import { textResponse } from '../tool_utils';
import { getDbPool } from '../../db/connection';
import { logger } from '../../utils/logger';

export const tool = {
  name: 'review_agent_outputs',
  description: 'Review agent outputs awaiting feedback',
  inputSchema: {
    status: z.string().optional(),
    limit: z.number().int().min(1).max(50).optional()
  },
  handler: async ({ status = 'pending', limit = 20 }: { status?: string; limit?: number }) => {
    try {
      const pool = getDbPool();
      const result = await pool.query(
        `SELECT * FROM feedback_log
         WHERE feedback_type IN ('agent_output_correction', 'agent_output_approval', 'agent_proposal_review')
           AND status = $1
         ORDER BY created_at DESC
         LIMIT $2`,
        [status, limit]
      );
      return textResponse(JSON.stringify(result.rows, null, 2));
    } catch (error) {
      logger.error('review_agent_outputs failed', { error, status });
      throw error;
    }
  }
};
