/**
 * Model Pricing Configuration
 *
 * Centralized pricing tables for LLM and embedding models.
 * Prices are per 1,000 tokens (input and output).
 *
 * Update this file when pricing changes - all cost calculations
 * use these values as the source of truth.
 */

export interface ModelPricing {
  model: string;
  provider: 'openai' | 'azure_openai' | 'cohere' | 'cursor';
  input_cost_per_1k: number;   // Cost per 1,000 input tokens in USD
  output_cost_per_1k: number;  // Cost per 1,000 output tokens in USD (0 for embeddings)
  effective_from: string;      // Date when pricing took effect (YYYY-MM-DD)
}

/**
 * Pricing table for all supported models
 * Based on OpenAI/Azure pricing as of January 2025
 */
export const PRICING_TABLE: ModelPricing[] = [
  // OpenAI LLM Models
  {
    model: 'gpt-4o',
    provider: 'openai',
    input_cost_per_1k: 0.0025,
    output_cost_per_1k: 0.01,
    effective_from: '2024-08-01'
  },
  {
    model: 'gpt-4o-mini',
    provider: 'openai',
    input_cost_per_1k: 0.00015,
    output_cost_per_1k: 0.0006,
    effective_from: '2024-07-01'
  },
  {
    model: 'gpt-4-turbo',
    provider: 'openai',
    input_cost_per_1k: 0.01,
    output_cost_per_1k: 0.03,
    effective_from: '2024-04-01'
  },
  {
    model: 'gpt-4',
    provider: 'openai',
    input_cost_per_1k: 0.03,
    output_cost_per_1k: 0.06,
    effective_from: '2023-03-01'
  },

  // Azure OpenAI LLM Models (same pricing as OpenAI)
  {
    model: 'gpt-4o',
    provider: 'azure_openai',
    input_cost_per_1k: 0.0025,
    output_cost_per_1k: 0.01,
    effective_from: '2024-08-01'
  },
  {
    model: 'gpt-4o-mini',
    provider: 'azure_openai',
    input_cost_per_1k: 0.00015,
    output_cost_per_1k: 0.0006,
    effective_from: '2024-07-01'
  },
  {
    model: 'gpt-4-turbo',
    provider: 'azure_openai',
    input_cost_per_1k: 0.01,
    output_cost_per_1k: 0.03,
    effective_from: '2024-04-01'
  },
  {
    model: 'gpt-4',
    provider: 'azure_openai',
    input_cost_per_1k: 0.03,
    output_cost_per_1k: 0.06,
    effective_from: '2023-03-01'
  },

  // OpenAI Embedding Models
  {
    model: 'text-embedding-3-large',
    provider: 'openai',
    input_cost_per_1k: 0.00013,
    output_cost_per_1k: 0,
    effective_from: '2024-01-25'
  },
  {
    model: 'text-embedding-3-small',
    provider: 'openai',
    input_cost_per_1k: 0.00002,
    output_cost_per_1k: 0,
    effective_from: '2024-01-25'
  },
  {
    model: 'text-embedding-ada-002',
    provider: 'openai',
    input_cost_per_1k: 0.0001,
    output_cost_per_1k: 0,
    effective_from: '2022-12-01'
  },

  // Azure OpenAI Embedding Models
  {
    model: 'text-embedding-3-large',
    provider: 'azure_openai',
    input_cost_per_1k: 0.00013,
    output_cost_per_1k: 0,
    effective_from: '2024-01-25'
  },
  {
    model: 'text-embedding-ada-002',
    provider: 'azure_openai',
    input_cost_per_1k: 0.0001,
    output_cost_per_1k: 0,
    effective_from: '2022-12-01'
  },

  // Cohere Embedding Models
  {
    model: 'embed-english-v3.0',
    provider: 'cohere',
    input_cost_per_1k: 0.0001,
    output_cost_per_1k: 0,
    effective_from: '2023-11-01'
  },
  {
    model: 'embed-multilingual-v3.0',
    provider: 'cohere',
    input_cost_per_1k: 0.0001,
    output_cost_per_1k: 0,
    effective_from: '2023-11-01'
  }
];

/**
 * Pricing tiers for different environments
 * Development tier uses zero costs for testing
 */
export type PricingTier = 'development' | 'production';

/**
 * Get the active pricing tier from environment
 * Defaults to production
 */
export function getPricingTier(): PricingTier {
  const tier = process.env.COST_TRACKING_TIER || 'production';
  return tier === 'development' ? 'development' : 'production';
}

/**
 * Find pricing for a specific model and provider
 * Returns undefined if no pricing found
 */
export function findPricing(
  provider: string,
  model: string
): ModelPricing | undefined {
  return PRICING_TABLE.find(
    p => p.provider === provider && p.model === model
  );
}

/**
 * Calculate cost for LLM usage
 * Returns cost in USD
 *
 * @param provider - Provider name (openai, azure_openai, etc.)
 * @param model - Model name (gpt-4o, gpt-4o-mini, etc.)
 * @param inputTokens - Number of input tokens
 * @param outputTokens - Number of output tokens
 * @returns Cost in USD
 */
export function calculateLLMCost(
  provider: string,
  model: string,
  inputTokens: number,
  outputTokens: number
): number {
  // Return zero cost in development tier
  if (getPricingTier() === 'development') {
    return 0;
  }

  const pricing = findPricing(provider, model);

  // If no pricing found, log warning and return 0
  if (!pricing) {
    console.warn(`No pricing found for provider=${provider}, model=${model}`);
    return 0;
  }

  const inputCost = (inputTokens / 1000) * pricing.input_cost_per_1k;
  const outputCost = (outputTokens / 1000) * pricing.output_cost_per_1k;

  return inputCost + outputCost;
}

/**
 * Calculate cost for embedding generation
 * Returns cost in USD
 *
 * @param provider - Provider name (openai, azure_openai, cohere, etc.)
 * @param model - Model name (text-embedding-3-large, etc.)
 * @param inputTokens - Number of input tokens
 * @returns Cost in USD
 */
export function calculateEmbeddingCost(
  provider: string,
  model: string,
  inputTokens: number
): number {
  // Return zero cost in development tier
  if (getPricingTier() === 'development') {
    return 0;
  }

  const pricing = findPricing(provider, model);

  // If no pricing found, log warning and return 0
  if (!pricing) {
    console.warn(`No pricing found for provider=${provider}, model=${model}`);
    return 0;
  }

  const inputCost = (inputTokens / 1000) * pricing.input_cost_per_1k;

  return inputCost;
}

/**
 * Get all available models for a provider
 */
export function getModelsForProvider(provider: string): string[] {
  return PRICING_TABLE
    .filter(p => p.provider === provider)
    .map(p => p.model);
}

/**
 * Get all supported providers
 */
export function getSupportedProviders(): string[] {
  return Array.from(new Set(PRICING_TABLE.map(p => p.provider)));
}
