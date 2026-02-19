import puppeteer, { Browser, Page } from 'puppeteer';
import * as fs from 'fs';
import * as path from 'path';
import { WebScrapeAdapter, WebScrapeInput } from '../ingestion/web_scrape_adapter';
import { NormalizerService } from '../ingestion/normalizer_service';
import { IngestionPipelineService } from './ingestion_pipeline_service';
import { createModuleLogger } from '../utils/logger';
import { getDbPool } from '../db/connection';
import { validateUrlSafety, getAllowedDomainsFromEnv } from '../utils/url_validator';

const logger = createModuleLogger('website_crawler', 'LOG_LEVEL_WEBSITE_CRAWLER');

export interface WebsiteConfig {
  name: string;
  url: string;
  type: string; // 'blog', 'changelog', 'pricing', 'docs', 'news', 'forum'
  competitor?: string;
  crawl_frequency: string; // '6h', '12h', '24h', 'manual'
  enabled: boolean;
  selectors?: {
    content?: string;
    title?: string;
    date?: string;
    author?: string;
  };
  tags?: string[];
  maxPages?: number;
  pagination?: {
    type: 'load-more' | 'next-link';
    selector: string;
  };
}

export interface WebsiteConfigFile {
  sources: WebsiteConfig[];
}

export class WebsiteCrawlerService {
  private browser?: Browser;
  private adapter: WebScrapeAdapter;
  private pipeline: IngestionPipelineService;
  private activePagesCount = 0;
  private isShuttingDown = false;

  constructor() {
    this.adapter = new WebScrapeAdapter(new NormalizerService());
    this.pipeline = new IngestionPipelineService();
  }

  /**
   * Get or create Puppeteer browser instance
   */
  private async getBrowser(): Promise<Browser> {
    if (this.isShuttingDown) {
      throw new Error('WebsiteCrawlerService is shutting down');
    }

    if (!this.browser || !this.browser.isConnected()) {
      logger.info('Launching Puppeteer browser', {
        stage: 'website_crawler'
      });

      try {
        this.browser = await puppeteer.launch({
          headless: true,
          args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--disable-gpu'
          ],
          // Set timeout for browser launch
          timeout: 30000
        });

        // Monitor browser disconnection
        this.browser.on('disconnected', () => {
          if (!this.isShuttingDown) {
            logger.warn('Browser disconnected unexpectedly', {
              stage: 'website_crawler',
              activePagesCount: this.activePagesCount
            });
          }
          this.browser = undefined;
        });

        logger.info('Puppeteer browser launched successfully', {
          stage: 'website_crawler'
        });
      } catch (error: any) {
        logger.error('Failed to launch Puppeteer browser', {
          stage: 'website_crawler',
          error: error.message,
          errorClass: error.constructor.name,
          stack: error.stack
        });
        throw error;
      }
    }

    return this.browser;
  }

  /**
   * Crawl a single website
   */
  async crawlWebsite(config: WebsiteConfig): Promise<number> {
    // Validate config
    if (!config.url) {
      throw new Error('Website URL is required');
    }

    if (!config.name) {
      throw new Error('Website name is required');
    }

    if (!config.enabled) {
      logger.debug('Skipping disabled website', {
        stage: 'website_crawler',
        name: config.name
      });
      return 0;
    }

    // SSRF Protection: Validate URL safety before crawling
    const allowedDomains = getAllowedDomainsFromEnv();
    const urlValidation = await validateUrlSafety(config.url, { allowedDomains });

    if (!urlValidation.safe) {
      logger.error('URL blocked by security check (SSRF protection)', {
        stage: 'website_crawler',
        name: config.name,
        url: config.url,
        reason: urlValidation.reason,
        details: urlValidation.details
      });
      throw new Error(`URL not allowed: ${urlValidation.reason}`);
    }

    logger.debug('URL passed security validation', {
      stage: 'website_crawler',
      name: config.name,
      url: config.url
    });

    const startTime = Date.now();

    logger.info('Starting website crawl', {
      stage: 'website_crawler',
      status: 'start',
      name: config.name,
      url: config.url,
      type: config.type
    });

    const browser = await this.getBrowser();
    let page: Page | null = null;

    try {
      this.activePagesCount++;
      page = await browser.newPage();

      // Set page timeout to prevent hanging
      page.setDefaultNavigationTimeout(30000);
      page.setDefaultTimeout(30000);

      // Set viewport and user agent
      await page.setViewport({ width: 1920, height: 1080 });
      await page.setUserAgent(
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      );

      let totalSignals = 0;

      // Navigate to URL with timeout
      const navStartTime = Date.now();
      logger.trace('Page navigation started', {
        stage: 'website_crawler',
        url: config.url,
        timeout_ms: 30000
      });

      await page.goto(config.url, {
        waitUntil: 'networkidle2',
        timeout: 30000
      });

      logger.trace('Page navigation complete', {
        stage: 'website_crawler',
        url: config.url,
        duration_ms: Date.now() - navStartTime
      });

      // Get page content
      const content = await page.content();
      const title = await page.title();

      // Check for deduplication
      const isDuplicate = await this.checkDuplicate(config.url, content);
      if (isDuplicate) {
        logger.info('Website content already ingested (duplicate)', {
          stage: 'website_crawler',
          name: config.name,
          url: config.url
        });
        await page.close();
        return 0;
      }

      // Process with adapter
      const input: WebScrapeInput = {
        url: config.url,
        content,
        captured_at: new Date().toISOString(),
        metadata: {
          page_title: title,
          content_type: config.type,
          competitor: config.competitor,
          tags: config.tags,
          selectors: config.selectors
        }
      };

      const signals = this.adapter.ingest(input);

      // Ingest through pipeline
      await this.pipeline.ingest(signals);

      totalSignals += signals.length;

      // Register source
      await this.registerSource(config);

      logger.info('Website crawl complete', {
        stage: 'website_crawler',
        status: 'success',
        name: config.name,
        url: config.url,
        signals_created: signals.length,
        duration_ms: Date.now() - startTime
      });
      return totalSignals;
    } catch (error: any) {
      logger.error('Website crawl failed', {
        stage: 'website_crawler',
        status: 'error',
        name: config.name,
        url: config.url,
        error: error.message,
        stack: error.stack,
        duration_ms: Date.now() - startTime
      });
      throw error;
    } finally {
      // Always cleanup page
      if (page) {
        try {
          await Promise.race([
            page.close(),
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error('Page close timeout')), 5000)
            )
          ]);
        } catch (error: any) {
          logger.error('Failed to close page gracefully', {
            stage: 'website_crawler',
            name: config.name,
            error: error.message
          });
        } finally {
          this.activePagesCount--;
        }
      }
    }
  }

  /**
   * Check if content has already been ingested (deduplication)
   */
  private async checkDuplicate(url: string, content: string): Promise<boolean> {
    const pool = getDbPool();
    const crypto = await import('crypto');
    const contentHash = crypto.createHash('sha256').update(content).digest('hex');

    const result = await pool.query(
      `SELECT COUNT(*) as count
       FROM signals
       WHERE metadata->>'url' = $1
         AND metadata->>'content_hash' = $2`,
      [url, contentHash]
    );

    const existingCount = parseInt(result.rows[0].count);
    const isDuplicate = existingCount > 0;

    logger.debug('Deduplication check', {
      stage: 'website_crawler',
      url,
      content_hash: contentHash.substring(0, 16),
      is_duplicate: isDuplicate,
      existing_count: existingCount
    });

    return isDuplicate;
  }

  /**
   * Register website as a data source
   */
  private async registerSource(config: WebsiteConfig): Promise<void> {
    const pool = getDbPool();

    try {
      await pool.query(
        `INSERT INTO source_registry (source_name, source_type, config, status, last_synced)
         VALUES ($1, $2, $3, $4, NOW())
         ON CONFLICT (source_name)
         DO UPDATE SET
           config = EXCLUDED.config,
           status = EXCLUDED.status,
           last_synced = NOW()`,
        [
          config.name,
          'web_scrape',
          JSON.stringify({
            url: config.url,
            crawl_frequency: config.crawl_frequency,
            content_type: config.type,
            competitor: config.competitor
          }),
          'connected'
        ]
      );
    } catch (error: any) {
      logger.warn('Failed to register website source', {
        stage: 'website_crawler',
        name: config.name,
        error: error.message
      });
    }
  }

  /**
   * Crawl all configured websites
   */
  async crawlAllConfigured(configPath?: string): Promise<Record<string, number>> {
    const configFile = configPath || path.join(process.cwd(), 'config', 'websites.json');
    const startTime = Date.now();

    if (!fs.existsSync(configFile)) {
      logger.warn('Website configuration file not found', {
        stage: 'website_crawler',
        config_path: configFile
      });
      return {};
    }

    logger.info('Loading website configuration', {
      stage: 'website_crawler',
      status: 'start',
      config_path: configFile
    });

    let configData: WebsiteConfigFile;
    try {
      configData = JSON.parse(fs.readFileSync(configFile, 'utf-8'));
    } catch (error: any) {
      logger.error('Failed to parse website configuration', {
        stage: 'website_crawler',
        status: 'error',
        config_path: configFile,
        error: error.message
      });
      throw new Error(`Invalid website configuration file: ${error.message}`);
    }

    const results: Record<string, number> = {};
    const enabledSources = configData.sources.filter(s => s.enabled);
    const totalSources = enabledSources.length;

    logger.info('Starting crawl of configured websites', {
      stage: 'website_crawler',
      status: 'in_progress',
      total_sources: totalSources,
      total_configured: configData.sources.length
    });

    let processed = 0;
    let lastLogTime = Date.now();

    for (const source of configData.sources) {
      if (source.enabled) {
        processed++;

        // Log progress every 5 seconds or for each site (since crawling is slow)
        const now = Date.now();
        if (now - lastLogTime >= 5000 || processed === totalSources) {
          const progress = (processed / totalSources) * 100;
          const elapsed = now - startTime;
          const rate = processed / (elapsed / 1000);
          const eta = totalSources > processed ? Math.round((totalSources - processed) / rate) : 0;

          logger.info('Website crawl progress', {
            stage: 'website_crawler',
            status: 'in_progress',
            processed,
            total: totalSources,
            progress_pct: progress.toFixed(1),
            rate_per_sec: rate.toFixed(3),
            eta_seconds: eta.toString(),
            elapsed_ms: elapsed
          });

          lastLogTime = now;
        }

        try {
          const count = await this.crawlWebsite(source);
          results[source.name] = count;
        } catch (error: any) {
          logger.error('Failed to crawl website', {
            stage: 'website_crawler',
            status: 'error',
            name: source.name,
            url: source.url,
            error: error.message,
            stack: error.stack
          });
          results[source.name] = 0;
        }
      } else {
        logger.debug('Skipping disabled website', {
          stage: 'website_crawler',
          name: source.name
        });
      }
    }

    const totalSignals = Object.values(results).reduce((sum, count) => sum + count, 0);
    const duration = Date.now() - startTime;

    logger.info('All configured websites crawled', {
      stage: 'website_crawler',
      status: 'success',
      total_sources: configData.sources.length,
      crawled_sources: Object.keys(results).length,
      total_signals: totalSignals,
      duration_ms: duration,
      rate_per_sec: totalSources > 0 ? (totalSources / (duration / 1000)).toFixed(3) : '0'
    });

    return results;
  }

  /**
   * Close browser and cleanup resources
   * Waits for active pages to finish before closing
   */
  async close(): Promise<void> {
    this.isShuttingDown = true;

    logger.info('Initiating WebsiteCrawlerService shutdown', {
      stage: 'website_crawler',
      activePagesCount: this.activePagesCount,
      browserConnected: this.browser?.isConnected() || false
    });

    // Wait for active pages to complete (with timeout)
    if (this.activePagesCount > 0) {
      logger.info('Waiting for active pages to complete', {
        stage: 'website_crawler',
        activePagesCount: this.activePagesCount
      });

      const waitStart = Date.now();
      const maxWait = 30000; // 30 seconds

      while (this.activePagesCount > 0 && (Date.now() - waitStart) < maxWait) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }

      if (this.activePagesCount > 0) {
        logger.warn('Force closing with active pages still running', {
          stage: 'website_crawler',
          activePagesCount: this.activePagesCount,
          waitedMs: Date.now() - waitStart
        });
      }
    }

    // Close browser
    if (this.browser && this.browser.isConnected()) {
      logger.info('Closing Puppeteer browser', {
        stage: 'website_crawler'
      });

      try {
        // Close browser with timeout
        await Promise.race([
          this.browser.close(),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Browser close timeout')), 10000)
          )
        ]);

        logger.info('Puppeteer browser closed successfully', {
          stage: 'website_crawler'
        });
      } catch (error: any) {
        logger.error('Error closing Puppeteer browser, forcing process kill', {
          stage: 'website_crawler',
          error: error.message
        });

        // Force kill browser process if graceful close fails
        try {
          const browserProcess = this.browser.process();
          if (browserProcess) {
            browserProcess.kill('SIGKILL');
          }
        } catch (killError: any) {
          logger.error('Failed to kill browser process', {
            stage: 'website_crawler',
            error: killError.message
          });
        }
      } finally {
        this.browser = undefined;
      }
    }

    logger.info('WebsiteCrawlerService shutdown complete', {
      stage: 'website_crawler'
    });
  }
}
