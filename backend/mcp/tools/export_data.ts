import * as z from 'zod/v4';
import { textResponse } from '../tool_utils';
import { getDbPool } from '../../db/connection';
import { getNeo4jDriver } from '../../neo4j/client';
import { config } from '../../config/env';
import { logger } from '../../utils/logger';

export const tool = {
  name: 'export_data',
  description: 'Export data from the system',
  inputSchema: {
    export_type: z.enum([
      'entities',
      'signals',
      'opportunities',
      'knowledge_graph',
      'feedback_log',
      'full_backup'
    ]),
    format: z.enum(['json', 'csv']).optional(),
    date_from: z.string().optional(),
    date_to: z.string().optional()
  },
  handler: async ({
    export_type,
    format = 'json',
    date_from,
    date_to
  }: {
    export_type: string;
    format?: 'json' | 'csv';
    date_from?: string;
    date_to?: string;
  }) => {
    try {
      const pool = getDbPool();
      const params: any[] = [];
      let dateClause = '';
      if (date_from) {
        const parsed = new Date(date_from);
        if (Number.isNaN(parsed.getTime())) throw new Error('Invalid date_from');
        params.push(parsed);
        dateClause += ` AND created_at >= $${params.length}`;
      }
      if (date_to) {
        const parsed = new Date(date_to);
        if (Number.isNaN(parsed.getTime())) throw new Error('Invalid date_to');
        params.push(parsed);
        dateClause += ` AND created_at <= $${params.length}`;
      }

      const toCsv = (rows: Record<string, any>[]) => {
        if (!rows.length) return '';
        const headers = Object.keys(rows[0]);
        const lines = rows.map((row) =>
          headers.map((key) => JSON.stringify(row[key] ?? '')).join(',')
        );
        return [headers.join(','), ...lines].join('\n');
      };

      let payload: any = null;
      if (export_type === 'entities') {
        const result = await pool.query(
          `SELECT * FROM entity_registry WHERE 1=1 ${dateClause} ORDER BY created_at DESC LIMIT 500`,
          params
        );
        payload = result.rows;
      } else if (export_type === 'signals') {
        const result = await pool.query(
          `SELECT * FROM signals WHERE 1=1 ${dateClause} ORDER BY created_at DESC LIMIT 500`,
          params
        );
        payload = result.rows;
      } else if (export_type === 'opportunities') {
        const result = await pool.query(
          `SELECT * FROM opportunities WHERE 1=1 ${dateClause} ORDER BY created_at DESC LIMIT 200`,
          params
        );
        payload = result.rows;
      } else if (export_type === 'feedback_log') {
        const result = await pool.query(
          `SELECT * FROM feedback_log WHERE 1=1 ${dateClause} ORDER BY created_at DESC LIMIT 500`,
          params
        );
        payload = result.rows;
      } else if (export_type === 'knowledge_graph') {
        const session = getNeo4jDriver().session({ database: config.neo4j.database });
        try {
          const nodesResult = await session.run('MATCH (n) RETURN n LIMIT 100');
          const relResult = await session.run('MATCH ()-[r]-() RETURN r LIMIT 100');
          payload = {
            nodes: nodesResult.records.map((record) => record.get('n').properties),
            relationships: relResult.records.map((record) => record.get('r').properties)
          };
        } finally {
          await session.close();
        }
      } else if (export_type === 'full_backup') {
        const entities = await pool.query(`SELECT * FROM entity_registry ORDER BY created_at DESC LIMIT 500`);
        const signals = await pool.query(`SELECT * FROM signals ORDER BY created_at DESC LIMIT 500`);
        const opportunities = await pool.query(`SELECT * FROM opportunities ORDER BY created_at DESC LIMIT 200`);
        const feedback = await pool.query(`SELECT * FROM feedback_log ORDER BY created_at DESC LIMIT 500`);
        payload = {
          entities: entities.rows,
          signals: signals.rows,
          opportunities: opportunities.rows,
          feedback_log: feedback.rows
        };
      }

      if (format === 'csv' && Array.isArray(payload)) {
        return textResponse(toCsv(payload));
      }

      return textResponse(JSON.stringify(payload, null, 2));
    } catch (error) {
      logger.error('export_data failed', { error, export_type });
      throw error;
    }
  }
};
