import { buildCommentKey, buildThreadText, mapForumThreadToRawSignals, ForumThread } from '../processing/community_forum_mapper';

describe('community forum mapper', () => {
  it('builds thread text from title and description', () => {
    const thread: ForumThread = {
      url: 'https://example.com/thread/1',
      title: 'Title',
      description: 'Body text'
    };

    expect(buildThreadText(thread)).toBe('Title\n\nBody text');
  });

  it('deduplicates accepted answer when comment is identical', () => {
    const thread: ForumThread = {
      url: 'https://example.com/thread/2',
      title: 'Question',
      description: 'How do I do X?',
      accepted_answer: {
        author: 'Support',
        date: '2026-02-01 10:00:00',
        text: 'Use setting Y.',
        is_accepted: true
      },
      comments: [
        {
          author: 'Support',
          date: '2026-02-01 10:00:00',
          text: 'Use setting Y.',
          is_accepted: true
        },
        {
          author: 'Other',
          date: '2026-02-01 11:00:00',
          text: 'Thanks, that worked.'
        }
      ]
    };

    const key = buildCommentKey(thread.accepted_answer);
    expect(key).toBeTruthy();

    const signals = mapForumThreadToRawSignals(thread, 'sample.json');
    expect(signals).toHaveLength(3);

    const types = signals.map(s => s.type);
    expect(types).toContain('community_post');
    expect(types).toContain('community_answer');
    expect(types).toContain('community_comment');
  });
});
