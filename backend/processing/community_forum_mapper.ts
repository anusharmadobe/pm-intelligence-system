import { RawSignal } from './signal_extractor';

export interface ForumComment {
  author?: string;
  date?: string;
  text?: string;
  is_accepted?: boolean;
  likes?: number;
}

export interface ForumThread {
  url: string;
  title?: string;
  author?: string;
  date_posted?: string;
  description?: string;
  tags?: string[];
  views?: number;
  replies_count?: number;
  likes?: number;
  status?: string;
  accepted_answer?: ForumComment | null;
  comments?: ForumComment[];
  scraped_at?: string;
}

export function buildCommentKey(comment?: ForumComment | null): string | null {
  if (!comment) return null;
  const text = (comment.text || '').trim();
  if (!text) return null;
  return [
    (comment.author || '').trim().toLowerCase(),
    (comment.date || '').trim(),
    text.slice(0, 200).toLowerCase()
  ].join('|');
}

export function buildThreadText(thread: ForumThread): string {
  const title = (thread.title || '').trim();
  const description = (thread.description || '').trim();
  if (title && description) return `${title}\n\n${description}`;
  return title || description;
}

export function mapForumThreadToRawSignals(
  thread: ForumThread,
  sourceFile: string
): RawSignal[] {
  const text = buildThreadText(thread);
  if (!text || text.trim().length < 10) return [];

  const baseMetadata = {
    source_type: 'community_forum',
    record_type: 'thread',
    url: thread.url,
    title: thread.title,
    author: thread.author,
    date_posted: thread.date_posted,
    tags: thread.tags || [],
    views: thread.views ?? null,
    replies_count: thread.replies_count ?? null,
    likes: thread.likes ?? null,
    status: thread.status,
    scraped_at: thread.scraped_at,
    source_file: sourceFile
  };

  const signals: RawSignal[] = [
    {
      source: 'manual',
      id: thread.url,
      type: 'community_post',
      text,
      metadata: baseMetadata
    }
  ];

  const seen = new Set<string>();
  const acceptedKey = buildCommentKey(thread.accepted_answer);
  if (acceptedKey) seen.add(acceptedKey);

  if (thread.accepted_answer?.text && thread.accepted_answer.text.trim().length >= 10) {
    signals.push({
      source: 'manual',
      id: `${thread.url}#accepted`,
      type: 'community_answer',
      text: thread.accepted_answer.text,
      metadata: {
        ...baseMetadata,
        record_type: 'accepted_answer',
        answer_author: thread.accepted_answer.author,
        answer_date: thread.accepted_answer.date,
        answer_likes: thread.accepted_answer.likes ?? null,
        is_accepted: true
      }
    });
  }

  const commentList = thread.comments || [];
  for (let i = 0; i < commentList.length; i++) {
    const comment = commentList[i];
    const commentText = (comment.text || '').trim();
    if (!commentText || commentText.length < 10) continue;
    const key = buildCommentKey(comment);
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);

    signals.push({
      source: 'manual',
      id: `${thread.url}#comment-${i + 1}`,
      type: comment.is_accepted ? 'community_answer' : 'community_comment',
      text: commentText,
      metadata: {
        ...baseMetadata,
        record_type: comment.is_accepted ? 'accepted_comment' : 'comment',
        comment_author: comment.author,
        comment_date: comment.date,
        comment_likes: comment.likes ?? null,
        is_accepted: comment.is_accepted ?? false
      }
    });
  }

  return signals;
}
