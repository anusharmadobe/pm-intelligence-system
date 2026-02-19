import { EventBus, SystemEvent } from '../agents/event_bus';
import { logger } from '../utils/logger';
import { getDbPool } from '../db/connection';
// Note: OpportunityService is not used; opportunity regeneration is TODO

/**
 * Correction Event Handler
 *
 * Listens for extraction.corrected events and triggers re-clustering
 * for affected opportunities.
 */
export class CorrectionEventHandler {
  private eventBus: EventBus;
  private isRunning: boolean = false;
  private lastEventId: string = '0';

  constructor(eventBus?: EventBus) {
    this.eventBus = eventBus || new EventBus();
  }

  /**
   * Start listening for correction events
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('Correction event handler already running');
      return;
    }

    this.isRunning = true;

    logger.info('Starting correction event handler', {
      stage: 'correction_event_handler'
    });

    // Start event loop
    this.eventLoop();
  }

  /**
   * Stop listening for correction events
   */
  stop(): void {
    this.isRunning = false;
    logger.info('Stopping correction event handler', {
      stage: 'correction_event_handler'
    });
  }

  /**
   * Event loop that processes correction events
   */
  private async eventLoop(): Promise<void> {
    while (this.isRunning) {
      try {
        // Read events from stream
        const events = await this.eventBus.read(this.lastEventId, 5000, 25);

        for (const { id, event } of events) {
          this.lastEventId = id;

          // Process extraction.corrected events
          if (event.event_type === 'extraction.corrected') {
            await this.handleCorrectionEvent(event);
          }
        }
      } catch (error: any) {
        logger.error('Error in correction event handler loop', {
          stage: 'correction_event_handler',
          error: error.message
        });

        // Wait before retrying
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
    }
  }

  /**
   * Handle a single extraction.corrected event
   */
  private async handleCorrectionEvent(event: SystemEvent): Promise<void> {
    const { signal_ids, correction_id, correction_type, opportunities_affected } = event.payload as any;

    logger.info('Processing extraction.corrected event', {
      stage: 'correction_event_handler',
      correction_id,
      signal_count: signal_ids?.length || 0,
      opportunity_count: opportunities_affected?.length || 0
    });

    try {
      // If specific opportunities are affected, re-generate them
      if (opportunities_affected && opportunities_affected.length > 0) {
        await this.reGenerateOpportunities(opportunities_affected, signal_ids);
      } else if (signal_ids && signal_ids.length > 0) {
        // Otherwise, find opportunities containing these signals and re-generate
        const affectedOpps = await this.findAffectedOpportunities(signal_ids);
        if (affectedOpps.length > 0) {
          await this.reGenerateOpportunities(affectedOpps, signal_ids);
        }
      }

      logger.info('Extraction correction event processed', {
        stage: 'correction_event_handler',
        correction_id,
        opportunities_updated: opportunities_affected?.length || 0
      });
    } catch (error: any) {
      logger.error('Failed to process correction event', {
        stage: 'correction_event_handler',
        correction_id,
        error: error.message
      });
    }
  }

  /**
   * Find opportunities that contain the corrected signals
   */
  private async findAffectedOpportunities(signalIds: string[]): Promise<string[]> {
    const pool = getDbPool();

    const result = await pool.query(
      `SELECT DISTINCT opportunity_id
       FROM opportunity_signals
       WHERE signal_id = ANY($1::uuid[])`,
      [signalIds]
    );

    return result.rows.map((r: any) => r.opportunity_id);
  }

  /**
   * Re-generate opportunities with updated signal extractions
   */
  private async reGenerateOpportunities(
    opportunityIds: string[],
    signalIds: string[]
  ): Promise<void> {
    const pool = getDbPool();

    for (const oppId of opportunityIds) {
      try {
        // Get all signals for this opportunity (including corrected ones)
        const signalsResult = await pool.query(
          `SELECT s.id, s.content, s.source, s.created_at, s.metadata,
                  se.extraction
           FROM signals s
           JOIN opportunity_signals os ON s.id = os.signal_id
           LEFT JOIN signal_extractions se ON s.id = se.signal_id
           WHERE os.opportunity_id = $1
           ORDER BY s.created_at DESC`,
          [oppId]
        );

        const signals = signalsResult.rows;

        if (signals.length === 0) {
          logger.warn('No signals found for opportunity', { opportunity_id: oppId });
          continue;
        }

        // Re-create opportunity from signals using the opportunity service method
        // Note: This requires the createOpportunityFromCluster method to be accessible
        // For now, we'll just update the metadata to trigger a refresh

        logger.info('Re-generating opportunity from corrected signals', {
          stage: 'correction_event_handler',
          opportunity_id: oppId,
          signal_count: signals.length,
          corrected_signal_count: signalIds.filter(sid =>
            signals.some((s: any) => s.id === sid)
          ).length
        });

        // Update opportunity's updated_at timestamp to mark it as changed
        await pool.query(
          `UPDATE opportunities
           SET updated_at = NOW(),
               metadata = COALESCE(metadata, '{}'::jsonb) || '{"corrections_applied": true, "last_correction_at": $2}'::jsonb
           WHERE id = $1`,
          [oppId, new Date().toISOString()]
        );

        // TODO: In a full implementation, we would re-run the clustering/opportunity creation
        // logic here to regenerate the opportunity summary, title, etc. with the corrected data.
        // For now, we're just marking it as updated.

      } catch (error: any) {
        logger.error('Failed to re-generate opportunity', {
          stage: 'correction_event_handler',
          opportunity_id: oppId,
          error: error.message
        });
      }
    }
  }

  /**
   * Process backlog of correction events (useful for startup)
   */
  async processBacklog(limit: number = 100): Promise<void> {
    logger.info('Processing correction event backlog', {
      stage: 'correction_event_handler',
      limit
    });

    try {
      const history = await this.eventBus.history(limit);

      // Filter for correction events
      const correctionEvents = history.filter(
        (event) => event.event_type === 'extraction.corrected'
      );

      logger.info(`Found ${correctionEvents.length} correction events in backlog`);

      for (const event of correctionEvents) {
        await this.handleCorrectionEvent(event);
      }

      logger.info('Correction event backlog processed', {
        stage: 'correction_event_handler',
        processed: correctionEvents.length
      });
    } catch (error: any) {
      logger.error('Failed to process correction event backlog', {
        stage: 'correction_event_handler',
        error: error.message
      });
    }
  }
}

// Singleton instance
let handlerInstance: CorrectionEventHandler | null = null;

/**
 * Get or create singleton correction event handler
 */
export function getCorrectionEventHandler(): CorrectionEventHandler {
  if (!handlerInstance) {
    handlerInstance = new CorrectionEventHandler();
  }
  return handlerInstance;
}

/**
 * Start the correction event handler (call this from app startup)
 */
export async function startCorrectionEventHandler(): Promise<void> {
  const handler = getCorrectionEventHandler();
  await handler.start();
}

/**
 * Stop the correction event handler (call this from app shutdown)
 */
export function stopCorrectionEventHandler(): void {
  if (handlerInstance) {
    handlerInstance.stop();
  }
}
