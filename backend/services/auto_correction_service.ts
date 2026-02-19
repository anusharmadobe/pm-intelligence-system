import { getDbPool } from '../db/connection';
import { logger } from '../utils/logger';
import { EmbeddingProvider, cosineSimilarity, createEmbeddingProviderFromEnv } from './embedding_provider';
import { EventBus, eventBus as defaultEventBus } from '../agents/event_bus';
import * as jp from 'jsonpath';

export interface CorrectionParams {
  signalId: string;
  correctionType: string;
  fieldPath: string;
  oldValue: string;
  newValue: string;
  correctedBy: string;
}

export interface CorrectionResult {
  correctionId: string;
  signalId: string;
  updated: boolean;
  affectedOpportunities: string[];
  extractionBefore: any;
  extractionAfter: any;
}

export interface SignalCorrection {
  id: string;
  signal_id: string;
  correction_type: string;
  field_path: string;
  old_value: string;
  new_value: string;
  corrected_by: string;
  corrected_at: Date;
  applied_to_similar_count: number;
  confidence: number;
}

export interface CorrectionPattern {
  id: string;
  pattern_type: string;
  pattern_data: any;
  correction_type?: string;
  occurrence_count: number;
  accuracy_rate: number | null;
  enabled: boolean;
}

export interface CorrectionStats {
  total_corrections: number;
  corrections_by_type: Record<string, number>;
  auto_applied_corrections: number;
  patterns_learned: number;
  average_accuracy: number;
}

export interface Signal {
  id: string;
  content: string;
  metadata?: any;
  embedding?: number[];
}

export class AutoCorrectionService {
  private embeddingProvider: EmbeddingProvider | null = null;
  private eventBus: EventBus;

  constructor(eventBus?: EventBus) {
    // Initialize embedding provider for similarity search
    try {
      this.embeddingProvider = createEmbeddingProviderFromEnv();
    } catch (error) {
      this.embeddingProvider = null;
      logger.warn('Auto-correction: Embedding provider unavailable - similarity search disabled', { error });
    }

    this.eventBus = eventBus || defaultEventBus;
  }

  /**
   * Apply a correction to a signal extraction (wrapped in transaction)
   */
  async applyCorrection(params: CorrectionParams): Promise<CorrectionResult> {
    // Validate input parameters
    if (!params.signalId || !params.correctionType || !params.fieldPath) {
      throw new Error('Missing required parameters: signalId, correctionType, or fieldPath');
    }

    if (!params.oldValue || !params.newValue) {
      throw new Error('Both oldValue and newValue are required');
    }

    if (params.oldValue === params.newValue) {
      throw new Error('Old value and new value cannot be the same');
    }

    const pool = getDbPool();
    const startTime = Date.now();

    logger.info('Applying extraction correction', {
      stage: 'auto_correction',
      status: 'start',
      signal_id: params.signalId,
      correction_type: params.correctionType,
      field_path: params.fieldPath
    });

    const client = await pool.connect();

    try {
      // Begin transaction
      await client.query('BEGIN');
      await client.query('SET LOCAL statement_timeout = 60000'); // 1 minute timeout

      logger.debug('Transaction started for correction', {
        stage: 'auto_correction',
        status: 'begin',
        signal_id: params.signalId
      });

      // Get current extraction
      const extractionResult = await client.query(
        `SELECT extraction FROM signal_extractions WHERE signal_id = $1`,
        [params.signalId]
      );

      if (extractionResult.rows.length === 0) {
        throw new Error(`No extraction found for signal ${params.signalId}`);
      }

      const extractionBefore = extractionResult.rows[0].extraction;

      // Apply correction to JSONB field
      const extractionAfter = this.applyJsonPathCorrection(
        extractionBefore,
        params.fieldPath,
        params.oldValue,
        params.newValue
      );

      // Update extraction in database
      await client.query(
        `UPDATE signal_extractions
         SET extraction = $1, corrections_applied = true, corrections_applied_at = NOW()
         WHERE signal_id = $2`,
        [JSON.stringify(extractionAfter), params.signalId]
      );

      // Store correction record
      const correctionResult = await client.query(
        `INSERT INTO signal_corrections
         (signal_id, correction_type, field_path, old_value, new_value, corrected_by)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id`,
        [
          params.signalId,
          params.correctionType,
          params.fieldPath,
          params.oldValue,
          params.newValue,
          params.correctedBy
        ]
      );

      const correctionId = correctionResult.rows[0].id;

      // Find opportunities affected by this signal
      const oppResult = await client.query(
        `SELECT opportunity_id FROM opportunity_signals WHERE signal_id = $1`,
        [params.signalId]
      );

      const affectedOpportunities = oppResult.rows.map((r: any) => r.opportunity_id);

      // Commit transaction
      await client.query('COMMIT');

      logger.info('Transaction committed for correction', {
        stage: 'auto_correction',
        status: 'commit',
        signal_id: params.signalId,
        correction_id: correctionId
      });

      // Publish event for re-clustering (outside transaction)
      this.eventBus.publish({
        event_type: 'extraction.corrected',
        source_service: 'auto_correction_service',
        payload: {
          signal_ids: [params.signalId],
          correction_id: correctionId,
          correction_type: params.correctionType,
          opportunities_affected: affectedOpportunities
        },
        metadata: {
          signal_ids: [params.signalId]
        }
      });

      logger.info('Extraction correction applied', {
        stage: 'auto_correction',
        status: 'success',
        signal_id: params.signalId,
        correction_id: correctionId,
        affected_opportunities: affectedOpportunities.length,
        duration_ms: Date.now() - startTime
      });

      return {
        correctionId,
        signalId: params.signalId,
        updated: true,
        affectedOpportunities,
        extractionBefore,
        extractionAfter
      };
    } catch (error: any) {
      // Rollback on error
      await client.query('ROLLBACK');
      logger.error('Transaction rolled back for correction', {
        stage: 'auto_correction',
        status: 'rollback',
        signal_id: params.signalId,
        correction_type: params.correctionType,
        error: error.message,
        stack: error.stack,
        duration_ms: Date.now() - startTime
      });
      throw error;
    } finally {
      // Always release client
      client.release();
    }
  }

  /**
   * Apply correction to JSONB using JSONPath
   */
  private applyJsonPathCorrection(
    extraction: any,
    fieldPath: string,
    oldValue: string,
    newValue: string
  ): any {
    // Clone extraction to avoid mutation
    const updated = JSON.parse(JSON.stringify(extraction));

    try {
      // Convert field path to JSONPath format (e.g., "entities.customers[0].name" → "$.entities.customers[0].name")
      const jsonPath = fieldPath.startsWith('$') ? fieldPath : `$.${fieldPath}`;

      // Get current values at path
      const values = jp.query(updated, jsonPath);

      if (values.length === 0) {
        logger.warn('JSONPath did not match any values', { jsonPath, fieldPath });
        return updated;
      }

      // Replace old value with new value
      jp.apply(updated, jsonPath, (value: any) => {
        if (value === oldValue || JSON.stringify(value) === oldValue) {
          return newValue;
        }
        return value;
      });

      return updated;
    } catch (error: any) {
      logger.error('Failed to apply JSONPath correction', {
        error: error.message,
        fieldPath,
        oldValue,
        newValue
      });
      return extraction; // Return original on error
    }
  }

  /**
   * Find similar signals using embedding similarity
   */
  async findSimilarSignals(
    signalId: string,
    similarityThreshold: number = 0.85
  ): Promise<Signal[]> {
    if (!this.embeddingProvider) {
      logger.warn('Cannot find similar signals - embedding provider not available');
      return [];
    }

    const pool = getDbPool();

    // Get the target signal's embedding
    const targetResult = await pool.query(
      `SELECT s.id, s.content, s.metadata, se.embedding
       FROM signals s
       JOIN signal_embeddings se ON s.id = se.signal_id
       WHERE s.id = $1`,
      [signalId]
    );

    if (targetResult.rows.length === 0) {
      logger.warn('Signal or embedding not found', { signalId });
      return [];
    }

    const targetEmbedding = targetResult.rows[0].embedding;
    if (!targetEmbedding) {
      logger.warn('No embedding found for signal', { signalId });
      return [];
    }

    // Find similar signals using vector similarity
    const similarResult = await pool.query(
      `SELECT
         s.id,
         s.content,
         s.metadata,
         se.embedding,
         1 - (se.embedding <=> $1::vector) as similarity
       FROM signals s
       JOIN signal_embeddings se ON s.id = se.signal_id
       WHERE s.id != $2
         AND 1 - (se.embedding <=> $1::vector) >= $3
       ORDER BY similarity DESC
       LIMIT 50`,
      [JSON.stringify(targetEmbedding), signalId, similarityThreshold]
    );

    logger.info('Found similar signals', {
      stage: 'auto_correction',
      signal_id: signalId,
      similar_count: similarResult.rows.length,
      threshold: similarityThreshold
    });

    return similarResult.rows.map((row: any) => ({
      id: row.id,
      content: row.content,
      metadata: row.metadata,
      embedding: row.embedding
    }));
  }

  /**
   * Apply correction to similar signals automatically
   */
  async applyCorrectionToSimilar(
    correctionId: string,
    maxSignals: number = 50
  ): Promise<number> {
    // Validate input
    if (!correctionId) {
      throw new Error('Correction ID is required');
    }

    if (maxSignals < 1 || maxSignals > 100) {
      throw new Error('maxSignals must be between 1 and 100');
    }

    const pool = getDbPool();
    const startTime = Date.now();

    logger.info('Applying correction to similar signals', {
      stage: 'auto_correction',
      status: 'start',
      correction_id: correctionId,
      max_signals: maxSignals
    });

    try {
      // Get the original correction
      const correctionResult = await pool.query(
        `SELECT * FROM signal_corrections WHERE id = $1`,
        [correctionId]
      );

      if (correctionResult.rows.length === 0) {
        throw new Error(`Correction ${correctionId} not found`);
      }

      const correction = correctionResult.rows[0];

      logger.debug('Found correction record', {
        stage: 'auto_correction',
        correction_id: correctionId,
        source_signal_id: correction.signal_id,
        correction_type: correction.correction_type
      });

      // Find similar signals
      const similarSignals = await this.findSimilarSignals(
        correction.signal_id,
        0.85
      );

      const signalsToProcess = similarSignals.slice(0, maxSignals);
      const totalSignals = signalsToProcess.length;

      logger.info('Found similar signals to process', {
        stage: 'auto_correction',
        status: 'in_progress',
        correction_id: correctionId,
        similar_signal_count: totalSignals
      });

      let appliedCount = 0;
      const signalIds: string[] = [];
      let lastLogTime = Date.now();

      // Apply correction to each similar signal in micro-transactions
      for (let i = 0; i < signalsToProcess.length; i++) {
        const signal = signalsToProcess[i];

        // Log progress every 5 seconds or every 10 signals
        const now = Date.now();
        if (now - lastLogTime >= 5000 || (i + 1) % 10 === 0) {
          const progress = ((i + 1) / totalSignals) * 100;
          const elapsed = now - startTime;
          const rate = (i + 1) / (elapsed / 1000);
          const eta = totalSignals > i + 1 ? Math.round((totalSignals - i - 1) / rate) : 0;

          logger.info('Applying corrections progress', {
            stage: 'auto_correction',
            status: 'in_progress',
            correction_id: correctionId,
            processed: i + 1,
            total: totalSignals,
            progress_pct: progress.toFixed(1),
            applied_so_far: appliedCount,
            rate_per_sec: rate.toFixed(2),
            eta_seconds: eta.toString(),
            elapsed_ms: elapsed
          });

          lastLogTime = now;
        }

        // Use individual transaction for each signal (micro-transaction pattern)
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          await client.query('SET LOCAL statement_timeout = 30000'); // 30 second timeout

          // Get extraction
          const extractionResult = await client.query(
            `SELECT extraction FROM signal_extractions WHERE signal_id = $1`,
            [signal.id]
          );

          if (extractionResult.rows.length === 0) {
            await client.query('ROLLBACK');
            client.release();
            continue;
          }

          const extraction = extractionResult.rows[0].extraction;

          // Check if the field path exists and has the old value
          const jsonPath = correction.field_path.startsWith('$')
            ? correction.field_path
            : `$.${correction.field_path}`;

          const values = jp.query(extraction, jsonPath);
          const hasOldValue = values.some(
            (v: any) => v === correction.old_value || JSON.stringify(v) === correction.old_value
          );

          if (!hasOldValue) {
            await client.query('ROLLBACK');
            client.release();
            continue; // Skip if old value not found
          }

          // Apply correction
          const updatedExtraction = this.applyJsonPathCorrection(
            extraction,
            correction.field_path,
            correction.old_value,
            correction.new_value
          );

          // Update extraction
          await client.query(
            `UPDATE signal_extractions
             SET extraction = $1, corrections_applied = true, corrections_applied_at = NOW()
             WHERE signal_id = $2`,
            [JSON.stringify(updatedExtraction), signal.id]
          );

          // Log application
          await client.query(
            `INSERT INTO correction_applications
             (signal_id, correction_id, applied_by, field_path, old_value, new_value, confidence)
             VALUES ($1, $2, 'auto_similar', $3, $4, $5, 0.85)`,
            [signal.id, correctionId, correction.field_path, correction.old_value, correction.new_value]
          );

          // Commit transaction
          await client.query('COMMIT');
          client.release();

          appliedCount++;
          signalIds.push(signal.id);
        } catch (error: any) {
          // Rollback on error
          await client.query('ROLLBACK');
          client.release();

          logger.error('Failed to apply correction to similar signal (rolled back)', {
            stage: 'auto_correction',
            signal_id: signal.id,
            correction_id: correctionId,
            error: error.message,
            stack: error.stack
          });
          // Continue processing other signals
        }
      }

      // Update applied_to_similar_count
      await pool.query(
        `UPDATE signal_corrections
         SET applied_to_similar_count = $1
         WHERE id = $2`,
        [appliedCount, correctionId]
      );

      // Publish event for re-clustering
      if (signalIds.length > 0) {
        this.eventBus.publish({
          event_type: 'extraction.corrected',
          source_service: 'auto_correction_service',
          payload: {
            signal_ids: signalIds,
            correction_id: correctionId,
            correction_type: correction.correction_type,
            opportunities_affected: []
          },
          metadata: {
            signal_ids: signalIds
          }
        });
      }

      const duration = Date.now() - startTime;
      logger.info('Applied correction to similar signals', {
        stage: 'auto_correction',
        status: 'success',
        correction_id: correctionId,
        applied_count: appliedCount,
        total_processed: totalSignals,
        success_rate: totalSignals > 0 ? ((appliedCount / totalSignals) * 100).toFixed(1) : '0',
        duration_ms: duration,
        rate_per_sec: (totalSignals / (duration / 1000)).toFixed(2)
      });

      return appliedCount;
    } catch (error: any) {
      logger.error('Failed to apply correction to similar signals', {
        stage: 'auto_correction',
        status: 'error',
        correction_id: correctionId,
        error: error.message,
        duration_ms: Date.now() - startTime
      });
      throw error;
    }
  }

  /**
   * Learn a pattern from a correction
   */
  async learnPattern(correctionId: string): Promise<void> {
    const pool = getDbPool();

    // Get correction
    const correctionResult = await pool.query(
      `SELECT * FROM signal_corrections WHERE id = $1`,
      [correctionId]
    );

    if (correctionResult.rows.length === 0) {
      throw new Error(`Correction ${correctionId} not found`);
    }

    const correction = correctionResult.rows[0];

    // Check if a similar pattern already exists
    const existingPattern = await pool.query(
      `SELECT * FROM correction_patterns
       WHERE pattern_type = $1
         AND pattern_data->>'old_pattern' = $2
       LIMIT 1`,
      [correction.correction_type, correction.old_value]
    );

    if (existingPattern.rows.length > 0) {
      // Update existing pattern
      await pool.query(
        `UPDATE correction_patterns
         SET occurrence_count = occurrence_count + 1,
             last_applied = NOW()
         WHERE id = $1`,
        [existingPattern.rows[0].id]
      );
    } else {
      // Create new pattern
      const patternData = {
        old_pattern: correction.old_value,
        new_pattern: correction.new_value,
        field_path: correction.field_path,
        context: []
      };

      await pool.query(
        `INSERT INTO correction_patterns
         (pattern_type, pattern_data, correction_type, enabled)
         VALUES ($1, $2, $3, true)`,
        [correction.correction_type, JSON.stringify(patternData), correction.correction_type]
      );
    }

    logger.info('Learned correction pattern', {
      stage: 'auto_correction',
      correction_id: correctionId,
      pattern_type: correction.correction_type
    });
  }

  /**
   * Get applicable patterns for a signal
   */
  async getApplicablePatterns(signalId: string): Promise<CorrectionPattern[]> {
    const pool = getDbPool();

    // Get all enabled patterns
    const result = await pool.query(
      `SELECT * FROM correction_patterns
       WHERE enabled = true
         AND (accuracy_rate IS NULL OR accuracy_rate >= 0.7)
       ORDER BY occurrence_count DESC, accuracy_rate DESC NULLS LAST
       LIMIT 20`
    );

    return result.rows;
  }

  /**
   * Apply a learned pattern to an extraction
   */
  async applyPattern(extraction: any, pattern: CorrectionPattern): Promise<any> {
    const patternData = pattern.pattern_data;

    // Apply the pattern transformation
    return this.applyJsonPathCorrection(
      extraction,
      patternData.field_path,
      patternData.old_pattern,
      patternData.new_pattern
    );
  }

  /**
   * Get correction history for a signal
   */
  async getCorrectionHistory(signalId: string): Promise<SignalCorrection[]> {
    const pool = getDbPool();

    const result = await pool.query(
      `SELECT * FROM signal_corrections
       WHERE signal_id = $1
       ORDER BY corrected_at DESC`,
      [signalId]
    );

    return result.rows;
  }

  /**
   * Get correction statistics
   */
  async getStats(): Promise<CorrectionStats> {
    const pool = getDbPool();

    // Total corrections
    const totalResult = await pool.query(
      `SELECT COUNT(*) as count FROM signal_corrections`
    );
    const total = parseInt(totalResult.rows[0].count);

    // Corrections by type
    const byTypeResult = await pool.query(
      `SELECT correction_type, COUNT(*) as count
       FROM signal_corrections
       GROUP BY correction_type`
    );
    const byType: Record<string, number> = {};
    byTypeResult.rows.forEach((row: any) => {
      byType[row.correction_type] = parseInt(row.count);
    });

    // Auto-applied corrections
    const autoAppliedResult = await pool.query(
      `SELECT COUNT(*) as count FROM correction_applications
       WHERE applied_by IN ('auto_similar', 'auto_pattern')`
    );
    const autoApplied = parseInt(autoAppliedResult.rows[0].count);

    // Patterns learned
    const patternsResult = await pool.query(
      `SELECT COUNT(*) as count FROM correction_patterns`
    );
    const patterns = parseInt(patternsResult.rows[0].count);

    // Average accuracy (from verified applications)
    const accuracyResult = await pool.query(
      `SELECT AVG(CASE WHEN verified = true THEN 1.0 ELSE 0.0 END) as avg_accuracy
       FROM correction_applications
       WHERE verified IS NOT NULL`
    );
    const avgAccuracy = accuracyResult.rows[0].avg_accuracy || 0;

    return {
      total_corrections: total,
      corrections_by_type: byType,
      auto_applied_corrections: autoApplied,
      patterns_learned: patterns,
      average_accuracy: parseFloat(avgAccuracy)
    };
  }
}
