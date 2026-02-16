import { WebClient } from '@slack/web-api';
import { config } from '../config/env';
import { logger } from '../utils/logger';
import { ingestSignal, RawSignal } from '../processing/signal_extractor';
import { getDbPool } from '../db/connection';
import * as fs from 'fs';
import * as path from 'path';

export interface IngestStats {
  channelId: string;
  channelName?: string;
  total: number;
  success: number;
  failed: number;
  skipped: number;
  threadsProcessed: number;
  lastMessageTs?: string;
}

export interface ChannelCheckpoint {
  channelId: string;
  lastMessageTs: string;
  messagesProcessed: number;
  updatedAt: string;
}

/**
 * Slack batch ingestion service for multi-channel data collection
 * Supports:
 * - Config-driven channel IDs
 * - Pagination for large message volumes
 * - Thread reply fetching
 * - Checkpoint/resume functionality
 * - Comprehensive stats tracking
 */
export class SlackBatchIngestionService {
  private client: WebClient;
  private checkpointDir: string;

  constructor() {
    if (!config.slack.botToken) {
      throw new Error('SLACK_BOT_TOKEN is required for Slack batch ingestion');
    }

    this.client = new WebClient(config.slack.botToken);
    this.checkpointDir = path.join(process.cwd(), 'data', 'checkpoints');

    // Ensure checkpoint directory exists
    if (!fs.existsSync(this.checkpointDir)) {
      fs.mkdirSync(this.checkpointDir, { recursive: true });
    }
  }

  /**
   * Ingest from all configured channels
   */
  async ingestAllChannels(options?: {
    resume?: boolean;
    skipChannels?: string[];
  }): Promise<Record<string, IngestStats>> {
    const channelIds = config.slack.channelIds;

    if (channelIds.length === 0) {
      throw new Error('No Slack channel IDs configured. Set SLACK_CHANNEL_IDS in .env');
    }

    logger.info('Starting Slack batch ingestion for all channels', {
      channelCount: channelIds.length,
      channelIds,
      resume: options?.resume || false
    });

    const allStats: Record<string, IngestStats> = {};

    for (const channelId of channelIds) {
      // Skip if in skipChannels list
      if (options?.skipChannels?.includes(channelId)) {
        logger.info('Skipping channel (in skip list)', { channelId });
        continue;
      }

      try {
        const stats = await this.ingestChannel(channelId, { resume: options?.resume });
        allStats[channelId] = stats;
      } catch (error: any) {
        logger.error('Channel ingestion failed', {
          channelId,
          error: error.message,
          stack: error.stack
        });

        // Record failed channel stats
        allStats[channelId] = {
          channelId,
          total: 0,
          success: 0,
          failed: 0,
          skipped: 0,
          threadsProcessed: 0
        };
      }
    }

    logger.info('All channels ingestion complete', {
      totalChannels: channelIds.length,
      successfulChannels: Object.values(allStats).filter(s => s.success > 0).length
    });

    return allStats;
  }

  /**
   * Ingest from a single channel
   */
  async ingestChannel(channelId: string, options?: {
    resume?: boolean;
    maxMessages?: number;
  }): Promise<IngestStats> {
    const maxMessages = options?.maxMessages || config.slack.maxMessagesPerChannel;
    const resume = options?.resume || false;

    logger.info('Starting channel ingestion', {
      channelId,
      maxMessages,
      resume,
      includeThreads: config.slack.includeThreads
    });

    // Get channel info
    let channelName: string | undefined;
    try {
      const channelInfo = await this.client.conversations.info({ channel: channelId });
      channelName = (channelInfo.channel as any)?.name;
      logger.info('Channel info retrieved', { channelId, channelName });
    } catch (error: any) {
      logger.warn('Could not get channel info', { channelId, error: error.message });
    }

    // Load checkpoint if resuming
    let cursor: string | undefined;
    let checkpoint: ChannelCheckpoint | null = null;
    if (resume) {
      checkpoint = this.loadCheckpoint(channelId);
      if (checkpoint) {
        logger.info('Resuming from checkpoint', {
          channelId,
          lastMessageTs: checkpoint.lastMessageTs,
          messagesProcessed: checkpoint.messagesProcessed
        });
        // Note: Slack API doesn't support cursor from specific timestamp
        // We'll skip messages until we reach the checkpoint
      }
    }

    const stats: IngestStats = {
      channelId,
      channelName,
      total: 0,
      success: 0,
      failed: 0,
      skipped: 0,
      threadsProcessed: 0
    };

    let totalMessages = 0;
    let shouldSkip = checkpoint !== null;

    // Paginate through channel history
    while (totalMessages < maxMessages) {
      try {
        const response = await this.client.conversations.history({
          channel: channelId,
          limit: Math.min(config.slack.batchSize, maxMessages - totalMessages),
          cursor
        });

        if (!response.messages || response.messages.length === 0) {
          logger.info('No more messages to fetch', { channelId });
          break;
        }

        logger.debug('Fetched message batch', {
          channelId,
          count: response.messages.length,
          hasMore: response.has_more
        });

        for (const message of response.messages) {
          if (totalMessages >= maxMessages) {
            break;
          }
          stats.total++;
          totalMessages++;

          // Skip until we reach the checkpoint message
          if (shouldSkip) {
            if (message.ts === checkpoint!.lastMessageTs) {
              shouldSkip = false;
              logger.info('Reached checkpoint, resuming ingestion', {
                channelId,
                ts: message.ts
              });
            }
            stats.skipped++;
            continue;
          }

          // Process message
          const result = await this.processMessage(message, channelId, channelName);
          if (result.success) {
            stats.success++;
            stats.lastMessageTs = message.ts;
          } else if (result.skipped) {
            stats.skipped++;
          } else {
            stats.failed++;
          }

          // Fetch thread replies if configured
          if (config.slack.includeThreads && message.thread_ts && message.reply_count && message.reply_count > 0) {
            const threadStats = await this.fetchThreadReplies(channelId, message.thread_ts, channelName);
            stats.success += threadStats.success;
            stats.failed += threadStats.failed;
            stats.skipped += threadStats.skipped;
            stats.threadsProcessed++;
          }

          // Save checkpoint every 100 messages
          if (stats.total % 100 === 0) {
            this.saveCheckpoint({
              channelId,
              lastMessageTs: message.ts!,
              messagesProcessed: stats.total,
              updatedAt: new Date().toISOString()
            });
          }
        }

        // Check if there are more messages
        cursor = response.response_metadata?.next_cursor;
        if (!cursor || !response.has_more || totalMessages >= maxMessages) {
          logger.info('All messages fetched', { channelId });
          break;
        }
      } catch (error: any) {
        logger.error('Error fetching channel history', {
          channelId,
          error: error.message,
          stack: error.stack
        });
        throw error;
      }
    }

    // Save final checkpoint
    if (stats.lastMessageTs) {
      this.saveCheckpoint({
        channelId,
        lastMessageTs: stats.lastMessageTs,
        messagesProcessed: stats.total,
        updatedAt: new Date().toISOString()
      });
    }

    logger.info('Channel ingestion complete', {
      channelId,
      channelName,
      stats
    });

    return stats;
  }

  /**
   * Process a single message and ingest as signal
   */
  private async processMessage(
    message: any,
    channelId: string,
    channelName?: string
  ): Promise<{ success: boolean; skipped: boolean }> {
    // Skip bot messages and system messages
    if (message.subtype || message.bot_id) {
      return { success: false, skipped: true };
    }

    // Skip messages without text
    if (!message.text || message.text.trim() === '') {
      return { success: false, skipped: true };
    }

    const signal: RawSignal = {
      source: 'slack',
      id: `slack_${channelId}_${message.ts}`,
      type: 'message',
      text: message.text,
      metadata: {
        channel_id: channelId,
        channel_name: channelName,
        user: message.user,
        timestamp: message.ts,
        thread_ts: message.thread_ts,
        reply_count: message.reply_count || 0,
        reactions: message.reactions || []
      }
    };

    try {
      await ingestSignal(signal);
      logger.debug('Message ingested', { channelId, ts: message.ts });
      return { success: true, skipped: false };
    } catch (error: any) {
      logger.warn('Failed to ingest message', {
        channelId,
        ts: message.ts,
        error: error.message
      });
      return { success: false, skipped: false };
    }
  }

  /**
   * Fetch and process thread replies
   */
  private async fetchThreadReplies(
    channelId: string,
    threadTs: string,
    channelName?: string
  ): Promise<{ success: number; failed: number; skipped: number }> {
    const stats = { success: 0, failed: 0, skipped: 0 };

    try {
      const response = await this.client.conversations.replies({
        channel: channelId,
        ts: threadTs,
        limit: 1000 // Max limit for replies
      });

      if (!response.messages || response.messages.length === 0) {
        return stats;
      }

      // Skip the first message (parent message, already processed)
      const replies = response.messages.slice(1);

      for (const reply of replies) {
        const result = await this.processMessage(reply, channelId, channelName);
        if (result.success) {
          stats.success++;
        } else if (result.skipped) {
          stats.skipped++;
        } else {
          stats.failed++;
        }
      }

      logger.debug('Thread replies processed', {
        channelId,
        threadTs,
        replyCount: replies.length
      });
    } catch (error: any) {
      logger.warn('Failed to fetch thread replies', {
        channelId,
        threadTs,
        error: error.message
      });
      stats.failed++;
    }

    return stats;
  }

  /**
   * Load checkpoint from disk
   */
  private loadCheckpoint(channelId: string): ChannelCheckpoint | null {
    const checkpointFile = path.join(this.checkpointDir, `${channelId}.json`);
    if (!fs.existsSync(checkpointFile)) {
      return null;
    }

    try {
      const data = fs.readFileSync(checkpointFile, 'utf-8');
      return JSON.parse(data) as ChannelCheckpoint;
    } catch (error: any) {
      logger.warn('Failed to load checkpoint', {
        channelId,
        error: error.message
      });
      return null;
    }
  }

  /**
   * Save checkpoint to disk
   */
  private saveCheckpoint(checkpoint: ChannelCheckpoint): void {
    const checkpointFile = path.join(this.checkpointDir, `${checkpoint.channelId}.json`);

    try {
      fs.writeFileSync(checkpointFile, JSON.stringify(checkpoint, null, 2));
      logger.debug('Checkpoint saved', { channelId: checkpoint.channelId });
    } catch (error: any) {
      logger.warn('Failed to save checkpoint', {
        channelId: checkpoint.channelId,
        error: error.message
      });
    }
  }

  /**
   * Clear checkpoint for a channel
   */
  clearCheckpoint(channelId: string): void {
    const checkpointFile = path.join(this.checkpointDir, `${channelId}.json`);
    if (fs.existsSync(checkpointFile)) {
      fs.unlinkSync(checkpointFile);
      logger.info('Checkpoint cleared', { channelId });
    }
  }

  /**
   * Clear all checkpoints
   */
  clearAllCheckpoints(): void {
    if (fs.existsSync(this.checkpointDir)) {
      const files = fs.readdirSync(this.checkpointDir);
      for (const file of files) {
        if (file.endsWith('.json')) {
          fs.unlinkSync(path.join(this.checkpointDir, file));
        }
      }
      logger.info('All checkpoints cleared');
    }
  }

  /**
   * Get ingestion stats from database
   */
  async getIngestionStats(channelId?: string): Promise<any> {
    const pool = getDbPool();

    let query = `
      SELECT
        metadata->>'channel_id' as channel_id,
        metadata->>'channel_name' as channel_name,
        COUNT(*) as signal_count,
        MIN(created_at) as first_ingested,
        MAX(created_at) as last_ingested
      FROM signals
      WHERE source = 'slack'
    `;

    const params: any[] = [];

    if (channelId) {
      query += ` AND metadata->>'channel_id' = $1`;
      params.push(channelId);
    }

    query += `
      GROUP BY metadata->>'channel_id', metadata->>'channel_name'
      ORDER BY signal_count DESC
    `;

    const result = await pool.query(query, params);
    return result.rows;
  }
}
