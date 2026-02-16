import { getDbPool } from '../db/connection';
import { createLLMProviderFromEnv } from './llm_service';
import { logger } from '../utils/logger';

type TrendDirection = 'emerging' | 'growing' | 'stable' | 'declining';

export class IntelligenceService {
  private normalizeAlias(value: string): string {
    return value
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private async resolveEntity(entityType: string, name: string) {
    const pool = getDbPool();
    const normalized = this.normalizeAlias(name);
    const aliasResult = await pool.query(
      `SELECT er.*
       FROM entity_aliases ea
       JOIN entity_registry er ON ea.canonical_entity_id = er.id
       WHERE ea.alias_normalized = $1
         AND er.entity_type = $2
         AND er.is_active = true
       LIMIT 1`,
      [normalized, entityType]
    );
    const entity =
      aliasResult.rows[0] ||
      (
        await pool.query(
          `SELECT * FROM entity_registry
           WHERE entity_type = $1 AND canonical_name ILIKE $2 AND is_active = true
           LIMIT 1`,
          [entityType, name]
        )
      ).rows[0];

    if (!entity) {
      return { entity: null, aliases: [name] };
    }

    const aliasRows = await pool.query(
      `SELECT alias
       FROM entity_aliases
       WHERE canonical_entity_id = $1 AND is_active = true`,
      [entity.id]
    );
    const aliases = [entity.canonical_name, ...aliasRows.rows.map((row) => row.alias)];
    return { entity, aliases };
  }

  async getCustomerProfile(customerName: string) {
    try {
      const pool = getDbPool();
      const { entity, aliases } = await this.resolveEntity('customer', customerName);
      const aliasArray = aliases.length ? aliases : [customerName];

      const signalCount = await pool.query(
        `SELECT COUNT(*)::int AS count
         FROM signal_extractions se
         JOIN signals s ON s.id = se.signal_id
         WHERE se.extraction->'entities'->'customers' ?| $1`,
        [aliasArray]
      );

      const recentSignals = await pool.query(
        `SELECT s.id, s.source, s.content, s.created_at
         FROM signal_extractions se
         JOIN signals s ON s.id = se.signal_id
         WHERE se.extraction->'entities'->'customers' ?| $1
         ORDER BY s.created_at DESC
         LIMIT 5`,
        [aliasArray]
      );

      const featureCounts = await pool.query(
        `SELECT feature, COUNT(*)::int AS count
         FROM (
           SELECT jsonb_array_elements_text(
             COALESCE(se.extraction->'entities'->'features', '[]'::jsonb)
           ) AS feature
           FROM signal_extractions se
           JOIN signals s ON s.id = se.signal_id
           WHERE se.extraction->'entities'->'customers' ?| $1
         ) features
         WHERE feature IS NOT NULL AND feature <> ''
         GROUP BY feature
         ORDER BY count DESC
         LIMIT 10`,
        [aliasArray]
      );

      const issueCounts = await pool.query(
        `SELECT issue, COUNT(*)::int AS count
         FROM (
           SELECT jsonb_array_elements_text(
             COALESCE(se.extraction->'entities'->'issues', '[]'::jsonb)
           ) AS issue
           FROM signal_extractions se
           JOIN signals s ON s.id = se.signal_id
           WHERE se.extraction->'entities'->'customers' ?| $1
         ) issues
         WHERE issue IS NOT NULL AND issue <> ''
         GROUP BY issue
         ORDER BY count DESC
         LIMIT 10`,
        [aliasArray]
      );

      const sentimentCounts = await pool.query(
        `SELECT COALESCE(se.extraction->>'sentiment', 'unknown') AS sentiment,
                COUNT(*)::int AS count
         FROM signal_extractions se
         JOIN signals s ON s.id = se.signal_id
         WHERE se.extraction->'entities'->'customers' ?| $1
         GROUP BY sentiment
         ORDER BY count DESC`,
        [aliasArray]
      );

      return {
        customer: entity,
        signal_count: signalCount.rows[0]?.count || 0,
        recent_signals: recentSignals.rows,
        top_features: featureCounts.rows,
        top_issues: issueCounts.rows,
        sentiment_breakdown: sentimentCounts.rows
      };
    } catch (error) {
      logger.error('getCustomerProfile failed', { error, customerName });
      throw error;
    }
  }

  async getFeatureHealth(featureName: string) {
    try {
      const pool = getDbPool();
      const { entity, aliases } = await this.resolveEntity('feature', featureName);
      const aliasArray = aliases.length ? aliases : [featureName];

      const signalCount = await pool.query(
        `SELECT COUNT(*)::int AS count
         FROM signal_extractions se
         JOIN signals s ON s.id = se.signal_id
         WHERE se.extraction->'entities'->'features' ?| $1`,
        [aliasArray]
      );

      const customerCounts = await pool.query(
        `SELECT customer, COUNT(*)::int AS count
         FROM (
           SELECT jsonb_array_elements_text(
             COALESCE(se.extraction->'entities'->'customers', '[]'::jsonb)
           ) AS customer
           FROM signal_extractions se
           JOIN signals s ON s.id = se.signal_id
           WHERE se.extraction->'entities'->'features' ?| $1
         ) customers
         WHERE customer IS NOT NULL AND customer <> ''
         GROUP BY customer
         ORDER BY count DESC
         LIMIT 10`,
        [aliasArray]
      );

      const issueCounts = await pool.query(
        `SELECT issue, COUNT(*)::int AS count
         FROM (
           SELECT jsonb_array_elements_text(
             COALESCE(se.extraction->'entities'->'issues', '[]'::jsonb)
           ) AS issue
           FROM signal_extractions se
           JOIN signals s ON s.id = se.signal_id
           WHERE se.extraction->'entities'->'features' ?| $1
         ) issues
         WHERE issue IS NOT NULL AND issue <> ''
         GROUP BY issue
         ORDER BY count DESC
         LIMIT 10`,
        [aliasArray]
      );

      return {
        feature: entity || { canonical_name: featureName },
        mentions: signalCount.rows[0]?.count || 0,
        top_customers: customerCounts.rows,
        top_issues: issueCounts.rows
      };
    } catch (error) {
      logger.error('getFeatureHealth failed', { error, featureName });
      throw error;
    }
  }

  async getIssueImpact(issueName: string) {
    try {
      const pool = getDbPool();
      const { entity, aliases } = await this.resolveEntity('issue', issueName);
      const aliasArray = aliases.length ? aliases : [issueName];

      const signalCount = await pool.query(
        `SELECT COUNT(*)::int AS count
         FROM signal_extractions se
         JOIN signals s ON s.id = se.signal_id
         WHERE se.extraction->'entities'->'issues' ?| $1`,
        [aliasArray]
      );

      const customerCounts = await pool.query(
        `SELECT customer, COUNT(*)::int AS count
         FROM (
           SELECT jsonb_array_elements_text(
             COALESCE(se.extraction->'entities'->'customers', '[]'::jsonb)
           ) AS customer
           FROM signal_extractions se
           JOIN signals s ON s.id = se.signal_id
           WHERE se.extraction->'entities'->'issues' ?| $1
         ) customers
         WHERE customer IS NOT NULL AND customer <> ''
         GROUP BY customer
         ORDER BY count DESC
         LIMIT 10`,
        [aliasArray]
      );

      const featureCounts = await pool.query(
        `SELECT feature, COUNT(*)::int AS count
         FROM (
           SELECT jsonb_array_elements_text(
             COALESCE(se.extraction->'entities'->'features', '[]'::jsonb)
           ) AS feature
           FROM signal_extractions se
           JOIN signals s ON s.id = se.signal_id
           WHERE se.extraction->'entities'->'issues' ?| $1
         ) features
         WHERE feature IS NOT NULL AND feature <> ''
         GROUP BY feature
         ORDER BY count DESC
         LIMIT 10`,
        [aliasArray]
      );

      return {
        issue: entity || { canonical_name: issueName },
        mentions: signalCount.rows[0]?.count || 0,
        affected_customers: customerCounts.rows,
        related_features: featureCounts.rows
      };
    } catch (error) {
      logger.error('getIssueImpact failed', { error, issueName });
      throw error;
    }
  }

  async getTrends(entityType: 'theme' | 'issue' | 'feature' | 'customer', windowDays = 28, limit = 15) {
    try {
      const pool = getDbPool();
      const fieldMap: Record<string, string> = {
        theme: 'themes',
        issue: 'issues',
        feature: 'features',
        customer: 'customers'
      };
      const field = fieldMap[entityType];
      const recentQuery = `
        WITH recent AS (
          SELECT jsonb_array_elements_text(
            COALESCE(se.extraction->'entities'->'${field}', '[]'::jsonb)
          ) AS entity,
          COUNT(*)::int AS count
          FROM signal_extractions se
          JOIN signals s ON s.id = se.signal_id
          WHERE s.created_at >= NOW() - ($1 || ' days')::interval
          GROUP BY entity
        ),
        previous AS (
          SELECT jsonb_array_elements_text(
            COALESCE(se.extraction->'entities'->'${field}', '[]'::jsonb)
          ) AS entity,
          COUNT(*)::int AS count
          FROM signal_extractions se
          JOIN signals s ON s.id = se.signal_id
          WHERE s.created_at >= NOW() - ($2 || ' days')::interval
            AND s.created_at < NOW() - ($1 || ' days')::interval
          GROUP BY entity
        )
        SELECT COALESCE(r.entity, p.entity) AS entity,
               COALESCE(r.count, 0) AS recent_count,
               COALESCE(p.count, 0) AS previous_count
        FROM recent r
        FULL JOIN previous p ON r.entity = p.entity
        WHERE COALESCE(r.entity, p.entity) IS NOT NULL
      `;

      const result = await pool.query(recentQuery, [windowDays, windowDays * 2]);
      const scored = result.rows.map((row) => {
        const recent = Number(row.recent_count) || 0;
        const previous = Number(row.previous_count) || 0;
        let direction: TrendDirection = 'stable';
        if (previous === 0 && recent > 0) {
          direction = 'emerging';
        } else if (previous > 0 && recent >= previous * 1.5) {
          direction = 'growing';
        } else if (previous > 0 && recent <= previous * 0.5) {
          direction = 'declining';
        }
        return {
          entity: row.entity,
          recent_count: recent,
          previous_count: previous,
          direction
        };
      });

      return scored.sort((a, b) => b.recent_count - a.recent_count).slice(0, limit);
    } catch (error) {
      logger.error('getTrends failed', { error, entityType });
      throw error;
    }
  }

  async getRoadmapPriorities(filter: string = 'all', limit = 10) {
    try {
      const pool = getDbPool();
      const result = await pool.query(
        `SELECT feature, COUNT(*)::int AS mentions
         FROM (
           SELECT jsonb_array_elements_text(
             COALESCE(se.extraction->'entities'->'features', '[]'::jsonb)
           ) AS feature
           FROM signal_extractions se
           JOIN signals s ON s.id = se.signal_id
         ) features
         WHERE feature IS NOT NULL AND feature <> ''
         GROUP BY feature
         ORDER BY mentions DESC
         LIMIT $1`,
        [limit * 3]
      );

      const maxMentions = Math.max(1, ...result.rows.map((row) => row.mentions || 1));
      const scored = result.rows.map((row) => {
        const impact = row.mentions;
        const confidence = Math.min(1, impact / maxMentions);
        const urgency = Math.min(1, impact / maxMentions);
        const effort = 5;
        const strategic_alignment = impact >= maxMentions * 0.7 ? 0.8 : 0.5;
        const score = (impact * confidence * urgency) / effort;
        return {
          feature: row.feature,
          impact,
          confidence,
          urgency,
          effort,
          strategic_alignment,
          score: Number(score.toFixed(3))
        };
      });

      const filtered = scored.filter((item) => {
        switch (filter) {
          case 'quick_wins':
            return item.score >= 0.2 && item.effort <= 5;
          case 'strategic':
            return item.strategic_alignment >= 0.7;
          case 'emerging':
            return item.impact <= 2;
          case 'high_confidence':
            return item.confidence >= 0.7;
          default:
            return true;
        }
      });

      return filtered.sort((a, b) => b.score - a.score).slice(0, limit);
    } catch (error) {
      logger.error('getRoadmapPriorities failed', { error, filter });
      throw error;
    }
  }

  async getStrategicInsights(focusArea?: string, timeWindowDays = 30) {
    const llmProvider = createLLMProviderFromEnv();
    try {
      const pool = getDbPool();
      const signalCount = await pool.query(
        `SELECT COUNT(*)::int AS count
         FROM signals
         WHERE created_at >= NOW() - ($1 || ' days')::interval`,
        [timeWindowDays]
      );

      const topIssues = await pool.query(
        `SELECT issue, COUNT(*)::int AS count
         FROM (
           SELECT jsonb_array_elements_text(
             COALESCE(se.extraction->'entities'->'issues', '[]'::jsonb)
           ) AS issue
           FROM signal_extractions se
           JOIN signals s ON s.id = se.signal_id
           WHERE s.created_at >= NOW() - ($1 || ' days')::interval
         ) issues
         WHERE issue IS NOT NULL AND issue <> ''
         GROUP BY issue
         ORDER BY count DESC
         LIMIT 5`,
        [timeWindowDays]
      );

      const topFeatures = await pool.query(
        `SELECT feature, COUNT(*)::int AS count
         FROM (
           SELECT jsonb_array_elements_text(
             COALESCE(se.extraction->'entities'->'features', '[]'::jsonb)
           ) AS feature
           FROM signal_extractions se
           JOIN signals s ON s.id = se.signal_id
           WHERE s.created_at >= NOW() - ($1 || ' days')::interval
         ) features
         WHERE feature IS NOT NULL AND feature <> ''
         GROUP BY feature
         ORDER BY count DESC
         LIMIT 5`,
        [timeWindowDays]
      );

      const prompt = [
        'You are a product strategist. Summarize key insights from recent signals.',
        `Time window: last ${timeWindowDays} days.`,
        focusArea ? `Focus area: ${focusArea}.` : '',
        `Total signals: ${signalCount.rows[0]?.count || 0}.`,
        `Top issues: ${topIssues.rows.map((row) => `${row.issue} (${row.count})`).join(', ') || 'None'}.`,
        `Top features: ${topFeatures.rows.map((row) => `${row.feature} (${row.count})`).join(', ') || 'None'}.`,
        'Provide 3-5 bullet insights with risks and opportunities.'
      ]
        .filter(Boolean)
        .join('\n');

      const response = await llmProvider(prompt);
      return response;
    } catch (error) {
      logger.warn('Strategic insights LLM failed', { error });
      return 'No insights available.';
    }
  }
}
