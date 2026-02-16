import * as z from 'zod/v4';
import { textResponse } from '../tool_utils';
import { HeatmapService } from '../../services/heatmap_service';
import { logger } from '../../utils/logger';

export const tool = {
  name: 'get_heatmap',
  description: 'Get issue-by-customer heatmap',
  inputSchema: {
    dimension: z.enum([
      'issues_by_feature',
      'issues_by_customer',
      'features_by_customer',
      'themes_by_signal_volume'
    ]),
    metric: z.enum(['customer_count', 'signal_count', 'severity_weighted']).optional(),
    limit: z.number().int().min(1).max(50).optional(),
    date_from: z.string().optional()
  },
  handler: async ({
    dimension,
    metric = 'customer_count',
    limit = 20,
    date_from
  }: {
    dimension: 'issues_by_feature' | 'issues_by_customer' | 'features_by_customer' | 'themes_by_signal_volume';
    metric?: 'customer_count' | 'signal_count' | 'severity_weighted';
    limit?: number;
    date_from?: string;
  }) => {
    try {
      const service = new HeatmapService();
      const response = await service.getHeatmap({ dimension, metric, limit, date_from });
      return textResponse(
        JSON.stringify(response, null, 2)
      );
    } catch (error) {
      logger.error('get_heatmap failed', { error, dimension });
      throw error;
    }
  }
};
