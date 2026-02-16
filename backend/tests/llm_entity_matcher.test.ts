import { LLMEntityMatcher, CanonicalEntity, EntityMatchResult } from '../services/llm_entity_matcher';
import { LLMProvider } from '../services/llm_service';

// Mock LLM provider
const createMockLLMProvider = (responses: string[]): LLMProvider => {
  let callCount = 0;
  return async (prompt: string): Promise<string> => {
    if (callCount >= responses.length) {
      throw new Error('Mock LLM provider ran out of responses');
    }
    return responses[callCount++];
  };
};

describe('LLMEntityMatcher', () => {
  describe('matchEntity', () => {
    it('should match entity with high confidence', async () => {
      const mockResponse = JSON.stringify({
        matched_entity_id: '1',
        confidence: 0.92,
        reasoning: 'MSFT is a common abbreviation for Microsoft',
        suggested_aliases: ['MSFT', 'MS']
      });

      const matcher = new LLMEntityMatcher();
      // @ts-ignore - accessing private property for testing
      matcher.llmProvider = createMockLLMProvider([mockResponse]);

      const candidates: CanonicalEntity[] = [
        {
          id: 'entity_123',
          canonical_name: 'Microsoft',
          entity_type: 'customer',
          aliases: ['Microsoft Corp', 'MS']
        },
        {
          id: 'entity_456',
          canonical_name: 'Apple',
          entity_type: 'customer',
          aliases: ['Apple Inc']
        }
      ];

      const result = await matcher.matchEntity('MSFT', candidates, 'User reported issue with MSFT product');

      expect(result.matchedEntityId).toBe('entity_123');
      expect(result.confidence).toBe(0.92);
      expect(result.reasoning).toContain('abbreviation');
      expect(result.suggestedAliases).toContain('MSFT');
    });

    it('should handle numeric index in matched_entity_id', async () => {
      const mockResponse = JSON.stringify({
        matched_entity_id: '2',
        confidence: 0.88,
        reasoning: 'Authentication and Auth are the same feature',
        suggested_aliases: ['Auth']
      });

      const matcher = new LLMEntityMatcher();
      // @ts-ignore
      matcher.llmProvider = createMockLLMProvider([mockResponse]);

      const candidates: CanonicalEntity[] = [
        {
          id: 'entity_001',
          canonical_name: 'Login',
          entity_type: 'feature',
          aliases: []
        },
        {
          id: 'entity_002',
          canonical_name: 'Authentication',
          entity_type: 'feature',
          aliases: ['SSO']
        }
      ];

      const result = await matcher.matchEntity('Auth', candidates, 'Need to fix Auth timeout');

      expect(result.matchedEntityId).toBe('entity_002');
      expect(result.confidence).toBe(0.88);
    });

    it('should return null for no match (new entity)', async () => {
      const mockResponse = JSON.stringify({
        matched_entity_id: null,
        confidence: 0.3,
        reasoning: 'No clear match found for FooBar in candidates',
        suggested_aliases: []
      });

      const matcher = new LLMEntityMatcher();
      // @ts-ignore
      matcher.llmProvider = createMockLLMProvider([mockResponse]);

      const candidates: CanonicalEntity[] = [
        {
          id: 'entity_123',
          canonical_name: 'Microsoft',
          entity_type: 'customer',
          aliases: []
        }
      ];

      const result = await matcher.matchEntity('FooBar', candidates, 'FooBar is a new customer');

      expect(result.matchedEntityId).toBeNull();
      expect(result.confidence).toBe(0.3);
    });

    it('should handle empty candidates list', async () => {
      const matcher = new LLMEntityMatcher();
      // @ts-ignore
      matcher.llmProvider = createMockLLMProvider([]);

      const result = await matcher.matchEntity('test', [], 'test context');

      expect(result.matchedEntityId).toBeNull();
      expect(result.confidence).toBe(0);
      expect(result.reasoning).toBe('No candidates provided');
      expect(result.suggestedAliases).toEqual([]);
    });

    it('should handle LLM failure gracefully', async () => {
      const matcher = new LLMEntityMatcher();
      // @ts-ignore
      matcher.llmProvider = async () => {
        throw new Error('LLM API timeout');
      };

      const candidates: CanonicalEntity[] = [
        {
          id: 'entity_123',
          canonical_name: 'Microsoft',
          entity_type: 'customer',
          aliases: []
        }
      ];

      const result = await matcher.matchEntity('MSFT', candidates, 'test context');

      expect(result.matchedEntityId).toBeNull();
      expect(result.confidence).toBe(0);
      expect(result.reasoning).toContain('LLM matching failed');
    });

    it('should handle malformed JSON response', async () => {
      const matcher = new LLMEntityMatcher();
      // @ts-ignore
      matcher.llmProvider = createMockLLMProvider(['not valid json']);

      const candidates: CanonicalEntity[] = [
        {
          id: 'entity_123',
          canonical_name: 'Microsoft',
          entity_type: 'customer',
          aliases: []
        }
      ];

      const result = await matcher.matchEntity('MSFT', candidates, 'test context');

      expect(result.matchedEntityId).toBeNull();
      expect(result.confidence).toBe(0);
    });

    it('should parse JSON from markdown code blocks', async () => {
      const mockResponse = '```json\n' + JSON.stringify({
        matched_entity_id: '1',
        confidence: 0.95,
        reasoning: 'Clear match',
        suggested_aliases: []
      }) + '\n```';

      const matcher = new LLMEntityMatcher();
      // @ts-ignore
      matcher.llmProvider = createMockLLMProvider([mockResponse]);

      const candidates: CanonicalEntity[] = [
        {
          id: 'entity_123',
          canonical_name: 'Test',
          entity_type: 'customer',
          aliases: []
        }
      ];

      const result = await matcher.matchEntity('test', candidates, 'context');

      expect(result.matchedEntityId).toBe('entity_123');
      expect(result.confidence).toBe(0.95);
    });
  });

  describe('extractCanonicalForm', () => {
    it('should extract proper canonical form', async () => {
      const mockResponse = 'Authentication Timeout';

      const matcher = new LLMEntityMatcher();
      // @ts-ignore
      matcher.llmProvider = createMockLLMProvider([mockResponse]);

      const result = await matcher.extractCanonicalForm('auth timeout', 'User experiencing auth timeout issues');

      expect(result).toBe('Authentication Timeout');
    });

    it('should remove quotes from LLM response', async () => {
      const mockResponse = '"Login Bug"';

      const matcher = new LLMEntityMatcher();
      // @ts-ignore
      matcher.llmProvider = createMockLLMProvider([mockResponse]);

      const result = await matcher.extractCanonicalForm('login bug', 'bug context');

      expect(result).toBe('Login Bug');
      expect(result).not.toContain('"');
    });

    it('should use fallback for invalid LLM response', async () => {
      const matcher = new LLMEntityMatcher();
      // @ts-ignore
      matcher.llmProvider = createMockLLMProvider(['']);

      const result = await matcher.extractCanonicalForm('sso error', 'context');

      // Fallback: title case
      expect(result).toBe('Sso Error');
    });

    it('should use fallback for too-short response', async () => {
      const mockResponse = 'x';

      const matcher = new LLMEntityMatcher();
      // @ts-ignore
      matcher.llmProvider = createMockLLMProvider([mockResponse]);

      const result = await matcher.extractCanonicalForm('test', 'context');

      expect(result).toBe('Test');
    });

    it('should use fallback for too-long response', async () => {
      const mockResponse = 'A'.repeat(150);

      const matcher = new LLMEntityMatcher();
      // @ts-ignore
      matcher.llmProvider = createMockLLMProvider([mockResponse]);

      const result = await matcher.extractCanonicalForm('test', 'context');

      expect(result).toBe('Test');
    });

    it('should use fallback on LLM failure', async () => {
      const matcher = new LLMEntityMatcher();
      // @ts-ignore
      matcher.llmProvider = async () => {
        throw new Error('LLM error');
      };

      const result = await matcher.extractCanonicalForm('pdf export', 'context');

      expect(result).toBe('Pdf Export');
    });
  });

  describe('classifyEntityType', () => {
    it('should classify customer entities', async () => {
      const mockResponse = JSON.stringify({
        entity_type: 'customer',
        confidence: 0.95,
        reasoning: 'Acme Corp is a company name'
      });

      const matcher = new LLMEntityMatcher();
      // @ts-ignore
      matcher.llmProvider = createMockLLMProvider([mockResponse]);

      const result = await matcher.classifyEntityType('Acme Corp', 'Customer Acme Corp requested this');

      expect(result.entityType).toBe('customer');
      expect(result.confidence).toBe(0.95);
      expect(result.reasoning).toContain('company');
    });

    it('should classify feature entities', async () => {
      const mockResponse = JSON.stringify({
        entity_type: 'feature',
        confidence: 0.88,
        reasoning: 'SSO is a product capability'
      });

      const matcher = new LLMEntityMatcher();
      // @ts-ignore
      matcher.llmProvider = createMockLLMProvider([mockResponse]);

      const result = await matcher.classifyEntityType('SSO', 'Need SSO feature implemented');

      expect(result.entityType).toBe('feature');
    });

    it('should classify issue entities', async () => {
      const mockResponse = JSON.stringify({
        entity_type: 'issue',
        confidence: 0.92,
        reasoning: 'Login Timeout is a bug/problem'
      });

      const matcher = new LLMEntityMatcher();
      // @ts-ignore
      matcher.llmProvider = createMockLLMProvider([mockResponse]);

      const result = await matcher.classifyEntityType('Login Timeout', 'Users experiencing Login Timeout');

      expect(result.entityType).toBe('issue');
    });

    it('should classify theme entities', async () => {
      const mockResponse = JSON.stringify({
        entity_type: 'theme',
        confidence: 0.85,
        reasoning: 'Performance is a high-level category'
      });

      const matcher = new LLMEntityMatcher();
      // @ts-ignore
      matcher.llmProvider = createMockLLMProvider([mockResponse]);

      const result = await matcher.classifyEntityType('Performance', 'Performance concerns raised');

      expect(result.entityType).toBe('theme');
    });

    it('should default to issue for invalid type', async () => {
      const mockResponse = JSON.stringify({
        entity_type: 'invalid_type',
        confidence: 0.6,
        reasoning: 'Unknown type'
      });

      const matcher = new LLMEntityMatcher();
      // @ts-ignore
      matcher.llmProvider = createMockLLMProvider([mockResponse]);

      const result = await matcher.classifyEntityType('Test', 'context');

      expect(result.entityType).toBe('issue');
    });

    it('should use default on LLM failure', async () => {
      const matcher = new LLMEntityMatcher();
      // @ts-ignore
      matcher.llmProvider = async () => {
        throw new Error('LLM error');
      };

      const result = await matcher.classifyEntityType('Test', 'context');

      expect(result.entityType).toBe('issue');
      expect(result.confidence).toBe(0.5);
      expect(result.reasoning).toContain('Classification failed');
    });
  });

  describe('generateAliases', () => {
    it('should generate relevant aliases', async () => {
      const mockResponse = JSON.stringify({
        aliases: ['Auth', 'Sign-in', 'Login', 'Sign In'],
        reasoning: 'Common variations for Authentication'
      });

      const matcher = new LLMEntityMatcher();
      // @ts-ignore
      matcher.llmProvider = createMockLLMProvider([mockResponse]);

      const result = await matcher.generateAliases('Authentication', 'Auth system context');

      expect(result.aliases).toContain('Auth');
      expect(result.aliases).toContain('Login');
      expect(result.aliases.length).toBeGreaterThan(0);
      expect(result.aliases.length).toBeLessThanOrEqual(5);
    });

    it('should filter out canonical name from aliases', async () => {
      const mockResponse = JSON.stringify({
        aliases: ['Microsoft', 'MSFT', 'MS', 'Microsoft Corp'],
        reasoning: 'Variations'
      });

      const matcher = new LLMEntityMatcher();
      // @ts-ignore
      matcher.llmProvider = createMockLLMProvider([mockResponse]);

      const result = await matcher.generateAliases('Microsoft', 'context');

      expect(result.aliases).not.toContain('Microsoft');
      expect(result.aliases).toContain('MSFT');
    });

    it('should remove duplicate aliases', async () => {
      const mockResponse = JSON.stringify({
        aliases: ['Auth', 'auth', 'Auth', 'AUTH'],
        reasoning: 'Duplicates test'
      });

      const matcher = new LLMEntityMatcher();
      // @ts-ignore
      matcher.llmProvider = createMockLLMProvider([mockResponse]);

      const result = await matcher.generateAliases('Authentication');

      const uniqueAliases = new Set(result.aliases);
      expect(result.aliases.length).toBe(uniqueAliases.size);
    });

    it('should return empty array on LLM failure', async () => {
      const matcher = new LLMEntityMatcher();
      // @ts-ignore
      matcher.llmProvider = async () => {
        throw new Error('LLM error');
      };

      const result = await matcher.generateAliases('Test');

      expect(result.aliases).toEqual([]);
      expect(result.reasoning).toContain('Alias generation failed');
    });

    it('should limit aliases to 5', async () => {
      const mockResponse = JSON.stringify({
        aliases: ['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8'],
        reasoning: 'Many aliases'
      });

      const matcher = new LLMEntityMatcher();
      // @ts-ignore
      matcher.llmProvider = createMockLLMProvider([mockResponse]);

      const result = await matcher.generateAliases('Test');

      expect(result.aliases.length).toBeLessThanOrEqual(5);
    });
  });
});
