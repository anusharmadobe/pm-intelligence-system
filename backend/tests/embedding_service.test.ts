import {
  generateContextualSummary,
  generateContextualEmbedding,
  embedSignal,
  getSignalsWithoutEmbeddings,
  getEmbeddingStats,
  batchGenerateEmbeddings
} from '../services/embedding_service';
import {
  createMockEmbeddingProvider,
  createTestEmbeddingProvider,
  createFailingEmbeddingProvider,
  cosineSimilarity
} from '../utils/mock_embedding_provider';
import { createMockLLMProvider } from '../services/llm_service';
import { ingestSignal, RawSignal, Signal } from '../processing/signal_extractor';
import { runMigrations, resetDatabase, shutdownDatabase } from './test_db';

describe('Embedding Service', () => {
  beforeAll(async () => {
    await runMigrations();
  });

  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await shutdownDatabase();
  });

  describe('generateContextualSummary', () => {
    it('should generate a summary using LLM', async () => {
      const mockLLM = createMockLLMProvider('This is a contextual summary of the signal about form builder issues.');
      
      const signal: Signal = {
        id: 'test-signal-1',
        source: 'slack',
        source_ref: 'test-signal-1',
        signal_type: 'message',
        content: 'Customer Adobe is having problems with the form builder. Forms are not saving correctly.',
        normalized_content: 'customer adobe is having problems with the form builder forms are not saving correctly',
        severity: null,
        confidence: null,
        created_at: new Date(),
        metadata: { customer_name: 'Adobe' }
      };

      const summary = await generateContextualSummary(signal, mockLLM);

      expect(summary).toBeDefined();
      expect(typeof summary).toBe('string');
      expect(summary.length).toBeGreaterThan(0);
    });
  });

  describe('generateContextualEmbedding', () => {
    it('should generate embedding from contextual summary', async () => {
      const mockLLM = createMockLLMProvider('Summary: Customer issue with form saving.');
      const mockEmbedding = createMockEmbeddingProvider(1536);

      const signal: Signal = {
        id: 'test-signal-2',
        source: 'slack',
        source_ref: 'test-signal-2',
        signal_type: 'message',
        content: 'Form builder has a bug when saving large forms.',
        normalized_content: 'form builder has a bug when saving large forms',
        severity: null,
        confidence: null,
        created_at: new Date(),
        metadata: {}
      };

      const result = await generateContextualEmbedding(signal, mockLLM, mockEmbedding);

      expect(result.signalId).toBe('test-signal-2');
      expect(result.embedding).toHaveLength(1536);
      expect(result.contextualSummary).toBeDefined();
      expect(result.model).toBe('text-embedding-3-large');
    });
  });

  describe('Mock Embedding Providers', () => {
    it('should create embeddings with correct dimensions', async () => {
      const provider = createMockEmbeddingProvider(1536);
      const embedding = await provider('Test text');
      
      expect(embedding).toHaveLength(1536);
      expect(embedding.every(v => typeof v === 'number')).toBe(true);
    });

    it('should create deterministic embeddings for test inputs', async () => {
      const provider = createTestEmbeddingProvider(new Map([
        ['test input', new Array(1536).fill(0.01)]
      ]), 1536);
      
      const embedding1 = await provider('test input');
      const embedding2 = await provider('test input');
      
      // Same input should produce same embedding
      expect(embedding1).toEqual(embedding2);
    });

    it('should throw error with failing provider', async () => {
      const provider = createFailingEmbeddingProvider('Network error');
      
      await expect(provider('any text')).rejects.toThrow('Network error');
    });
  });

  describe('cosineSimilarity', () => {
    it('should return 1 for identical vectors', () => {
      const vec = [0.5, 0.5, 0.5, 0.5];
      const similarity = cosineSimilarity(vec, vec);
      expect(similarity).toBeCloseTo(1, 5);
    });

    it('should return 0 for orthogonal vectors', () => {
      const vec1 = [1, 0, 0, 0];
      const vec2 = [0, 1, 0, 0];
      const similarity = cosineSimilarity(vec1, vec2);
      expect(similarity).toBeCloseTo(0, 5);
    });

    it('should return -1 for opposite vectors', () => {
      const vec1 = [1, 0, 0, 0];
      const vec2 = [-1, 0, 0, 0];
      const similarity = cosineSimilarity(vec1, vec2);
      expect(similarity).toBeCloseTo(-1, 5);
    });
  });

  describe('getSignalsWithoutEmbeddings', () => {
    it('should return signals that need embedding', async () => {
      // First ingest some signals
      const rawSignal: RawSignal = {
        source: 'slack',
        id: 'embed-test-1',
        type: 'message',
        text: 'Customer feedback about performance issues.',
        metadata: { channel: 'feedback', channel_id: 'C123' }
      };

      await ingestSignal(rawSignal);

      const signalsNeedingEmbedding = await getSignalsWithoutEmbeddings(10);
      
      // The newly ingested signal should need embedding
      expect(signalsNeedingEmbedding.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('getEmbeddingStats', () => {
    it('should return embedding statistics', async () => {
      const stats = await getEmbeddingStats();

      expect(stats).toHaveProperty('totalSignals');
      expect(stats).toHaveProperty('embeddedSignals');
      expect(stats).toHaveProperty('pendingQueue');
      expect(stats).toHaveProperty('failedQueue');
      expect(stats).toHaveProperty('coveragePercent');
      expect(typeof stats.totalSignals).toBe('number');
      expect(typeof stats.embeddedSignals).toBe('number');
    });
  });

  describe('embedSignal', () => {
    it('should embed a signal and store the embedding', async () => {
      const mockLLM = createMockLLMProvider('Summary of customer issue.');
      const mockEmbedding = createMockEmbeddingProvider(1536);

      // First ingest a signal
      const rawSignal: RawSignal = {
        source: 'slack',
        id: 'embed-store-1',
        type: 'message',
        text: 'Important customer feedback about the API.',
        metadata: { channel: 'api-feedback', channel_id: 'C456' }
      };

      const signal = await ingestSignal(rawSignal);

      // Now embed it
      await embedSignal(signal, mockLLM, mockEmbedding);

      // Check stats - embedded count should increase
      const statsAfter = await getEmbeddingStats();
      expect(statsAfter.embeddedSignals).toBeGreaterThanOrEqual(1);
    });
  });

  describe('batchGenerateEmbeddings', () => {
    it('should process multiple signals in batch', async () => {
      const mockLLM = createMockLLMProvider('Batch summary.');
      const mockEmbedding = createMockEmbeddingProvider(1536);

      // Ingest multiple signals
      for (let i = 0; i < 3; i++) {
        await ingestSignal({
          source: 'slack',
          id: `batch-test-${i}`,
          type: 'message',
          text: `Customer feedback ${i} about feature request.`,
          metadata: { channel: 'feedback', channel_id: 'C789' }
        });
      }

      const signals = await getSignalsWithoutEmbeddings(10);
      const results = await batchGenerateEmbeddings(signals, mockLLM, mockEmbedding, { batchSize: 3 });

      expect(results.successful).toBeGreaterThan(0);
      expect(results.failed).toBe(0);
    });
  });
});
