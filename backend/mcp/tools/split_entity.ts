import * as z from 'zod/v4';
import { textResponse } from '../tool_utils';
import { FeedbackService } from '../../services/feedback_service';
import { logger } from '../../utils/logger';

export const tool = {
  name: 'split_entity',
  description: 'Split an entity into a new entity',
  inputSchema: {
    surviving_entity_id: z.string(),
    new_entity_name: z.string(),
    entity_type: z.enum(['customer', 'feature', 'issue', 'theme', 'stakeholder']),
    performed_by: z.string(),
    reasoning: z.string().optional()
  },
  handler: async ({
    surviving_entity_id,
    new_entity_name,
    entity_type,
    performed_by,
    reasoning
  }: {
    surviving_entity_id: string;
    new_entity_name: string;
    entity_type: string;
    performed_by: string;
    reasoning?: string;
  }) => {
    try {
      const service = new FeedbackService();
      const newId = await service.splitEntity({
        survivingEntityId: surviving_entity_id,
        newEntityName: new_entity_name,
        entityType: entity_type,
        performedBy: performed_by,
        reasoning
      });
      return textResponse(`Entity split created: ${newId}`);
    } catch (error) {
      logger.error('split_entity failed', { error, surviving_entity_id });
      throw error;
    }
  }
};
