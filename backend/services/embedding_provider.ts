import { logger } from '../utils/logger';
import { fetchWithRetry } from '../utils/network_retry';
import { getRunMetrics } from '../utils/run_metrics';

/**
 * Embedding provider type - simple function signature following LLM provider pattern
 */
export type EmbeddingProvider = (text: string) => Promise<number[]>;

/**
 * Batch embedding provider for efficiency
 */
export type BatchEmbeddingProvider = (texts: string[]) => Promise<number[][]>;

/**
 * Embedding provider configuration
 */
export interface EmbeddingProviderConfig {
  provider: 'openai' | 'azure_openai' | 'cohere' | 'cursor' | 'mock';
  model?: string;
  dimensions?: number;
  apiKey?: string;
  endpoint?: string;
  baseUrl?: string;
  deployment?: string;
  apiVersion?: string;
  timeout?: number;
}

/**
 * Default configurations by provider
 */
const PROVIDER_DEFAULTS: Record<string, Partial<EmbeddingProviderConfig>> = {
  openai: {
    model: 'text-embedding-3-large',
    dimensions: 1536,
    endpoint: 'https://api.openai.com/v1/embeddings'
  },
  azure_openai: {
    model: 'text-embedding-ada-002',
    dimensions: 1536,
    apiVersion: '2023-05-15'
  },
  cohere: {
    model: 'embed-english-v3.0',
    dimensions: 1024,
    endpoint: 'https://api.cohere.ai/v1/embed'
  },
  cursor: {
    model: 'cursor-embedding',
    dimensions: 1536
  },
  mock: {
    model: 'mock-embedding',
    dimensions: 384
  }
};

/**
 * Creates an embedding provider based on configuration
 */
export function createEmbeddingProvider(config: EmbeddingProviderConfig): EmbeddingProvider {
  const azureApiKey = process.env.AZURE_OPENAI_API_KEY || process.env.AZURE_OPENAI_KEY;
  const fullConfig = {
    ...PROVIDER_DEFAULTS[config.provider],
    ...config
  };

  switch (config.provider) {
    case 'openai':
      return createOpenAIEmbeddingProvider(
        fullConfig.apiKey || process.env.OPENAI_API_KEY || '',
        fullConfig.model,
        fullConfig.dimensions,
        fullConfig.baseUrl || process.env.OPENAI_BASE_URL
      );
    case 'azure_openai':
      return createAzureOpenAIEmbeddingProvider(
        fullConfig.endpoint || process.env.AZURE_OPENAI_ENDPOINT || '',
        fullConfig.apiKey || azureApiKey || '',
        fullConfig.deployment || process.env.AZURE_OPENAI_EMBEDDINGS_DEPLOYMENT || 'text-embedding-ada-002',
        fullConfig.apiVersion || process.env.AZURE_OPENAI_EMBEDDINGS_API_VERSION || '2023-05-15'
      );
    case 'cohere':
      return createCohereEmbeddingProvider(
        fullConfig.apiKey || process.env.COHERE_API_KEY || '',
        fullConfig.model
      );
    case 'cursor':
      return createCursorEmbeddingProvider(fullConfig);
    case 'mock':
      return createMockEmbeddingProvider(fullConfig.dimensions);
    default:
      throw new Error(`Unknown embedding provider: ${config.provider}`);
  }
}

/**
 * Creates an OpenAI embedding provider
 */
export function createOpenAIEmbeddingProvider(
  apiKey: string,
  model: string = 'text-embedding-3-large',
  dimensions?: number,
  baseUrl?: string
): EmbeddingProvider {
  if (!apiKey) {
    throw new Error('OpenAI API key is required');
  }

  const apiBase = (baseUrl || 'https://api.openai.com').replace(/\/$/, '');
  const url = `${apiBase}/v1/embeddings`;

  return async (text: string): Promise<number[]> => {
    const startTime = Date.now();
    const metrics = getRunMetrics();
    metrics.increment('embedding_calls');
    
    try {
      const body: any = {
        input: text,
        model: model
      };
      
      // text-embedding-3 models support dimension reduction
      if (dimensions && model.includes('text-embedding-3')) {
        body.dimensions = dimensions;
      }

      const response = await fetchWithRetry(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify(body)
      }, {
        operationName: `openai_embedding_${model}`
      });

      if (!response.ok) {
        metrics.increment('embedding_errors');
        const error = await response.text();
        throw new Error(`OpenAI API error: ${response.status} - ${error}`);
      }

      const data = await response.json() as {
        data: Array<{ embedding: number[] }>;
        usage?: { prompt_tokens: number; total_tokens: number };
      };
      const embedding = data.data[0].embedding;

      // Capture token usage from API response (or fallback to estimation)
      const tokensIn = data.usage?.prompt_tokens ?? Math.ceil(text.length / 4);
      metrics.addEmbeddingTokens(tokensIn);

      // Record cost asynchronously (non-blocking)
      const { getCostTrackingService } = require('./cost_tracking_service');
      const { getCorrelationContext } = require('../utils/correlation');
      const costService = getCostTrackingService();
      const context = getCorrelationContext();

      costService.recordCost({
        correlation_id: context?.correlationId || 'unknown',
        signal_id: context?.signalId,
        agent_id: context?.agentId,
        operation: 'embedding',
        provider: 'openai',
        model,
        tokens_input: tokensIn,
        tokens_output: 0,
        cost_usd: costService.calculateCostForEmbedding('openai', model, tokensIn),
        response_time_ms: Date.now() - startTime,
        timestamp: new Date()
      }).catch((err: any) => {
        logger.warn('Cost recording failed (non-blocking)', {
          error: err.message,
          model,
          correlation_id: context?.correlationId
        });
      });

      logger.debug('OpenAI embedding generated', {
        model,
        dimensions: embedding.length,
        tokensIn,
        durationMs: Date.now() - startTime
      });

      return embedding;
    } catch (error: any) {
      metrics.increment('embedding_errors');
      logger.error('OpenAI embedding failed', { error: error.message, model });
      throw error;
    }
  };
}

/**
 * Creates a batch OpenAI embedding provider for efficiency
 */
export function createOpenAIBatchEmbeddingProvider(
  apiKey: string,
  model: string = 'text-embedding-3-large',
  dimensions?: number,
  baseUrl?: string
): BatchEmbeddingProvider {
  if (!apiKey) {
    throw new Error('OpenAI API key is required');
  }

  const apiBase = (baseUrl || 'https://api.openai.com').replace(/\/$/, '');
  const url = `${apiBase}/v1/embeddings`;

  return async (texts: string[]): Promise<number[][]> => {
    if (texts.length === 0) return [];
    
    const startTime = Date.now();
    const metrics = getRunMetrics();
    metrics.increment('embedding_calls');
    
    try {
      const body: any = {
        input: texts,
        model: model
      };
      
      if (dimensions && model.includes('text-embedding-3')) {
        body.dimensions = dimensions;
      }

      const response = await fetchWithRetry(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify(body)
      }, {
        operationName: `openai_embedding_batch_${model}`
      });

      if (!response.ok) {
        metrics.increment('embedding_errors');
        const error = await response.text();
        throw new Error(`OpenAI API error: ${response.status} - ${error}`);
      }

      const data = await response.json() as { data: Array<{ embedding: number[]; index: number }> };
      
      // Sort by index to maintain order
      const sortedData = data.data.sort((a: any, b: any) => a.index - b.index);
      const embeddings = sortedData.map((item: any) => item.embedding);
      
      logger.debug('OpenAI batch embeddings generated', {
        model,
        count: texts.length,
        dimensions: embeddings[0]?.length,
        durationMs: Date.now() - startTime
      });

      return embeddings;
    } catch (error: any) {
      metrics.increment('embedding_errors');
      logger.error('OpenAI batch embedding failed', { error: error.message, model, count: texts.length });
      throw error;
    }
  };
}

/**
 * Creates an Azure OpenAI embedding provider
 */
export function createAzureOpenAIEmbeddingProvider(
  endpoint: string,
  apiKey: string,
  deployment: string = 'text-embedding-ada-002',
  apiVersion: string = '2023-05-15'
): EmbeddingProvider {
  if (!endpoint) {
    throw new Error('Azure OpenAI endpoint is required');
  }
  if (!apiKey) {
    throw new Error('Azure OpenAI API key is required');
  }

  // Build the full URL for embeddings
  // Format: https://{resource}.openai.azure.com/openai/deployments/{deployment}/embeddings?api-version={version}
  const baseEndpoint = endpoint.replace(/\/$/, ''); // Remove trailing slash
  const url = baseEndpoint.includes('/deployments/')
    ? `${baseEndpoint}` // Already has full path
    : `${baseEndpoint}/openai/deployments/${deployment}/embeddings?api-version=${apiVersion}`;

  return async (text: string): Promise<number[]> => {
    const startTime = Date.now();
    const metrics = getRunMetrics();
    metrics.increment('embedding_calls');
    
    try {
      const response = await fetchWithRetry(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'api-key': apiKey
        },
        body: JSON.stringify({
          input: text
        })
      }, {
        operationName: `azure_embedding_${deployment}`
      });

      if (!response.ok) {
        metrics.increment('embedding_errors');
        const error = await response.text();
        throw new Error(`Azure OpenAI API error: ${response.status} - ${error}`);
      }

      const data = await response.json() as { data: Array<{ embedding: number[] }> };
      const embedding = data.data[0].embedding;
      
      logger.debug('Azure OpenAI embedding generated', {
        deployment,
        dimensions: embedding.length,
        durationMs: Date.now() - startTime
      });

      return embedding;
    } catch (error: any) {
      metrics.increment('embedding_errors');
      logger.error('Azure OpenAI embedding failed', { error: error.message, deployment, endpoint });
      throw error;
    }
  };
}

/**
 * Creates a batch Azure OpenAI embedding provider for efficiency
 */
export function createAzureOpenAIBatchEmbeddingProvider(
  endpoint: string,
  apiKey: string,
  deployment: string = 'text-embedding-ada-002',
  apiVersion: string = '2023-05-15'
): BatchEmbeddingProvider {
  if (!endpoint || !apiKey) {
    throw new Error('Azure OpenAI endpoint and API key are required');
  }

  const baseEndpoint = endpoint.replace(/\/$/, '');
  const url = baseEndpoint.includes('/deployments/')
    ? `${baseEndpoint}`
    : `${baseEndpoint}/openai/deployments/${deployment}/embeddings?api-version=${apiVersion}`;

  return async (texts: string[]): Promise<number[][]> => {
    if (texts.length === 0) return [];
    
    const startTime = Date.now();
    const metrics = getRunMetrics();
    metrics.increment('embedding_calls');
    
    try {
      const response = await fetchWithRetry(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'api-key': apiKey
        },
        body: JSON.stringify({
          input: texts
        })
      }, {
        operationName: `azure_embedding_batch_${deployment}`
      });

      if (!response.ok) {
        metrics.increment('embedding_errors');
        const error = await response.text();
        throw new Error(`Azure OpenAI API error: ${response.status} - ${error}`);
      }

      const data = await response.json() as { data: Array<{ embedding: number[]; index: number }> };
      
      // Sort by index to maintain order
      const sortedData = data.data.sort((a: any, b: any) => a.index - b.index);
      const embeddings = sortedData.map((item: any) => item.embedding);
      
      logger.debug('Azure OpenAI batch embeddings generated', {
        deployment,
        count: texts.length,
        dimensions: embeddings[0]?.length,
        durationMs: Date.now() - startTime
      });

      return embeddings;
    } catch (error: any) {
      metrics.increment('embedding_errors');
      logger.error('Azure OpenAI batch embedding failed', { error: error.message, deployment, count: texts.length });
      throw error;
    }
  };
}

/**
 * Creates a Cohere embedding provider
 */
export function createCohereEmbeddingProvider(
  apiKey: string,
  model: string = 'embed-english-v3.0'
): EmbeddingProvider {
  if (!apiKey) {
    throw new Error('Cohere API key is required');
  }

  return async (text: string): Promise<number[]> => {
    const startTime = Date.now();
    const metrics = getRunMetrics();
    metrics.increment('embedding_calls');

    try {
      const response = await fetchWithRetry('https://api.cohere.ai/v1/embed', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          texts: [text],
          model: model,
          input_type: 'search_document'
        })
      }, {
        operationName: `cohere_embedding_${model}`
      });

      if (!response.ok) {
        metrics.increment('embedding_errors');
        const error = await response.text();
        throw new Error(`Cohere API error: ${response.status} - ${error}`);
      }

      const data = await response.json() as { embeddings: number[][] };
      const embedding = data.embeddings[0];

      logger.debug('Cohere embedding generated', {
        model,
        dimensions: embedding.length,
        durationMs: Date.now() - startTime
      });

      return embedding;
    } catch (error: any) {
      metrics.increment('embedding_errors');
      logger.error('Cohere embedding failed', { error: error.message, model });
      throw error;
    }
  };
}

/**
 * Creates a Cursor LLM bridge embedding provider
 * Uses Cursor's built-in LLM capabilities
 */
export function createCursorEmbeddingProvider(
  config?: Partial<EmbeddingProviderConfig>
): EmbeddingProvider {
  const endpoint = config?.endpoint || process.env.CURSOR_EMBEDDING_ENDPOINT;
  const token = config?.apiKey || process.env.CURSOR_EMBEDDING_TOKEN;
  
  return async (text: string): Promise<number[]> => {
    const startTime = Date.now();
    
    try {
      // Try to use Cursor's MCP or extension API
      const cursorEmbed = (global as any).cursorEmbed || (global as any).mcp?.embed;
      
      if (cursorEmbed) {
        const embedding = await cursorEmbed(text);
        logger.debug('Cursor embedding generated', {
          dimensions: embedding.length,
          durationMs: Date.now() - startTime
        });
        return embedding;
      }
      
      // Fallback to HTTP endpoint if available
      if (endpoint) {
        const response = await fetchWithRetry(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { 'Authorization': `Bearer ${token}` } : {})
          },
          body: JSON.stringify({ text })
        }, {
          operationName: 'cursor_embedding_http'
        });

        if (!response.ok) {
          throw new Error(`Cursor embedding API error: ${response.status}`);
        }

        const data = await response.json() as { embedding: number[] };
        return data.embedding;
      }
      
      // If no Cursor embedding available, fall back to mock
      logger.warn('Cursor embedding not available, using mock');
      const mockProvider = createMockEmbeddingProvider(config?.dimensions || 1536);
      return mockProvider(text);
    } catch (error: any) {
      logger.error('Cursor embedding failed', { error: error.message });
      throw error;
    }
  };
}

/**
 * Creates a mock embedding provider for testing
 * Generates deterministic embeddings based on text hash
 */
export function createMockEmbeddingProvider(dimensions: number = 384): EmbeddingProvider {
  return async (text: string): Promise<number[]> => {
    // Generate deterministic embedding based on text hash
    const embedding: number[] = [];
    let hash = 0;
    
    for (let i = 0; i < text.length; i++) {
      hash = ((hash << 5) - hash) + text.charCodeAt(i);
      hash = hash & hash; // Convert to 32bit integer
    }
    
    // Use hash as seed for pseudo-random but deterministic values
    for (let i = 0; i < dimensions; i++) {
      const seed = hash + i * 31;
      const value = Math.sin(seed) * 0.5 + 0.5; // Normalize to 0-1
      embedding.push((value - 0.5) * 2); // Normalize to -1 to 1
    }
    
    // Normalize to unit vector
    const magnitude = Math.sqrt(embedding.reduce((sum, val) => sum + val * val, 0));
    const normalized = embedding.map(val => val / magnitude);
    
    // Simulate processing delay
    await new Promise(resolve => setTimeout(resolve, 10));
    
    logger.debug('Mock embedding generated', { dimensions, textLength: text.length });
    
    return normalized;
  };
}

/**
 * Creates an embedding provider from environment variables
 */
export function createEmbeddingProviderFromEnv(): EmbeddingProvider {
  const provider = (process.env.EMBEDDING_PROVIDER || 'mock') as EmbeddingProviderConfig['provider'];
  const model = process.env.EMBEDDING_MODEL;
  const dimensions = process.env.EMBEDDING_DIMENSIONS ? parseInt(process.env.EMBEDDING_DIMENSIONS) : undefined;
  const azureApiKey = process.env.AZURE_OPENAI_API_KEY || process.env.AZURE_OPENAI_KEY;
  
  // Determine API key based on provider
  let apiKey: string | undefined;
  if (provider === 'azure_openai') {
    apiKey = azureApiKey;
  } else if (provider === 'openai') {
    apiKey = process.env.OPENAI_API_KEY;
  } else if (provider === 'cohere') {
    apiKey = process.env.COHERE_API_KEY;
  }
  
  return createEmbeddingProvider({
    provider,
    model,
    dimensions,
    apiKey,
    endpoint: process.env.AZURE_OPENAI_ENDPOINT,
    deployment: process.env.AZURE_OPENAI_EMBEDDINGS_DEPLOYMENT,
    apiVersion: process.env.AZURE_OPENAI_EMBEDDINGS_API_VERSION
  });
}

/**
 * Utility: Calculate cosine similarity between two embeddings
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error('Embeddings must have the same dimensions');
  }
  
  let dotProduct = 0;
  let magnitudeA = 0;
  let magnitudeB = 0;
  
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    magnitudeA += a[i] * a[i];
    magnitudeB += b[i] * b[i];
  }
  
  const magnitude = Math.sqrt(magnitudeA) * Math.sqrt(magnitudeB);
  
  if (magnitude === 0) return 0;
  
  return dotProduct / magnitude;
}
