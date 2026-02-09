import { getSignals } from '../backend/processing/signal_extractor';
import { processSlackSignal } from '../backend/services/slack_structuring_service';
import { logger } from '../backend/utils/logger';

async function backfillSlackStructure(batchSize: number = 500) {
  process.env.SLACK_ONLY_ENABLED = process.env.SLACK_ONLY_ENABLED || 'true';
  let offset = 0;
  let totalProcessed = 0;

  while (true) {
    const signals = await getSignals({
      source: 'slack',
      limit: batchSize,
      offset,
      orderBy: 'created_at',
      orderDirection: 'ASC'
    });

    if (signals.length === 0) break;

    for (const signal of signals) {
      try {
        await processSlackSignal(signal);
        totalProcessed += 1;
      } catch (error: any) {
        logger.warn('Failed to backfill Slack signal', {
          signalId: signal.id,
          error: error.message
        });
      }
    }

    offset += signals.length;
  }

  logger.info('Slack backfill complete', { totalProcessed });
}

backfillSlackStructure().catch(error => {
  logger.error('Slack backfill failed', { error: error.message });
  process.exit(1);
});
