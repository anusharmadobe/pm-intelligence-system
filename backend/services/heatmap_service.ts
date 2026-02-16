import { getDbPool } from '../db/connection';
import { logger } from '../utils/logger';

export type HeatmapDimension =
  | 'issues_by_feature'
  | 'issues_by_customer'
  | 'features_by_customer'
  | 'themes_by_signal_volume';

export type HeatmapMetric = 'customer_count' | 'signal_count' | 'severity_weighted';

export interface HeatmapRequest {
  dimension: HeatmapDimension;
  metric?: HeatmapMetric;
  limit?: number;
  date_from?: string;
}

export interface HeatmapRow {
  x: string;
  y: string;
  value: number;
}

export interface HeatmapResponse {
  dimension: HeatmapDimension;
  metric: HeatmapMetric;
  rows: HeatmapRow[];
}

export class HeatmapService {
  async getHeatmap(params: HeatmapRequest): Promise<HeatmapResponse> {
    const pool = getDbPool();
    const metric = params.metric || 'customer_count';
    const limit = Math.min(100, Math.max(1, params.limit || 20));
    const paramsList: any[] = [];
    let dateClause = '';

    if (params.date_from) {
      const parsed = new Date(params.date_from);
      if (Number.isNaN(parsed.getTime())) {
        throw new Error('Invalid date_from');
      }
      paramsList.push(parsed);
      dateClause = `WHERE s.created_at >= $${paramsList.length}`;
    }

    try {
      const rows = await this.buildRows(params.dimension, dateClause, paramsList, limit);
      const metricKey = metric === 'severity_weighted' ? 'severity_weighted' : 'signal_count';
      return {
        dimension: params.dimension,
        metric,
        rows: rows.map((row) => ({
          x: row.x,
          y: row.y,
          value: row[metricKey]
        }))
      };
    } catch (error) {
      logger.error('Heatmap query failed', { error, dimension: params.dimension });
      throw error;
    }
  }

  private async buildRows(
    dimension: HeatmapDimension,
    dateClause: string,
    paramsList: any[],
    limit: number
  ): Promise<Array<{ x: string; y: string; signal_count: number; severity_weighted: number }>> {
    const pool = getDbPool();
    switch (dimension) {
      case 'issues_by_customer': {
        const limitParamIndex = paramsList.length + 1;
        const query = `
          SELECT issue, customer,
                 COUNT(*)::int AS signal_count,
                 SUM(COALESCE(pairs.severity, 1))::int AS severity_weighted
          FROM (
            SELECT s.severity,
                   jsonb_array_elements_text(
                     COALESCE(se.extraction->'entities'->'issues', '[]'::jsonb)
                   ) AS issue,
                   jsonb_array_elements_text(
                     COALESCE(se.extraction->'entities'->'customers', '[]'::jsonb)
                   ) AS customer
            FROM signal_extractions se
            JOIN signals s ON s.id = se.signal_id
            ${dateClause}
          ) pairs
          WHERE issue <> '' AND customer <> ''
          GROUP BY issue, customer
          ORDER BY signal_count DESC
          LIMIT $${limitParamIndex}
        `;
        const result = await pool.query(query, [...paramsList, limit]);
        return result.rows.map((row) => ({
          x: row.issue,
          y: row.customer,
          signal_count: row.signal_count,
          severity_weighted: row.severity_weighted
        }));
      }
      case 'issues_by_feature': {
        const limitParamIndex = paramsList.length + 1;
        const query = `
          SELECT issue, feature,
                 COUNT(*)::int AS signal_count,
                 SUM(COALESCE(pairs.severity, 1))::int AS severity_weighted
          FROM (
            SELECT s.severity,
                   jsonb_array_elements_text(
                     COALESCE(se.extraction->'entities'->'issues', '[]'::jsonb)
                   ) AS issue,
                   jsonb_array_elements_text(
                     COALESCE(se.extraction->'entities'->'features', '[]'::jsonb)
                   ) AS feature
            FROM signal_extractions se
            JOIN signals s ON s.id = se.signal_id
            ${dateClause}
          ) pairs
          WHERE issue <> '' AND feature <> ''
          GROUP BY issue, feature
          ORDER BY signal_count DESC
          LIMIT $${limitParamIndex}
        `;
        const result = await pool.query(query, [...paramsList, limit]);
        return result.rows.map((row) => ({
          x: row.issue,
          y: row.feature,
          signal_count: row.signal_count,
          severity_weighted: row.severity_weighted
        }));
      }
      case 'features_by_customer': {
        const limitParamIndex = paramsList.length + 1;
        const query = `
          SELECT feature, customer,
                 COUNT(*)::int AS signal_count,
                 SUM(COALESCE(pairs.severity, 1))::int AS severity_weighted
          FROM (
            SELECT s.severity,
                   jsonb_array_elements_text(
                     COALESCE(se.extraction->'entities'->'features', '[]'::jsonb)
                   ) AS feature,
                   jsonb_array_elements_text(
                     COALESCE(se.extraction->'entities'->'customers', '[]'::jsonb)
                   ) AS customer
            FROM signal_extractions se
            JOIN signals s ON s.id = se.signal_id
            ${dateClause}
          ) pairs
          WHERE feature <> '' AND customer <> ''
          GROUP BY feature, customer
          ORDER BY signal_count DESC
          LIMIT $${limitParamIndex}
        `;
        const result = await pool.query(query, [...paramsList, limit]);
        return result.rows.map((row) => ({
          x: row.feature,
          y: row.customer,
          signal_count: row.signal_count,
          severity_weighted: row.severity_weighted
        }));
      }
      case 'themes_by_signal_volume': {
        const limitParamIndex = paramsList.length + 1;
        const query = `
          SELECT theme,
                 COUNT(*)::int AS signal_count,
                 SUM(COALESCE(themes.severity, 1))::int AS severity_weighted
          FROM (
            SELECT s.severity,
                   jsonb_array_elements_text(
                     COALESCE(se.extraction->'entities'->'themes', '[]'::jsonb)
                   ) AS theme
            FROM signal_extractions se
            JOIN signals s ON s.id = se.signal_id
            ${dateClause}
          ) themes
          WHERE theme <> ''
          GROUP BY theme
          ORDER BY signal_count DESC
          LIMIT $${limitParamIndex}
        `;
        const result = await pool.query(query, [...paramsList, limit]);
        return result.rows.map((row) => ({
          x: row.theme,
          y: 'signals',
          signal_count: row.signal_count,
          severity_weighted: row.severity_weighted
        }));
      }
      default:
        return [];
    }
  }
}
