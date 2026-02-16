import * as z from 'zod/v4';
import { textResponse } from '../tool_utils';
import { getNeo4jDriver } from '../../neo4j/client';
import { config } from '../../config/env';
import { logger } from '../../utils/logger';

export const tool = {
  name: 'browse_knowledge_graph',
  description: 'Browse nodes in the knowledge graph',
  inputSchema: {
    root_entity_type: z
      .enum(['customer', 'feature', 'issue', 'theme', 'stakeholder', 'all'])
      .optional(),
    root_entity_name: z.string().optional(),
    filter_area: z.string().optional(),
    max_hops: z.number().int().min(1).max(4).optional(),
    limit: z.number().int().min(1).max(50).optional()
  },
  handler: async ({
    root_entity_type = 'all',
    root_entity_name,
    filter_area,
    max_hops = 2,
    limit = 25
  }: {
    root_entity_type?: string;
    root_entity_name?: string;
    filter_area?: string;
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
        all: ''
      };
      const label = labelMap[root_entity_type] || '';
      const labelClause = label ? `:${label}` : '';
      const areaClause = filter_area ? 'AND (n.product_area = $filterArea OR n.area = $filterArea)' : '';

      if (root_entity_name) {
        const query = `
          MATCH (n${labelClause})
          WHERE toLower(n.canonical_name) = toLower($name)
          ${areaClause}
          OPTIONAL MATCH (n)-[r*1..$maxHops]-(neighbor)
          RETURN n, collect(DISTINCT neighbor) AS neighbors
          LIMIT $limit
        `;
        const result = await session.run(query, {
          name: root_entity_name,
          maxHops: max_hops,
          limit,
          filterArea: filter_area
        });
        const record = result.records[0];
        const root = record?.get('n')?.properties || null;
        const neighbors = (record?.get('neighbors') || []).map((node: any) => node.properties);
        return textResponse(JSON.stringify({ root, neighbors }, null, 2));
      }

      const query = `MATCH (n${labelClause}) WHERE 1=1 ${areaClause} RETURN n LIMIT $limit`;
      const result = await session.run(query, { limit, filterArea: filter_area });
      const nodes = result.records.map((record) => record.get('n').properties);
      return textResponse(JSON.stringify(nodes, null, 2));
    } catch (error) {
      logger.error('browse_knowledge_graph failed', { error, root_entity_name });
      throw error;
    } finally {
      await session.close();
    }
  }
};
