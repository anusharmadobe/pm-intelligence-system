import { eventBus } from './event_bus';
import { AgentRegistryService } from './agent_registry_service';
import { getDbPool } from '../db/connection';
import { config } from '../config/env';
import { logger } from '../utils/logger';
import { deliverWebhookEvent } from './webhook_delivery';

const START_ID = process.env.EVENT_DISPATCHER_START_ID || '$';

function shouldDeliver(subscriptions: string[] | null, eventType: string): boolean {
  if (!subscriptions || subscriptions.length === 0) return false;
  if (subscriptions.includes('all')) return true;
  return subscriptions.includes(eventType);
}

export function startEventDispatcher(): void {
  if (!config.featureFlags.eventBus) {
    logger.info('Event dispatcher skipped (event bus disabled)');
    return;
  }

  const registry = new AgentRegistryService();
  let lastId = START_ID;
  let running = true;

  const stop = () => {
    running = false;
  };

  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);

  (async () => {
    logger.info('Event dispatcher started', { startId: lastId });
    while (running) {
      try {
        const events = await eventBus.read(lastId, 5000, 50);
        if (events.length === 0) {
          continue;
        }

        lastId = events[events.length - 1].id;

        const pool = getDbPool();
        const agentsResult = await pool.query(
          `SELECT id, webhook_url, event_subscriptions, current_version
           FROM agent_registry
           WHERE is_active = true AND webhook_url IS NOT NULL`
        );

        for (const { id, webhook_url, event_subscriptions, current_version } of agentsResult.rows) {
          for (const item of events) {
            if (!shouldDeliver(event_subscriptions, item.event.event_type)) {
              continue;
            }
            await deliverWebhookEvent({
              registry,
              agentId: id,
              webhookUrl: webhook_url,
              agentVersion: current_version,
              event: item.event
            });
          }
        }
      } catch (error) {
        logger.warn('Event dispatcher loop failed', { error });
      }
    }
  })();
}
