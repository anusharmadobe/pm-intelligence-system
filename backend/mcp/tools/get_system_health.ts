import * as z from 'zod/v4';
import { textResponse } from '../tool_utils';
import { getSystemHealth } from '../../services/health_service';
import { logger } from '../../utils/logger';

export const tool = {
  name: 'get_system_health',
  description: 'Get system health summary',
  inputSchema: {},
  handler: async () => {
    try {
      const health = await getSystemHealth();
      return textResponse(JSON.stringify(health, null, 2));
    } catch (error) {
      logger.error('get_system_health failed', { error });
      throw error;
    }
  }
};
