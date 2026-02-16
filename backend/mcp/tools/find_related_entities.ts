import * as z from 'zod/v4';
import { textResponse } from '../tool_utils';
import { getNeo4jDriver } from '../../neo4j/client';
import { config } from '../../config/env';
import { logger } from '../../utils/logger';

export const tool = {
  name: 'find_related_entities',
  description: 'Find entities related by name similarity',
  inputSchema: {
    entity_name: z.string(),
    entity_type: z.enum(['customer', 'feature', 'issue', 'theme', 'stakeholder', 'any']).optional(),
    max_hops: z.number().int().min(1).max(4).optional(),
    limit: z.number().int().min(1).max(50).optional()
  },
  handler: async ({
    entity_name,
    entity_type = 'any',
    max_hops = 2,
    limit = 25
  }: {
    entity_name: string;
    entity_type?: string;
    max_hops?: number;
    limit?: number;
  }) => {
    const driver = getNeo4jDriver();
    const session = driver.session({ database: config.neo4j.database });
    try {
      const labelMap: Record<string, string> = {
        customer: 'Customer',
        feature: 'Feature',
        issue: 'Issue',
        theme: 'Theme',
        stakeholder: 'Stakeholder',
        any: ''
      };
      const label = labelMap[entity_type] || '';
      const labelClause = label ? `:${label}` : '';

      const query = `
        MATCH (start${labelClause})
        WHERE toLower(start.canonical_name) = toLower($name)
        MATCH (start)-[r*1..$maxHops]-(neighbor)
        RETURN DISTINCT neighbor, length(r) AS hops
        LIMIT $limit
      `;
      const result = await session.run(query, { name: entity_name, maxHops: max_hops, limit });
      const related = result.records.map((record) => {
        const node = record.get('neighbor');
        return {
          labels: node.labels,
          properties: node.properties,
          hops: record.get('hops')
        };
      });
      return textResponse(JSON.stringify(related, null, 2));
    } catch (error) {
      logger.error('find_related_entities failed', { error, entity_name });
      throw error;
    } finally {
      await session.close();
    }
  }
};
