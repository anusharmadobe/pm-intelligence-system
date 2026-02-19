import { NormalizerService, RawSignal } from './normalizer_service';
import { config } from '../config/env';
import * as cheerio from 'cheerio';
import { createHash } from 'crypto';
import { logger } from '../utils/logger';

export interface WebScrapeInput {
  url: string;
  content: string; // HTML content
  captured_at?: string;
  metadata?: {
    page_title?: string;
    content_type?: string; // 'blog', 'changelog', 'pricing', 'docs', 'news', 'forum', etc.
    competitor?: string;
    tags?: string[];
    selectors?: {
      content?: string; // CSS selector for main content
      title?: string; // CSS selector for title
      date?: string; // CSS selector for date
      author?: string; // CSS selector for author
    };
  };
}

interface ParsedMetadata {
  title: string | null;
  date: string | null;
  author: string | null;
}

export class WebScrapeAdapter {
  private static readonly MAX_CHUNK_SIZE = 10000; // Max characters per chunk

  constructor(private normalizer: NormalizerService) {}

  /**
   * Validate URL format
   */
  private validateUrl(url: string): void {
    try {
      new URL(url);
    } catch (_error) {
      throw new Error('Invalid URL');
    }
  }

  /**
   * Validate content size
   */
  private validateSize(content: string): void {
    const sizeMb = Buffer.byteLength(content, 'utf8') / (1024 * 1024);
    if (sizeMb > config.ingestion.maxFileSizeMb) {
      throw new Error(`Web content exceeds maximum size of ${config.ingestion.maxFileSizeMb}MB`);
    }
  }

  /**
   * Parse HTML and extract metadata using selectors
   */
  private extractMetadata($: cheerio.CheerioAPI, selectors?: {
    content?: string;
    title?: string;
    date?: string;
    author?: string;
  }): ParsedMetadata {
    let title: string | null = null;
    let date: string | null = null;
    let author: string | null = null;

    try {
      // Extract title
      if (selectors?.title) {
        title = $(selectors.title).first().text().trim();
      }
      if (!title) {
        title = $('title').first().text().trim();
      }
      if (!title) {
        title = $('h1').first().text().trim();
      }

      // Extract date
      if (selectors?.date) {
        date = $(selectors.date).first().text().trim();
      }
      if (!date) {
        // Try common date selectors
        date =
          $('time').first().attr('datetime') ||
          $('[itemprop="datePublished"]').first().attr('content') ||
          $('meta[property="article:published_time"]').first().attr('content') ||
          null;
      }

      // Extract author
      if (selectors?.author) {
        author = $(selectors.author).first().text().trim();
      }
      if (!author) {
        author =
          $('[rel="author"]').first().text().trim() ||
          $('[itemprop="author"]').first().text().trim() ||
          $('meta[name="author"]').first().attr('content') ||
          null;
      }
    } catch (error: any) {
      logger.warn('Failed to extract metadata from HTML', {
        stage: 'web_scrape_adapter',
        error: error.message
      });
    }

    return { title, date, author };
  }

  /**
   * Extract clean text content from HTML
   */
  private extractText($: cheerio.CheerioAPI, contentSelector?: string): string {
    try {
      // Select content element
      const element = contentSelector ? $(contentSelector) : $('body');

      // Remove unwanted elements
      element.find('script, style, nav, header, footer, aside, .sidebar, .advertisement, [role="navigation"]').remove();

      // Get text content
      let text = element.text();

      // Clean up whitespace
      text = text.replace(/\s+/g, ' ').trim();

      return text;
    } catch (error: any) {
      logger.warn('Failed to extract text from HTML', {
        stage: 'web_scrape_adapter',
        error: error.message
      });

      // Fallback: just get body text
      return $('body').text().replace(/\s+/g, ' ').trim();
    }
  }

  /**
   * Chunk content into smaller pieces if needed
   */
  private chunkContent(content: string, url: string): string[] {
    if (!content || content.length === 0) {
      logger.warn('Empty content provided to chunkContent', {
        stage: 'web_scrape_adapter',
        url
      });
      return [];
    }

    if (content.length <= WebScrapeAdapter.MAX_CHUNK_SIZE) {
      return [content];
    }

    logger.debug('Chunking large web content', {
      stage: 'web_scrape_adapter',
      status: 'start',
      url,
      content_length: content.length,
      max_chunk_size: WebScrapeAdapter.MAX_CHUNK_SIZE
    });

    try {
      // Split by paragraph boundaries
      const paragraphs = content.split(/\n\n+/);
      const chunks: string[] = [];
      let currentChunk = '';

      for (const para of paragraphs) {
        // If adding this paragraph would exceed the limit
        if (currentChunk.length + para.length > WebScrapeAdapter.MAX_CHUNK_SIZE) {
          // Save current chunk if it's not empty
          if (currentChunk) {
            chunks.push(currentChunk.trim());
            currentChunk = '';
          }

          // If single paragraph is too large, split by sentences
          if (para.length > WebScrapeAdapter.MAX_CHUNK_SIZE) {
            const sentences = para.split(/\.\s+/);
            for (const sentence of sentences) {
              if (currentChunk.length + sentence.length > WebScrapeAdapter.MAX_CHUNK_SIZE) {
                if (currentChunk) {
                  chunks.push(currentChunk.trim());
                }
                currentChunk = sentence;
              } else {
                currentChunk += (currentChunk ? '. ' : '') + sentence;
              }
            }
          } else {
            currentChunk = para;
          }
        } else {
          currentChunk += (currentChunk ? '\n\n' : '') + para;
        }
      }

      // Add remaining chunk
      if (currentChunk) {
        chunks.push(currentChunk.trim());
      }

      logger.info('Content chunked successfully', {
        stage: 'web_scrape_adapter',
        status: 'success',
        url,
        chunk_count: chunks.length,
        original_length: content.length,
        avg_chunk_size: chunks.length > 0 ? Math.round(content.length / chunks.length) : 0
      });

      return chunks.length > 0 ? chunks : [content];
    } catch (error: any) {
      logger.error('Content chunking failed, returning whole content', {
        stage: 'web_scrape_adapter',
        status: 'error',
        url,
        error: error.message,
        stack: error.stack
      });
      // Fallback: return whole content as single chunk
      return [content];
    }
  }

  /**
   * Generate content hash for deduplication
   */
  private generateContentHash(content: string): string {
    return createHash('sha256').update(content).digest('hex');
  }

  /**
   * Ingest web content and convert to RawSignals
   */
  ingest(input: WebScrapeInput): RawSignal[] {
    const startTime = Date.now();

    // Input validation
    if (!input) {
      throw new Error('Input parameter is required');
    }

    if (!input.url || input.url.trim().length === 0) {
      throw new Error('URL is required');
    }

    if (!input.content || input.content.trim().length === 0) {
      throw new Error('Content is required');
    }

    logger.info('Starting web content ingestion', {
      stage: 'web_scrape_adapter',
      status: 'start',
      url: input.url,
      content_length: input.content.length,
      content_type: input.metadata?.content_type || 'web_page',
      competitor: input.metadata?.competitor || 'none'
    });

    try {
      this.validateUrl(input.url);
      this.validateSize(input.content);

      // Parse HTML
      const $ = cheerio.load(input.content);

      // Extract metadata
      const metadata = this.extractMetadata($, input.metadata?.selectors);

      // Extract clean text content
      const content = this.extractText($, input.metadata?.selectors?.content);

      if (!content || content.length < 10) {
        logger.warn('Extracted content too short or empty', {
          stage: 'web_scrape_adapter',
          status: 'error',
          url: input.url,
          content_length: content?.length || 0
        });
        throw new Error('Extracted content is too short or empty');
      }

      // Chunk content if needed
      const chunks = this.chunkContent(content, input.url);

      // Generate content hash for deduplication
      const contentHash = this.generateContentHash(content);

      // Create a signal for each chunk
      const signals = chunks.map((chunk, index) =>
        this.normalizer.normalize({
          source: 'web_scrape',
          content: chunk,
          metadata: {
            url: input.url,
            page_title: input.metadata?.page_title || metadata.title || 'Untitled',
            content_type: input.metadata?.content_type || 'web_page',
            competitor: input.metadata?.competitor,
            tags: input.metadata?.tags || [],
            content_hash: contentHash,
            chunk_index: index,
            total_chunks: chunks.length,
            captured_at: input.captured_at || new Date().toISOString(),
            extracted_date: metadata.date,
            extracted_author: metadata.author,
            signal_type: 'web_page'
          },
          timestamp: input.captured_at
        })
      );

      const duration = Date.now() - startTime;

      logger.info('Web content ingested successfully', {
        stage: 'web_scrape_adapter',
        status: 'success',
        url: input.url,
        signals_created: signals.length,
        content_length: content.length,
        chunk_count: chunks.length,
        content_hash: contentHash.substring(0, 16),
        duration_ms: duration
      });

      return signals;
    } catch (error: any) {
      logger.error('Web content ingestion failed', {
        stage: 'web_scrape_adapter',
        status: 'error',
        url: input.url,
        error: error.message,
        stack: error.stack,
        duration_ms: Date.now() - startTime
      });
      throw error;
    }
  }
}
