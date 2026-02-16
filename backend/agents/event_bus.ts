import { randomUUID } from 'crypto';
import { config } from '../config/env';
import { logger } from '../utils/logger';
import { getSharedRedis } from '../config/redis';

export type EventSeverity = 'info' | 'warning' | 'critical';

export interface SystemEvent {
  event_id: string;
  event_type: string;
  timestamp: string;
  source_service: string;
  correlation_id: string;
  payload: Record<string, unknown>;
  metadata?: {
    entity_ids?: string[];
    signal_ids?: string[];
    severity?: EventSeverity;
  };
}

const STREAM_KEY = 'pm_intelligence_events';
const DEFAULT_MAXLEN = 10000;

export class EventBus {
  async publish(event: Omit<SystemEvent, 'event_id' | 'timestamp' | 'correlation_id'> & {
    event_id?: string;
    timestamp?: string;
    correlation_id?: string;
  }): Promise<SystemEvent> {
    if (!config.featureFlags.eventBus) {
      return {
        event_id: event.event_id || randomUUID(),
        event_type: event.event_type,
        timestamp: event.timestamp || new Date().toISOString(),
        source_service: event.source_service,
        correlation_id: event.correlation_id || randomUUID(),
        payload: event.payload,
        metadata: event.metadata
      };
    }

    const fullEvent: SystemEvent = {
      event_id: event.event_id || randomUUID(),
      event_type: event.event_type,
      timestamp: event.timestamp || new Date().toISOString(),
      source_service: event.source_service,
      correlation_id: event.correlation_id || randomUUID(),
      payload: event.payload,
      metadata: event.metadata
    };

    try {
      const redis = getSharedRedis();
      await redis.xadd(
        STREAM_KEY,
        'MAXLEN',
        '~',
        DEFAULT_MAXLEN,
        '*',
        'data',
        JSON.stringify(fullEvent)
      );
    } catch (error) {
      logger.warn('Event publish failed', { error, event_type: event.event_type });
    }

    return fullEvent;
  }

  async read(fromId: string, blockMs = 5000, count = 25): Promise<Array<{ id: string; event: SystemEvent }>> {
    if (!config.featureFlags.eventBus) return [];
    const redis = getSharedRedis();
    const response = await (redis as any).xread(
      'BLOCK',
      blockMs,
      'COUNT',
      count,
      'STREAMS',
      STREAM_KEY,
      fromId
    );

    if (!response || response.length === 0) return [];

    const [, entries] = response[0] as [string, Array<[string, string[]]>];
    return entries.map((entry: [string, string[]]) => {
      const [id, fields] = entry;
      const dataIndex = fields.findIndex((value: string) => value === 'data');
      const eventJson = dataIndex >= 0 ? fields[dataIndex + 1] : '{}';
      return {
        id,
        event: JSON.parse(eventJson)
      };
    });
  }

  async history(limit = 50): Promise<SystemEvent[]> {
    if (!config.featureFlags.eventBus) return [];
    const redis = getSharedRedis();
    const entries = await redis.xrevrange(STREAM_KEY, '+', '-', 'COUNT', limit);
    return (entries as Array<[string, string[]]>).map((entry: [string, string[]]) => {
      const [, fields] = entry;
      const dataIndex = fields.findIndex((value: string) => value === 'data');
      const eventJson = dataIndex >= 0 ? fields[dataIndex + 1] : '{}';
      return JSON.parse(eventJson);
    });
  }

  async trim(maxLen = DEFAULT_MAXLEN): Promise<void> {
    if (!config.featureFlags.eventBus) return;
    try {
      const redis = getSharedRedis();
      await redis.xtrim(STREAM_KEY, 'MAXLEN', '~', maxLen);
    } catch (error) {
      logger.warn('Event stream trim failed', { error });
    }
  }

  async trimByMinId(minId: string): Promise<void> {
    if (!config.featureFlags.eventBus) return;
    try {
      const redis = getSharedRedis();
      await (redis as any).xtrim(STREAM_KEY, 'MINID', '~', minId);
    } catch (error) {
      logger.warn('Event stream trim by MINID failed', { error, minId });
    }
  }
}

export const eventBus = new EventBus();
