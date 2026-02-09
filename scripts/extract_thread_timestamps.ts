#!/usr/bin/env ts-node

import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const MESSAGES_FILE = '/Users/anusharm/.cursor/projects/Users-anusharm-learn-PM-cursor-system/agent-tools/d95e9433-1c13-4020-96b4-ea2117197ce6.txt';
const INTERMEDIATE_DIR = join(process.cwd(), 'data', 'intermediate');

interface SlackMessage {
  thread_ts?: string;
  reply_count?: number;
  ts: string;
  [key: string]: any;
}

function extractThreadTimestamps() {
  const fileContent = readFileSync(MESSAGES_FILE, 'utf-8');
  const data = JSON.parse(fileContent);
  const messages: SlackMessage[] = data.messages || [];
  
  const threads = new Map<string, { threadTs: string; replyCount: number; date: string }>();
  
  for (const msg of messages) {
    if (msg.thread_ts && msg.reply_count && msg.reply_count > 0) {
      if (!threads.has(msg.thread_ts)) {
        threads.set(msg.thread_ts, {
          threadTs: msg.thread_ts,
          replyCount: msg.reply_count,
          date: new Date(parseFloat(msg.thread_ts) * 1000).toISOString().split('T')[0]
        });
      }
    }
  }
  
  const threadArray = Array.from(threads.values()).sort((a, b) => b.threadTs.localeCompare(a.threadTs));
  
  const outputFile = join(INTERMEDIATE_DIR, 'thread_timestamps.json');
  writeFileSync(outputFile, JSON.stringify(threadArray, null, 2), 'utf-8');
  
  console.log(`Found ${threadArray.length} threads with replies`);
  console.log(`Saved to: ${outputFile}`);
  
  return threadArray;
}

if (require.main === module) {
  extractThreadTimestamps();
}

export { extractThreadTimestamps };
