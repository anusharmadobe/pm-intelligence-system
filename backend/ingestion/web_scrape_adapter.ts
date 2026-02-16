import { NormalizerService, RawSignal } from './normalizer_service';
import { config } from '../config/env';

export interface WebScrapeInput {
  url: string;
  content: string;
  captured_at?: string;
  metadata?: Record<string, unknown>;
}

export class WebScrapeAdapter {
  constructor(private normalizer: NormalizerService) {}

  private validateUrl(url: string): void {
    try {
      new URL(url);
    } catch (_error) {
      throw new Error('Invalid URL');
    }
  }

  private validateSize(content: string): void {
    const sizeMb = Buffer.byteLength(content, 'utf8') / (1024 * 1024);
    if (sizeMb > config.ingestion.maxFileSizeMb) {
      throw new Error(`Web content exceeds maximum size of ${config.ingestion.maxFileSizeMb}MB`);
    }
  }

  ingest(input: WebScrapeInput): RawSignal {
    this.validateUrl(input.url);
    this.validateSize(input.content);

    return this.normalizer.normalize({
      source: 'web_scrape',
      content: input.content,
      metadata: {
        url: input.url,
        captured_at: input.captured_at || new Date().toISOString(),
        ...input.metadata
      },
      timestamp: input.captured_at
    });
  }
}
