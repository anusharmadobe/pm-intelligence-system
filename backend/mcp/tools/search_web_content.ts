import * as z from 'zod/v4';
import { textResponse } from '../tool_utils';
import { searchWebContent } from '../../services/hybrid_search_service';
import { createEmbeddingProviderFromEnv } from '../../services/embedding_provider';
import { logger } from '../../utils/logger';

export const tool = {
  name: 'search_web_content',
  description: 'Search only in web content (competitor blogs, changelogs, pricing pages, news). Use this when the query specifically mentions competitors, blogs, or web pages.',
  inputSchema: {
    query: z.string().describe('Search query'),
    competitor: z.string().optional().describe('Filter by specific competitor name'),
    limit: z.number().int().min(1).max(50).optional().default(20).describe('Maximum number of results (default: 20)')
  },
  handler: async ({ query, competitor, limit }: { query: string; competitor?: string; limit?: number }) => {
    const startTime = Date.now();

    // Input validation
    if (!query || query.trim().length === 0) {
      const errorMsg = 'Query parameter cannot be empty';
      logger.error('search_web_content validation failed', {
        stage: 'mcp_tools',
        status: 'error',
        error: errorMsg
      });
      throw new Error(errorMsg);
    }

    const effectiveLimit = limit || 20;
    if (effectiveLimit < 1 || effectiveLimit > 50) {
      const errorMsg = 'Limit must be between 1 and 50';
      logger.error('search_web_content validation failed', {
        stage: 'mcp_tools',
        status: 'error',
        error: errorMsg,
        provided_limit: effectiveLimit
      });
      throw new Error(errorMsg);
    }

    logger.info('Starting web content search', {
      stage: 'mcp_tools',
      status: 'start',
      query: query.substring(0, 100),
      competitor: competitor || 'all',
      limit: effectiveLimit
    });

    try {
      const provider = createEmbeddingProviderFromEnv();
      const results = await searchWebContent(query, provider, {
        competitor,
        limit: effectiveLimit
      });

      const response = results.map(r => ({
        id: r.signal.id,
        score: r.combinedScore.toFixed(3),
        page_title: r.signal.metadata?.page_title || 'Untitled',
        url: r.signal.metadata?.url,
        competitor: r.signal.metadata?.competitor || null,
        content_type: r.signal.metadata?.content_type || 'web_page',
        timestamp: r.signal.created_at,
        snippet: r.signal.content.substring(0, 200) + (r.signal.content.length > 200 ? '...' : '')
      }));

      const duration = Date.now() - startTime;

      logger.info('Web content search completed', {
        stage: 'mcp_tools',
        status: 'success',
        query: query.substring(0, 100),
        result_count: results.length,
        competitor: competitor || 'all',
        duration_ms: duration
      });

      return textResponse(JSON.stringify(response, null, 2));
    } catch (error: any) {
      logger.error('search_web_content failed', {
        stage: 'mcp_tools',
        status: 'error',
        error: error.message,
        stack: error.stack,
        query: query.substring(0, 100),
        duration_ms: Date.now() - startTime
      });
      throw error;
    }
  }
};
