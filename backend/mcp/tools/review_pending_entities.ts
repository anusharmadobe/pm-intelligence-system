import * as z from 'zod/v4';
import { textResponse } from '../tool_utils';
import { FeedbackService } from '../../services/feedback_service';
import { logger } from '../../utils/logger';

export const tool = {
  name: 'review_pending_entities',
  description: 'List pending entity merge reviews',
  inputSchema: {
    limit: z.number().int().min(1).max(50).optional()
  },
  handler: async ({ limit = 20 }: { limit?: number }) => {
    try {
      const service = new FeedbackService();
      const pending = await service.getPendingReviews(limit);
      return textResponse(JSON.stringify(pending, null, 2));
    } catch (error) {
      logger.error('review_pending_entities failed', { error });
      throw error;
    }
  }
};
