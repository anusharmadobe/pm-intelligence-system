import * as z from 'zod/v4';
import { textResponse } from '../tool_utils';
import { getDbPool } from '../../db/connection';
import { logger } from '../../utils/logger';

export const tool = {
  name: 'deactivate_agent',
  description: 'Deactivate a registered agent',
  inputSchema: {
    agent_name: z.string()
  },
  handler: async ({ agent_name }: { agent_name: string }) => {
    try {
      const pool = getDbPool();
      await pool.query(
        `UPDATE agent_registry SET is_active = false, updated_at = NOW() WHERE agent_name = $1`,
        [agent_name]
      );
      return textResponse(`Agent ${agent_name} deactivated`);
    } catch (error) {
      logger.error('deactivate_agent failed', { error, agent_name });
      throw error;
    }
  }
};
