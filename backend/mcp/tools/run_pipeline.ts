import * as z from 'zod/v4';
import crypto from 'crypto';
import { textResponse } from '../tool_utils';
import { getDbPool } from '../../db/connection';
import { IngestionPipelineService } from '../../services/ingestion_pipeline_service';
import { logger } from '../../utils/logger';

export const tool = {
  name: 'run_pipeline',
  description: 'Trigger a pipeline run',
  inputSchema: {
    scope: z.enum(['recent', 'unprocessed', 'all']).optional(),
    skip_ingestion: z.boolean().optional()
  },
  handler: async ({
    scope = 'unprocessed',
    skip_ingestion = false
  }: {
    scope?: 'recent' | 'unprocessed' | 'all';
    skip_ingestion?: boolean;
  }) => {
    try {
      const pool = getDbPool();
      let query = 'SELECT * FROM signals';
      if (scope === 'recent') {
        query += ' WHERE created_at >= NOW() - interval \'7 days\'';
      } else if (scope === 'unprocessed') {
        query =
          'SELECT s.* FROM signals s LEFT JOIN signal_extractions se ON s.id = se.signal_id WHERE se.signal_id IS NULL';
      }
      query += ' ORDER BY created_at DESC LIMIT 200';

      const result = await pool.query(query);
      const rawSignals = result.rows.map((row) => ({
        id: row.id,
        source: row.source,
        content: row.content,
        normalized_content: row.normalized_content,
        metadata: row.metadata || {},
        content_hash: crypto.createHash('sha256').update(row.normalized_content || row.content).digest('hex'),
        created_at: row.created_at.toISOString()
      }));

      if (!rawSignals.length) {
        return textResponse('No signals found for the selected scope.');
      }

      const pipeline = new IngestionPipelineService();
      if (skip_ingestion) {
        await pipeline.ingest(rawSignals);
      } else {
        await pipeline.ingest(rawSignals);
      }

      return textResponse(`Pipeline processed ${rawSignals.length} signals (scope: ${scope}).`);
    } catch (error) {
      logger.error('run_pipeline failed', { error, scope });
      throw error;
    }
  }
};
