import { Signal } from '../processing/signal_extractor';
import { extractCustomerNames } from '../utils/text_processing';
import { matchFeatures } from '../config/feature_dictionary';
import { getTopicKeywords } from '../config/entities';
import { matchThemes } from '../config/theme_dictionary';
import { logger } from '../utils/logger';
import {
  normalizeCustomerName,
  upsertCustomer,
  upsertFeature,
  upsertIssue,
  insertSignalEntity,
  upsertTheme,
  upsertCustomerFeatureUsage,
  insertCustomerIssueReport,
  upsertSlackUser
} from './slack_entity_helpers';
import { getDbPool } from '../db/connection';

export interface IssueMatch {
  title: string;
  category: string;
  severity: number | null;
  confidence: number;
}

const ISSUE_DEFINITIONS: Array<{ category: string; keywords: string[]; severity: number | null }> = [
  { category: 'blocker', keywords: ['blocker', 'blocked', 'cannot', 'can not', 'unable'], severity: 5 },
  { category: 'bug', keywords: ['bug', 'error', 'exception', 'crash', 'failed', 'failure', 'broken'], severity: 4 },
  { category: 'performance', keywords: ['slow', 'latency', 'timeout', 'lag', 'performance'], severity: 3 },
  { category: 'request', keywords: ['feature request', 'request', 'would like', 'need', 'want'], severity: 2 }
];

const TOPICS_AS_FEATURES = new Set([
  'Forms Experience Builder',
  'Automated Forms Conversion',
  'IC Editor',
  'Core Components',
  'Data Binding',
  'Forms'
]);

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

function extractIssues(text: string): IssueMatch[] {
  const normalizedText = normalizeValue(text);
  const matches: IssueMatch[] = [];
  const seen = new Set<string>();

  for (const def of ISSUE_DEFINITIONS) {
    const matchedKeyword = def.keywords.find(keyword => normalizedText.includes(keyword));
    if (!matchedKeyword) continue;

    const title = deriveIssueTitle(text, matchedKeyword);
    const key = `${def.category}:${title.toLowerCase()}`;
    if (seen.has(key)) continue;

    matches.push({
      title,
      category: def.category,
      severity: def.severity,
      confidence: 0.55
    });
    seen.add(key);
    break;
  }

  return matches;
}


export async function processSlackSignal(signal: Signal): Promise<void> {
  if (signal.source !== 'slack') return;
  if (process.env.SLACK_ONLY_ENABLED === 'false') return;

  const pool = getDbPool();
  const metadata = signal.metadata || {};
  const slackChannelId = metadata.channel_id || metadata.channel;
  const slackChannelName = metadata.channel_name || metadata.channel;
  const slackUserId = metadata.user_id || metadata.user;
  const messageTs = metadata.timestamp || metadata.ts || signal.source_ref;
  const threadTs = metadata.thread_ts || metadata.threadTs;
  const isThreadReply = Boolean(threadTs && messageTs && threadTs !== messageTs);
  const isEdit = Boolean(metadata.is_edit);
  const isDelete = Boolean(metadata.is_delete);
  const permalink = metadata.permalink;

  try {
    await pool.query(
      `INSERT INTO slack_messages (
         signal_id, slack_channel_id, slack_channel_name, slack_user_id,
         slack_message_ts, slack_thread_ts, is_thread_reply, is_edit, is_delete, permalink
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT DO NOTHING`,
      [
        signal.id,
        slackChannelId || null,
        slackChannelName || null,
        slackUserId || null,
        messageTs ? String(messageTs) : null,
        threadTs ? String(threadTs) : null,
        isThreadReply,
        isEdit,
        isDelete,
        permalink || null
      ]
    );
  } catch (error: any) {
    logger.warn('Slack message insert failed', { error: error.message, signalId: signal.id });
  }

  const metadataCustomer = metadata.customer_name || metadata.customerName;
  const customers = metadataCustomer
    ? [normalizeCustomerName(String(metadataCustomer))]
    : (Array.isArray(metadata.customers) && metadata.customers.length > 0
      ? metadata.customers
      : extractCustomerNames(signal.content, metadata));

  const topicFeatures = getTopicKeywords()
    .filter(topic => TOPICS_AS_FEATURES.has(topic.topic))
    .filter(topic => topic.keywords.some(keyword => signal.content.toLowerCase().includes(keyword)))
    .map(topic => ({ canonicalName: topic.topic, confidence: 0.4 }));

  const matchedFeatures = matchFeatures(signal.content);
  const features = matchedFeatures.length > 0 ? matchedFeatures : topicFeatures;
  const themes = matchThemes(signal.content);
  const issues = extractIssues(signal.content);

  const customerIds: string[] = [];
  for (const customer of customers) {
    const customerId = await upsertCustomer(customer);
    customerIds.push(customerId);
    await insertSignalEntity(signal.id, 'customer', customerId, 0.7);
  }

  if (slackUserId) {
    const displayName = metadata.user_name || metadata.username || null;
    const primaryCustomerId = customerIds[0] || null;
    await upsertSlackUser(String(slackUserId), primaryCustomerId, displayName);
  }

  const featureIds: string[] = [];
  for (const feature of features) {
    const featureId = await upsertFeature(feature.canonicalName);
    featureIds.push(featureId);
    await insertSignalEntity(signal.id, 'feature', featureId, feature.confidence);
  }

  for (const theme of themes) {
    const themeId = await upsertTheme(theme.name);
    await insertSignalEntity(signal.id, 'theme', themeId, 0.5);
  }

  const issueIds: string[] = [];
  for (const issue of issues) {
    const issueId = await upsertIssue(issue, signal.created_at);
    issueIds.push(issueId);
    await insertSignalEntity(signal.id, 'issue', issueId, issue.confidence);
  }

  for (const customerId of customerIds) {
    for (const featureId of featureIds) {
      await upsertCustomerFeatureUsage(customerId, featureId, signal.created_at);
    }
    for (const issueId of issueIds) {
      await insertCustomerIssueReport(customerId, issueId, signal.id);
    }
  }
}
