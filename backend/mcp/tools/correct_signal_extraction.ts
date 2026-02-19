import * as z from 'zod/v4';
import { textResponse } from '../tool_utils';
import { AutoCorrectionService } from '../../services/auto_correction_service';
import { logger } from '../../utils/logger';

export const tool = {
  name: 'correct_signal_extraction',
  description: 'Correct an LLM extraction error in a signal. Can optionally apply the correction to similar signals automatically based on vector similarity.',
  inputSchema: {
    signal_id: z.string().uuid().describe('UUID of the signal to correct'),
    correction_type: z.enum(['customer_name', 'feature_name', 'issue_title', 'sentiment', 'urgency', 'theme']).describe('Type of correction being made'),
    field_path: z.string().describe('JSONPath to the field in extraction JSONB (e.g., "entities.customers[0].name" or "sentiment")'),
    old_value: z.string().describe('Current (incorrect) value'),
    new_value: z.string().describe('Corrected value'),
    apply_to_similar: z.boolean().optional().default(false).describe('Whether to automatically apply this correction to similar signals (default: false)'),
    similarity_threshold: z.number().min(0).max(1).optional().default(0.85).describe('Minimum similarity score for auto-applying corrections (default: 0.85)'),
    corrected_by: z.string().optional().default('human').describe('Who is making this correction (default: "human")')
  },
  handler: async ({
    signal_id,
    correction_type,
    field_path,
    old_value,
    new_value,
    apply_to_similar,
    similarity_threshold,
    corrected_by
  }: {
    signal_id: string;
    correction_type: string;
    field_path: string;
    old_value: string;
    new_value: string;
    apply_to_similar?: boolean;
    similarity_threshold?: number;
    corrected_by?: string;
  }) => {
    try {
      const correctionService = new AutoCorrectionService();

      // Apply correction to this signal
      const result = await correctionService.applyCorrection({
        signalId: signal_id,
        correctionType: correction_type,
        fieldPath: field_path,
        oldValue: old_value,
        newValue: new_value,
        correctedBy: corrected_by || 'human'
      });

      let appliedCount = 0;

      // Optionally apply to similar signals
      if (apply_to_similar) {
        appliedCount = await correctionService.applyCorrectionToSimilar(
          result.correctionId,
          50 // Max 50 similar signals
        );

        // Learn pattern for future auto-correction
        await correctionService.learnPattern(result.correctionId);
      }

      // Format response
      const response = {
        success: true,
        correction_id: result.correctionId,
        signal_id: result.signalId,
        signal_corrected: true,
        similar_signals_corrected: appliedCount,
        re_clustering_triggered: result.affectedOpportunities.length > 0,
        affected_opportunities: result.affectedOpportunities,
        extraction_updated: {
          before: result.extractionBefore,
          after: result.extractionAfter
        }
      };

      logger.info('Signal extraction corrected via MCP tool', {
        stage: 'mcp_tools',
        signal_id,
        correction_type,
        similar_count: appliedCount
      });

      return textResponse(JSON.stringify(response, null, 2));
    } catch (error: any) {
      logger.error('correct_signal_extraction failed', {
        error: error.message,
        signal_id,
        correction_type,
        field_path
      });
      throw error;
    }
  }
};
