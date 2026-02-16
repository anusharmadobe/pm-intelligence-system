#!/usr/bin/env ts-node

/**
 * Slack Batch Ingestion Script
 *
 * Ingests messages from all configured Slack channels
 *
 * Usage:
 *   npm run ingest-slack                    # Ingest from all configured channels
 *   npm run ingest-slack -- --resume        # Resume from checkpoints
 *   npm run ingest-slack -- --clear         # Clear checkpoints before ingesting
 *   npm run ingest-slack -- --stats         # Show ingestion stats only
 *   npm run ingest-slack -- --channel C123  # Ingest single channel
 *
 * Environment Variables:
 *   SLACK_CHANNEL_IDS - Comma-separated list of channel IDs
 *   SLACK_BOT_TOKEN - Slack bot token
 *   SLACK_BATCH_SIZE - Batch size (default: 200)
 *   SLACK_MAX_MESSAGES_PER_CHANNEL - Max messages per channel (default: 10000)
 *   SLACK_INCLUDE_THREADS - Include thread replies (default: true)
 */

import * as dotenv from 'dotenv';
dotenv.config();

import { SlackBatchIngestionService, IngestStats } from '../backend/services/slack_batch_ingestion_service';
import { logger } from '../backend/utils/logger';
import { config } from '../backend/config/env';
import * as fs from 'fs';
import * as path from 'path';

interface ScriptOptions {
  resume: boolean;
  clear: boolean;
  stats: boolean;
  channel?: string;
  help: boolean;
}

function parseArgs(): ScriptOptions {
  const args = process.argv.slice(2);
  const options: ScriptOptions = {
    resume: false,
    clear: false,
    stats: false,
    help: false
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case '--resume':
        options.resume = true;
        break;
      case '--clear':
        options.clear = true;
        break;
      case '--stats':
        options.stats = true;
        break;
      case '--channel':
        options.channel = args[++i];
        break;
      case '--help':
      case '-h':
        options.help = true;
        break;
    }
  }

  return options;
}

function printHelp() {
  console.log(`
Slack Batch Ingestion Script

Usage:
  npm run ingest-slack [options]

Options:
  --resume              Resume from previous checkpoints
  --clear               Clear checkpoints before ingesting
  --stats               Show ingestion stats only (no ingestion)
  --channel <ID>        Ingest single channel by ID
  --help, -h            Show this help message

Environment Variables Required:
  SLACK_CHANNEL_IDS               Comma-separated list of channel IDs
  SLACK_BOT_TOKEN                 Slack bot token with channels:history scope

Optional Environment Variables:
  SLACK_BATCH_SIZE                Messages per API call (default: 200)
  SLACK_MAX_MESSAGES_PER_CHANNEL  Max messages per channel (default: 10000)
  SLACK_INCLUDE_THREADS           Include thread replies (default: true)

Examples:
  npm run ingest-slack
  npm run ingest-slack -- --resume
  npm run ingest-slack -- --clear
  npm run ingest-slack -- --channel C04D195JVGS
  npm run ingest-slack -- --stats
`);
}

function printConfig() {
  console.log('\n📋 Configuration');
  console.log('================');
  console.log(`Slack Bot Token: ${config.slack.botToken ? '✓ Set' : '✗ Not set'}`);
  console.log(`Channel IDs: ${config.slack.channelIds.length > 0 ? config.slack.channelIds.join(', ') : '✗ None configured'}`);
  console.log(`Batch Size: ${config.slack.batchSize}`);
  console.log(`Max Messages Per Channel: ${config.slack.maxMessagesPerChannel}`);
  console.log(`Include Threads: ${config.slack.includeThreads ? 'Yes' : 'No'}`);
  console.log('');
}

function printStats(allStats: Record<string, IngestStats>) {
  console.log('\n📊 Ingestion Summary');
  console.log('====================');

  const channels = Object.values(allStats);
  const totalMessages = channels.reduce((sum, s) => sum + s.total, 0);
  const totalSuccess = channels.reduce((sum, s) => sum + s.success, 0);
  const totalFailed = channels.reduce((sum, s) => sum + s.failed, 0);
  const totalSkipped = channels.reduce((sum, s) => sum + s.skipped, 0);
  const totalThreads = channels.reduce((sum, s) => sum + s.threadsProcessed, 0);

  console.log(`Total Channels: ${channels.length}`);
  console.log(`Total Messages Processed: ${totalMessages}`);
  console.log(`  ✓ Success: ${totalSuccess}`);
  console.log(`  ✗ Failed: ${totalFailed}`);
  console.log(`  ⊝ Skipped: ${totalSkipped}`);
  console.log(`Thread Conversations: ${totalThreads}`);
  console.log('');

  console.log('Per-Channel Breakdown:');
  console.log('----------------------');
  for (const stats of channels) {
    const channelLabel = stats.channelName ? `#${stats.channelName}` : stats.channelId;
    console.log(`\n${channelLabel} (${stats.channelId})`);
    console.log(`  Total: ${stats.total}`);
    console.log(`  Success: ${stats.success}`);
    console.log(`  Failed: ${stats.failed}`);
    console.log(`  Skipped: ${stats.skipped}`);
    console.log(`  Threads: ${stats.threadsProcessed}`);
    if (stats.lastMessageTs) {
      console.log(`  Last TS: ${stats.lastMessageTs}`);
    }
  }
  console.log('');
}

async function main() {
  const options = parseArgs();

  if (options.help) {
    printHelp();
    process.exit(0);
  }

  console.log('\n🚀 Slack Batch Ingestion');
  console.log('========================\n');

  // Validate configuration
  printConfig();

  if (!config.slack.botToken) {
    console.error('❌ Error: SLACK_BOT_TOKEN not set in environment');
    console.error('   Please set SLACK_BOT_TOKEN in your .env file\n');
    process.exit(1);
  }

  if (config.slack.channelIds.length === 0 && !options.channel) {
    console.error('❌ Error: No Slack channels configured');
    console.error('   Please set SLACK_CHANNEL_IDS in your .env file');
    console.error('   Or use --channel flag to specify a channel\n');
    process.exit(1);
  }

  const service = new SlackBatchIngestionService();

  // Show stats only
  if (options.stats) {
    console.log('📊 Fetching ingestion stats from database...\n');
    const dbStats = await service.getIngestionStats();

    if (dbStats.length === 0) {
      console.log('No Slack messages found in database yet.\n');
    } else {
      console.log('Database Stats:');
      console.log('---------------');
      for (const row of dbStats) {
        const channelLabel = row.channel_name ? `#${row.channel_name}` : row.channel_id;
        console.log(`\n${channelLabel}`);
        console.log(`  Signals: ${row.signal_count}`);
        console.log(`  First: ${new Date(row.first_ingested).toLocaleString()}`);
        console.log(`  Last: ${new Date(row.last_ingested).toLocaleString()}`);
      }
      console.log('');
    }
    process.exit(0);
  }

  // Clear checkpoints if requested
  if (options.clear) {
    console.log('🗑️  Clearing checkpoints...\n');
    service.clearAllCheckpoints();
    console.log('✓ Checkpoints cleared\n');
  }

  // Start ingestion
  const startTime = Date.now();
  let allStats: Record<string, IngestStats>;

  try {
    if (options.channel) {
      // Single channel ingestion
      console.log(`📥 Ingesting single channel: ${options.channel}\n`);
      const stats = await service.ingestChannel(options.channel, {
        resume: options.resume
      });
      allStats = { [options.channel]: stats };
    } else {
      // Multi-channel ingestion
      console.log(`📥 Ingesting ${config.slack.channelIds.length} channels...\n`);
      allStats = await service.ingestAllChannels({
        resume: options.resume
      });
    }

    const duration = Date.now() - startTime;
    const durationSec = (duration / 1000).toFixed(2);

    console.log(`\n✅ Ingestion Complete!`);
    console.log(`   Duration: ${durationSec}s\n`);

    printStats(allStats);

    // Save summary to file
    const outputDir = path.join(process.cwd(), 'output');
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
    const summaryFile = path.join(outputDir, `slack_ingestion_summary_${timestamp}.json`);

    const summary = {
      timestamp: new Date().toISOString(),
      duration_ms: duration,
      options: {
        resume: options.resume,
        channel: options.channel
      },
      config: {
        channelIds: config.slack.channelIds,
        batchSize: config.slack.batchSize,
        maxMessagesPerChannel: config.slack.maxMessagesPerChannel,
        includeThreads: config.slack.includeThreads
      },
      stats: allStats
    };

    fs.writeFileSync(summaryFile, JSON.stringify(summary, null, 2));
    console.log(`📄 Summary saved to: ${summaryFile}\n`);

    logger.info('Slack batch ingestion complete', summary);

  } catch (error: any) {
    console.error('\n❌ Ingestion failed:', error.message);
    logger.error('Slack batch ingestion failed', {
      error: error.message,
      stack: error.stack
    });
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('\n❌ Fatal error:', error.message);
  logger.error('Fatal error in Slack batch ingestion', {
    error: error.message,
    stack: error.stack
  });
  process.exit(1);
});
