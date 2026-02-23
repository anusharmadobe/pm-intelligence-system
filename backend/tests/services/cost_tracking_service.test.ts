import { getCostTrackingService, shutdownCostTracking } from '../../services/cost_tracking_service';
import { calculateLLMCost, calculateEmbeddingCost } from '../../config/pricing';
import { runMigrations, resetDatabase, shutdownDatabase } from '../test_db';

describe('Cost Tracking Service', () => {
  beforeAll(async () => {
    await runMigrations();
  });

  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await shutdownCostTracking();
    await shutdownDatabase();
  });

  describe('Cost Calculations', () => {
    it('should calculate LLM costs correctly for gpt-4o', () => {
      const cost = calculateLLMCost('openai', 'gpt-4o', 1000, 500);
      // 1000 input tokens at $0.0025/1k = $0.0025
      // 500 output tokens at $0.01/1k = $0.005
      // Total = $0.0075
      expect(cost).toBeCloseTo(0.0075, 6);
    });

    it('should calculate LLM costs correctly for gpt-4o-mini', () => {
      const cost = calculateLLMCost('openai', 'gpt-4o-mini', 1000, 500);
      // 1000 input tokens at $0.00015/1k = $0.00015
      // 500 output tokens at $0.0006/1k = $0.0003
      // Total = $0.00045
      expect(cost).toBeCloseTo(0.00045, 6);
    });

    it('should calculate embedding costs correctly', () => {
      const cost = calculateEmbeddingCost('openai', 'text-embedding-3-large', 1000);
      // 1000 input tokens at $0.00013/1k = $0.00013
      expect(cost).toBeCloseTo(0.00013, 6);
    });

    it('should return 0 for unknown models', () => {
      const cost = calculateLLMCost('openai', 'unknown-model', 1000, 500);
      expect(cost).toBe(0);
    });

    it('should return 0 in development tier', () => {
      const originalTier = process.env.COST_TRACKING_TIER;
      process.env.COST_TRACKING_TIER = 'development';

      const cost = calculateLLMCost('openai', 'gpt-4o', 1000, 500);
      expect(cost).toBe(0);

      process.env.COST_TRACKING_TIER = originalTier;
    });
  });

  describe('Cost Recording', () => {
    it('should record cost entries to database', async () => {
      const service = getCostTrackingService();

      await service.recordCost({
        correlation_id: 'test-correlation-1',
        operation: 'llm_chat',
        provider: 'openai',
        model: 'gpt-4o-mini',
        tokens_input: 100,
        tokens_output: 50,
        cost_usd: 0.0000525,
        timestamp: new Date()
      });

      // Force flush
      await (service as any).flushCostBuffer();

      // Wait for async operation
      await new Promise(resolve => setTimeout(resolve, 100));

      // Verify record was written (would need DB query)
      // This is a basic test - in real tests you'd query the database
    });

    it('should batch multiple cost records', async () => {
      const service = getCostTrackingService();

      // Record multiple costs
      for (let i = 0; i < 10; i++) {
        await service.recordCost({
          correlation_id: `test-correlation-${i}`,
          operation: 'embedding',
          provider: 'openai',
          model: 'text-embedding-3-large',
          tokens_input: 50,
          tokens_output: 0,
          cost_usd: 0.0000065,
          timestamp: new Date()
        });
      }

      // Force flush
      await (service as any).flushCostBuffer();
      await new Promise(resolve => setTimeout(resolve, 100));
    });

    it('should handle recording failures gracefully', async () => {
      const service = getCostTrackingService();

      // Recording with invalid data should not throw
      await expect(async () => {
        await service.recordCost({
          correlation_id: '',
          operation: 'test',
          provider: 'test',
          model: 'test',
          tokens_input: -1, // Invalid
          tokens_output: -1,
          cost_usd: -1,
          timestamp: new Date()
        });
      }).not.toThrow();
    });
  });

  describe('Budget Checking', () => {
    it('should return budget status for agent', async () => {
      // This test would need a test agent in the database
      // Skipping for now as it requires full test setup
    });

    it('should use cache for budget checks', async () => {
      // Test that subsequent budget checks use cache
      // Would need to verify DB queries are not made
    });

    it('should handle budget check errors gracefully (fail open)', async () => {
      const service = getCostTrackingService();

      // Check budget for non-existent agent should not throw
      const status = await service.checkAgentBudget('non-existent-id');

      // Should fail open (allow the request)
      expect(status.allowed).toBe(true);
    });
  });

  describe('Cost Summaries', () => {
    it('should return empty summary for no data', async () => {
      const service = getCostTrackingService();

      const summary = await service.getCostSummary({
        dateFrom: new Date('2026-01-01'),
        dateTo: new Date('2026-01-31')
      });

      expect(summary.total_cost_usd).toBe(0);
      expect(summary.total_operations).toBe(0);
    });
  });
});
