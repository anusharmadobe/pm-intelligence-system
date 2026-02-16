import * as z from 'zod/v4';
import { textResponse } from '../tool_utils';
import {
  ReportGenerationService,
  ReportType,
  ReportFormat,
  ReportAudience
} from '../../services/report_generation_service';
import { logger } from '../../utils/logger';

export const tool = {
  name: 'generate_shareable_report',
  description: 'Generate a shareable report (markdown)',
  inputSchema: {
    report_type: z.enum([
      'customer_health_summary',
      'roadmap_summary',
      'customer_impact_brief',
      'weekly_digest',
      'competitive_intel',
      'product_area_overview'
    ]),
    time_window_days: z.number().int().min(7).max(365).optional(),
    format: z.enum(['executive_summary', 'detailed', 'one_pager']).optional(),
    audience: z.enum(['leadership', 'engineering', 'design', 'cs_sales', 'general']).optional(),
    filter_area: z.string().optional(),
    filter_customer: z.string().optional()
  },
  handler: async ({
    report_type,
    time_window_days = 30,
    format = 'executive_summary',
    audience = 'general',
    filter_area,
    filter_customer
  }: {
    report_type: ReportType;
    time_window_days?: number;
    format?: ReportFormat;
    audience?: ReportAudience;
    filter_area?: string;
    filter_customer?: string;
  }) => {
    try {
      const service = new ReportGenerationService();
      const report = await service.generateReport({
        report_type,
        time_window_days,
        format,
        audience,
        filter_area,
        filter_customer
      });
      return textResponse(report);
    } catch (error) {
      logger.error('generate_shareable_report failed', { error });
      throw error;
    }
  }
};
