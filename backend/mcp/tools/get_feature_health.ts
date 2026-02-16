import * as z from 'zod/v4';
import { textResponse } from '../tool_utils';
import { IntelligenceService } from '../../services/intelligence_service';
import { logger } from '../../utils/logger';

export const tool = {
  name: 'get_feature_health',
  description: 'Get health metrics for a feature',
  inputSchema: {
    feature_name: z.string()
  },
  handler: async ({ feature_name }: { feature_name: string }) => {
    try {
      const service = new IntelligenceService();
      const result = await service.getFeatureHealth(feature_name);
      return textResponse(JSON.stringify(result, null, 2));
    } catch (error) {
      logger.error('get_feature_health failed', { error, feature_name });
      throw error;
    }
  }
};
