import { v4 as uuidv4 } from 'uuid';
import { getDbPool } from '../db/connection';
import { logger as globalLogger, createModuleLogger } from '../utils/logger';
import { EntityRegistryService } from './entity_registry_service';
import { eventBus } from '../agents/event_bus';
import { config } from '../config/env';

// Create module-specific logger for entity resolution operations
const logger = createModuleLogger('entity_resolution', 'LOG_LEVEL_ENTITY_RESOLUTION');

export class FeedbackService {
  private registryService = new EntityRegistryService();

  private normalizeAlias(alias: string): string {
    return alias
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private async logAudit(params: {
    eventType: string;
    eventData: Record<string, unknown>;
    actor: string;
    actorPersona?: string | null;
  }): Promise<void> {
    const pool = getDbPool();
    await pool.query(
      `INSERT INTO audit_log
        (id, event_type, event_data, actor, actor_persona)
       VALUES (gen_random_uuid(), $1, $2, $3, $4)`,
      [
        params.eventType,
        JSON.stringify(params.eventData),
        params.actor,
        params.actorPersona || null
      ]
    );
  }

  async getPendingReviews(limit = 20) {
    const pool = getDbPool();
    const result = await pool.query(
      `SELECT * FROM feedback_log
       WHERE status = 'pending'
       ORDER BY created_at ASC
       LIMIT $1`,
      [limit]
    );
    return result.rows;
  }

  async confirmMerge(feedbackId: string, resolvedBy: string, notes?: string): Promise<void> {
    logger.info('Processing merge confirmation', {
      stage: 'entity_merge',
      status: 'start',
      feedback_id: feedbackId,
      resolved_by: resolvedBy,
      has_notes: !!notes
    });

    const pool = getDbPool();
    const feedbackResult = await pool.query(
      `SELECT * FROM feedback_log WHERE id = $1`,
      [feedbackId]
    );
    const feedback = feedbackResult.rows[0];
    if (!feedback) {
      logger.error('Feedback not found for merge confirmation', {
        stage: 'entity_merge',
        feedback_id: feedbackId
      });
      throw new Error('Feedback not found');
    }

    const systemOutput = feedback.system_output || {};
    const alias = systemOutput.entity_a || systemOutput.alias || null;
    const candidateEntityId = systemOutput.candidate_entity_id || systemOutput.entity_id;

    logger.debug('Feedback details retrieved', {
      stage: 'entity_merge',
      feedback_id: feedbackId,
      feedback_type: feedback.feedback_type,
      alias,
      candidate_entity_id: candidateEntityId,
      confidence: feedback.system_confidence
    });

    if (alias && candidateEntityId) {
      logger.debug('Preparing entity merge', {
        stage: 'entity_merge',
        alias,
        canonical_entity_id: candidateEntityId,
        alias_normalized: this.normalizeAlias(alias),
        feedback_id: feedbackId
      });

      await pool.query(
        `INSERT INTO entity_aliases
          (id, canonical_entity_id, alias, alias_normalized, alias_source, confidence, confirmed_by_human)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (alias_normalized, canonical_entity_id) DO NOTHING`,
        [
          uuidv4(),
          candidateEntityId,
          alias,
          this.normalizeAlias(alias),
          'human_confirmed',
          1.0,
          true
        ]
      );

      logger.info('Entity merged via feedback', {
        stage: 'entity_merge',
        status: 'alias_added',
        canonical_entity_id: candidateEntityId,
        alias,
        feedback_id: feedbackId,
        resolved_by: resolvedBy,
        method: 'human_confirmation'
      });

      if (config.featureFlags.eventBus) {
        logger.debug('Publishing entity.merged event', {
          stage: 'entity_merge',
          canonical_entity_id: candidateEntityId,
          alias,
          feedback_id: feedbackId
        });

        await eventBus.publish({
          event_type: 'entity.merged',
          source_service: 'feedback_service',
          payload: {
            canonical_entity_id: candidateEntityId,
            alias,
            feedback_id: feedbackId
          },
          metadata: {
            entity_ids: [candidateEntityId],
            severity: 'info'
          }
        });
      }
    } else {
      logger.warn('Cannot merge entity: missing alias or candidate entity ID', {
        stage: 'entity_merge',
        feedback_id: feedbackId,
        has_alias: !!alias,
        has_candidate_entity_id: !!candidateEntityId
      });
    }

    await pool.query(
      `UPDATE feedback_log
       SET status = 'accepted', resolved_by = $2, resolved_at = NOW(), resolution_notes = $3, updated_at = NOW()
       WHERE id = $1`,
      [feedbackId, resolvedBy, notes || null]
    );

    logger.info('Merge confirmation complete', {
      stage: 'entity_merge',
      status: 'success',
      feedback_id: feedbackId,
      resolved_by: resolvedBy
    });

    await this.logAudit({
      eventType: 'feedback.accepted',
      eventData: {
        feedback_id: feedbackId,
        alias,
        candidate_entity_id: candidateEntityId,
        notes: notes || null
      },
      actor: resolvedBy,
      actorPersona: 'daily_driver'
    });
  }

  async rejectMerge(feedbackId: string, resolvedBy: string, notes?: string): Promise<void> {
    logger.info('Processing merge rejection', {
      stage: 'entity_merge',
      status: 'rejected',
      feedback_id: feedbackId,
      resolved_by: resolvedBy,
      notes: notes || null,
      method: 'human_rejection'
    });

    const pool = getDbPool();
    await pool.query(
      `UPDATE feedback_log
       SET status = 'rejected', resolved_by = $2, resolved_at = NOW(), resolution_notes = $3, updated_at = NOW()
       WHERE id = $1`,
      [feedbackId, resolvedBy, notes || null]
    );

    logger.info('Merge rejection complete', {
      stage: 'entity_merge',
      status: 'rejection_complete',
      feedback_id: feedbackId,
      resolved_by: resolvedBy
    });

    await this.logAudit({
      eventType: 'feedback.rejected',
      eventData: {
        feedback_id: feedbackId,
        notes: notes || null
      },
      actor: resolvedBy,
      actorPersona: 'daily_driver'
    });
  }

  async addAlias(entityId: string, alias: string, source = 'manual'): Promise<void> {
    const pool = getDbPool();
    await pool.query(
      `INSERT INTO entity_aliases
        (id, canonical_entity_id, alias, alias_normalized, alias_source, confidence, confirmed_by_human)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (alias_normalized, canonical_entity_id) DO NOTHING`,
      [
        uuidv4(),
        entityId,
        alias,
        this.normalizeAlias(alias),
        source,
        1.0,
        source === 'human_confirmed' || source === 'manual'
      ]
    );

    await this.logAudit({
      eventType: 'alias.added',
      eventData: {
        entity_id: entityId,
        alias,
        source
      },
      actor: 'system',
      actorPersona: null
    });
  }

  async splitEntity(params: {
    survivingEntityId: string;
    newEntityName: string;
    entityType: string;
    performedBy: string;
    reasoning?: string;
  }): Promise<string> {
    const newEntity = await this.registryService.createEntity({
      entityType: params.entityType,
      canonicalName: params.newEntityName,
      createdBy: params.performedBy
    });

    const pool = getDbPool();
    await pool.query(
      `INSERT INTO entity_merge_history
        (id, action, surviving_entity_id, new_entity_id, performed_by, reasoning)
       VALUES (gen_random_uuid(), 'split', $1, $2, $3, $4)`,
      [params.survivingEntityId, newEntity.id, params.performedBy, params.reasoning || null]
    );

    await this.logAudit({
      eventType: 'entity.split',
      eventData: {
        surviving_entity_id: params.survivingEntityId,
        new_entity_id: newEntity.id,
        reasoning: params.reasoning || null
      },
      actor: params.performedBy,
      actorPersona: 'daily_driver'
    });

    return newEntity.id;
  }

  async recordFeedback(params: {
    feedbackType: string;
    systemOutput: Record<string, unknown>;
    systemConfidence: number;
    status?: string;
    signalsAffected?: number;
    entitiesAffected?: number;
  }): Promise<void> {
    const pool = getDbPool();
    try {
      await pool.query(
        `INSERT INTO feedback_log
          (id, feedback_type, system_output, system_confidence, status, signals_affected, entities_affected)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6)`,
        [
          params.feedbackType,
          JSON.stringify(params.systemOutput),
          params.systemConfidence,
          params.status || 'pending',
          params.signalsAffected || 0,
          params.entitiesAffected || 0
        ]
      );

      await this.logAudit({
        eventType: 'feedback.recorded',
        eventData: {
          feedback_type: params.feedbackType,
          status: params.status || 'pending',
          signals_affected: params.signalsAffected || 0,
          entities_affected: params.entitiesAffected || 0
        },
        actor: 'system',
        actorPersona: null
      });
    } catch (error) {
      logger.error('Failed to record feedback', { error, params });
      throw error;
    }
  }
}
