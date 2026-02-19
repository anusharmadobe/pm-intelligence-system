import { ingestSignal, RawSignal } from '../processing/signal_extractor';
import { logger } from '../utils/logger';
import crypto from 'crypto';

/**
 * Verify Slack webhook signature
 * https://api.slack.com/authentication/verifying-requests-from-slack
 */
function verifySlackSignature(req: any): boolean {
  const slackSigningSecret = process.env.SLACK_SIGNING_SECRET;

  // Skip validation if no signing secret configured (backward compatibility)
  if (!slackSigningSecret) {
    logger.warn('SLACK_SIGNING_SECRET not configured - webhook validation disabled');
    return true;
  }

  const signature = req.headers['x-slack-signature'] as string;
  const timestamp = req.headers['x-slack-request-timestamp'] as string;
  const body = JSON.stringify(req.body);

  if (!signature || !timestamp) {
    logger.warn('Slack webhook rejected: missing signature or timestamp headers', {
      hasSignature: !!signature,
      hasTimestamp: !!timestamp
    });
    return false;
  }

  // Prevent replay attacks - reject requests older than 5 minutes
  const currentTime = Math.floor(Date.now() / 1000);
  const requestTime = parseInt(timestamp, 10);

  if (Math.abs(currentTime - requestTime) > 300) {
    logger.warn('Slack webhook rejected: timestamp too old', {
      timestamp,
      currentTime,
      ageSeconds: currentTime - requestTime
    });
    return false;
  }

  // Compute expected signature
  const sigBasestring = `v0:${timestamp}:${body}`;
  const hmac = crypto
    .createHmac('sha256', slackSigningSecret)
    .update(sigBasestring)
    .digest('hex');
  const expectedSignature = `v0=${hmac}`;

  // Use timing-safe comparison to prevent timing attacks
  try {
    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expectedSignature)
    );
  } catch (error) {
    // Buffers are different lengths - definitely invalid
    logger.warn('Slack webhook rejected: signature length mismatch');
    return false;
  }
}

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
      logger.info('Slack message ingested', {
        signal_id: signal.id,
        channel: event.channel,
        user: event.user,
        message_length: event.text?.length,
        event_type: event.type
      });
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
      // Slack URL verification challenge (skip signature check for this)
      if (req.body.type === 'url_verification') {
        logger.info('Slack URL verification challenge received');
        return res.json({ challenge: req.body.challenge });
      }

      // Validate webhook signature for all other events
      if (!verifySlackSignature(req)) {
        logger.warn('Slack webhook rejected: invalid signature', {
          ip: req.ip,
          headers: {
            signature: req.headers['x-slack-signature']?.substring(0, 20) + '...',
            timestamp: req.headers['x-slack-request-timestamp']
          }
        });
        return res.status(401).json({
          error: 'Invalid signature',
          message: 'Webhook signature verification failed'
        });
      }

      const timestamp = req.headers['x-slack-request-timestamp'] as string;
      const currentTime = Math.floor(Date.now() / 1000);
      const requestTime = parseInt(timestamp, 10);

      logger.info('Slack webhook signature verified', {
        security_event: 'webhook_verified',
        source: 'slack',
        timestamp: timestamp,
        timestamp_freshness_seconds: currentTime - requestTime,
        ip: req.ip
      });

      await handleSlackWebhook(req.body);
      res.status(200).json({ ok: true });
    } catch (error: any) {
      logger.error('Slack webhook processing error', {
        error: error.message,
        stack: error.stack
      });
      res.status(500).json({ error: error.message });
    }
  };
}
