import { QueryEngineService } from '../services/query_engine_service';
import * as hybridSearchService from '../services/hybrid_search_service';
import * as llmService from '../services/llm_service';

describe('QueryEngineService', () => {
  it('returns synthesized answer with supporting signals', async () => {
    jest.spyOn(hybridSearchService, 'hybridSearch').mockResolvedValue([
      {
        signal: {
          id: 'sig-1',
          source: 'manual',
          content: 'Acme Corp reports latency in checkout',
          normalized_content: 'Acme Corp reports latency in checkout',
          created_at: new Date().toISOString()
        },
        combinedScore: 0.8
      } as any
    ]);
    jest
      .spyOn(llmService, 'createLLMProviderFromEnv')
      .mockReturnValue(async () => 'Checkout latency is a recurring issue.');

    const service = new QueryEngineService();
    const response = await service.answerQuery({ query: 'checkout latency' });

    expect(response.answer).toContain('Checkout latency');
    expect(response.supporting_signals.length).toBe(1);
  });
});
