import * as z from 'zod/v4';
import { textResponse } from '../tool_utils';
import { IntelligenceService } from '../../services/intelligence_service';
import { logger } from '../../utils/logger';

export const tool = {
  name: 'get_roadmap_priorities',
  description: 'Rank features for roadmap priorities',
  inputSchema: {
    filter: z
      .enum(['all', 'quick_wins', 'strategic', 'emerging', 'high_confidence'])
      .optional(),
    limit: z.number().int().min(1).max(25).optional()
  },
  handler: async ({ filter = 'all', limit = 10 }: { filter?: string; limit?: number }) => {
    try {
      const service = new IntelligenceService();
      const priorities = await service.getRoadmapPriorities(filter, limit);
      return textResponse(JSON.stringify(priorities, null, 2));
    } catch (error) {
      logger.error('get_roadmap_priorities failed', { error, filter });
      throw error;
    }
  }
};
