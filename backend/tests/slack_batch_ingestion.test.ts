import { SlackBatchIngestionService } from '../services/slack_batch_ingestion_service';
import { WebClient } from '@slack/web-api';
import { config } from '../config/env';
import * as fs from 'fs';
import * as path from 'path';

// Mock WebClient
jest.mock('@slack/web-api');
jest.mock('../processing/signal_extractor', () => ({
  ingestSignal: jest.fn().mockResolvedValue({ id: 'test_signal_id' })
}));

describe('SlackBatchIngestionService', () => {
  let service: SlackBatchIngestionService;
  let mockWebClient: {
    conversations: {
      info: jest.Mock;
      history: jest.Mock;
      replies: jest.Mock;
    };
  };
  const checkpointDir = path.join(process.cwd(), 'data', 'checkpoints');

  beforeEach(() => {
    // Clear environment
    process.env.SLACK_BOT_TOKEN = 'xoxb-test-token';
    process.env.SLACK_CHANNEL_IDS = 'C123,C456';
    process.env.SLACK_BATCH_SIZE = '100';
    process.env.SLACK_MAX_MESSAGES_PER_CHANNEL = '500';
    process.env.SLACK_INCLUDE_THREADS = 'true';
    config.slack.botToken = process.env.SLACK_BOT_TOKEN;
    config.slack.channelIds = ['C123', 'C456'];
    config.slack.batchSize = 100;
    config.slack.maxMessagesPerChannel = 500;
    config.slack.includeThreads = true;

    // Mock WebClient
    mockWebClient = {
      conversations: {
        info: jest.fn(),
        history: jest.fn(),
        replies: jest.fn()
      }
    } as any;

    (WebClient as unknown as jest.Mock).mockImplementation(() => mockWebClient as any);

    service = new SlackBatchIngestionService();

    // Clean up checkpoint directory if it exists
    if (fs.existsSync(checkpointDir)) {
      const files = fs.readdirSync(checkpointDir);
      files.forEach(file => {
        if (file.endsWith('.json')) {
          fs.unlinkSync(path.join(checkpointDir, file));
        }
      });
    }
  });

  afterEach(() => {
    // Clean up
    if (fs.existsSync(checkpointDir)) {
      const files = fs.readdirSync(checkpointDir);
      files.forEach(file => {
        if (file.endsWith('.json')) {
          fs.unlinkSync(path.join(checkpointDir, file));
        }
      });
    }
  });

  describe('constructor', () => {
    it('should throw error if SLACK_BOT_TOKEN not set', () => {
      delete process.env.SLACK_BOT_TOKEN;
      config.slack.botToken = '';
      expect(() => new SlackBatchIngestionService()).toThrow('SLACK_BOT_TOKEN is required');
    });

    it('should create checkpoint directory if not exists', () => {
      expect(fs.existsSync(checkpointDir)).toBe(true);
    });
  });

  describe('ingestChannel', () => {
    it('should ingest messages from a channel', async () => {
      const channelId = 'C123';

      mockWebClient.conversations.info.mockResolvedValue({
        ok: true,
        channel: { name: 'test-channel' }
      } as any);

      mockWebClient.conversations.history.mockResolvedValue({
        ok: true,
        messages: [
          {
            ts: '1234.5678',
            text: 'Test message 1',
            user: 'U123'
          },
          {
            ts: '1234.5679',
            text: 'Test message 2',
            user: 'U124'
          }
        ],
        has_more: false
      } as any);

      const stats = await service.ingestChannel(channelId);

      expect(stats.channelId).toBe(channelId);
      expect(stats.channelName).toBe('test-channel');
      expect(stats.success).toBe(2);
      expect(stats.failed).toBe(0);
      expect(stats.skipped).toBe(0);
    });

    it('should skip bot messages', async () => {
      const channelId = 'C123';

      mockWebClient.conversations.info.mockResolvedValue({
        ok: true,
        channel: { name: 'test-channel' }
      } as any);

      mockWebClient.conversations.history.mockResolvedValue({
        ok: true,
        messages: [
          {
            ts: '1234.5678',
            text: 'User message',
            user: 'U123'
          },
          {
            ts: '1234.5679',
            text: 'Bot message',
            bot_id: 'B123',
            subtype: 'bot_message'
          }
        ],
        has_more: false
      } as any);

      const stats = await service.ingestChannel(channelId);

      expect(stats.success).toBe(1);
      expect(stats.skipped).toBe(1);
    });

    it('should skip messages without text', async () => {
      const channelId = 'C123';

      mockWebClient.conversations.info.mockResolvedValue({
        ok: true,
        channel: { name: 'test-channel' }
      } as any);

      mockWebClient.conversations.history.mockResolvedValue({
        ok: true,
        messages: [
          {
            ts: '1234.5678',
            text: 'Valid message',
            user: 'U123'
          },
          {
            ts: '1234.5679',
            text: '',
            user: 'U124'
          }
        ],
        has_more: false
      } as any);

      const stats = await service.ingestChannel(channelId);

      expect(stats.success).toBe(1);
      expect(stats.skipped).toBe(1);
    });

    it('should handle pagination', async () => {
      const channelId = 'C123';

      mockWebClient.conversations.info.mockResolvedValue({
        ok: true,
        channel: { name: 'test-channel' }
      } as any);

      // First call - has more messages
      mockWebClient.conversations.history
        .mockResolvedValueOnce({
          ok: true,
          messages: [
            { ts: '1234.5678', text: 'Message 1', user: 'U123' }
          ],
          has_more: true,
          response_metadata: { next_cursor: 'cursor_123' }
        } as any)
        .mockResolvedValueOnce({
          ok: true,
          messages: [
            { ts: '1234.5679', text: 'Message 2', user: 'U124' }
          ],
          has_more: false
        } as any);

      const stats = await service.ingestChannel(channelId);

      expect(stats.success).toBe(2);
      expect(mockWebClient.conversations.history).toHaveBeenCalledTimes(2);
    });

    it('should respect max messages per channel', async () => {
      const channelId = 'C123';

      mockWebClient.conversations.info.mockResolvedValue({
        ok: true,
        channel: { name: 'test-channel' }
      } as any);

      mockWebClient.conversations.history.mockResolvedValue({
        ok: true,
        messages: Array(100).fill(null).map((_, i) => ({
          ts: `1234.${5678 + i}`,
          text: `Message ${i}`,
          user: 'U123'
        })),
        has_more: true,
        response_metadata: { next_cursor: 'cursor_123' }
      } as any);

      const stats = await service.ingestChannel(channelId, { maxMessages: 50 });

      expect(stats.total).toBeLessThanOrEqual(50);
    });

    it('should fetch thread replies when includeThreads is true', async () => {
      process.env.SLACK_INCLUDE_THREADS = 'true';
      config.slack.includeThreads = true;
      const channelId = 'C123';

      mockWebClient.conversations.info.mockResolvedValue({
        ok: true,
        channel: { name: 'test-channel' }
      } as any);

      mockWebClient.conversations.history.mockResolvedValue({
        ok: true,
        messages: [
          {
            ts: '1234.5678',
            text: 'Parent message',
            user: 'U123',
            thread_ts: '1234.5678',
            reply_count: 2
          }
        ],
        has_more: false
      } as any);

      mockWebClient.conversations.replies.mockResolvedValue({
        ok: true,
        messages: [
          {
            ts: '1234.5678',
            text: 'Parent message',
            user: 'U123'
          },
          {
            ts: '1234.5680',
            text: 'Reply 1',
            user: 'U124'
          },
          {
            ts: '1234.5681',
            text: 'Reply 2',
            user: 'U125'
          }
        ]
      } as any);

      const stats = await service.ingestChannel(channelId);

      expect(stats.success).toBe(3); // Parent + 2 replies
      expect(stats.threadsProcessed).toBe(1);
      expect(mockWebClient.conversations.replies).toHaveBeenCalledWith({
        channel: channelId,
        ts: '1234.5678',
        limit: 1000
      });
    });

    it('should save checkpoints every 100 messages', async () => {
      const channelId = 'C123';

      mockWebClient.conversations.info.mockResolvedValue({
        ok: true,
        channel: { name: 'test-channel' }
      } as any);

      mockWebClient.conversations.history.mockResolvedValue({
        ok: true,
        messages: Array(150).fill(null).map((_, i) => ({
          ts: `1234.${5678 + i}`,
          text: `Message ${i}`,
          user: 'U123'
        })),
        has_more: false
      } as any);

      await service.ingestChannel(channelId);

      const checkpointFile = path.join(checkpointDir, `${channelId}.json`);
      expect(fs.existsSync(checkpointFile)).toBe(true);

      const checkpoint = JSON.parse(fs.readFileSync(checkpointFile, 'utf-8'));
      expect(checkpoint.channelId).toBe(channelId);
      expect(checkpoint.messagesProcessed).toBeGreaterThan(0);
    });

    it('should resume from checkpoint', async () => {
      const channelId = 'C123';

      // Create checkpoint
      const checkpoint = {
        channelId,
        lastMessageTs: '1234.5680',
        messagesProcessed: 50,
        updatedAt: new Date().toISOString()
      };
      fs.writeFileSync(
        path.join(checkpointDir, `${channelId}.json`),
        JSON.stringify(checkpoint)
      );

      mockWebClient.conversations.info.mockResolvedValue({
        ok: true,
        channel: { name: 'test-channel' }
      } as any);

      mockWebClient.conversations.history.mockResolvedValue({
        ok: true,
        messages: [
          { ts: '1234.5678', text: 'Old message 1', user: 'U123' },
          { ts: '1234.5679', text: 'Old message 2', user: 'U123' },
          { ts: '1234.5680', text: 'Checkpoint message', user: 'U123' },
          { ts: '1234.5681', text: 'New message', user: 'U123' }
        ],
        has_more: false
      } as any);

      const stats = await service.ingestChannel(channelId, { resume: true });

      // Should skip first 3 messages (including checkpoint)
      expect(stats.skipped).toBeGreaterThanOrEqual(3);
      expect(stats.success).toBe(1); // Only new message
    });
  });

  describe('ingestAllChannels', () => {
    it('should ingest from all configured channels', async () => {
      process.env.SLACK_CHANNEL_IDS = 'C123,C456';
      config.slack.channelIds = ['C123', 'C456'];

      mockWebClient.conversations.info
        .mockResolvedValueOnce({
          ok: true,
          channel: { name: 'channel-1' }
        } as any)
        .mockResolvedValueOnce({
          ok: true,
          channel: { name: 'channel-2' }
        } as any);

      mockWebClient.conversations.history.mockResolvedValue({
        ok: true,
        messages: [
          { ts: '1234.5678', text: 'Test message', user: 'U123' }
        ],
        has_more: false
      } as any);

      const allStats = await service.ingestAllChannels();

      expect(Object.keys(allStats)).toHaveLength(2);
      expect(allStats['C123']).toBeDefined();
      expect(allStats['C456']).toBeDefined();
    });

    it('should throw error if no channels configured', async () => {
      process.env.SLACK_CHANNEL_IDS = '';
      config.slack.channelIds = [];
      const newService = new SlackBatchIngestionService();

      await expect(newService.ingestAllChannels()).rejects.toThrow('No Slack channel IDs configured');
    });

    it('should skip channels in skipChannels list', async () => {
      process.env.SLACK_CHANNEL_IDS = 'C123,C456,C789';
      config.slack.channelIds = ['C123', 'C456', 'C789'];

      mockWebClient.conversations.info.mockResolvedValue({
        ok: true,
        channel: { name: 'test-channel' }
      } as any);

      mockWebClient.conversations.history.mockResolvedValue({
        ok: true,
        messages: [
          { ts: '1234.5678', text: 'Test message', user: 'U123' }
        ],
        has_more: false
      } as any);

      const allStats = await service.ingestAllChannels({
        skipChannels: ['C456']
      });

      expect(Object.keys(allStats)).toHaveLength(2);
      expect(allStats['C123']).toBeDefined();
      expect(allStats['C456']).toBeUndefined();
      expect(allStats['C789']).toBeDefined();
    });

    it('should handle channel ingestion failures', async () => {
      process.env.SLACK_CHANNEL_IDS = 'C123,C456';
      config.slack.channelIds = ['C123', 'C456'];

      mockWebClient.conversations.info
        .mockResolvedValueOnce({
          ok: true,
          channel: { name: 'channel-1' }
        } as any)
        .mockRejectedValueOnce(new Error('Channel not found'));

      mockWebClient.conversations.history
        .mockResolvedValueOnce({
          ok: true,
          messages: [
            { ts: '1234.5678', text: 'Test message', user: 'U123' }
          ],
          has_more: false
        } as any)
        .mockRejectedValueOnce(new Error('History fetch failed'));

      const allStats = await service.ingestAllChannels();

      expect(allStats['C123'].success).toBeGreaterThan(0);
      expect(allStats['C456'].success).toBe(0);
    });
  });

  describe('checkpoint management', () => {
    it('should clear checkpoint for a channel', () => {
      const channelId = 'C123';
      const checkpointFile = path.join(checkpointDir, `${channelId}.json`);

      // Create checkpoint
      fs.writeFileSync(checkpointFile, JSON.stringify({ channelId }));
      expect(fs.existsSync(checkpointFile)).toBe(true);

      service.clearCheckpoint(channelId);

      expect(fs.existsSync(checkpointFile)).toBe(false);
    });

    it('should clear all checkpoints', () => {
      // Create multiple checkpoints
      ['C123', 'C456', 'C789'].forEach(channelId => {
        fs.writeFileSync(
          path.join(checkpointDir, `${channelId}.json`),
          JSON.stringify({ channelId })
        );
      });

      service.clearAllCheckpoints();

      const files = fs.readdirSync(checkpointDir).filter(f => f.endsWith('.json'));
      expect(files.length).toBe(0);
    });
  });
});
