import * as z from 'zod/v4';
import { textResponse } from '../tool_utils';
import { searchDocuments } from '../../services/hybrid_search_service';
import { createEmbeddingProviderFromEnv } from '../../services/embedding_provider';
import { logger } from '../../utils/logger';

export const tool = {
  name: 'search_documents',
  description: 'Search only in documents (PDFs, specs, documentation). Use this when the query specifically mentions documents or PDFs.',
  inputSchema: {
    query: z.string().describe('Search query'),
    limit: z.number().int().min(1).max(50).optional().default(20).describe('Maximum number of results (default: 20)')
  },
  handler: async ({ query, limit }: { query: string; limit?: number }) => {
    const startTime = Date.now();

    // Input validation
    if (!query || query.trim().length === 0) {
      const errorMsg = 'Query parameter cannot be empty';
      logger.error('search_documents validation failed', {
        stage: 'mcp_tools',
        status: 'error',
        error: errorMsg
      });
      throw new Error(errorMsg);
    }

    const effectiveLimit = limit || 20;
    if (effectiveLimit < 1 || effectiveLimit > 50) {
      const errorMsg = 'Limit must be between 1 and 50';
      logger.error('search_documents validation failed', {
        stage: 'mcp_tools',
        status: 'error',
        error: errorMsg,
        provided_limit: effectiveLimit
      });
      throw new Error(errorMsg);
    }

    logger.info('Starting document search', {
      stage: 'mcp_tools',
      status: 'start',
      query: query.substring(0, 100),
      limit: effectiveLimit
    });

    try {
      const provider = createEmbeddingProviderFromEnv();
      const results = await searchDocuments(query, provider, {
        limit: effectiveLimit
      });

      const response = results.map(r => ({
        id: r.signal.id,
        score: r.combinedScore.toFixed(3),
        title: r.signal.metadata?.title || r.signal.metadata?.filename || 'Untitled',
        document_type: r.signal.signal_type,
        timestamp: r.signal.created_at,
        snippet: r.signal.content.substring(0, 200) + (r.signal.content.length > 200 ? '...' : '')
      }));

      const duration = Date.now() - startTime;

      logger.info('Document search completed', {
        stage: 'mcp_tools',
        status: 'success',
        query: query.substring(0, 100),
        result_count: results.length,
        duration_ms: duration
      });

      return textResponse(JSON.stringify(response, null, 2));
    } catch (error: any) {
      logger.error('search_documents failed', {
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
