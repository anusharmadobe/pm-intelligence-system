import * as z from 'zod/v4';
import { textResponse } from '../tool_utils';
import { hybridSearch, textSearch } from '../../services/hybrid_search_service';
import { createEmbeddingProvider, EmbeddingProviderConfig } from '../../services/embedding_provider';
import { logger } from '../../utils/logger';

export const tool = {
  name: 'search_signals',
  description: 'Search signals using hybrid vector + text search',
  inputSchema: {
    query: z.string(),
    source: z
      .enum(['slack', 'meeting_transcript', 'document', 'web_scrape', 'jira', 'wiki', 'all'])
      .optional(),
    customer: z.string().optional(),
    feature: z.string().optional(),
    theme: z.string().optional(),
    date_from: z.string().optional(),
    date_to: z.string().optional(),
    limit: z.number().int().min(1).max(50).optional()
  },
  handler: async ({
    query,
    source,
    customer,
    feature,
    theme,
    date_from,
    date_to,
    limit
  }: {
    query: string;
    source?: string;
    customer?: string;
    feature?: string;
    theme?: string;
    date_from?: string;
    date_to?: string;
    limit?: number;
  }) => {
    try {
      const provider = (process.env.EMBEDDING_PROVIDER as EmbeddingProviderConfig['provider']) || 'mock';
      const embeddingProvider = createEmbeddingProvider({ provider });
      const filters: {
        source?: string;
        customer?: string;
        feature?: string;
        theme?: string;
        startDate?: Date;
        endDate?: Date;
      } = {};

      if (source && source !== 'all') {
        filters.source = source === 'meeting_transcript' ? 'transcript' : source;
      }
      if (customer) filters.customer = customer;
      if (feature) filters.feature = feature;
      if (theme) filters.theme = theme;
      if (date_from) {
        const parsed = new Date(date_from);
        if (Number.isNaN(parsed.getTime())) throw new Error('Invalid date_from');
        filters.startDate = parsed;
      }
      if (date_to) {
        const parsed = new Date(date_to);
        if (Number.isNaN(parsed.getTime())) throw new Error('Invalid date_to');
        filters.endDate = parsed;
      }

      let results = [];
      try {
        results = await hybridSearch({ query, limit, filters }, embeddingProvider);
      } catch (error) {
        logger.warn('Hybrid search failed, falling back to text search', { error });
        results = await textSearch(query, { limit, filters });
      }
      const summary = results.map((result) => ({
        id: result.signal.id,
        source: result.signal.source,
        created_at: result.signal.created_at,
        score: result.combinedScore,
        snippet: result.signal.content.substring(0, 160)
      }));
      if (summary.length === 0) {
        return textResponse('No matching signals found.');
      }
      return textResponse(JSON.stringify(summary, null, 2));
    } catch (error) {
      logger.error('search_signals failed', { error, query });
      throw error;
    }
  }
};
