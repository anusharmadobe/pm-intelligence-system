import * as z from 'zod/v4';
import { textResponse } from '../tool_utils';
import { IntelligenceService } from '../../services/intelligence_service';
import { logger } from '../../utils/logger';

export const tool = {
  name: 'get_trends',
  description: 'Get signal volume trends over time',
  inputSchema: {
    entity_type: z.enum(['theme', 'issue', 'feature', 'customer']),
    direction: z.enum(['emerging', 'growing', 'stable', 'declining', 'all']).optional(),
    window_days: z.number().int().min(7).max(365).optional(),
    limit: z.number().int().min(1).max(50).optional()
  },
  handler: async ({
    entity_type,
    direction = 'all',
    window_days = 28,
    limit = 15
  }: {
    entity_type: 'theme' | 'issue' | 'feature' | 'customer';
    direction?: 'emerging' | 'growing' | 'stable' | 'declining' | 'all';
    window_days?: number;
    limit?: number;
  }) => {
    try {
      const service = new IntelligenceService();
      const trends = await service.getTrends(entity_type, window_days, limit * 2);
      const filtered =
        direction === 'all' ? trends : trends.filter((trend) => trend.direction === direction);
      return textResponse(JSON.stringify(filtered.slice(0, limit), null, 2));
    } catch (error) {
      logger.error('get_trends failed', { error, entity_type });
      throw error;
    }
  }
};
