import { getDbPool } from '../db/connection';
import { getFeatureDefinitions } from '../config/feature_dictionary';

function normalizeCustomerName(value: string): string {
  return value.replace(/\*+$/g, '').replace(/\s+/g, ' ').trim();
}

export interface FeatureUsageResult {
  customer_id: string;
  customer_name: string;
  segment: string | null;
  usage_strength: number;
  last_mentioned_at: Date | null;
}

export interface FeatureBottleneckResult {
  issue_id: string;
  title: string;
  category: string | null;
  severity: number | null;
  report_count: number;
  customers: string[];
  evidence_signal_ids: string[];
  evidence_snippets: string[];
}

async function resolveFeatureId(query: string): Promise<string | null> {
  const pool = getDbPool();
  const normalized = query.trim().toLowerCase();
  const result = await pool.query(
    `SELECT id, canonical_name FROM features
     WHERE lower(canonical_name) = $1
        OR EXISTS (
          SELECT 1
          FROM jsonb_array_elements_text(aliases) alias
          WHERE lower(alias) = $1
        )
     LIMIT 1`,
    [normalized]
  );

  if (result.rows.length > 0) return result.rows[0].id;

  const fallback = getFeatureDefinitions().find(def =>
    def.canonicalName.toLowerCase() === normalized ||
    (def.aliases || []).some(alias => alias.toLowerCase() === normalized)
  );

  if (!fallback) return null;

  const fallbackResult = await pool.query(
    `SELECT id FROM features WHERE lower(canonical_name) = $1 LIMIT 1`,
    [fallback.canonicalName.toLowerCase()]
  );
  return fallbackResult.rows.length > 0 ? fallbackResult.rows[0].id : null;
}

export async function getFeatureUsageByCustomer(featureQuery: string, limit: number = 50): Promise<FeatureUsageResult[]> {
  const featureId = await resolveFeatureId(featureQuery);
  if (!featureId) return [];

  const pool = getDbPool();
  const result = await pool.query(
    `SELECT c.id as customer_id,
            c.name as customer_name,
            c.segment as segment,
            cfu.usage_strength as usage_strength,
            cfu.last_mentioned_at as last_mentioned_at
     FROM customer_feature_usage cfu
     INNER JOIN customers c ON cfu.customer_id = c.id
     WHERE cfu.feature_id = $1
     ORDER BY cfu.usage_strength DESC, cfu.last_mentioned_at DESC
     LIMIT $2`,
    [featureId, limit]
  );

  return result.rows.map(row => ({
    customer_id: row.customer_id,
    customer_name: normalizeCustomerName(row.customer_name),
    segment: row.segment,
    usage_strength: parseInt(row.usage_strength, 10),
    last_mentioned_at: row.last_mentioned_at ? new Date(row.last_mentioned_at) : null
  }));
}

export async function getFeatureBottlenecks(featureQuery: string, limit: number = 20): Promise<FeatureBottleneckResult[]> {
  const featureId = await resolveFeatureId(featureQuery);
  if (!featureId) return [];

  const pool = getDbPool();
  const result = await pool.query(
    `WITH feature_signals AS (
       SELECT DISTINCT signal_id
       FROM signal_entities
       WHERE entity_type = 'feature' AND entity_id = $1
     )
     SELECT i.id as issue_id,
            i.title as title,
            i.category as category,
            i.severity as severity,
            COUNT(*) as report_count,
            ARRAY_AGG(DISTINCT c.name) as customers,
           ARRAY_AGG(DISTINCT cir.evidence_signal_id) as evidence_signal_ids,
           ARRAY_AGG(DISTINCT LEFT(s.content, 200)) as evidence_snippets
     FROM customer_issue_reports cir
     INNER JOIN feature_signals fs ON fs.signal_id = cir.evidence_signal_id
     INNER JOIN issues i ON i.id = cir.issue_id
     INNER JOIN customers c ON c.id = cir.customer_id
    INNER JOIN signals s ON s.id = cir.evidence_signal_id
     GROUP BY i.id, i.title, i.category, i.severity
     ORDER BY COUNT(*) DESC, MAX(i.first_seen_at) DESC
     LIMIT $2`,
    [featureId, limit]
  );

  return result.rows.map(row => ({
    issue_id: row.issue_id,
    title: row.title,
    category: row.category,
    severity: row.severity ? parseInt(row.severity, 10) : null,
    report_count: parseInt(row.report_count, 10),
    customers: (row.customers || []).map((name: string) => normalizeCustomerName(name)),
    evidence_signal_ids: row.evidence_signal_ids || [],
    evidence_snippets: row.evidence_snippets || []
  }));
}
