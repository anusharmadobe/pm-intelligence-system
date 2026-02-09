#!/usr/bin/env ts-node

/**
 * Ingest all data from customer_engagement_C04D195JVGS_complete.json into PM system
 * This includes:
 * 1. Parent engagement messages (notes)
 * 2. All thread replies
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import * as dotenv from 'dotenv';

dotenv.config();

const CHANNEL_ID = 'C04D195JVGS';
const RAW_DATA_DIR = join(process.cwd(), 'data', 'raw', 'slack', CHANNEL_ID);
const INTERMEDIATE_DIR = join(process.cwd(), 'data', 'intermediate');
const COMPLETE_DATA_FILE = join(RAW_DATA_DIR, 'customer_engagement_C04D195JVGS_complete.json');
const INGESTION_PROGRESS_FILE = join(INTERMEDIATE_DIR, 'ingestion_progress.json');
const API_BASE = process.env.API_BASE || 'http://localhost:3000';

interface ThreadReply {
  id: string;
  timestamp: string;
  date: string;
  user: string;
  userId: string;
  text: string;
  isBot: boolean;
  rawData?: any;
}

interface Engagement {
  id: string;
  timestamp: string;
  date: string;
  customerName?: string;
  pmName?: string;
  notes?: string;
  threadReplies?: ThreadReply[];
  [key: string]: any;
}

interface CompleteData {
  channelId: string;
  fetchedAt: string;
  totalEngagements: number;
  totalReplies?: number;
  engagements: Engagement[];
}

interface IngestionProgress {
  ingestedEngagements: string[];
  ingestedReplies: string[];
  failed: Array<{ id: string; type: 'engagement' | 'reply'; error: string }>;
  totalIngested: number;
  totalFailed: number;
}

/**
 * Ingest a single signal via API
 */
async function ingestSignal(
  id: string,
  text: string,
  metadata: any,
  type: 'engagement' | 'reply' = 'reply'
): Promise<boolean> {
  // Skip empty messages or messages that are too short (API requires min 10 chars)
  if (!text || text.trim().length < 10) {
    return false;
  }

  try {
    const response = await fetch(`${API_BASE}/api/signals`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'X-Bulk-Ingestion': 'true' // Bypass rate limiting for bulk ingestion
      },
      body: JSON.stringify({
        source: 'slack',
        id: id,
        type: 'message',
        text: text,
        metadata: {
          channel_id: CHANNEL_ID,
          ...metadata,
          is_thread_reply: type === 'reply',
          is_engagement: type === 'engagement'
        }
      })
    });

    if (response.ok) {
      return true;
    } else {
      const errorData = await response.json() as { error?: string };
      // Ignore duplicate errors
      if (errorData.error?.includes('duplicate') || 
          errorData.error?.includes('already exists') ||
          errorData.error?.includes('unique constraint')) {
        return true; // Count as success
      }
      // Handle rate limiting with retry
      if (response.status === 429 || errorData.error?.includes('Too many requests')) {
        // Wait 70 seconds (1 minute + buffer) for rate limit window to reset
        console.log(`  ⚠ Rate limited, waiting 70 seconds for rate limit window to reset...`);
        await new Promise(resolve => setTimeout(resolve, 70000));
        // Retry the request (up to 3 times)
        for (let retryAttempt = 1; retryAttempt <= 3; retryAttempt++) {
          const retryResponse = await fetch(`${API_BASE}/api/signals`, {
            method: 'POST',
            headers: { 
              'Content-Type': 'application/json',
              'X-Bulk-Ingestion': 'true' // Bypass rate limiting for bulk ingestion
            },
            body: JSON.stringify({
              source: 'slack',
              id: id,
              type: 'message',
              text: text,
              metadata: {
                channel_id: CHANNEL_ID,
                ...metadata,
                is_thread_reply: type === 'reply',
                is_engagement: type === 'engagement'
              }
            })
          });
          if (retryResponse.ok) {
            return true;
          } else if (retryResponse.status === 429 && retryAttempt < 3) {
            // Still rate limited, wait another minute
            console.log(`  ⚠ Still rate limited, waiting another 70 seconds (attempt ${retryAttempt + 1}/3)...`);
            await new Promise(resolve => setTimeout(resolve, 70000));
            continue;
          } else {
            const retryErrorData = await retryResponse.json() as { error?: string };
            throw new Error(retryErrorData.error || `HTTP ${retryResponse.status} (after ${retryAttempt} retries)`);
          }
        }
      }
      throw new Error(errorData.error || `HTTP ${response.status}`);
    }
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new Error(`Ingestion failed: ${errorMessage}`);
  }
}

/**
 * Check if API server is running
 */
async function checkAPIServer(): Promise<boolean> {
  try {
    const response = await fetch(`${API_BASE}/health`);
    return response.ok;
  } catch (error) {
    return false;
  }
}

/**
 * Main ingestion function
 */
async function ingestAllData() {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`📤 Ingesting All Data into PM System`);
  console.log(`${'='.repeat(60)}\n`);
  console.log(`Data File: ${COMPLETE_DATA_FILE}`);
  console.log(`API Base: ${API_BASE}\n`);

  // Check if API server is running
  console.log('🔍 Checking API server...');
  const apiRunning = await checkAPIServer();
  if (!apiRunning) {
    throw new Error(
      `API server is not running at ${API_BASE}\n` +
      `Please start the backend server first:\n` +
      `  cd backend && npm run dev`
    );
  }
  console.log('✅ API server is running\n');

  // Load complete data
  if (!existsSync(COMPLETE_DATA_FILE)) {
    throw new Error(`Complete data file not found: ${COMPLETE_DATA_FILE}`);
  }

  console.log('📖 Loading complete data...');
  const completeData: CompleteData = JSON.parse(readFileSync(COMPLETE_DATA_FILE, 'utf-8'));
  console.log(`✅ Loaded ${completeData.engagements.length} engagements`);
  console.log(`   Total replies: ${completeData.totalReplies || 0}\n`);

  // Load progress if exists
  let progress: IngestionProgress = {
    ingestedEngagements: [],
    ingestedReplies: [],
    failed: [],
    totalIngested: 0,
    totalFailed: 0
  };

  if (existsSync(INGESTION_PROGRESS_FILE)) {
    progress = JSON.parse(readFileSync(INGESTION_PROGRESS_FILE, 'utf-8'));
    console.log(`📊 Resuming ingestion...`);
    console.log(`   Already ingested: ${progress.totalIngested} signals`);
    console.log(`   Failed: ${progress.totalFailed}\n`);
  }

  const BATCH_SIZE = 10;
  let ingestedCount = 0;
  let failedCount = 0;

  // Phase 1: Ingest parent engagement messages
  console.log(`${'='.repeat(60)}`);
  console.log(`PHASE 1: Ingesting Parent Engagement Messages`);
  console.log(`${'='.repeat(60)}\n`);

  for (let i = 0; i < completeData.engagements.length; i++) {
    const engagement = completeData.engagements[i];
    const engagementId = engagement.id;

    // Skip if already ingested
    if (progress.ingestedEngagements.includes(engagementId)) {
      continue;
    }

    // Skip if no notes (API requires min 10 chars)
    if (!engagement.notes || engagement.notes.trim().length < 10) {
      continue;
    }

    console.log(`[${i + 1}/${completeData.engagements.length}] Ingesting engagement ${engagementId.substring(0, 10)}...`);

    try {
      const success = await ingestSignal(
        engagementId,
        engagement.notes,
        {
          customer_name: engagement.customerName || '',
          pm_name: engagement.pmName || '',
          timestamp: engagement.timestamp,
          date: engagement.date,
          thread_ts: engagementId,
          reply_count: engagement.threadReplies?.length || 0
        },
        'engagement'
      );

      if (success) {
        progress.ingestedEngagements.push(engagementId);
        ingestedCount++;
        console.log(`  ✓ Ingested\n`);
      } else {
        console.log(`  ⚠ Skipped (empty)\n`);
      }

      // Save progress every BATCH_SIZE
      if ((i + 1) % BATCH_SIZE === 0) {
        progress.totalIngested = ingestedCount;
        progress.totalFailed = failedCount;
        writeFileSync(INGESTION_PROGRESS_FILE, JSON.stringify(progress, null, 2), 'utf-8');
        console.log(`💾 Progress saved (${i + 1}/${completeData.engagements.length})\n`);
      }

      // Small delay to avoid overwhelming the server (reduced since we bypass rate limiting)
      await new Promise(resolve => setTimeout(resolve, 100));

      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`  ❌ Error: ${errorMessage}\n`);
        progress.failed.push({
          id: engagementId,
          type: 'engagement',
          error: errorMessage
        });
      failedCount++;
      progress.totalFailed = failedCount;

      // Save progress on error
      writeFileSync(INGESTION_PROGRESS_FILE, JSON.stringify(progress, null, 2), 'utf-8');

      // Stop on first error for debugging
      console.error(`\n${'='.repeat(60)}\n`);
      console.error(`🛑 STOPPING: Error encountered. Fix the issue and re-run the script.\n`);
      console.error(`   Failed engagement: ${engagementId}`);
      console.error(`   Error: ${errorMessage}\n`);
      console.error(`   Progress saved to: ${INGESTION_PROGRESS_FILE}\n`);
      console.error(`${'='.repeat(60)}\n`);
      throw error;
    }
  }

  // Phase 2: Ingest thread replies
  console.log(`\n${'='.repeat(60)}`);
  console.log(`PHASE 2: Ingesting Thread Replies`);
  console.log(`${'='.repeat(60)}\n`);

  let totalReplies = 0;
  let repliesIngested = 0;

  for (const engagement of completeData.engagements) {
    if (!engagement.threadReplies || engagement.threadReplies.length === 0) {
      continue;
    }

    for (const reply of engagement.threadReplies) {
      totalReplies++;

      // Skip if already ingested
      if (progress.ingestedReplies.includes(reply.id)) {
        continue;
      }

      // Skip bots and empty messages (API requires min 10 chars)
      if (reply.isBot || !reply.text || reply.text.trim().length < 10) {
        continue;
      }

      if (totalReplies % 50 === 0) {
        console.log(`[${totalReplies}/${completeData.totalReplies || '?'}] Ingesting reply ${reply.id.substring(0, 10)}...`);
      }

      try {
        const success = await ingestSignal(
          reply.id,
          reply.text,
          {
            customer_name: engagement.customerName || '',
            pm_name: engagement.pmName || '',
            user: reply.user,
            user_id: reply.userId,
            user_name: reply.user,
            timestamp: reply.timestamp,
            date: reply.date,
            thread_ts: engagement.id,
            parent_thread: engagement.id,
            is_bot: reply.isBot
          },
          'reply'
        );

        if (success) {
          progress.ingestedReplies.push(reply.id);
          repliesIngested++;
          ingestedCount++;

          if (totalReplies % 50 === 0) {
            console.log(`  ✓ Ingested\n`);
          }
        }

        // Save progress every 100 replies
        if (repliesIngested % 100 === 0) {
          progress.totalIngested = ingestedCount;
          progress.totalFailed = failedCount;
          writeFileSync(INGESTION_PROGRESS_FILE, JSON.stringify(progress, null, 2), 'utf-8');
          if (totalReplies % 50 === 0) {
            console.log(`💾 Progress saved (${repliesIngested} replies ingested)\n`);
          }
        }

        // Small delay to avoid overwhelming the server (reduced since we bypass rate limiting)
        await new Promise(resolve => setTimeout(resolve, 50));

      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        // Skip validation errors for short messages (already filtered, but handle edge cases)
        if (errorMessage.includes('Text content must be at least 10 characters')) {
          if (totalReplies % 50 === 0) {
            console.log(`  ⚠ Skipped short reply ${reply.id}\n`);
          }
          continue;
        }
        console.error(`\n❌ Error ingesting reply ${reply.id}: ${errorMessage}\n`);
        progress.failed.push({
          id: reply.id,
          type: 'reply',
          error: errorMessage
        });
        failedCount++;
        progress.totalFailed = failedCount;

        // Save progress on error
        writeFileSync(INGESTION_PROGRESS_FILE, JSON.stringify(progress, null, 2), 'utf-8');

        // Stop on first non-validation error for debugging
        console.error(`\n${'='.repeat(60)}\n`);
        console.error(`🛑 STOPPING: Error encountered. Fix the issue and re-run the script.\n`);
        console.error(`   Failed reply: ${reply.id}`);
        console.error(`   Error: ${errorMessage}\n`);
        console.error(`   Progress saved to: ${INGESTION_PROGRESS_FILE}\n`);
        console.error(`${'='.repeat(60)}\n`);
        throw error;
      }
    }
  }

  // Save final progress
  progress.totalIngested = ingestedCount;
  progress.totalFailed = failedCount;
  writeFileSync(INGESTION_PROGRESS_FILE, JSON.stringify(progress, null, 2), 'utf-8');

  // Summary
  console.log(`\n${'='.repeat(60)}\n`);
  console.log(`📊 INGESTION SUMMARY\n`);
  console.log(`Total Engagements: ${completeData.engagements.length}`);
  console.log(`Engagements Ingested: ${progress.ingestedEngagements.length}`);
  console.log(`Total Replies: ${completeData.totalReplies || 0}`);
  console.log(`Replies Ingested: ${repliesIngested}`);
  console.log(`Total Signals Ingested: ${ingestedCount}`);
  console.log(`Failed: ${failedCount}`);
  console.log(`\nFiles:\n`);
  console.log(`  1. Progress: ${INGESTION_PROGRESS_FILE}`);
  console.log(`\n${'='.repeat(60)}\n`);

  if (progress.failed.length > 0) {
    console.log(`\n⚠️  Failed Items (${progress.failed.length}):\n`);
    progress.failed.slice(0, 10).forEach((f, idx) => {
      console.log(`  ${idx + 1}. [${f.type}] ${f.id}: ${f.error}`);
    });
    if (progress.failed.length > 10) {
      console.log(`  ... and ${progress.failed.length - 10} more`);
    }
    console.log();
  }

  return { ingestedCount, failedCount, progress };
}

if (require.main === module) {
  ingestAllData()
    .then(() => {
      console.log('✅ Ingestion complete\n');
      process.exit(0);
    })
    .catch(error => {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('\n❌ Fatal error:', errorMessage);
      process.exit(1);
    });
}

export { ingestAllData };
