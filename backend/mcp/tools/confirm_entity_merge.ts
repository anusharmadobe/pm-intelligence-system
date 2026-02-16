import * as z from 'zod/v4';
import { textResponse } from '../tool_utils';
import { FeedbackService } from '../../services/feedback_service';
import { logger } from '../../utils/logger';

export const tool = {
  name: 'confirm_entity_merge',
  description: 'Confirm a pending entity merge',
  inputSchema: {
    feedback_id: z.string(),
    resolved_by: z.string(),
    notes: z.string().optional()
  },
  handler: async ({ feedback_id, resolved_by, notes }: { feedback_id: string; resolved_by: string; notes?: string }) => {
    try {
      const service = new FeedbackService();
      await service.confirmMerge(feedback_id, resolved_by, notes);
      return textResponse('Merge confirmed');
    } catch (error) {
      logger.error('confirm_entity_merge failed', { error, feedback_id });
      throw error;
    }
  }
};
