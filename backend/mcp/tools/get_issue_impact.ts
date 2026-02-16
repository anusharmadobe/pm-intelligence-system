import * as z from 'zod/v4';
import { textResponse } from '../tool_utils';
import { IntelligenceService } from '../../services/intelligence_service';
import { logger } from '../../utils/logger';

export const tool = {
  name: 'get_issue_impact',
  description: 'Get impact metrics for an issue',
  inputSchema: {
    issue_name: z.string()
  },
  handler: async ({ issue_name }: { issue_name: string }) => {
    try {
      const service = new IntelligenceService();
      const result = await service.getIssueImpact(issue_name);
      return textResponse(JSON.stringify(result, null, 2));
    } catch (error) {
      logger.error('get_issue_impact failed', { error, issue_name });
      throw error;
    }
  }
};
