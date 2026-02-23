import { z } from 'zod';
import { config } from '../config/env';
import { logger } from '../utils/logger';
import { createAzureOpenAIProvider, createLLMProviderFromEnv, LLMProvider } from './llm_service';
import { parsePositiveInt } from '../utils/env_parsing';

const DEFAULT_BATCH_CONCURRENCY = 5;
const DEFAULT_BATCH_ITEM_TIMEOUT_MS = 30000;
const DEFAULT_BATCH_TIMEOUT_MS = 300000;
const MIN_BATCH_TIMEOUT_MS = 1000;
const SIGNAL_CATEGORIES = [
  'community_forum_ux',
  'product_bug',
  'feature_request',
  'documentation_gap',
  'configuration_issue',
  'integration_issue',
  'licensing_portal'
] as const;
const LEGACY_SIGNAL_CATEGORIES = ['product_issue'] as const;

const ExtractionSchema = z.object({
  entities: z.object({
    customers: z.array(z.string()).default([]),
    features: z.array(z.string()).default([]),
    issues: z.array(z.string()).default([]),
    themes: z.array(z.string()).default([]),
    stakeholders: z.array(z.string()).optional().default([])
  }),
  relationships: z
    .array(
      z.object({
        from: z.string(),
        to: z.string(),
        type: z.string()
      })
    )
    .default([]),
  sentiment: z.string().optional(),
  urgency: z.string().optional(),
  summary: z.string().optional(),
  signal_category: z.enum([...SIGNAL_CATEGORIES, ...LEGACY_SIGNAL_CATEGORIES]).optional()
});

export type ExtractionOutput = z.infer<typeof ExtractionSchema>;

export class LLMExtractionService {
  private fastProvider: LLMProvider;
  private slowProvider: LLMProvider;

  constructor() {
    const azureApiKey = process.env.AZURE_OPENAI_API_KEY || process.env.AZURE_OPENAI_KEY;
    // Fast provider uses Azure OpenAI fast deployment when configured, otherwise env provider
    if (process.env.AZURE_OPENAI_ENDPOINT && azureApiKey) {
      this.fastProvider = createAzureOpenAIProvider(
        process.env.AZURE_OPENAI_ENDPOINT,
        azureApiKey,
        config.llm.fastDeployment,
        process.env.AZURE_OPENAI_CHAT_API_VERSION || '2024-08-01-preview',
        { temperature: config.llm.fastTemperature, maxTokens: config.llm.fastMaxTokens }
      );
    } else {
      this.fastProvider = createLLMProviderFromEnv();
    }
    this.slowProvider = createLLMProviderFromEnv();
  }

  private buildPrompt(content: string): string {
    return [
      'Extract structured entities and relationships from the following signal.',
      'Return JSON with this schema:',
      JSON.stringify(
        {
          entities: {
            customers: ['string'],
            features: ['string'],
            issues: ['string'],
            themes: ['string'],
            stakeholders: ['string']
          },
          relationships: [{ from: 'string', to: 'string', type: 'string' }],
          sentiment: 'string',
          urgency: 'string',
          summary: 'string',
          signal_category: SIGNAL_CATEGORIES.join('|')
        },
        null,
        2
      ),
      '',
      'Classify the signal as one of:',
      '- community_forum_ux: forum process, moderation, discoverability, or community experience issue',
      '- product_bug: product defect, broken workflow, or reliability issue',
      '- feature_request: missing capability or enhancement request for the product',
      '- documentation_gap: missing, unclear, or inaccurate product documentation',
      '- configuration_issue: setup, environment, permission, or configuration blockers',
      '- integration_issue: interoperability problems across systems/APIs/connectors',
      '- licensing_portal: licensing, entitlement, subscription, or account portal issue',
      '',
      'Signal:',
      content
    ].join('\n');
  }

  private normalizeSignalCategory(output: ExtractionOutput): ExtractionOutput {
    if (output.signal_category === 'product_issue') {
      return {
        ...output,
        signal_category: 'product_bug'
      };
    }
    return output;
  }

  private parseJson(text: string): ExtractionOutput | null {
    try {
      const trimmed = text.trim();
      const start = trimmed.indexOf('{');
      const end = trimmed.lastIndexOf('}');
      if (start === -1 || end === -1) return null;
      const jsonText = trimmed.slice(start, end + 1);
      const parsed = JSON.parse(jsonText);
      return this.normalizeSignalCategory(ExtractionSchema.parse(parsed));
    } catch (error) {
      logger.warn('LLM extraction JSON parse failed', { error });
      return null;
    }
  }

  private hallucinationFilter(content: string, output: ExtractionOutput): ExtractionOutput {
    if (!config.featureFlags.hallucinationGuard) return output;
    const haystack = content.toLowerCase();
    const filterList = (items: string[]) =>
      items.filter((item) => haystack.includes(item.toLowerCase()));

    return {
      ...output,
      entities: {
        customers: filterList(output.entities.customers || []),
        features: filterList(output.entities.features || []),
        issues: filterList(output.entities.issues || []),
        themes: filterList(output.entities.themes || []),
        stakeholders: filterList(output.entities.stakeholders || [])
      }
    };
  }

  private heuristicExtract(content: string): ExtractionOutput {
    const customers = new Set<string>();
    const features = new Set<string>();
    const issues = new Set<string>();

    const customerRegex = /([A-Z][A-Za-z0-9]+(?:\s+(?:Corp(?:oration)?|Inc|LLC|Ltd)))/g;
    const featureRegex = /feature\s+([A-Z][A-Za-z0-9_-]+)/gi;
    const featurePrefixRegex = /\bFeature[A-Za-z0-9_-]+\b/g;
    const issueRegex = /(?:bug|issue|problem)\s+(?:with\s+)?([A-Za-z0-9_-]+)/gi;

    let match: RegExpExecArray | null;
    while ((match = customerRegex.exec(content)) !== null) {
      customers.add(match[1]);
    }
    while ((match = featureRegex.exec(content)) !== null) {
      features.add(match[1]);
    }
    while ((match = featurePrefixRegex.exec(content)) !== null) {
      features.add(match[0]);
    }
    while ((match = issueRegex.exec(content)) !== null) {
      issues.add(match[1]);
    }

    return {
      entities: {
        customers: Array.from(customers),
        features: Array.from(features),
        issues: Array.from(issues),
        themes: [],
        stakeholders: []
      },
      relationships: [],
      summary: '',
      signal_category: 'product_bug'
    };
  }

  async extract(content: string): Promise<ExtractionOutput> {
    const startTime = Date.now();
    const contentPreview = content.slice(0, 100);

    logger.debug('LLM extraction start', {
      stage: 'llm_extraction',
      status: 'start',
      contentLength: content.length,
      contentPreview
    });

    const prompt = this.buildPrompt(content);
    const fastResponse = await this.fastProvider(prompt);
    let extraction = this.parseJson(fastResponse);

    const needsSecondPass =
      config.featureFlags.twoPassLlm &&
      (content.length > 800 ||
        (extraction &&
          (extraction.entities.customers.length +
            extraction.entities.features.length +
            extraction.entities.issues.length) > 3));

    if (needsSecondPass) {
      logger.debug('LLM extraction second pass triggered', {
        stage: 'llm_extraction',
        status: 'second_pass',
        reason: content.length > 800 ? 'long_content' : 'high_entity_count',
        contentLength: content.length,
        firstPassEntityCount: extraction ?
          extraction.entities.customers.length + extraction.entities.features.length + extraction.entities.issues.length : 0
      });

      const slowResponse = await this.slowProvider(prompt);
      extraction = this.parseJson(slowResponse) || extraction;
    }

    const safeOutput =
      extraction ||
      ExtractionSchema.parse(this.heuristicExtract(content));

    const filtered = this.hallucinationFilter(content, safeOutput);

    const entitiesRemoved = config.featureFlags.hallucinationGuard ? {
      customers: (safeOutput.entities.customers?.length || 0) - (filtered.entities.customers?.length || 0),
      features: (safeOutput.entities.features?.length || 0) - (filtered.entities.features?.length || 0),
      issues: (safeOutput.entities.issues?.length || 0) - (filtered.entities.issues?.length || 0),
      themes: (safeOutput.entities.themes?.length || 0) - (filtered.entities.themes?.length || 0),
      stakeholders: (safeOutput.entities.stakeholders?.length || 0) - (filtered.entities.stakeholders?.length || 0)
    } : null;

    logger.info('LLM extraction complete', {
      stage: 'llm_extraction',
      status: 'success',
      elapsedMs: Date.now() - startTime,
      extractionMethod: extraction ? 'llm' : 'heuristic',
      usedSecondPass: needsSecondPass,
      entities: {
        customers: filtered.entities.customers?.length || 0,
        features: filtered.entities.features?.length || 0,
        issues: filtered.entities.issues?.length || 0,
        themes: filtered.entities.themes?.length || 0,
        stakeholders: filtered.entities.stakeholders?.length || 0
      },
      relationships: filtered.relationships?.length || 0,
      sentiment: filtered.sentiment,
      urgency: filtered.urgency,
      signalCategory: filtered.signal_category,
      hallucinationFilterApplied: config.featureFlags.hallucinationGuard,
      entitiesRemovedByFilter: entitiesRemoved
    });

    return filtered;
  }

  async extractBatch(contents: string[]): Promise<ExtractionOutput[]> {
    if (contents.length === 0) {
      return [];
    }

    const startTime = Date.now();
    const concurrency = Math.max(
      1,
      parsePositiveInt(process.env.LLM_EXTRACTION_BATCH_CONCURRENCY, DEFAULT_BATCH_CONCURRENCY)
    );
    const itemTimeoutMs = Math.max(
      MIN_BATCH_TIMEOUT_MS,
      parsePositiveInt(process.env.LLM_EXTRACTION_TIMEOUT_MS, DEFAULT_BATCH_ITEM_TIMEOUT_MS)
    );
    const batchTimeoutMs = Math.max(
      itemTimeoutMs,
      parsePositiveInt(process.env.LLM_EXTRACTION_BATCH_TIMEOUT_MS, DEFAULT_BATCH_TIMEOUT_MS)
    );

    logger.info('LLM batch extraction start', {
      stage: 'llm_batch_extraction',
      status: 'start',
      batchSize: contents.length,
      concurrency,
      itemTimeoutMs,
      batchTimeoutMs
    });

    const results: Array<ExtractionOutput | undefined> = new Array(contents.length);
    let index = 0;
    let successCount = 0;
    let failureCount = 0;
    let fallbackCount = 0;
    let timedOutCount = 0;
    let batchTimedOut = false;

    const workers = Array.from({ length: Math.min(concurrency, contents.length) }).map(async () => {
      while (!batchTimedOut && index < contents.length) {
        const current = index;
        index += 1;
        let timeoutHandle: NodeJS.Timeout | null = null;
        try {
          const timeoutPromise = new Promise<ExtractionOutput>((_, reject) => {
            timeoutHandle = setTimeout(() => {
              reject(new Error(`LLM batch extraction item timeout after ${itemTimeoutMs}ms`));
            }, itemTimeoutMs);
          });
          results[current] = await Promise.race([this.extract(contents[current]), timeoutPromise]);
          successCount++;
        } catch (error) {
          failureCount++;
          fallbackCount++;
          const errorMessage = error instanceof Error ? error.message : String(error);
          const errorClass = error instanceof Error ? error.name : 'Error';
          const isTimeout = errorMessage.toLowerCase().includes('timeout');
          if (isTimeout) {
            timedOutCount++;
          }
          logger.warn('Batch extraction item failed, using heuristic fallback', {
            stage: 'llm_batch_extraction',
            status: 'degraded',
            itemIndex: current,
            errorClass,
            errorMessage,
            isTimeout,
            fallback: 'heuristic'
          });
          results[current] = this.heuristicExtract(contents[current]);
        } finally {
          if (timeoutHandle) {
            clearTimeout(timeoutHandle);
          }
        }
      }
    });

    const batchResult = await Promise.race([
      Promise.all(workers).then(() => 'completed' as const),
      new Promise<'timed_out'>((resolve) => {
        setTimeout(() => {
          resolve('timed_out');
        }, batchTimeoutMs);
      })
    ]);

    if (batchResult === 'timed_out') {
      batchTimedOut = true;
      let remainingFallbackCount = 0;
      for (let i = 0; i < contents.length; i++) {
        if (!results[i]) {
          results[i] = this.heuristicExtract(contents[i]);
          remainingFallbackCount++;
        }
      }
      if (remainingFallbackCount > 0) {
        failureCount += remainingFallbackCount;
        fallbackCount += remainingFallbackCount;
      }
      logger.warn('LLM batch extraction timed out, using heuristic fallback for remaining items', {
        stage: 'llm_batch_extraction',
        status: 'timeout',
        elapsedMs: Date.now() - startTime,
        batchSize: contents.length,
        concurrency,
        batchTimeoutMs,
        remainingFallbackCount
      });
    }

    const finalResults = results.map(
      (extraction, i) => extraction || this.heuristicExtract(contents[i])
    );

    logger.info('LLM batch extraction complete', {
      stage: 'llm_batch_extraction',
      status: failureCount > 0 ? 'degraded' : 'success',
      elapsedMs: Date.now() - startTime,
      batchSize: contents.length,
      successCount,
      failureCount,
      fallbackCount,
      timedOutCount,
      concurrency,
      itemTimeoutMs,
      batchTimeoutMs
    });

    return finalResults;
  }
}
