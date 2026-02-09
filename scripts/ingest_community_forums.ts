#!/usr/bin/env ts-node
/**
 * Ingest community forum threads into signals schema.
 */
import 'dotenv/config';
import { readFileSync, readdirSync } from 'fs';
import { join, basename } from 'path';
import { ingestSignal } from '../backend/processing/signal_extractor';
import { mapForumThreadToRawSignals, ForumThread } from '../backend/processing/community_forum_mapper';
import { logger } from '../backend/utils/logger';

const DATA_DIR = join(process.cwd(), 'data', 'raw', 'community_forums');

async function ingestThread(thread: ForumThread, sourceFile: string) {
  const signals = mapForumThreadToRawSignals(thread, sourceFile);
  let posts = 0;
  let answers = 0;
  let comments = 0;

  for (const signal of signals) {
    await ingestSignal(signal);
    if (signal.type === 'community_post') posts++;
    else if (signal.type === 'community_answer') answers++;
    else comments++;
  }

  return { post: posts > 0, comments, answers };
}

async function ingestCommunityForums() {
  const files = readdirSync(DATA_DIR).filter(f => f.endsWith('.json'));
  if (files.length === 0) {
    throw new Error(`No JSON files found in ${DATA_DIR}`);
  }

  let totalThreads = 0;
  let totalPosts = 0;
  let totalComments = 0;
  let totalAnswers = 0;

  for (const file of files) {
    const filePath = join(DATA_DIR, file);
    const raw = readFileSync(filePath, 'utf-8');
    const threads: ForumThread[] = JSON.parse(raw);
    totalThreads += threads.length;

    for (const thread of threads) {
      try {
        const result = await ingestThread(thread, basename(file));
        if (result.post) totalPosts++;
        totalComments += result.comments;
        totalAnswers += result.answers;
      } catch (error: any) {
        logger.warn('Failed to ingest community thread', {
          error: error.message,
          url: thread.url
        });
      }
    }
  }

  console.log('\n✅ Community forums ingestion complete');
  console.log(`Threads: ${totalThreads}`);
  console.log(`Posts ingested: ${totalPosts}`);
  console.log(`Answers ingested: ${totalAnswers}`);
  console.log(`Comments ingested: ${totalComments}\n`);
}

if (require.main === module) {
  ingestCommunityForums().catch(error => {
    console.error('❌ Community forums ingestion failed:', error.message);
    process.exit(1);
  });
}

export { ingestCommunityForums };
