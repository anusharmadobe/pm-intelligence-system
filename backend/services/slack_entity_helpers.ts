import { randomUUID } from 'crypto';
import { logger } from '../utils/logger';
import { getDbPool } from '../db/connection';
import { getFeatureDefinitions } from '../config/feature_dictionary';
import { fuzzyCustomerMatch, resolveToCanonicalName } from '../utils/text_processing';
import { IssueMatch } from './slack_structuring_service';

export function normalizeCustomerName(value: string): string {
  return value.replace(/\*+$/g, '').replace(/\s+/g, ' ').trim();
}

type CachedCustomer = { id: string; name: string };

let customerCache: CachedCustomer[] | null = null;

export function clearCustomerCache(): void {
  customerCache = null;
}

export async function upsertCustomer(name: string): Promise<string> {
  const pool = getDbPool();
  const canonical = resolveToCanonicalName(name);
  const resolvedName = canonical || normalizeCustomerName(name);

  if (!customerCache) {
    const existing = await pool.query('SELECT id, name FROM customers');
    customerCache = existing.rows.map(row => ({ id: row.id, name: row.name }));
  }

  for (const existing of customerCache) {
    if (fuzzyCustomerMatch(existing.name, resolvedName)) {
      return existing.id;
    }
  }

  const id = randomUUID();
  const result = await pool.query(
    `INSERT INTO customers (id, name)
     VALUES ($1, $2)
     ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    [id, resolvedName]
  );
  const storedId = result.rows[0].id;
  customerCache.push({ id: storedId, name: resolvedName });
  return storedId;
}

export async function upsertFeature(canonicalName: string): Promise<string> {
  const pool = getDbPool();
  const id = randomUUID();
  const definition = getFeatureDefinitions().find(feature => feature.canonicalName === canonicalName);
  const aliases = definition?.aliases || [];
  const result = await pool.query(
    `INSERT INTO features (id, canonical_name, aliases)
     VALUES ($1, $2, $3)
     ON CONFLICT (canonical_name) DO UPDATE SET aliases = EXCLUDED.aliases
     RETURNING id`,
    [id, canonicalName, JSON.stringify(aliases)]
  );
  return result.rows[0].id;
}

export async function upsertIssue(match: IssueMatch, createdAt: Date): Promise<string> {
  const pool = getDbPool();
  const id = randomUUID();
  const result = await pool.query(
    `INSERT INTO issues (id, title, category, severity, first_seen_at)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (title, category)
     DO UPDATE SET severity = COALESCE(EXCLUDED.severity, issues.severity)
     RETURNING id`,
    [id, match.title, match.category, match.severity, createdAt]
  );
  return result.rows[0].id;
}

export async function insertSignalEntity(signalId: string, entityType: string, entityId: string, confidence: number) {
  const pool = getDbPool();
  await pool.query(
    `INSERT INTO signal_entities (signal_id, entity_type, entity_id, confidence)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT DO NOTHING`,
    [signalId, entityType, entityId, confidence]
  );
}

export async function upsertTheme(name: string): Promise<string> {
  const pool = getDbPool();
  const id = randomUUID();
  const result = await pool.query(
    `INSERT INTO themes (id, name)
     VALUES ($1, $2)
     ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    [id, name]
  );
  return result.rows[0].id;
}

export async function upsertCustomerFeatureUsage(customerId: string, featureId: string, mentionedAt: Date, increment: number = 1) {
  const pool = getDbPool();
  await pool.query(
    `INSERT INTO customer_feature_usage (customer_id, feature_id, usage_strength, last_mentioned_at)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (customer_id, feature_id)
     DO UPDATE SET usage_strength = customer_feature_usage.usage_strength + EXCLUDED.usage_strength,
                   last_mentioned_at = EXCLUDED.last_mentioned_at`,
    [customerId, featureId, increment, mentionedAt]
  );
}

export async function insertCustomerIssueReport(customerId: string, issueId: string, signalId: string) {
  const pool = getDbPool();
  await pool.query(
    `INSERT INTO customer_issue_reports (customer_id, issue_id, evidence_signal_id)
     VALUES ($1, $2, $3)
     ON CONFLICT DO NOTHING`,
    [customerId, issueId, signalId]
  );
}

export async function upsertSlackUser(slackUserId: string, customerId?: string | null, displayName?: string | null) {
  const pool = getDbPool();
  await pool.query(
    `INSERT INTO slack_users (slack_user_id, customer_id, display_name)
     VALUES ($1, $2, $3)
     ON CONFLICT (slack_user_id) DO UPDATE SET
       customer_id = COALESCE(slack_users.customer_id, EXCLUDED.customer_id),
       display_name = COALESCE(EXCLUDED.display_name, slack_users.display_name)`,
    [slackUserId, customerId || null, displayName || null]
  );
}
