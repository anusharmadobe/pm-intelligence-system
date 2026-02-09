#!/usr/bin/env ts-node

import { getDbPool } from '../backend/db/connection';
import { ingestSlackExtraction } from '../backend/services/slack_llm_extraction_service';
import { extractSlackSignalWithLLM, SlackSignalLike } from '../backend/services/slack_llm_extractor';
import { createCursorBridgeProvider } from '../backend/services/cursor_llm_provider';

const CHANNEL_ID = process.env.CHANNEL_ID || 'C04D195JVGS';
const LIMIT = process.env.LIMIT ? parseInt(process.env.LIMIT, 10) : 100;
const LOOKBACK_DAYS = process.env.LOOKBACK_DAYS ? parseInt(process.env.LOOKBACK_DAYS, 10) : undefined;
const DRY_RUN = process.env.DRY_RUN === 'true';

async function fetchSignals(): Promise<SlackSignalLike[]> {
  const pool = getDbPool();
  const params: any[] = [CHANNEL_ID, LIMIT];
  let whereClause = 'WHERE sm.slack_channel_id = $1';

  if (LOOKBACK_DAYS) {
    params.push(new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000));
    whereClause += ` AND s.created_at >= $${params.length}`;
  }

  const result = await pool.query(
    `SELECT s.id, s.content, s.metadata, s.created_at
     FROM signals s
     JOIN slack_messages sm ON sm.signal_id = s.id
     ${whereClause}
     ORDER BY s.created_at DESC
     LIMIT $2`,
    params
  );

  return result.rows;
}

async function run() {
  const llmProvider = createCursorBridgeProvider();
  const signals = await fetchSignals();

  let processed = 0;
  for (const signal of signals) {
    const extraction = await extractSlackSignalWithLLM(signal, llmProvider);
    if (!DRY_RUN) {
      await ingestSlackExtraction(signal.id, extraction, 'cursor-llm', process.env.CURSOR_LLM_MODEL || null);
    }
    processed += 1;
  }

  console.log(`Processed ${processed} Slack signals (${DRY_RUN ? 'dry run' : 'stored'}).`);
}

run()
  .then(() => process.exit(0))
  .catch(error => {
    console.error('Slack LLM extraction failed:', error.message);
    process.exit(1);
  });
