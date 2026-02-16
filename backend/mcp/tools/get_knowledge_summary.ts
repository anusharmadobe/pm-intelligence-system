import * as z from 'zod/v4';
import { textResponse } from '../tool_utils';
import { getDbPool } from '../../db/connection';
import { getNeo4jDriver } from '../../neo4j/client';
import { config } from '../../config/env';
import { logger } from '../../utils/logger';

export const tool = {
  name: 'get_knowledge_summary',
  description: 'Summarize knowledge graph and registry stats',
  inputSchema: {},
  handler: async () => {
    try {
      const pool = getDbPool();
      const pgResult = await pool.query(
        `SELECT entity_type, COUNT(*)::int AS count
         FROM entity_registry
         WHERE is_active = true
         GROUP BY entity_type`
      );

      const driver = getNeo4jDriver();
      const session = driver.session({ database: config.neo4j.database });
      try {
        const neo4jResult = await session.run('MATCH (n) RETURN count(n) AS count');
        const neo4jCount = neo4jResult.records[0]?.get('count')?.toInt?.() || 0;
        return textResponse(
          JSON.stringify(
            {
              entity_counts: pgResult.rows,
              neo4j_nodes: neo4jCount
            },
            null,
            2
          )
        );
      } finally {
        await session.close();
      }
    } catch (error) {
      logger.error('get_knowledge_summary failed', { error });
      throw error;
    }
  }
};
