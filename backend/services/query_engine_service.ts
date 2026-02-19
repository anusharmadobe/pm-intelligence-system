import { hybridSearch, textSearch } from './hybrid_search_service';
import { createLLMProviderFromEnv } from './llm_service';
import { createEmbeddingProvider, EmbeddingProviderConfig } from './embedding_provider';
import { QueryRoutingService } from './query_routing_service';
import { logger } from '../utils/logger';

export interface QueryEngineRequest {
  query: string;
  limit?: number;
  source?: string;
  customer?: string;
  feature?: string;
  theme?: string;
}

export interface QueryEngineResponse {
  query: string;
  answer: string;
  confidence: number;
  supporting_signals: Array<{
    id: string;
    source: string;
    snippet: string;
    created_at: string;
  }>;
}

export interface SmartQueryResult {
  query: string;
  answer: string;
  sources: Array<{
    source: string;
    relevance: number;
    result_count: number;
  }>;
  supporting_signals: Array<{
    id: string;
    source: string;
    snippet: string;
    created_at: string;
    score: number;
  }>;
  confidence: number;
}

export class QueryEngineService {
  async answerQuery(params: QueryEngineRequest): Promise<QueryEngineResponse> {
    const limit = params.limit || 12;
    let results: any[] = [];
    try {
      const provider =
        (process.env.EMBEDDING_PROVIDER as EmbeddingProviderConfig['provider']) || 'mock';
      const embeddingProvider = createEmbeddingProvider({
        provider,
        dimensions: provider === 'mock' ? 1536 : undefined
      });
      results = await hybridSearch(
        {
          query: params.query,
          limit,
          filters: {
            source: params.source,
            customer: params.customer,
            feature: params.feature,
            theme: params.theme
          }
        },
        embeddingProvider
      );
    } catch (error) {
      logger.warn('Hybrid search failed, falling back to text search', { error });
      results = await textSearch(params.query, {
        limit,
        filters: {
          source: params.source
        }
      });
    }

    const signals = results.map((row: any) => {
      const signal = row.signal || row;
      return {
        id: signal.id,
        source: signal.source,
        snippet: (signal.content || signal.normalized_content || '').substring(0, 240),
        created_at: signal.created_at
      };
    });

    const llmProvider = createLLMProviderFromEnv();
    const prompt = [
      'Answer the question using only the provided signals.',
      'If evidence is insufficient, say so explicitly.',
      `Question: ${params.query}`,
      '',
      'Signals:',
      ...signals.map((s, idx) => `${idx + 1}. [${s.source}] ${s.snippet}`)
    ].join('\n');

    let answer = '';
    try {
      answer = await llmProvider(prompt);
    } catch (error) {
      logger.warn('LLM query synthesis failed', { error });
      answer =
        'Unable to synthesize a full answer right now. Review the supporting signals directly.';
    }

    const confidence = Math.min(0.9, 0.4 + signals.length / 20);

    return {
      query: params.query,
      answer,
      confidence,
      supporting_signals: signals
    };
  }

  /**
   * Answer query with smart source routing
   */
  async queryWithRouting(
    query: string,
    options?: { sources?: string[]; limit?: number }
  ): Promise<SmartQueryResult> {
    try {
      // Create embedding provider
      const provider =
        (process.env.EMBEDDING_PROVIDER as EmbeddingProviderConfig['provider']) || 'mock';
      const embeddingProvider = createEmbeddingProvider({
        provider,
        dimensions: provider === 'mock' ? 1536 : undefined
      });

      // Route query to relevant sources
      const router = new QueryRoutingService(embeddingProvider);
      const sourceResults = await router.routeQuery(query, options);

      // Aggregate all results
      const allResults = sourceResults.flatMap(sr => sr.results);

      // Sort by combined score
      allResults.sort((a, b) => b.combinedScore - a.combinedScore);

      // Take top results
      const topResults = allResults.slice(0, options?.limit || 10);

      // Format signals
      const signals = topResults.map(result => ({
        id: result.signal.id,
        source: result.signal.source,
        snippet: result.signal.content.substring(0, 240),
        created_at: result.signal.created_at.toISOString(),
        score: result.combinedScore
      }));

      // Generate answer using LLM
      const llmProvider = createLLMProviderFromEnv();
      const prompt = [
        'Answer the question using only the provided signals from multiple sources.',
        'If evidence is insufficient, say so explicitly.',
        `Question: ${query}`,
        '',
        'Signals (sorted by relevance):',
        ...signals.map((s, idx) => `${idx + 1}. [${s.source}] (score: ${s.score.toFixed(2)}) ${s.snippet}`)
      ].join('\n');

      let answer = '';
      try {
        answer = await llmProvider(prompt);
      } catch (error) {
        logger.warn('LLM query synthesis failed', { error });
        answer =
          'Unable to synthesize a full answer right now. Review the supporting signals directly.';
      }

      // Calculate confidence
      const confidence = Math.min(0.9, 0.4 + signals.length / 20);

      return {
        query,
        answer,
        sources: sourceResults.map(sr => ({
          source: sr.source,
          relevance: sr.relevance,
          result_count: sr.results.length
        })),
        supporting_signals: signals,
        confidence
      };
    } catch (error: any) {
      logger.error('Query with routing failed', { error: error.message, query });
      throw error;
    }
  }
}
