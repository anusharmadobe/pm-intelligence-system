import * as z from 'zod/v4';
import { textResponse } from '../tool_utils';
import { getDbPool } from '../../db/connection';
import { logger } from '../../utils/logger';

export const tool = {
  name: 'rollback_agent',
  description: 'Rollback an agent to a previous version',
  inputSchema: {
    agent_name: z.string(),
    target_version: z.string()
  },
  handler: async ({ agent_name, target_version }: { agent_name: string; target_version: string }) => {
    try {
      const pool = getDbPool();
      await pool.query(
        `UPDATE agent_registry
         SET rollback_version = current_version,
             current_version = $2,
             deployed_at = NOW()
         WHERE agent_name = $1`,
        [agent_name, target_version]
      );
      return textResponse(`Agent ${agent_name} rolled back to ${target_version}`);
    } catch (error) {
      logger.error('rollback_agent failed', { error, agent_name });
      throw error;
    }
  }
};
