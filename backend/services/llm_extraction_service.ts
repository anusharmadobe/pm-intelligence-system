import { z } from 'zod';
import { config } from '../config/env';
import { logger } from '../utils/logger';
import { createAzureOpenAIProvider, createLLMProviderFromEnv, LLMProvider } from './llm_service';

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
  signal_category: z.enum(['community_forum_ux', 'product_issue']).optional()
});

export type ExtractionOutput = z.infer<typeof ExtractionSchema>;

export class LLMExtractionService {
  private fastProvider: LLMProvider;
  private slowProvider: LLMProvider;

  constructor() {
    // Fast provider uses Azure OpenAI fast deployment when configured, otherwise env provider
    if (process.env.AZURE_OPENAI_ENDPOINT && process.env.AZURE_OPENAI_KEY) {
      this.fastProvider = createAzureOpenAIProvider(
        process.env.AZURE_OPENAI_ENDPOINT,
        process.env.AZURE_OPENAI_KEY,
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
          signal_category: 'community_forum_ux|product_issue'
        },
        null,
        2
      ),
      '',
      'Classify the signal as one of:',
      '- community_forum_ux: forum/process/community interaction issue (moderation, docs discoverability, forum usability)',
      '- product_issue: product feature, defect, capability gap, or product behavior issue',
      '',
      'Signal:',
      content
    ].join('\n');
  }

  private parseJson(text: string): ExtractionOutput | null {
    try {
      const trimmed = text.trim();
      const start = trimmed.indexOf('{');
      const end = trimmed.lastIndexOf('}');
      if (start === -1 || end === -1) return null;
      const jsonText = trimmed.slice(start, end + 1);
      const parsed = JSON.parse(jsonText);
      return ExtractionSchema.parse(parsed);
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
      signal_category: 'product_issue'
    };
  }

  async extract(content: string): Promise<ExtractionOutput> {
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
      const slowResponse = await this.slowProvider(prompt);
      extraction = this.parseJson(slowResponse) || extraction;
    }

    const safeOutput =
      extraction ||
      ExtractionSchema.parse(this.heuristicExtract(content));

    return this.hallucinationFilter(content, safeOutput);
  }

  async extractBatch(contents: string[]): Promise<ExtractionOutput[]> {
    if (contents.length === 0) {
      return [];
    }
    const concurrency = Math.max(
      1,
      parseInt(process.env.LLM_EXTRACTION_BATCH_CONCURRENCY || '5', 10)
    );
    const results: ExtractionOutput[] = new Array(contents.length);
    let index = 0;

    const workers = Array.from({ length: Math.min(concurrency, contents.length) }).map(async () => {
      while (index < contents.length) {
        const current = index;
        index += 1;
        results[current] = await this.extract(contents[current]);
      }
    });

    await Promise.all(workers);
    return results;
  }
}
