import { logger } from '../utils/logger';
import { EmbeddingProvider } from './embedding_provider';
import { hybridSearch, HybridSearchResult } from './hybrid_search_service';

export interface QueryRoutingOptions {
  sources?: string[];
  limit?: number;
}

export interface SourceSearchResult {
  source: string;
  results: HybridSearchResult[];
  relevance: number;
}

export class QueryRoutingService {
  constructor(private embeddingProvider: EmbeddingProvider) {}

  /**
   * Route a query to appropriate data sources
   */
  async routeQuery(query: string, options?: QueryRoutingOptions): Promise<SourceSearchResult[]> {
    // Input validation
    if (!query || query.trim().length === 0) {
      throw new Error('Query cannot be empty');
    }

    if (options?.limit !== undefined && (options.limit < 1 || options.limit > 100)) {
      throw new Error('Limit must be between 1 and 100');
    }

    if (options?.sources !== undefined && (!Array.isArray(options.sources) || options.sources.length === 0)) {
      throw new Error('Sources must be a non-empty array');
    }

    const startTime = Date.now();

    // Determine relevant sources if not specified
    const sources = options?.sources || this.determineRelevantSources(query);

    logger.info('Routing query to sources', {
      stage: 'query_routing',
      status: 'start',
      query: query.substring(0, 100), // Truncate for logging
      sources,
      limit: options?.limit || 10
    });

    try {
      // Search in parallel across all relevant sources
      const searches = sources.map(source => this.searchSource(query, source, options?.limit || 10));

      const results = await Promise.all(searches);

      // Calculate relevance score for each source
      const rankedResults = results
        .map(({ source, results }) => ({
          source,
          results,
          relevance: this.calculateSourceRelevance(results)
        }))
        .sort((a, b) => b.relevance - a.relevance);

      const totalResults = rankedResults.reduce((sum, sr) => sum + sr.results.length, 0);
      const duration = Date.now() - startTime;

      logger.info('Query routing complete', {
        stage: 'query_routing',
        status: 'success',
        sources_searched: sources.length,
        total_results: totalResults,
        top_source: rankedResults[0]?.source || 'none',
        top_relevance: rankedResults[0]?.relevance?.toFixed(3) || '0',
        duration_ms: duration
      });

      return rankedResults;
    } catch (error: any) {
      logger.error('Query routing failed', {
        stage: 'query_routing',
        status: 'error',
        error: error.message,
        stack: error.stack,
        duration_ms: Date.now() - startTime
      });
      throw error;
    }
  }

  /**
   * Determine relevant sources from query keywords
   */
  private determineRelevantSources(query: string): string[] {
    // Input validation
    if (!query || query.trim().length === 0) {
      logger.warn('Empty query for source determination, using default sources', {
        stage: 'query_routing'
      });
      return ['slack', 'transcript', 'document', 'web_scrape'];
    }

    const keywords = query.toLowerCase();
    const sources: string[] = [];
    const matchReasons: Record<string, string[]> = {};

    // Check for explicit source mentions
    if (keywords.includes('slack') || keywords.includes('channel')) {
      sources.push('slack');
      matchReasons['slack'] = ['explicit mention in query'];
    }
    if (keywords.includes('meeting') || keywords.includes('discussed') || keywords.includes('transcript')) {
      sources.push('transcript');
      matchReasons['transcript'] = ['meeting/discussion keywords detected'];
    }
    if (keywords.includes('document') || keywords.includes('spec') || keywords.includes('pdf')) {
      sources.push('document');
      matchReasons['document'] = ['document type keywords detected'];
    }
    if (keywords.includes('competitor') || keywords.includes('blog') || keywords.includes('changelog')) {
      sources.push('web_scrape');
      matchReasons['web_scrape'] = ['external content keywords detected'];
    }
    if (keywords.includes('jira') || keywords.includes('ticket')) {
      sources.push('jira');
      matchReasons['jira'] = ['issue tracking keywords detected'];
    }

    // Check for temporal keywords that suggest certain sources
    if (keywords.includes('recent') || keywords.includes('today') || keywords.includes('this week')) {
      // Slack is more real-time
      if (!sources.includes('slack')) {
        sources.push('slack');
        matchReasons['slack'] = ['temporal keywords suggest real-time data'];
      } else {
        matchReasons['slack']?.push('temporal keywords reinforce real-time need');
      }
    }

    // Default: search all sources if no specific source mentioned
    if (sources.length === 0) {
      logger.debug('No specific source keywords found, using default sources', {
        stage: 'query_routing',
        query: query.substring(0, 100)
      });
      return ['slack', 'transcript', 'document', 'web_scrape'];
    }

    logger.info('Determined relevant sources from query', {
      stage: 'query_routing',
      decision: 'source_selection',
      sources,
      reasoning: matchReasons,
      query: query.substring(0, 100),
      confidenceLevel: sources.length > 0 ? 'high' : 'low'
    });

    return sources;
  }

  /**
   * Search a single source
   */
  private async searchSource(query: string, source: string, limit: number): Promise<{ source: string; results: HybridSearchResult[] }> {
    const startTime = Date.now();

    logger.debug('Searching source', {
      stage: 'query_routing',
      status: 'start',
      source,
      limit
    });

    try {
      const results = await hybridSearch(
        {
          query,
          filters: { source },
          limit,
          minScore: 0.3
        },
        this.embeddingProvider
      );

      logger.debug('Source search complete', {
        stage: 'query_routing',
        status: 'success',
        source,
        result_count: results.length,
        duration_ms: Date.now() - startTime
      });

      return { source, results };
    } catch (error: any) {
      logger.warn('Source search failed', {
        stage: 'query_routing',
        status: 'error',
        source,
        error: error.message,
        stack: error.stack,
        duration_ms: Date.now() - startTime
      });
      return { source, results: [] };
    }
  }

  /**
   * Calculate relevance score for a source based on results
   */
  private calculateSourceRelevance(results: HybridSearchResult[]): number {
    if (results.length === 0) return 0;

    // Average of top 3 scores
    const topScores = results.slice(0, 3).map(r => r.combinedScore);
    return topScores.reduce((sum, score) => sum + score, 0) / topScores.length;
  }

  /**
   * Search by specific source
   */
  async searchBySource(query: string, source: string, limit: number = 20): Promise<HybridSearchResult[]> {
    // Input validation
    if (!query || query.trim().length === 0) {
      throw new Error('Query cannot be empty');
    }

    if (!source || source.trim().length === 0) {
      throw new Error('Source cannot be empty');
    }

    if (limit < 1 || limit > 100) {
      throw new Error('Limit must be between 1 and 100');
    }

    const startTime = Date.now();

    logger.info('Searching by specific source', {
      stage: 'query_routing',
      status: 'start',
      source,
      query: query.substring(0, 100),
      limit
    });

    try {
      const results = await hybridSearch(
        {
          query,
          filters: { source },
          limit
        },
        this.embeddingProvider
      );

      logger.info('Source search complete', {
        stage: 'query_routing',
        status: 'success',
        source,
        result_count: results.length,
        duration_ms: Date.now() - startTime
      });

      return results;
    } catch (error: any) {
      logger.error('Source search failed', {
        stage: 'query_routing',
        status: 'error',
        source,
        error: error.message,
        stack: error.stack,
        duration_ms: Date.now() - startTime
      });
      throw error;
    }
  }
}
