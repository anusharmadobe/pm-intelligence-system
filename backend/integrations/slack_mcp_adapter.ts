import { ingestSignal, RawSignal } from '../processing/signal_extractor';
import { 
  autoRegisterChannel, 
  getActiveChannels, 
  getChannelConfig,
  ChannelConfig 
} from '../services/channel_registry_service';
import { logger } from '../utils/logger';

/**
 * Slack MCP Integration for PM Intelligence System
 * Uses Cursor's built-in Slack MCP to read messages and ingest as signals
 * Supports parallel multi-channel ingestion with channel registry integration
 */

/**
 * Result of channel ingestion
 */
export interface ChannelIngestionResult {
  channel: string;
  channelId?: string;
  count: number;
  errors: string[];
  durationMs: number;
}

/**
 * Ingests Slack messages from a channel using Cursor's Slack MCP
 */
export async function ingestSlackChannelViaMCP(
  channelName: string,
  limit: number = 50
): Promise<number> {
  // Note: This function will be called from Cursor extension context
  // where Slack MCP is available via vscode.mcp or similar API
  
  let ingestedCount = 0;
  
  try {
    // Get Slack MCP client (available in Cursor extension context)
    // This is a placeholder - actual implementation depends on Cursor's MCP API
    const slackMCP = (global as any).slackMCP || (global as any).mcp?.slack;
    
    if (!slackMCP) {
      throw new Error('Slack MCP not available. Ensure Slack MCP is enabled in Cursor settings.');
    }

    // Get channel ID from channel name
    const channels = await slackMCP.listChannels();
    const channel = channels.find((c: any) => 
      c.name === channelName.replace('#', '') || 
      c.id === channelName
    );

    if (!channel) {
      throw new Error(`Channel '${channelName}' not found`);
    }

    // Get recent messages from channel
    const messages = await slackMCP.getChannelHistory({
      channel_id: channel.id,
      limit: limit
    });

    // Ingest each message as a signal
    for (const message of messages.messages || []) {
      // Skip bot messages and system messages
      if (message.subtype || message.bot_id) {
        continue;
      }

      const signal: RawSignal = {
        source: 'slack',
        id: message.ts || message.event_ts,
        type: 'message',
        text: message.text || '',
        metadata: {
          channel: channel.name,
          channel_id: channel.id,
          user: message.user,
          timestamp: message.ts,
          thread_ts: message.thread_ts,
          permalink: message.permalink
        }
      };

      try {
        await ingestSignal(signal);
        ingestedCount++;
      } catch (error: any) {
        console.warn(`Failed to ingest message ${message.ts}:`, error.message);
      }
    }

    return ingestedCount;
  } catch (error: any) {
    throw new Error(`Slack MCP ingestion failed: ${error.message}`);
  }
}

/**
 * Ingests Slack mentions using Cursor's Slack MCP
 */
export async function ingestSlackMentionsViaMCP(
  limit: number = 50
): Promise<number> {
  let ingestedCount = 0;
  
  try {
    const slackMCP = (global as any).slackMCP || (global as any).mcp?.slack;
    
    if (!slackMCP) {
      throw new Error('Slack MCP not available');
    }

    // Search for messages mentioning the app/bot
    const searchResults = await slackMCP.searchMessages({
      query: 'on:me',
      count: limit
    });

    for (const message of searchResults.messages || []) {
      const signal: RawSignal = {
        source: 'slack',
        id: message.ts,
        type: 'mention',
        text: message.text || '',
        metadata: {
          channel: message.channel?.name,
          channel_id: message.channel?.id,
          user: message.user,
          timestamp: message.ts
        }
      };

      try {
        await ingestSignal(signal);
        ingestedCount++;
      } catch (error: any) {
        console.warn(`Failed to ingest mention ${message.ts}:`, error.message);
      }
    }

    return ingestedCount;
  } catch (error: any) {
    throw new Error(`Slack MCP mention ingestion failed: ${error.message}`);
  }
}

/**
 * Ingests Slack messages from multiple channels in PARALLEL
 * Uses Promise.allSettled for graceful failure handling
 */
export async function ingestSlackChannelsViaMCP(
  channelNames: string[],
  limitPerChannel: number = 50,
  options?: {
    autoRegister?: boolean;  // Auto-register unknown channels
    maxConcurrency?: number; // Limit parallel requests (default: 5)
  }
): Promise<ChannelIngestionResult[]> {
  const { autoRegister = true, maxConcurrency = 5 } = options || {};
  
  logger.info('Starting parallel channel ingestion', { 
    channelCount: channelNames.length, 
    limitPerChannel,
    maxConcurrency 
  });
  
  const startTime = Date.now();
  
  // Process in batches to respect concurrency limit
  const results: ChannelIngestionResult[] = [];
  
  for (let i = 0; i < channelNames.length; i += maxConcurrency) {
    const batch = channelNames.slice(i, i + maxConcurrency);
    
    const batchResults = await Promise.allSettled(
      batch.map(async (channelName) => {
        const channelStartTime = Date.now();
        const errors: string[] = [];
        
        try {
          const count = await ingestSlackChannelViaMCP(channelName, limitPerChannel);
          
          // Auto-register channel if enabled
          if (autoRegister) {
            try {
              const slackMCP = (global as any).slackMCP || (global as any).mcp?.slack;
              if (slackMCP) {
                const channels = await slackMCP.listChannels();
                const channel = channels.find((c: any) => 
                  c.name === channelName.replace('#', '') || c.id === channelName
                );
                if (channel) {
                  await autoRegisterChannel(channel.id, channel.name);
                }
              }
            } catch (regError: any) {
              // Non-fatal: channel registration failed
              errors.push(`Channel registration warning: ${regError.message}`);
            }
          }
          
          return {
            channel: channelName,
            count,
            errors,
            durationMs: Date.now() - channelStartTime
          };
        } catch (error: any) {
          errors.push(error.message);
          return {
            channel: channelName,
            count: 0,
            errors,
            durationMs: Date.now() - channelStartTime
          };
        }
      })
    );
    
    // Process settled results
    for (const result of batchResults) {
      if (result.status === 'fulfilled') {
        results.push(result.value);
      } else {
        results.push({
          channel: 'unknown',
          count: 0,
          errors: [result.reason?.message || 'Unknown error'],
          durationMs: 0
        });
      }
    }
  }
  
  const totalDuration = Date.now() - startTime;
  const totalIngested = results.reduce((sum, r) => sum + r.count, 0);
  const totalErrors = results.reduce((sum, r) => sum + r.errors.length, 0);
  
  logger.info('Parallel channel ingestion complete', {
    channelCount: channelNames.length,
    totalIngested,
    totalErrors,
    durationMs: totalDuration
  });
  
  return results;
}

/**
 * Ingests all active channels from the channel registry
 * Automatically reads channel configuration and applies weights
 */
export async function ingestActiveChannelsViaMCP(
  limitPerChannel: number = 50
): Promise<ChannelIngestionResult[]> {
  try {
    const activeChannels = await getActiveChannels();
    
    if (activeChannels.length === 0) {
      logger.warn('No active channels found in registry');
      return [];
    }
    
    logger.info('Ingesting active channels from registry', { 
      channelCount: activeChannels.length 
    });
    
    const channelNames = activeChannels.map(c => c.channelId);
    return ingestSlackChannelsViaMCP(channelNames, limitPerChannel, { autoRegister: false });
  } catch (error: any) {
    logger.error('Failed to ingest active channels', { error: error.message });
    throw error;
  }
}

/**
 * Ingests channels by category from the registry
 */
export async function ingestChannelsByCategoryViaMCP(
  category: ChannelConfig['category'],
  limitPerChannel: number = 50
): Promise<ChannelIngestionResult[]> {
  const { getChannelsByCategory } = await import('../services/channel_registry_service');
  
  try {
    const channels = await getChannelsByCategory(category);
    
    if (channels.length === 0) {
      logger.warn('No channels found for category', { category });
      return [];
    }
    
    logger.info('Ingesting channels by category', { 
      category, 
      channelCount: channels.length 
    });
    
    const channelIds = channels.map(c => c.channelId);
    return ingestSlackChannelsViaMCP(channelIds, limitPerChannel, { autoRegister: false });
  } catch (error: any) {
    logger.error('Failed to ingest channels by category', { error: error.message, category });
    throw error;
  }
}

/**
 * Gets ingestion statistics for monitoring
 */
export function summarizeIngestionResults(results: ChannelIngestionResult[]): {
  totalChannels: number;
  successfulChannels: number;
  failedChannels: number;
  totalSignalsIngested: number;
  totalErrors: number;
  avgDurationMs: number;
} {
  const successful = results.filter(r => r.errors.length === 0);
  const failed = results.filter(r => r.errors.length > 0 && r.count === 0);
  
  return {
    totalChannels: results.length,
    successfulChannels: successful.length,
    failedChannels: failed.length,
    totalSignalsIngested: results.reduce((sum, r) => sum + r.count, 0),
    totalErrors: results.reduce((sum, r) => sum + r.errors.length, 0),
    avgDurationMs: results.length > 0 
      ? Math.round(results.reduce((sum, r) => sum + r.durationMs, 0) / results.length)
      : 0
  };
}
