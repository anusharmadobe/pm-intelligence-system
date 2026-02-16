import * as z from 'zod/v4';
import { textResponse } from '../tool_utils';
import { IntelligenceService } from '../../services/intelligence_service';
import { logger } from '../../utils/logger';

export const tool = {
  name: 'get_strategic_insights',
  description: 'Generate strategic insights from context',
  inputSchema: {
    focus_area: z.string().optional(),
    time_window_days: z.number().int().min(7).max(365).optional()
  },
  handler: async ({
    focus_area,
    time_window_days = 30
  }: {
    focus_area?: string;
    time_window_days?: number;
  }) => {
    try {
      const service = new IntelligenceService();
      const response = await service.getStrategicInsights(focus_area, time_window_days);
      return textResponse(response);
    } catch (error) {
      logger.error('get_strategic_insights failed', { error, focus_area });
      throw error;
    }
  }
};
