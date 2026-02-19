import * as z from 'zod/v4';
import { textResponse } from '../tool_utils';
import { WebsiteCrawlerService } from '../../services/website_crawler_service';
import { logger } from '../../utils/logger';

export const tool = {
  name: 'crawl_website',
  description: 'Crawl and ingest content from a website URL. Useful for competitor blogs, changelogs, pricing pages, documentation, and news articles.',
  inputSchema: {
    url: z.string().url().describe('URL of the website to crawl'),
    content_type: z.enum(['blog', 'changelog', 'pricing', 'docs', 'news', 'forum', 'web_page']).optional().describe('Type of content (default: "web_page")'),
    competitor: z.string().optional().describe('Competitor name if this is competitor content'),
    tags: z.array(z.string()).optional().describe('Tags to categorize the content'),
    content_selector: z.string().optional().describe('CSS selector for main content (e.g., "article.post-content")')
  },
  handler: async ({
    url,
    content_type,
    competitor,
    tags,
    content_selector
  }: {
    url: string;
    content_type?: string;
    competitor?: string;
    tags?: string[];
    content_selector?: string;
  }) => {
    try {
      const crawler = new WebsiteCrawlerService();

      try {
        const count = await crawler.crawlWebsite({
          name: `Manual crawl: ${url}`,
          url,
          type: content_type || 'web_page',
          competitor,
          crawl_frequency: 'manual',
          enabled: true,
          selectors: content_selector ? { content: content_selector } : undefined,
          tags: tags || []
        });

        const response = {
          success: true,
          url,
          signals_created: count,
          content_type: content_type || 'web_page',
          competitor: competitor || null,
          message: `Successfully crawled ${url} and created ${count} signal(s)`
        };

        logger.info('Website crawled via MCP tool', {
          stage: 'mcp_tools',
          url,
          signals_created: count
        });

        return textResponse(JSON.stringify(response, null, 2));
      } finally {
        await crawler.close();
      }
    } catch (error: any) {
      logger.error('crawl_website failed', {
        error: error.message,
        url,
        content_type
      });
      throw error;
    }
  }
};
