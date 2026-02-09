/**
 * Mock embedding provider for testing
 * Re-exports from embedding_provider for convenience
 */

export { createMockEmbeddingProvider, cosineSimilarity } from '../services/embedding_provider';

/**
 * Creates a mock embedding provider that returns fixed embeddings for specific test cases
 */
export function createTestEmbeddingProvider(
  testCases: Map<string, number[]>,
  fallbackDimensions: number = 384
): (text: string) => Promise<number[]> {
  return async (text: string): Promise<number[]> => {
    // Check for exact match
    if (testCases.has(text)) {
      return testCases.get(text)!;
    }
    
    // Check for partial match
    for (const [key, value] of testCases.entries()) {
      if (text.includes(key) || key.includes(text)) {
        return value;
      }
    }
    
    // Generate random embedding for unknown text
    const embedding: number[] = [];
    for (let i = 0; i < fallbackDimensions; i++) {
      embedding.push(Math.random() * 2 - 1);
    }
    
    // Normalize
    const magnitude = Math.sqrt(embedding.reduce((sum, val) => sum + val * val, 0));
    return embedding.map(val => val / magnitude);
  };
}

/**
 * Creates a mock embedding provider that always fails (for error testing)
 */
export function createFailingEmbeddingProvider(errorMessage: string = 'Mock embedding error'): (text: string) => Promise<number[]> {
  return async (_text: string): Promise<number[]> => {
    throw new Error(errorMessage);
  };
}

/**
 * Creates a mock embedding provider with configurable delay
 */
export function createDelayedEmbeddingProvider(
  delayMs: number = 100,
  dimensions: number = 384
): (text: string) => Promise<number[]> {
  return async (text: string): Promise<number[]> => {
    await new Promise(resolve => setTimeout(resolve, delayMs));
    
    // Generate simple hash-based embedding
    const embedding: number[] = [];
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
      hash = ((hash << 5) - hash) + text.charCodeAt(i);
    }
    
    for (let i = 0; i < dimensions; i++) {
      const seed = hash + i;
      embedding.push(Math.sin(seed) * 2 - 1);
    }
    
    const magnitude = Math.sqrt(embedding.reduce((sum, val) => sum + val * val, 0));
    return embedding.map(val => val / magnitude);
  };
}
