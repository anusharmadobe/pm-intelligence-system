import * as z from 'zod/v4';
import { textResponse } from '../tool_utils';
import { IntelligenceService } from '../../services/intelligence_service';
import { logger } from '../../utils/logger';

export const tool = {
  name: 'get_customer_profile',
  description: 'Get a customer profile summary',
  inputSchema: {
    customer_name: z.string()
  },
  handler: async ({ customer_name }: { customer_name: string }) => {
    try {
      const service = new IntelligenceService();
      const profile = await service.getCustomerProfile(customer_name);
      return textResponse(JSON.stringify(profile, null, 2));
    } catch (error) {
      logger.error('get_customer_profile failed', { error, customer_name });
      throw error;
    }
  }
};
