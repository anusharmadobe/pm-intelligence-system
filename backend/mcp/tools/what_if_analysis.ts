import * as z from 'zod/v4';
import { textResponse } from '../tool_utils';
import { getDbPool } from '../../db/connection';
import { logger } from '../../utils/logger';

export const tool = {
  name: 'what_if_analysis',
  description: 'Run a simple what-if analysis over entities',
  inputSchema: {
    action: z.enum(['fix_issue', 'build_feature', 'deprecate_feature']),
    entity_name: z.string()
  },
  handler: async ({
    action,
    entity_name
  }: {
    action: 'fix_issue' | 'build_feature' | 'deprecate_feature';
    entity_name: string;
  }) => {
    try {
      const pool = getDbPool();
      const targetField = action === 'fix_issue' ? 'issues' : 'features';
      const relatedField = action === 'fix_issue' ? 'features' : 'issues';

      const customerCounts = await pool.query(
        `SELECT customer, COUNT(*)::int AS count
         FROM (
           SELECT jsonb_array_elements_text(
             COALESCE(se.extraction->'entities'->'customers', '[]'::jsonb)
           ) AS customer
           FROM signal_extractions se
           JOIN signals s ON s.id = se.signal_id
           WHERE se.extraction->'entities'->'${targetField}' ? $1
         ) customers
         WHERE customer <> ''
         GROUP BY customer
         ORDER BY count DESC
         LIMIT 10`,
        [entity_name]
      );

      const relatedCounts = await pool.query(
        `SELECT related, COUNT(*)::int AS count
         FROM (
           SELECT jsonb_array_elements_text(
             COALESCE(se.extraction->'entities'->'${relatedField}', '[]'::jsonb)
           ) AS related
           FROM signal_extractions se
           JOIN signals s ON s.id = se.signal_id
           WHERE se.extraction->'entities'->'${targetField}' ? $1
         ) related_items
         WHERE related <> ''
         GROUP BY related
         ORDER BY count DESC
         LIMIT 10`,
        [entity_name]
      );

      return textResponse(
        JSON.stringify(
          {
            action,
            entity_name,
            affected_customers: customerCounts.rows,
            related_entities: relatedCounts.rows
          },
          null,
          2
        )
      );
    } catch (error) {
      logger.error('what_if_analysis failed', { error, action, entity_name });
      throw error;
    }
  }
};
