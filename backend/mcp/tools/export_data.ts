import * as z from 'zod/v4';
import { textResponse } from '../tool_utils';
import { getDbPool } from '../../db/connection';
import { getNeo4jDriver } from '../../neo4j/client';
import { config } from '../../config/env';
import { createModuleLogger } from '../../utils/logger';

// Create module-specific logger for export operations
const logger = createModuleLogger('export', 'LOG_LEVEL_EXPORT');

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
    const startTime = Date.now();

    logger.info('Starting data export', {
      stage: 'export_data',
      status: 'start',
      export_type,
      format,
      date_from: date_from || null,
      date_to: date_to || null,
      has_date_filter: !!(date_from || date_to)
    });

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
        logger.debug('Executing export query', {
          stage: 'export_data',
          export_type,
          query_type: 'entities',
          has_date_filter: !!dateClause,
          params: params.map(p => p.toISOString ? p.toISOString() : p)
        });

        const queryStartTime = Date.now();
        const result = await pool.query(
          `SELECT * FROM entity_registry WHERE 1=1 ${dateClause} ORDER BY created_at DESC LIMIT 500`,
          params
        );
        payload = result.rows;

        logger.info('Export query completed', {
          stage: 'export_data',
          status: 'query_complete',
          export_type,
          query_type: 'entities',
          row_count: result.rows.length,
          duration_ms: Date.now() - queryStartTime,
          truncated: result.rows.length >= 500
        });
      } else if (export_type === 'signals') {
        logger.debug('Executing export query', {
          stage: 'export_data',
          export_type,
          query_type: 'signals',
          has_date_filter: !!dateClause
        });

        const queryStartTime = Date.now();
        const result = await pool.query(
          `SELECT * FROM signals WHERE 1=1 ${dateClause} ORDER BY created_at DESC LIMIT 500`,
          params
        );
        payload = result.rows;

        logger.info('Export query completed', {
          stage: 'export_data',
          status: 'query_complete',
          export_type,
          query_type: 'signals',
          row_count: result.rows.length,
          duration_ms: Date.now() - queryStartTime,
          truncated: result.rows.length >= 500
        });
      } else if (export_type === 'opportunities') {
        logger.debug('Executing export query', {
          stage: 'export_data',
          export_type,
          query_type: 'opportunities',
          has_date_filter: !!dateClause
        });

        const queryStartTime = Date.now();
        const result = await pool.query(
          `SELECT * FROM opportunities WHERE 1=1 ${dateClause} ORDER BY created_at DESC LIMIT 200`,
          params
        );
        payload = result.rows;

        logger.info('Export query completed', {
          stage: 'export_data',
          status: 'query_complete',
          export_type,
          query_type: 'opportunities',
          row_count: result.rows.length,
          duration_ms: Date.now() - queryStartTime,
          truncated: result.rows.length >= 200
        });
      } else if (export_type === 'feedback_log') {
        logger.debug('Executing export query', {
          stage: 'export_data',
          export_type,
          query_type: 'feedback_log',
          has_date_filter: !!dateClause
        });

        const queryStartTime = Date.now();
        const result = await pool.query(
          `SELECT * FROM feedback_log WHERE 1=1 ${dateClause} ORDER BY created_at DESC LIMIT 500`,
          params
        );
        payload = result.rows;

        logger.info('Export query completed', {
          stage: 'export_data',
          status: 'query_complete',
          export_type,
          query_type: 'feedback_log',
          row_count: result.rows.length,
          duration_ms: Date.now() - queryStartTime,
          truncated: result.rows.length >= 500
        });
      } else if (export_type === 'knowledge_graph') {
        logger.debug('Querying Neo4j for knowledge graph export', {
          stage: 'export_data',
          export_type,
          database: config.neo4j.database
        });

        const neo4jStartTime = Date.now();
        const session = getNeo4jDriver().session({ database: config.neo4j.database });
        try {
          const nodesResult = await session.run('MATCH (n) RETURN n LIMIT 100');
          const relResult = await session.run('MATCH ()-[r]-() RETURN r LIMIT 100');
          payload = {
            nodes: nodesResult.records.map((record) => record.get('n').properties),
            relationships: relResult.records.map((record) => record.get('r').properties)
          };

          logger.info('Neo4j query completed', {
            stage: 'export_data',
            status: 'neo4j_complete',
            export_type,
            node_count: nodesResult.records.length,
            relationship_count: relResult.records.length,
            duration_ms: Date.now() - neo4jStartTime,
            truncated: nodesResult.records.length >= 100 || relResult.records.length >= 100
          });
        } finally {
          await session.close();
        }
      } else if (export_type === 'full_backup') {
        logger.debug('Executing full backup export', {
          stage: 'export_data',
          export_type
        });

        const backupStartTime = Date.now();
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

        logger.info('Full backup export completed', {
          stage: 'export_data',
          status: 'backup_complete',
          export_type,
          entity_count: entities.rows.length,
          signal_count: signals.rows.length,
          opportunity_count: opportunities.rows.length,
          feedback_count: feedback.rows.length,
          duration_ms: Date.now() - backupStartTime
        });
      }

      if (format === 'csv' && Array.isArray(payload)) {
        logger.debug('Converting to CSV', {
          stage: 'export_data',
          status: 'csv_conversion',
          export_type,
          row_count: payload.length,
          column_count: payload.length > 0 ? Object.keys(payload[0]).length : 0
        });

        const csvOutput = toCsv(payload);
        const totalDuration = Date.now() - startTime;

        logger.info('Export completed successfully', {
          stage: 'export_data',
          status: 'success',
          export_type,
          format: 'csv',
          row_count: payload.length,
          output_size_bytes: csvOutput.length,
          total_duration_ms: totalDuration
        });

        return textResponse(csvOutput);
      }

      const jsonOutput = JSON.stringify(payload, null, 2);
      const totalDuration = Date.now() - startTime;

      logger.info('Export completed successfully', {
        stage: 'export_data',
        status: 'success',
        export_type,
        format: 'json',
        row_count: Array.isArray(payload) ? payload.length : 'N/A',
        output_size_bytes: jsonOutput.length,
        total_duration_ms: totalDuration
      });

      return textResponse(jsonOutput);
    } catch (error: any) {
      logger.error('Export failed', {
        stage: 'export_data',
        status: 'error',
        error: error.message,
        stack: error.stack,
        export_type,
        format,
        date_from,
        date_to,
        duration_ms: Date.now() - startTime
      });
      throw error;
    }
  }
};
