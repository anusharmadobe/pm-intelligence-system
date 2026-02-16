import crypto from 'crypto';
import { logger } from '../utils/logger';

export interface AdapterOutput {
  source: string;
  content: string;
  metadata?: Record<string, unknown>;
  timestamp?: string | number | Date;
}

export interface RawSignal {
  id: string;
  source: string;
  content: string;
  normalized_content: string;
  metadata: Record<string, unknown>;
  content_hash: string;
  created_at: string;
}

export class NormalizerService {
  private static readonly MIN_CONTENT_LENGTH = 20;
  private static readonly MAX_CONTENT_LENGTH = 100_000;
  private static readonly MAX_SIGNAL_LENGTH = 10_000;
  private static readonly FUTURE_TIMESTAMP_GRACE_MS = 60 * 60 * 1000;
  private static readonly VALID_SOURCES = new Set([
    'slack',
    'transcript',
    'document',
    'web_scrape',
    'jira',
    'wiki',
    'email',
    'manual'
  ]);

  validateUTF8(content: string): void {
    try {
      Buffer.from(content, 'utf8').toString('utf8');
    } catch (error) {
      logger.warn('Invalid UTF-8 content detected', { error });
      throw new Error('Invalid UTF-8 content');
    }
  }

  stripNullBytes(content: string): string {
    return content.replace(/\x00/g, '');
  }

  stripControlChars(content: string): string {
    return content.replace(/[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
  }

  cleanText(content: string): string {
    return content
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  truncateIfNeeded(content: string): string {
    if (content.length <= NormalizerService.MAX_SIGNAL_LENGTH) return content;
    return content.slice(0, NormalizerService.MAX_SIGNAL_LENGTH);
  }

  sanitizeHTML(content: string): string {
    return content
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<iframe[^>]*>[\s\S]*?<\/iframe>/gi, '')
      .replace(/\son\w+="[^"]*"/gi, '');
  }

  private normalizeTimestamp(timestamp?: string | number | Date): string {
    if (!timestamp) return new Date().toISOString();
    const parsed = timestamp instanceof Date ? timestamp : new Date(timestamp);
    if (Number.isNaN(parsed.getTime())) {
      throw new Error('Invalid timestamp');
    }
    if (parsed.getTime() > Date.now() + NormalizerService.FUTURE_TIMESTAMP_GRACE_MS) {
      throw new Error('Signal timestamp is in the future');
    }
    return parsed.toISOString();
  }

  normalize(input: AdapterOutput): RawSignal {
    this.validateUTF8(input.content);
    let content = this.stripNullBytes(input.content);
    content = this.stripControlChars(content);

    const trimmed = content.trim();
    if (trimmed.length < NormalizerService.MIN_CONTENT_LENGTH) {
      throw new Error('Signal content too short (min 20 chars)');
    }
    if (trimmed.length > NormalizerService.MAX_CONTENT_LENGTH) {
      throw new Error('Signal content too long (max 100K chars)');
    }

    if (!NormalizerService.VALID_SOURCES.has(input.source)) {
      throw new Error(`Invalid source: ${input.source}`);
    }

    if (input.source === 'web_scrape') {
      content = this.sanitizeHTML(content);
    }

    content = this.cleanText(content);
    content = this.truncateIfNeeded(content);
    const normalized = content;
    const contentHash = crypto.createHash('sha256').update(normalized).digest('hex');
    const createdAt = this.normalizeTimestamp(input.timestamp);
    const metadata = {
      ...(input.metadata || {}),
      ingested_at: new Date().toISOString(),
      content_hash: contentHash
    };

    return {
      id: crypto.randomUUID(),
      source: input.source,
      content,
      normalized_content: normalized,
      metadata,
      content_hash: contentHash,
      created_at: createdAt
    };
  }
}
