import * as z from 'zod/v4';
import { textResponse } from '../tool_utils';
import { getDbPool } from '../../db/connection';
import { logger } from '../../utils/logger';

export const tool = {
  name: 'list_opportunities',
  description: 'List opportunities',
  inputSchema: {
    status: z.enum(['new', 'reviewing', 'accepted', 'rejected', 'all']).optional(),
    sort_by: z.enum(['score', 'signal_count', 'created_at']).optional(),
    limit: z.number().int().min(1).max(50).optional()
  },
  handler: async ({
    status = 'all',
    sort_by = 'score',
    limit = 20
  }: {
    status?: 'new' | 'reviewing' | 'accepted' | 'rejected' | 'all';
    sort_by?: 'score' | 'signal_count' | 'created_at';
    limit?: number;
  }) => {
    try {
      const pool = getDbPool();
      const statusClause = status === 'all' ? '' : 'WHERE o.status = $1';
      const params: any[] = status === 'all' ? [] : [status];
      const orderBy =
        sort_by === 'created_at' ? 'o.created_at DESC' : 'signal_count DESC';
      const result = await pool.query(
        `SELECT o.id, o.title, o.description, o.status, o.created_at,
                COUNT(os.signal_id)::int AS signal_count
         FROM opportunities o
         LEFT JOIN opportunity_signals os ON o.id = os.opportunity_id
         ${statusClause}
         GROUP BY o.id
         ORDER BY ${orderBy}
         LIMIT $${params.length + 1}`,
        [...params, limit]
      );
      return textResponse(JSON.stringify(result.rows, null, 2));
    } catch (error) {
      logger.error('list_opportunities failed', { error });
      throw error;
    }
  }
};
