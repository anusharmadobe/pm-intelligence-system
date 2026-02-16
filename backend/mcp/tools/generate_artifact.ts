import * as z from 'zod/v4';
import { textResponse } from '../tool_utils';
import { createLLMProviderFromEnv } from '../../services/llm_service';
import { getDbPool } from '../../db/connection';
import { logger } from '../../utils/logger';

export const tool = {
  name: 'generate_artifact',
  description: 'Generate an artifact (PRD/RFC) from a judgment',
  inputSchema: {
    artifact_type: z.enum(['prd', 'jira', 'rfc', 'one_pager']),
    opportunity_id: z.string().optional(),
    entity_name: z.string().optional(),
    include_provenance: z.boolean().optional(),
    audience: z.enum(['engineering', 'design', 'leadership', 'cs_sales', 'general']).optional()
  },
  handler: async ({
    artifact_type,
    opportunity_id,
    entity_name,
    include_provenance = true,
    audience = 'general'
  }: {
    artifact_type: 'prd' | 'jira' | 'rfc' | 'one_pager';
    opportunity_id?: string;
    entity_name?: string;
    include_provenance?: boolean;
    audience?: 'engineering' | 'design' | 'leadership' | 'cs_sales' | 'general';
  }) => {
    try {
      if (!opportunity_id && !entity_name) {
        throw new Error('Provide opportunity_id or entity_name');
      }

      const pool = getDbPool();
      let signals: Array<{ id: string; source: string; content: string; created_at: string }> = [];
      if (opportunity_id) {
        const result = await pool.query(
          `SELECT s.id, s.source, s.content, s.created_at
           FROM opportunity_signals os
           JOIN signals s ON s.id = os.signal_id
           WHERE os.opportunity_id = $1
           ORDER BY s.created_at DESC
           LIMIT 20`,
          [opportunity_id]
        );
        signals = result.rows;
      } else if (entity_name) {
        const result = await pool.query(
          `SELECT id, source, content, created_at
           FROM signals
           WHERE normalized_content ILIKE $1
           ORDER BY created_at DESC
           LIMIT 20`,
          [`%${entity_name}%`]
        );
        signals = result.rows;
      }

      if (!signals.length) {
        throw new Error('No signals found for artifact generation');
      }

      const llmProvider = createLLMProviderFromEnv();
      const provenance = signals.map((signal) => ({
        id: signal.id,
        source: signal.source,
        created_at: signal.created_at
      }));
      const prompt = [
        `Generate a ${artifact_type} for a ${audience} audience.`,
        entity_name ? `Entity focus: ${entity_name}.` : '',
        opportunity_id ? `Opportunity ID: ${opportunity_id}.` : '',
        'Use the signal evidence below. Clearly label assumptions.',
        signals
          .map((signal) => `- [${signal.source}] ${signal.content.substring(0, 200)}`)
          .join('\n')
      ]
        .filter(Boolean)
        .join('\n');

      const content = await llmProvider(prompt);
      return textResponse(
        JSON.stringify(
          {
            artifact_type,
            audience,
            opportunity_id: opportunity_id || null,
            entity_name: entity_name || null,
            content,
            provenance: include_provenance ? provenance : undefined
          },
          null,
          2
        )
      );
    } catch (error) {
      logger.error('generate_artifact failed', { error, opportunity_id, entity_name });
      throw error;
    }
  }
};
