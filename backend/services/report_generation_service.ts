import { getDbPool } from '../db/connection';
import { IntelligenceService } from './intelligence_service';
import { logger } from '../utils/logger';

export type ReportType =
  | 'customer_health_summary'
  | 'roadmap_summary'
  | 'customer_impact_brief'
  | 'weekly_digest'
  | 'competitive_intel'
  | 'product_area_overview';

export type ReportFormat = 'executive_summary' | 'detailed' | 'one_pager';
export type ReportAudience = 'leadership' | 'engineering' | 'design' | 'cs_sales' | 'general';

export interface ReportRequest {
  report_type: ReportType;
  time_window_days?: number;
  format?: ReportFormat;
  audience?: ReportAudience;
  filter_area?: string;
  filter_customer?: string;
}

export class ReportGenerationService {
  async generateReport(params: ReportRequest): Promise<string> {
    const pool = getDbPool();
    const timeWindow = params.time_window_days || 30;
    const format = params.format || 'executive_summary';
    const audience = params.audience || 'general';

    const queryParams: any[] = [timeWindow];
    let filters = `WHERE s.created_at >= NOW() - ($1 || ' days')::interval`;
    if (params.filter_customer) {
      queryParams.push(`%${params.filter_customer}%`);
      filters += ` AND s.normalized_content ILIKE $${queryParams.length}`;
    }
    if (params.filter_area) {
      queryParams.push(`%${params.filter_area}%`);
      filters += ` AND s.normalized_content ILIKE $${queryParams.length}`;
    }

    try {
      const signalResult = await pool.query(
        `SELECT s.id, s.source, s.content, s.created_at
         FROM signals s
         ${filters}
         ORDER BY s.created_at DESC
         LIMIT 20`,
        queryParams
      );

      const freshnessResult = await pool.query(
        `SELECT MAX(s.created_at) AS latest
         FROM signals s
         ${filters}`,
        queryParams
      );
      const sourceCounts = await pool.query(
        `SELECT s.source, COUNT(*)::int AS count
         FROM signals s
         ${filters}
         GROUP BY s.source
         ORDER BY count DESC`,
        queryParams
      );

      const topIssues = await pool.query(
        `SELECT issue, COUNT(*)::int AS count
         FROM (
           SELECT jsonb_array_elements_text(
             COALESCE(se.extraction->'entities'->'issues', '[]'::jsonb)
           ) AS issue
           FROM signal_extractions se
           JOIN signals s ON s.id = se.signal_id
           ${filters}
         ) issues
         WHERE issue <> ''
         GROUP BY issue
         ORDER BY count DESC
         LIMIT 5`,
        queryParams
      );

      const topFeatures = await pool.query(
        `SELECT feature, COUNT(*)::int AS count
         FROM (
           SELECT jsonb_array_elements_text(
             COALESCE(se.extraction->'entities'->'features', '[]'::jsonb)
           ) AS feature
           FROM signal_extractions se
           JOIN signals s ON s.id = se.signal_id
           ${filters}
         ) features
         WHERE feature <> ''
         GROUP BY feature
         ORDER BY count DESC
         LIMIT 5`,
        queryParams
      );

      const intelligence = new IntelligenceService();
      const roadmap = params.report_type === 'roadmap_summary'
        ? await intelligence.getRoadmapPriorities('all', 5)
        : [];

      const freshness = freshnessResult.rows[0]?.latest;
      const reportLines = [
        `# ${params.report_type.replace(/_/g, ' ').toUpperCase()}`,
        '',
        `Time window: last ${timeWindow} days`,
        `Audience: ${audience}`,
        `Format: ${format}`,
        `Data freshness: ${freshness ? new Date(freshness).toISOString() : 'unknown'}`,
        '',
        '## Highlights',
        `- Signals analyzed: ${signalResult.rows.length}`,
        `- Top issues: ${topIssues.rows.map((row) => `${row.issue} (${row.count})`).join(', ') || 'None'}`,
        `- Top features: ${topFeatures.rows.map((row) => `${row.feature} (${row.count})`).join(', ') || 'None'}`,
        ''
      ];

      if (params.report_type === 'roadmap_summary') {
        reportLines.push('## Roadmap Priorities');
        roadmap.forEach((item) => {
          reportLines.push(`- ${item.feature} (score: ${item.score})`);
        });
        reportLines.push('');
      }

      if (params.report_type === 'weekly_digest' || format !== 'executive_summary') {
        reportLines.push('## Recent Signals');
        signalResult.rows.forEach((row: any) => {
          reportLines.push(`- (${row.source}) ${row.content.substring(0, 140)}...`);
        });
        reportLines.push('');
      }

      reportLines.push('## Methodology');
      reportLines.push(
        [
          `- Sources included: ${
            sourceCounts.rows.length
              ? sourceCounts.rows.map((row: any) => `${row.source} (${row.count})`).join(', ')
              : 'None'
          }`,
          `- Filters applied: ${params.filter_customer || params.filter_area ? 'yes' : 'no'}`,
          `- Time window: last ${timeWindow} days`,
          `- Signal limit: ${signalResult.rows.length}`
        ].join('\n')
      );
      reportLines.push('');

      reportLines.push('## Provenance');
      reportLines.push(
        sourceCounts.rows.length
          ? sourceCounts.rows.map((row: any) => `- ${row.source}: ${row.count} signals`).join('\n')
          : 'No signals'
      );
      reportLines.push('');

      reportLines.push(`_Generated by PM Intelligence System at ${new Date().toISOString()}_`);

      const rawReport = reportLines.join('\n');
      return this.redactPII(rawReport);
    } catch (error) {
      logger.error('Report generation failed', { error, report_type: params.report_type });
      throw error;
    }
  }

  private redactPII(content: string): string {
    const emailRegex = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
    const phoneRegex = /(\+?\d{1,2}[\s.-]?)?(\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4})/g;
    const ssnRegex = /\b\d{3}-\d{2}-\d{4}\b/g;
    return content
      .replace(emailRegex, '[REDACTED]')
      .replace(phoneRegex, '[REDACTED]')
      .replace(ssnRegex, '[REDACTED]');
  }
}
