import * as z from 'zod/v4';
import { textResponse } from '../tool_utils';
import { getDbPool } from '../../db/connection';
import { logger } from '../../utils/logger';

export const tool = {
  name: 'list_registered_agents',
  description: 'List registered agents',
  inputSchema: {
    active_only: z.boolean().optional()
  },
  handler: async ({ active_only = false }: { active_only?: boolean }) => {
    try {
      const pool = getDbPool();
      const result = await pool.query(
        `SELECT agent_name, agent_class, is_active, current_version
         FROM agent_registry
         WHERE ($1::boolean = false OR is_active = true)
         ORDER BY agent_name ASC`,
        [active_only]
      );
      return textResponse(JSON.stringify(result.rows, null, 2));
    } catch (error) {
      logger.error('list_registered_agents failed', { error });
      throw error;
    }
  }
};
