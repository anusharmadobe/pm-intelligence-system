import { getDbPool } from '../db/connection';
import { extractMeaningfulWords } from '../utils/text_processing';
import { matchFeatures } from '../config/feature_dictionary';

const TOPICS_AS_FEATURES = [
  'Forms Experience Builder',
  'Automated Forms Conversion',
  'IC Editor',
  'Core Components',
  'Data Binding',
  'Forms'
];

export interface StrategicInsight {
  theme: string;
  primary_theme: string;
  feature: string;
  category: string;
  report_count: number;
  customer_count: number;
  avg_severity: number;
  last_seen_at: Date | null;
  evidence_signal_ids: string[];
  top_customers: string[];
  summary_keywords: string[];
  evidence_snippets: string[];
  score: number;
}

interface InsightQueryOptions {
  limit?: number;
  lookbackDays?: number;
}

function computeScore(
  reportCount: number,
  customerCount: number,
  avgSeverity: number,
  lastSeenAt: Date | null,
  lookbackDays: number
): number {
  const base = reportCount * Math.max(customerCount, 1) * Math.max(avgSeverity, 1);
  if (!lastSeenAt) return base;

  const daysSince = (Date.now() - lastSeenAt.getTime()) / (1000 * 60 * 60 * 24);
  const recencyBoost = daysSince <= 7 ? 1.5 : daysSince <= 30 ? 1.2 : daysSince <= lookbackDays ? 1.0 : 0.7;
  return Math.round(base * recencyBoost * 100) / 100;
}

function normalizeCustomerName(value: string): string {
  return value.replace(/\*+$/g, '').replace(/\s+/g, ' ').trim();
}

export async function getStrategicInsights(options: InsightQueryOptions = {}): Promise<StrategicInsight[]> {
  const pool = getDbPool();
  const limit = options.limit ?? 20;
  const lookbackDays = options.lookbackDays ?? 180;
  const sinceDate = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000);

  const result = await pool.query(
    `WITH issue_reports AS (
       SELECT
         cir.issue_id,
         cir.customer_id,
         cir.evidence_signal_id,
         i.category,
         i.severity,
         s.created_at
       FROM customer_issue_reports cir
       JOIN issues i ON i.id = cir.issue_id
       JOIN signals s ON s.id = cir.evidence_signal_id
       WHERE s.created_at >= $1
     ),
     feature_links AS (
       SELECT se.signal_id, f.canonical_name AS feature_name
       FROM signal_entities se
       JOIN features f ON f.id = se.entity_id
       WHERE se.entity_type = 'feature'
     ),
     theme_links AS (
       SELECT se.signal_id, t.name AS theme_name
       FROM signal_entities se
       JOIN themes t ON t.id = se.entity_id
       WHERE se.entity_type = 'theme'
     ),
     customer_links AS (
       SELECT cir.evidence_signal_id, c.name AS customer_name
       FROM customer_issue_reports cir
       JOIN customers c ON c.id = cir.customer_id
     )
     SELECT
       COALESCE(tl.theme_name, fl.feature_name) AS primary_theme,
       COALESCE(
         fl.feature_name,
         tl.theme_name,
         CASE
           WHEN (s.metadata->'topics'->>0) = ANY($3::text[]) THEN (s.metadata->'topics'->>0)
           ELSE NULL
         END,
         'Unspecified Feature'
       ) AS feature,
       COALESCE(ir.category, 'uncategorized') AS category,
       COUNT(*) AS report_count,
       COUNT(DISTINCT ir.customer_id) AS customer_count,
       AVG(COALESCE(ir.severity, 1)) AS avg_severity,
       MAX(ir.created_at) AS last_seen_at,
       ARRAY_AGG(DISTINCT ir.evidence_signal_id) AS evidence_signal_ids,
       ARRAY_AGG(DISTINCT LEFT(s.content, 200)) AS evidence_snippets,
       ARRAY_AGG(DISTINCT cl.customer_name) AS customers
     FROM issue_reports ir
     LEFT JOIN feature_links fl ON fl.signal_id = ir.evidence_signal_id
     LEFT JOIN theme_links tl ON tl.signal_id = ir.evidence_signal_id
     LEFT JOIN customer_links cl ON cl.evidence_signal_id = ir.evidence_signal_id
     LEFT JOIN signals s ON s.id = ir.evidence_signal_id
    GROUP BY COALESCE(tl.theme_name, fl.feature_name), feature, category
     ORDER BY COUNT(*) DESC, MAX(ir.created_at) DESC
     LIMIT $2`,
    [sinceDate, limit, TOPICS_AS_FEATURES]
  );

  return result.rows.map(row => {
    const lastSeen = row.last_seen_at ? new Date(row.last_seen_at) : null;
    const reportCount = parseInt(row.report_count, 10);
    const customerCount = parseInt(row.customer_count, 10);
    const avgSeverity = parseFloat(row.avg_severity);
    const score = computeScore(reportCount, customerCount, avgSeverity, lastSeen, lookbackDays);
    let feature = row.feature as string;
    const primaryTheme = row.primary_theme as string | null;
    const category = row.category as string;
    const evidenceSnippets: string[] = row.evidence_snippets || [];
    const topCustomers: string[] = (row.customers || [])
      .filter(Boolean)
      .map((name: string) => normalizeCustomerName(name))
      .slice(0, 5);
    const keywords = new Map<string, number>();
    for (const snippet of evidenceSnippets) {
      const words = extractMeaningfulWords(snippet, 4);
      for (const word of words) {
        keywords.set(word, (keywords.get(word) || 0) + 1);
      }
    }
    const summaryKeywords = [...keywords.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([word]) => word);

    if (feature === 'Unspecified Feature') {
      const featureCounts = new Map<string, number>();
      for (const snippet of evidenceSnippets) {
        const matches = matchFeatures(snippet);
        for (const match of matches) {
          featureCounts.set(match.canonicalName, (featureCounts.get(match.canonicalName) || 0) + 1);
        }
      }
      const [bestFeature] = [...featureCounts.entries()].sort((a, b) => b[1] - a[1])[0] || [];
      if (bestFeature) {
        feature = bestFeature;
      }
    }

    const themeLabel = primaryTheme || feature;

    return {
      theme: `${themeLabel} - ${category}`,
      primary_theme: themeLabel,
      feature,
      category,
      report_count: reportCount,
      customer_count: customerCount,
      avg_severity: Math.round(avgSeverity * 100) / 100,
      last_seen_at: lastSeen,
      evidence_signal_ids: row.evidence_signal_ids || [],
      top_customers: topCustomers,
      summary_keywords: summaryKeywords,
      evidence_snippets: evidenceSnippets,
      score
    };
  });
}
