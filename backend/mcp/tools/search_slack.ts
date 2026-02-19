import * as z from 'zod/v4';
import { textResponse } from '../tool_utils';
import { searchSlack } from '../../services/hybrid_search_service';
import { createEmbeddingProviderFromEnv } from '../../services/embedding_provider';
import { logger } from '../../utils/logger';

export const tool = {
  name: 'search_slack',
  description: 'Search only in Slack messages and threads. Use this when the query specifically mentions Slack or channels.',
  inputSchema: {
    query: z.string().describe('Search query'),
    channel_id: z.string().optional().describe('Filter by specific Slack channel ID'),
    limit: z.number().int().min(1).max(50).optional().default(20).describe('Maximum number of results (default: 20)')
  },
  handler: async ({ query, channel_id, limit }: { query: string; channel_id?: string; limit?: number }) => {
    try {
      const provider = createEmbeddingProviderFromEnv();
      const results = await searchSlack(query, provider, {
        channelId: channel_id,
        limit: limit || 20
      });

      const response = results.map(r => ({
        id: r.signal.id,
        score: r.combinedScore.toFixed(3),
        channel: r.signal.metadata?.channel_name || 'unknown',
        user: r.signal.metadata?.user_id || 'unknown',
        timestamp: r.signal.created_at,
        snippet: r.signal.content.substring(0, 200) + (r.signal.content.length > 200 ? '...' : '')
      }));

      logger.info('Slack search completed', {
        stage: 'mcp_tools',
        query,
        result_count: results.length
      });

      return textResponse(JSON.stringify(response, null, 2));
    } catch (error: any) {
      logger.error('search_slack failed', { error: error.message, query });
      throw error;
    }
  }
};
