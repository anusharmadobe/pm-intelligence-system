/**
 * LLM Service - Only used in Judgment and Artifact layers.
 * Supports Azure OpenAI, OpenAI, ChatGPT Enterprise (via OpenAI-compatible endpoint), or mock.
 * 
 * Constraints:
 * - Do NOT recommend decisions
 * - Clearly label assumptions
 * - No LLM memory persistence
 */

import { logger } from '../utils/logger';
import { fetchWithRetry } from '../utils/network_retry';
import { getRunMetrics } from '../utils/run_metrics';

export interface LLMResponse {
  content: string;
  assumptions?: string[];
  missing_evidence?: string[];
}

export type LLMProvider = (prompt: string) => Promise<string>;

/**
 * LLM Provider configuration
 */
export interface LLMProviderConfig {
  provider: 'openai' | 'azure_openai' | 'chatgpt_enterprise' | 'anthropic' | 'cursor' | 'mock';
  model?: string;
  apiKey?: string;
  endpoint?: string;
  deployment?: string;
  apiVersion?: string;
  temperature?: number;
  maxTokens?: number;
}

/**
 * Creates an Azure OpenAI LLM provider
 */
export function createAzureOpenAIProvider(
  endpoint: string,
  apiKey: string,
  deployment: string,
  apiVersion: string = '2024-08-01-preview',
  options: { temperature?: number; maxTokens?: number } = {}
): LLMProvider {
  if (!endpoint) {
    throw new Error('Azure OpenAI endpoint is required');
  }
  if (!apiKey) {
    throw new Error('Azure OpenAI API key is required');
  }
  if (!deployment) {
    throw new Error('Azure OpenAI deployment is required');
  }

  const { temperature = 0.7, maxTokens = 4096 } = options;

  // Build the full URL for chat completions
  const baseEndpoint = endpoint.replace(/\/$/, '');
  const url = `${baseEndpoint}/openai/deployments/${deployment}/chat/completions?api-version=${apiVersion}`;

  return async (prompt: string): Promise<string> => {
    const startTime = Date.now();
    const metrics = getRunMetrics();
    metrics.increment('llm_calls');
    
    try {
      const response = await fetchWithRetry(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'api-key': apiKey
        },
        body: JSON.stringify({
          messages: [
            { role: 'user', content: prompt }
          ],
          temperature,
          max_tokens: maxTokens
        })
      }, {
        operationName: `azure_chat_${deployment}`
      });

      if (!response.ok) {
        if (response.status === 429) {
          metrics.increment('llm_429s');
        }
        metrics.increment('llm_errors');
        const error = await response.text();
        throw new Error(`Azure OpenAI API error: ${response.status} - ${error}`);
      }

      const data = await response.json() as {
        choices: Array<{ message?: { content?: string } }>;
        usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
      };
      const content = data.choices[0]?.message?.content || '';

      // Capture actual token usage from API response (or fallback to estimation)
      const tokensIn = data.usage?.prompt_tokens ?? Math.ceil(prompt.length / 4);
      const tokensOut = data.usage?.completion_tokens ?? Math.ceil(content.length / 4);
      metrics.addTokenUsage(tokensIn, tokensOut);

      // Record cost asynchronously (non-blocking)
      const { getCostTrackingService } = require('./cost_tracking_service');
      const { getCorrelationContext } = require('../utils/correlation');
      const costService = getCostTrackingService();
      const context = getCorrelationContext();

      costService.recordCost({
        correlation_id: context?.correlationId || 'unknown',
        signal_id: context?.signalId,
        agent_id: context?.agentId,
        operation: 'llm_chat',
        provider: 'azure_openai',
        model: deployment,
        tokens_input: tokensIn,
        tokens_output: tokensOut,
        cost_usd: costService.calculateCostForLLM('azure_openai', deployment, tokensIn, tokensOut),
        response_time_ms: Date.now() - startTime,
        timestamp: new Date()
      }).catch((err: any) => {
        logger.warn('Cost recording failed (non-blocking)', {
          error: err.message,
          deployment,
          correlation_id: context?.correlationId
        });
      });

      logger.debug('Azure OpenAI LLM response', {
        deployment,
        promptLength: prompt.length,
        responseLength: content.length,
        tokensIn,
        tokensOut,
        durationMs: Date.now() - startTime
      });

      return content;
    } catch (error: any) {
      metrics.increment('llm_errors');
      logger.error('Azure OpenAI LLM failed', { error: error.message, deployment });
      throw error;
    }
  };
}

/**
 * Creates an OpenAI LLM provider
 */
export function createOpenAIProvider(
  apiKey: string,
  model: string = 'gpt-4o',
  options: { temperature?: number; maxTokens?: number } = {},
  baseUrl?: string
): LLMProvider {
  if (!apiKey) {
    throw new Error('OpenAI API key is required');
  }

  const { temperature = 0.7, maxTokens = 4096 } = options;
  const apiBase = (baseUrl || 'https://api.openai.com').replace(/\/$/, '');
  const url = `${apiBase}/v1/chat/completions`;

  return async (prompt: string): Promise<string> => {
    const startTime = Date.now();
    const metrics = getRunMetrics();
    metrics.increment('llm_calls');
    
    try {
      const response = await fetchWithRetry(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'user', content: prompt }
          ],
          temperature,
          max_tokens: maxTokens
        })
      }, {
        operationName: `openai_chat_${model}`
      });

      if (!response.ok) {
        if (response.status === 429) {
          metrics.increment('llm_429s');
        }
        metrics.increment('llm_errors');
        const error = await response.text();
        throw new Error(`OpenAI API error: ${response.status} - ${error}`);
      }

      const data = await response.json() as {
        choices: Array<{ message?: { content?: string } }>;
        usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
      };
      const content = data.choices[0]?.message?.content || '';

      // Capture actual token usage from API response (or fallback to estimation)
      const tokensIn = data.usage?.prompt_tokens ?? Math.ceil(prompt.length / 4);
      const tokensOut = data.usage?.completion_tokens ?? Math.ceil(content.length / 4);
      metrics.addTokenUsage(tokensIn, tokensOut);

      // Record cost asynchronously (non-blocking)
      const { getCostTrackingService } = require('./cost_tracking_service');
      const { getCorrelationContext } = require('../utils/correlation');
      const costService = getCostTrackingService();
      const context = getCorrelationContext();

      costService.recordCost({
        correlation_id: context?.correlationId || 'unknown',
        signal_id: context?.signalId,
        agent_id: context?.agentId,
        operation: 'llm_chat',
        provider: 'openai',
        model,
        tokens_input: tokensIn,
        tokens_output: tokensOut,
        cost_usd: costService.calculateCostForLLM('openai', model, tokensIn, tokensOut),
        response_time_ms: Date.now() - startTime,
        timestamp: new Date()
      }).catch((err: any) => {
        logger.warn('Cost recording failed (non-blocking)', {
          error: err.message,
          model,
          correlation_id: context?.correlationId
        });
      });

      logger.debug('OpenAI LLM response', {
        model,
        promptLength: prompt.length,
        responseLength: content.length,
        tokensIn,
        tokensOut,
        durationMs: Date.now() - startTime
      });

      return content;
    } catch (error: any) {
      metrics.increment('llm_errors');
      logger.error('OpenAI LLM failed', { error: error.message, model });
      throw error;
    }
  };
}

/**
 * Creates a mock LLM provider for testing
 */
export function createMockLLMProvider(mockResponse?: string): LLMProvider {
  return async (prompt: string): Promise<string> => {
    // Simulate processing delay
    await new Promise(resolve => setTimeout(resolve, 50));
    
    if (mockResponse) {
      return mockResponse;
    }
    
    // Generate a simple mock response based on the prompt
    if (prompt.includes('JSON')) {
      return JSON.stringify({
        content: 'Mock analysis of the provided signals',
        assumptions: ['This is a mock assumption'],
        missing_evidence: ['This is mock missing evidence']
      });
    }
    
    return `Mock LLM response for prompt of length ${prompt.length}`;
  };
}

/**
 * Creates an LLM provider from environment variables
 */
export function validateLLMProviderEnv(): void {
  const provider = process.env.LLM_PROVIDER || 'mock';
  const azureApiKey = process.env.AZURE_OPENAI_API_KEY || process.env.AZURE_OPENAI_KEY;
  if (provider === 'mock') return;

  switch (provider) {
    case 'chatgpt_enterprise': {
      const apiKey = process.env.CHATGPT_ENTERPRISE_API_KEY || process.env.OPENAI_API_KEY;
      if (!apiKey) {
        throw new Error('CHATGPT_ENTERPRISE_API_KEY (or OPENAI_API_KEY) is required for chatgpt_enterprise');
      }
      return;
    }
    case 'azure_openai': {
      if (!process.env.AZURE_OPENAI_ENDPOINT || !azureApiKey) {
        throw new Error('AZURE_OPENAI_ENDPOINT and AZURE_OPENAI_API_KEY are required for azure_openai');
      }
      return;
    }
    case 'openai': {
      if (!process.env.OPENAI_API_KEY) {
        throw new Error('OPENAI_API_KEY is required for openai');
      }
      return;
    }
    default:
      return;
  }
}

export function createLLMProviderFromEnv(): LLMProvider {
  const provider = process.env.LLM_PROVIDER || 'mock';
  const azureApiKey = process.env.AZURE_OPENAI_API_KEY || process.env.AZURE_OPENAI_KEY;

  if (process.env.NODE_ENV === 'production') {
    validateLLMProviderEnv();
  }
  
  switch (provider) {
    case 'chatgpt_enterprise':
      return createOpenAIProvider(
        process.env.CHATGPT_ENTERPRISE_API_KEY || process.env.OPENAI_API_KEY || '',
        process.env.CHATGPT_ENTERPRISE_MODEL || process.env.OPENAI_MODEL || 'gpt-4o',
        {
          temperature: process.env.LLM_TEMPERATURE ? parseFloat(process.env.LLM_TEMPERATURE) : undefined,
          maxTokens: process.env.LLM_MAX_TOKENS ? parseInt(process.env.LLM_MAX_TOKENS) : undefined
        },
        process.env.CHATGPT_ENTERPRISE_BASE_URL || process.env.OPENAI_BASE_URL
      );
    case 'azure_openai':
      return createAzureOpenAIProvider(
        process.env.AZURE_OPENAI_ENDPOINT || '',
        azureApiKey || '',
        process.env.AZURE_OPENAI_CHAT_DEPLOYMENT || 'gpt-4o',
        process.env.AZURE_OPENAI_CHAT_API_VERSION || '2024-08-01-preview',
        {
          temperature: process.env.LLM_TEMPERATURE ? parseFloat(process.env.LLM_TEMPERATURE) : undefined,
          maxTokens: process.env.LLM_MAX_TOKENS ? parseInt(process.env.LLM_MAX_TOKENS) : undefined
        }
      );
    
    case 'openai':
      return createOpenAIProvider(
        process.env.OPENAI_API_KEY || '',
        process.env.OPENAI_MODEL || 'gpt-4o',
        {
          temperature: process.env.LLM_TEMPERATURE ? parseFloat(process.env.LLM_TEMPERATURE) : undefined,
          maxTokens: process.env.LLM_MAX_TOKENS ? parseInt(process.env.LLM_MAX_TOKENS) : undefined
        },
        process.env.OPENAI_BASE_URL
      );
    
    case 'mock':
    default:
      logger.info('Using mock LLM provider');
      return createMockLLMProvider();
  }
}

/**
 * OPPORTUNITY_SYNTHESIS prompt contract.
 * Input: signals[], opportunity, llmProvider
 * Output: structured reasoning, assumptions, missing evidence
 * Constraint: Do NOT recommend decisions
 */
export async function synthesizeOpportunity(
  signals: any[],
  opportunity: any,
  llmProvider: LLMProvider
): Promise<LLMResponse> {
  logger.info('Synthesizing opportunity with LLM', { 
    opportunityId: opportunity.id,
    signalCount: signals.length 
  });
  
  const prompt = buildOpportunitySynthesisPrompt(signals, opportunity);
  
  logger.debug('LLM prompt generated', { 
    promptLength: prompt.length,
    opportunityId: opportunity.id 
  });
  
  // Use Cursor's built-in LLM via provider
  const startTime = Date.now();
  const llmResponse = await llmProvider(prompt);
  const duration = Date.now() - startTime;
  
  logger.info('LLM response received', { 
    opportunityId: opportunity.id,
    responseLength: llmResponse.length,
    durationMs: duration
  });
  
  // Parse structured response
  const parsed = parseOpportunitySynthesisResponse(llmResponse, signals, opportunity);
  
  logger.debug('Opportunity synthesis parsed', {
    opportunityId: opportunity.id,
    assumptionsCount: parsed.assumptions?.length || 0,
    missingEvidenceCount: parsed.missing_evidence?.length || 0
  });
  
  return parsed;
}

/**
 * ARTIFACT_DRAFT prompt contract.
 * Input: judgment, artifactType, llmProvider
 * Output: draft PRD / RFC
 * Constraint: Clearly label assumptions
 */
export async function draftArtifact(
  judgment: any,
  artifactType: 'PRD' | 'RFC',
  llmProvider: LLMProvider
): Promise<string> {
  logger.info('Drafting artifact with LLM', { 
    judgmentId: judgment.id,
    artifactType 
  });
  
  const prompt = buildArtifactDraftPrompt(judgment, artifactType);
  
  logger.debug('Artifact draft prompt generated', { 
    promptLength: prompt.length,
    judgmentId: judgment.id,
    artifactType 
  });
  
  // Use Cursor's built-in LLM via provider
  const startTime = Date.now();
  const draftContent = await llmProvider(prompt);
  const duration = Date.now() - startTime;
  
  logger.info('Artifact draft generated', { 
    judgmentId: judgment.id,
    artifactType,
    contentLength: draftContent.length,
    durationMs: duration
  });
  
  return draftContent;
}

function buildOpportunitySynthesisPrompt(signals: any[], opportunity: any): string {
  return `Analyze the following opportunity and its related signals.

Opportunity: ${opportunity.title}
Description: ${opportunity.description}

Signals (${signals.length} total):
${signals.map((s, i) => `${i + 1}. [${s.source}] ${s.content}`).join('\n')}

Provide a structured analysis in the following JSON format:
{
  "content": "Structured reasoning about patterns and themes observed across the signals",
  "assumptions": ["List of explicit assumptions made in the analysis"],
  "missing_evidence": ["List of missing evidence that would strengthen the analysis"]
}

IMPORTANT: 
- Do NOT recommend decisions or priorities. Only provide analysis.
- Return valid JSON only, no markdown formatting.
- Be specific about assumptions and missing evidence.`;
}

function buildArtifactDraftPrompt(judgment: any, artifactType: string): string {
  const assumptions = typeof judgment.assumptions === 'object' && judgment.assumptions.items 
    ? judgment.assumptions.items 
    : [];
  const missingEvidence = typeof judgment.missing_evidence === 'object' && judgment.missing_evidence.items
    ? judgment.missing_evidence.items
    : [];

  return `Create a ${artifactType} draft based on the following judgment.

Judgment Summary: ${judgment.summary}
Assumptions: ${JSON.stringify(assumptions)}
Missing Evidence: ${JSON.stringify(missingEvidence)}
Confidence Level: ${judgment.confidence_level}

Requirements:
1. Create a complete ${artifactType} draft
2. Clearly label ALL assumptions in a dedicated "Assumptions" section
3. Include the judgment summary and analysis
4. Note any missing evidence that should be gathered
5. Use proper ${artifactType} structure and formatting

IMPORTANT: Clearly label all assumptions in the document.`;
}

function parseOpportunitySynthesisResponse(
  response: string,
  signals: any[],
  opportunity: any
): LLMResponse {
  try {
    // Try to parse JSON response
    const cleaned = response.trim();
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        content: parsed.content || response,
        assumptions: Array.isArray(parsed.assumptions) ? parsed.assumptions : [],
        missing_evidence: Array.isArray(parsed.missing_evidence) ? parsed.missing_evidence : []
      };
    }
  } catch (error) {
    // Fallback: extract assumptions and missing evidence from text
  }

  // Fallback parsing if JSON parsing fails
  const assumptionsMatch = response.match(/assumptions?[:\-]\s*\[?([^\]]+)\]?/i);
  const missingMatch = response.match(/missing[_\s]evidence[:\-]\s*\[?([^\]]+)\]?/i);

  return {
    content: response,
    assumptions: assumptionsMatch 
      ? assumptionsMatch[1].split(',').map(a => a.trim().replace(/['"]/g, ''))
      : [],
    missing_evidence: missingMatch
      ? missingMatch[1].split(',').map(e => e.trim().replace(/['"]/g, ''))
      : []
  };
}
