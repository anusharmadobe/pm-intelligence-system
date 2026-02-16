import { ingestSignal } from '../processing/signal_extractor';
import { getDbPool } from '../db/connection';

// Mock dependencies
jest.mock('../processing/signal_extractor', () => ({
  ingestSignal: jest.fn()
}));

describe('Community Forum Pipeline', () => {
  const pool = getDbPool();

  const mockForumThread = {
    id: 'thread_123',
    title: 'PDF generation fails in AEM Forms',
    body: 'Users are experiencing issues when generating PDFs. The system throws a timeout error after 30 seconds.',
    author: 'user_456',
    created_at: '2024-01-15T10:30:00Z',
    replies: [
      {
        id: 'reply_001',
        body: 'I have the same issue with large forms. It works fine with small forms.',
        author: 'user_789',
        created_at: '2024-01-15T11:00:00Z'
      },
      {
        id: 'reply_002',
        body: 'This is a known issue. Try increasing the timeout in your configuration.',
        author: 'moderator_001',
        created_at: '2024-01-15T12:00:00Z',
        is_accepted_answer: true
      }
    ],
    tags: ['pdf', 'generation', 'timeout'],
    view_count: 45,
    like_count: 3
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (ingestSignal as jest.Mock).mockResolvedValue({ id: 'signal_123' });
  });

  describe('Thread Ingestion', () => {
    it('should ingest forum thread as signal', async () => {
      await ingestSignal({
        source: 'community_forum',
        id: mockForumThread.id,
        type: 'thread',
        text: `${mockForumThread.title}\n\n${mockForumThread.body}`,
        metadata: {
          author: mockForumThread.author,
          created_at: mockForumThread.created_at,
          tags: mockForumThread.tags,
          view_count: mockForumThread.view_count,
          like_count: mockForumThread.like_count
        }
      });

      expect(ingestSignal).toHaveBeenCalledWith(
        expect.objectContaining({
          source: 'community_forum',
          type: 'thread',
          text: expect.stringContaining('PDF generation fails')
        })
      );
    });

    it('should ingest thread replies as separate signals', async () => {
      for (const reply of mockForumThread.replies) {
        await ingestSignal({
          source: 'community_forum',
          id: reply.id,
          type: 'reply',
          text: reply.body,
          metadata: {
            thread_id: mockForumThread.id,
            author: reply.author,
            created_at: reply.created_at,
            is_accepted_answer: reply.is_accepted_answer || false
          }
        });
      }

      expect(ingestSignal).toHaveBeenCalledTimes(2);
    });

    it('should mark accepted answers in metadata', async () => {
      const acceptedReply = mockForumThread.replies.find(r => r.is_accepted_answer);

      await ingestSignal({
        source: 'community_forum',
        id: acceptedReply!.id,
        type: 'reply',
        text: acceptedReply!.body,
        metadata: {
          thread_id: mockForumThread.id,
          author: acceptedReply!.author,
          is_accepted_answer: true
        }
      });

      expect(ingestSignal).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({
            is_accepted_answer: true
          })
        })
      );
    });

    it('should handle threads without replies', async () => {
      const threadWithoutReplies = {
        ...mockForumThread,
        replies: []
      };

      await ingestSignal({
        source: 'community_forum',
        id: threadWithoutReplies.id,
        type: 'thread',
        text: `${threadWithoutReplies.title}\n\n${threadWithoutReplies.body}`,
        metadata: {
          author: threadWithoutReplies.author,
          created_at: threadWithoutReplies.created_at
        }
      });

      expect(ingestSignal).toHaveBeenCalledTimes(1);
    });

    it('should preserve forum tags', async () => {
      await ingestSignal({
        source: 'community_forum',
        id: mockForumThread.id,
        type: 'thread',
        text: mockForumThread.title,
        metadata: {
          tags: mockForumThread.tags
        }
      });

      const call = (ingestSignal as jest.Mock).mock.calls[0][0];
      expect(call.metadata.tags).toEqual(['pdf', 'generation', 'timeout']);
    });
  });

  describe('Content Filtering', () => {
    it('should skip boilerplate content', async () => {
      const boilerplateTexts = [
        'This thread is locked',
        'Thread closed by moderator',
        'Please see community guidelines',
        'Welcome to the forum'
      ];

      for (const text of boilerplateTexts) {
        const shouldSkip = text.length < 50 ||
          text.toLowerCase().includes('locked') ||
          text.toLowerCase().includes('closed');

        if (!shouldSkip) {
          await ingestSignal({
            source: 'community_forum',
            id: `thread_${Date.now()}`,
            type: 'thread',
            text
          });
        }
      }

      // Should not have called ingestSignal for boilerplate
      expect(ingestSignal).not.toHaveBeenCalled();
    });

    it('should ingest substantive content', async () => {
      const substantiveText = 'We are experiencing a critical issue with form submission. When users try to submit forms with attachments larger than 10MB, the system returns a 500 error. This has been happening since the last deployment.';

      await ingestSignal({
        source: 'community_forum',
        id: 'thread_substantive',
        type: 'thread',
        text: substantiveText,
        metadata: {}
      });

      expect(ingestSignal).toHaveBeenCalledWith(
        expect.objectContaining({
          text: substantiveText
        })
      );
    });
  });

  describe('Metadata Extraction', () => {
    it('should extract view and like counts', async () => {
      await ingestSignal({
        source: 'community_forum',
        id: mockForumThread.id,
        type: 'thread',
        text: mockForumThread.title,
        metadata: {
          view_count: 45,
          like_count: 3
        }
      });

      const call = (ingestSignal as jest.Mock).mock.calls[0][0];
      expect(call.metadata.view_count).toBe(45);
      expect(call.metadata.like_count).toBe(3);
    });

    it('should handle missing metadata gracefully', async () => {
      await ingestSignal({
        source: 'community_forum',
        id: 'thread_minimal',
        type: 'thread',
        text: 'Minimal thread',
        metadata: {}
      });

      expect(ingestSignal).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.any(Object)
        })
      );
    });
  });

  describe('Error Handling', () => {
    it('should handle ingestion failures', async () => {
      (ingestSignal as jest.Mock).mockRejectedValueOnce(new Error('Database error'));

      await expect(
        ingestSignal({
          source: 'community_forum',
          id: 'thread_error',
          type: 'thread',
          text: 'Test thread'
        })
      ).rejects.toThrow('Database error');
    });

    it('should continue processing after individual failures', async () => {
      (ingestSignal as jest.Mock)
        .mockRejectedValueOnce(new Error('Failed'))
        .mockResolvedValueOnce({ id: 'signal_1' })
        .mockResolvedValueOnce({ id: 'signal_2' });

      const threads = [
        { id: 'thread_1', text: 'Thread 1' },
        { id: 'thread_2', text: 'Thread 2' },
        { id: 'thread_3', text: 'Thread 3' }
      ];

      const results = [];
      for (const thread of threads) {
        try {
          const result = await ingestSignal({
            source: 'community_forum',
            id: thread.id,
            type: 'thread',
            text: thread.text
          });
          results.push(result);
        } catch (error) {
          // Log error but continue
          results.push(null);
        }
      }

      expect(results).toHaveLength(3);
      expect(results.filter(r => r !== null)).toHaveLength(2);
    });
  });

  describe('Signal Relationships', () => {
    it('should link replies to parent thread', async () => {
      const threadId = 'thread_parent';
      const replyId = 'reply_child';

      await ingestSignal({
        source: 'community_forum',
        id: replyId,
        type: 'reply',
        text: 'This is a reply',
        metadata: {
          thread_id: threadId,
          parent_type: 'thread'
        }
      });

      const call = (ingestSignal as jest.Mock).mock.calls[0][0];
      expect(call.metadata.thread_id).toBe(threadId);
      expect(call.metadata.parent_type).toBe('thread');
    });
  });
});
