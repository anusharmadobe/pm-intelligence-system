import { LLMExtractionService } from '../services/llm_extraction_service';

describe('LLMExtractionService', () => {
  it('extracts entities using heuristic fallback', async () => {
    const service = new LLMExtractionService();
    const content = 'Acme Corp reports issue with FeatureX in checkout flow.';
    const result = await service.extract(content);

    expect(result.entities.customers).toContain('Acme Corp');
    expect(result.entities.issues.length).toBeGreaterThan(0);
  });
});
