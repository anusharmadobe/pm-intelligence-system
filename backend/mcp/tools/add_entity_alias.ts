import * as z from 'zod/v4';
import { textResponse } from '../tool_utils';
import { FeedbackService } from '../../services/feedback_service';
import { logger } from '../../utils/logger';

export const tool = {
  name: 'add_entity_alias',
  description: 'Add an alias to an entity',
  inputSchema: {
    entity_id: z.string(),
    alias: z.string(),
    source: z.string().optional()
  },
  handler: async ({ entity_id, alias, source }: { entity_id: string; alias: string; source?: string }) => {
    try {
      const service = new FeedbackService();
      await service.addAlias(entity_id, alias, source);
      return textResponse('Alias added');
    } catch (error) {
      logger.error('add_entity_alias failed', { error, entity_id });
      throw error;
    }
  }
};
