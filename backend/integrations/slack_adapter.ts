import { ingestSignal, RawSignal } from '../processing/signal_extractor';
import { logger } from '../utils/logger';

/**
 * Slack webhook adapter for signal ingestion.
 * Converts Slack events/messages into signals.
 */
export async function handleSlackWebhook(payload: any): Promise<void> {
  logger.info('Processing Slack webhook', { type: payload.type });
  
  // Slack event structure: https://api.slack.com/events-api
  if (payload.type === 'event_callback' && payload.event) {
    const event = payload.event;
    
    // Handle message events
    if (event.type === 'message' && event.text && !event.subtype) {
      logger.debug('Processing Slack message event', { 
        channel: event.channel,
        user: event.user,
        ts: event.ts
      });
      
      const signal: RawSignal = {
        source: 'slack',
        id: event.ts || event.event_ts,
        type: 'message',
        text: event.text,
        metadata: {
          channel: event.channel,
          user: event.user,
          thread_ts: event.thread_ts,
          timestamp: event.ts
        }
      };
      
      await ingestSignal(signal);
      logger.info('Slack message ingested', { signalId: signal.id, channel: event.channel });
    }
    
    // Handle app_mention events
    if (event.type === 'app_mention' && event.text) {
      const signal: RawSignal = {
        source: 'slack',
        id: event.ts || event.event_ts,
        type: 'mention',
        text: event.text,
        metadata: {
          channel: event.channel,
          user: event.user,
          timestamp: event.ts
        }
      };
      
      await ingestSignal(signal);
    }
  }
  
  // Handle Slack slash commands
  if (payload.command) {
    const signal: RawSignal = {
      source: 'slack',
      id: payload.response_url || Date.now().toString(),
      type: 'command',
      text: payload.text || '',
      metadata: {
        command: payload.command,
        user_id: payload.user_id,
        channel_id: payload.channel_id,
        response_url: payload.response_url
      }
    };
    
    await ingestSignal(signal);
  }
}

/**
 * Slack webhook endpoint handler
 */
export function createSlackWebhookHandler() {
  return async (req: any, res: any) => {
    try {
      // Slack URL verification challenge
      if (req.body.type === 'url_verification') {
        return res.json({ challenge: req.body.challenge });
      }
      
      await handleSlackWebhook(req.body);
      res.status(200).json({ ok: true });
    } catch (error: any) {
      console.error('Slack webhook error:', error);
      res.status(500).json({ error: error.message });
    }
  };
}
