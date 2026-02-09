#!/usr/bin/env ts-node

import { getDbPool } from '../backend/db/connection';
import { extractCustomerNames } from '../backend/utils/text_processing';
import { matchFeatures } from '../backend/config/feature_dictionary';
import { matchThemes } from '../backend/config/theme_dictionary';
import { ingestSlackExtraction } from '../backend/services/slack_llm_extraction_service';
import { normalizeCustomerName } from '../backend/services/slack_entity_helpers';

const CHANNEL_ID = process.env.CHANNEL_ID || 'C04D195JVGS';
const LIMIT = process.env.LIMIT ? parseInt(process.env.LIMIT, 10) : 50;

type SignalRow = {
  id: string;
  content: string;
  metadata: any;
  created_at: Date;
};

const ISSUE_DEFINITIONS: Array<{ category: string; keywords: string[]; severity: number | null }> = [
  { category: 'blocker', keywords: ['blocker', 'blocked', 'cannot', 'can not', 'unable'], severity: 5 },
  { category: 'bug', keywords: ['bug', 'error', 'exception', 'crash', 'failed', 'failure', 'broken'], severity: 4 },
  { category: 'performance', keywords: ['slow', 'latency', 'timeout', 'lag', 'performance'], severity: 3 },
  { category: 'request', keywords: ['feature request', 'request', 'would like', 'need', 'want'], severity: 2 }
];

function normalizeValue(value: string): string {
  return value.trim().toLowerCase();
}

function deriveIssueTitle(text: string, keyword: string): string {
  const sentences = text.split(/[.!?]/).map(part => part.trim()).filter(Boolean);
  const normalizedKeyword = normalizeValue(keyword);
  const match = sentences.find(sentence => normalizeValue(sentence).includes(normalizedKeyword));
  const base = match || text;
  return base.replace(/\s+/g, ' ').trim().slice(0, 140);
}

function extractIssues(text: string) {
  const normalizedText = normalizeValue(text);
  for (const def of ISSUE_DEFINITIONS) {
    const matchedKeyword = def.keywords.find(keyword => normalizedText.includes(keyword));
    if (!matchedKeyword) continue;
    return [{
      title: deriveIssueTitle(text, matchedKeyword),
      category: def.category,
      severity: typeof def.severity === 'number' ? def.severity : undefined,
      confidence: 0.6
    }];
  }
  return [];
}

async function run() {
  const pool = getDbPool();
  const result = await pool.query<SignalRow>(
    `SELECT s.id, s.content, s.metadata, s.created_at
     FROM signals s
     JOIN slack_messages sm ON sm.signal_id = s.id
     WHERE sm.slack_channel_id = $1
     ORDER BY s.created_at DESC
     LIMIT $2`,
    [CHANNEL_ID, LIMIT]
  );

  let processed = 0;
  for (const row of result.rows) {
    const metadata = row.metadata || {};
    const metadataCustomer = metadata.customer_name || metadata.customerName;
    const customers = metadataCustomer
      ? [normalizeCustomerName(String(metadataCustomer))]
      : (Array.isArray(metadata.customers) && metadata.customers.length > 0
        ? metadata.customers.map((value: string) => normalizeCustomerName(String(value)))
        : extractCustomerNames(row.content, metadata).map(value => normalizeCustomerName(String(value))));

    const features = matchFeatures(row.content).map(feature => ({
      name: feature.canonicalName,
      confidence: feature.confidence
    }));
    const themes = matchThemes(row.content).map(theme => ({
      name: theme.name,
      confidence: 0.55
    }));
    const issues = extractIssues(row.content);

    await ingestSlackExtraction(row.id, {
      customers: customers.map((name: string) => ({ name, confidence: 0.7 })),
      features,
      themes,
      issues
    }, 'heuristic', 'rule-based');

    processed += 1;
  }

  console.log(`Processed ${processed} signals for channel ${CHANNEL_ID}.`);
}

run()
  .then(() => process.exit(0))
  .catch(error => {
    console.error('Extraction run failed:', error.message);
    process.exit(1);
  });
