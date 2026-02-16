import { hybridSearch, textSearch } from './hybrid_search_service';
import { createLLMProviderFromEnv } from './llm_service';
import { createEmbeddingProvider, EmbeddingProviderConfig } from './embedding_provider';
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
}
