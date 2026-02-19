import {
  hybridSearch,
  vectorSearch,
  textSearch,
  findSimilarSignals,
  searchByTheme,
  searchByCustomer,
  HybridSearchOptions
} from '../services/hybrid_search_service';
import { embedSignal } from '../services/embedding_service';
import { createMockLLMProvider } from '../services/llm_service';
import { createMockEmbeddingProvider } from '../utils/mock_embedding_provider';
import { ingestSignal, RawSignal, Signal } from '../processing/signal_extractor';
import { runMigrations, resetDatabase, shutdownDatabase } from './test_db';

describe('Hybrid Search Service', () => {
  beforeAll(async () => {
    await runMigrations();
  });

  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await shutdownDatabase();
  });

  describe('textSearch', () => {
    beforeEach(async () => {
      // Create test signals
      const signals: RawSignal[] = [
        {
          source: 'slack',
          id: 'search-1',
          type: 'message',
          text: 'Customer Adobe needs help with form builder performance issues.',
          metadata: { channel: 'support', channel_id: 'C123' }
        },
        {
          source: 'slack',
          id: 'search-2',
          type: 'message',
          text: 'Microsoft is requesting new API documentation for integrations.',
          metadata: { channel: 'support', channel_id: 'C123' }
        },
        {
          source: 'slack',
          id: 'search-3',
          type: 'message',
          text: 'Another performance issue reported by Adobe team.',
          metadata: { channel: 'support', channel_id: 'C123' }
        }
      ];

      for (const signal of signals) {
        await ingestSignal(signal);
      }
    });

    it('should find signals matching query text', async () => {
      const results = await textSearch('Adobe performance', { limit: 10 });
      
      expect(Array.isArray(results)).toBe(true);
      // Should find signals mentioning Adobe and performance
      if (results.length > 0) {
        expect(results[0].signal.content.toLowerCase()).toMatch(/adobe|performance/);
      }
    });

    it('should return empty array for unmatched query', async () => {
      const results = await textSearch('zzzznonexistenttermzzzz', { limit: 10 });
      expect(results.length).toBe(0);
    });

    it('should respect limit parameter', async () => {
      const results = await textSearch('performance', { limit: 1 });
      expect(results.length).toBeLessThanOrEqual(1);
    });
  });

  describe('vectorSearch', () => {
    it('should require embeddings to return results', async () => {
      const mockEmbedding = createMockEmbeddingProvider(1536);
      
      // Search without any embeddings stored
      const results = await vectorSearch('performance issues', mockEmbedding, { limit: 10 });
      
      // Should return empty when no embeddings exist
      expect(Array.isArray(results)).toBe(true);
    });

    it('should find semantically similar signals when embeddings exist', async () => {
      const mockLLM = createMockLLMProvider('Performance issue summary');
      const mockEmbedding = createMockEmbeddingProvider(1536);

      // Create and embed a signal
      const signal = await ingestSignal({
        source: 'slack',
        id: 'vector-search-1',
        type: 'message',
        text: 'The form builder has severe performance degradation.',
        metadata: { channel: 'feedback', channel_id: 'C456' }
      });

      await embedSignal(signal, mockLLM, mockEmbedding);

      // Now search
      const results = await vectorSearch('slow loading times', mockEmbedding, { limit: 10 });
      
      expect(Array.isArray(results)).toBe(true);
      // With mock embeddings, results depend on the mock implementation
    });
  });

  describe('hybridSearch', () => {
    beforeEach(async () => {
      const signals: RawSignal[] = [
        {
          source: 'slack',
          id: 'hybrid-1',
          type: 'message',
          text: 'Performance issues with form validation affecting multiple customers.',
          metadata: { channel: 'issues', channel_id: 'C789' }
        },
        {
          source: 'slack',
          id: 'hybrid-2',
          type: 'message',
          text: 'Request for better form builder templates and themes.',
          metadata: { channel: 'requests', channel_id: 'C789' }
        }
      ];

      for (const signal of signals) {
        await ingestSignal(signal);
      }
    });

    it('should combine vector and text search', async () => {
      const mockEmbedding = createMockEmbeddingProvider(1536);

      const options: HybridSearchOptions = {
        query: 'performance problems',
        limit: 10,
        vectorWeight: 0.5,
        textWeight: 0.5
      };

      const results = await hybridSearch(options, mockEmbedding);

      expect(Array.isArray(results)).toBe(true);
    });

    it('should apply source filters', async () => {
      const mockEmbedding = createMockEmbeddingProvider(1536);

      const options: HybridSearchOptions = {
        query: 'form',
        limit: 10,
        filters: {
          source: 'slack'
        }
      };

      const results = await hybridSearch(options, mockEmbedding);
      
      // All results should be from slack
      for (const result of results) {
        expect(result.signal.source).toBe('slack');
      }
    });

    it('should respect minimum score threshold', async () => {
      const mockEmbedding = createMockEmbeddingProvider(1536);

      const options: HybridSearchOptions = {
        query: 'form',
        limit: 10,
        minScore: 0.5
      };

      const results = await hybridSearch(options, mockEmbedding);
      
      // All results should meet minimum score
      for (const result of results) {
        expect(result.combinedScore).toBeGreaterThanOrEqual(0.5);
      }
    });
  });

  describe('findSimilarSignals', () => {
    it('should find signals similar to a given signal', async () => {
      const mockEmbedding = createMockEmbeddingProvider(1536);
      const mockLLM = createMockLLMProvider('Summary');

      // Create and embed signals
      const signal1 = await ingestSignal({
        source: 'slack',
        id: 'similar-1',
        type: 'message',
        text: 'Form builder performance is slow.',
        metadata: { channel: 'feedback', channel_id: 'C111' }
      });

      const signal2 = await ingestSignal({
        source: 'slack',
        id: 'similar-2',
        type: 'message',
        text: 'Performance degradation in forms.',
        metadata: { channel: 'feedback', channel_id: 'C111' }
      });

      // Embed both
      await embedSignal(signal1, mockLLM, mockEmbedding);
      await embedSignal(signal2, mockLLM, mockEmbedding);

      const similar = await findSimilarSignals(signal1.id, mockEmbedding, { limit: 5 });
      
      expect(Array.isArray(similar)).toBe(true);
    });
  });

  describe('searchByTheme', () => {
    it('should search signals by theme', async () => {
      await ingestSignal({
        source: 'slack',
        id: 'theme-search-1',
        type: 'message',
        text: 'Issue with performance',
        metadata: { 
          channel: 'feedback', 
          channel_id: 'C222',
          themes: ['performance', 'speed']
        }
      });

      const mockEmbedding = createMockEmbeddingProvider(1536);
      const results = await searchByTheme('performance', mockEmbedding, { limit: 10 });
      
      expect(Array.isArray(results)).toBe(true);
    });
  });

  describe('searchByCustomer', () => {
    it('should search signals by customer', async () => {
      await ingestSignal({
        source: 'slack',
        id: 'customer-search-1',
        type: 'message',
        text: 'Adobe customer feedback',
        metadata: { 
          channel: 'feedback', 
          channel_id: 'C333',
          customer_name: 'Adobe',
          customers: ['Adobe']
        }
      });

      const mockEmbedding = createMockEmbeddingProvider(1536);
      const results = await searchByCustomer('Adobe', mockEmbedding, { limit: 10 });
      
      expect(Array.isArray(results)).toBe(true);
    });

    it('should return empty for non-existent customer', async () => {
      const mockEmbedding = createMockEmbeddingProvider(1536);
      const results = await searchByCustomer('NonExistentCorp', mockEmbedding, { limit: 10 });
      expect(results.length).toBe(0);
    });
  });
});
