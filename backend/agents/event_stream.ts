import express from 'express';
import { eventBus } from './event_bus';
import { config } from '../config/env';
import { AgentRequest } from './auth_middleware';
import { logger } from '../utils/logger';

export function createEventStreamHandler() {
  return async (req: AgentRequest, res: express.Response) => {
    if (!config.featureFlags.eventBus) {
      return res.status(503).json({ error: 'Event bus disabled' });
    }
    if (!req.agent?.permissions?.events) {
      return res.status(403).json({ error: 'Events permission required' });
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    let lastId = '$';
    const lastEvent = req.query.last_event_id;
    if (typeof lastEvent === 'string' && lastEvent.trim()) {
      lastId = lastEvent.trim();
    } else if (typeof req.headers['last-event-id'] === 'string') {
      lastId = req.headers['last-event-id'];
    }

    let active = true;
    const startedAt = Date.now();
    const maxDurationMs = 30 * 60 * 1000;
    let lastKeepAlive = Date.now();
    req.on('close', () => {
      active = false;
    });

    while (active) {
      if (Date.now() - startedAt > maxDurationMs) {
        res.write(`event: retry\ndata: ${JSON.stringify({ message: 'stream_timeout' })}\n\n`);
        break;
      }
      try {
        const events = await eventBus.read(lastId, 5000, 25);
        if (events.length === 0) {
          if (Date.now() - lastKeepAlive >= 30 * 1000) {
            res.write(': keepalive\n\n');
            lastKeepAlive = Date.now();
          }
          continue;
        }
        for (const item of events) {
          lastId = item.id;
          res.write(`data: ${JSON.stringify(item.event)}\n\n`);
        }
      } catch (error) {
        logger.warn('Event stream read failed', { error, correlation_id: req.correlationId });
        res.write(`event: error\ndata: ${JSON.stringify({ error: 'stream_failed' })}\n\n`);
      }
    }
  };
}
