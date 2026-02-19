import { ingestSignal, RawSignal } from '../processing/signal_extractor';
import { logger } from '../utils/logger';
import crypto from 'crypto';

/**
 * Verify Microsoft Teams webhook signature
 * Teams uses HMAC-SHA256 signature in Authorization header
 */
function verifyTeamsSignature(req: any): boolean {
  const teamsSharedSecret = process.env.TEAMS_WEBHOOK_SECRET;

  // Skip validation if no secret configured (backward compatibility)
  if (!teamsSharedSecret) {
    logger.warn('TEAMS_WEBHOOK_SECRET not configured - webhook validation disabled');
    return true;
  }

  const authHeader = req.headers['authorization'] as string;
  const body = JSON.stringify(req.body);

  if (!authHeader) {
    logger.warn('Teams webhook rejected: missing Authorization header');
    return false;
  }

  // Teams sends HMAC signature in Authorization header
  // Format: "HMAC <base64-encoded-signature>"
  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0] !== 'HMAC') {
    logger.warn('Teams webhook rejected: invalid Authorization format', {
      format: parts[0]
    });
    return false;
  }

  const receivedSignature = parts[1];

  // Compute expected signature
  const hmac = crypto
    .createHmac('sha256', teamsSharedSecret)
    .update(body)
    .digest('base64');

  // Compare signatures
  try {
    return crypto.timingSafeEqual(
      Buffer.from(receivedSignature),
      Buffer.from(hmac)
    );
  } catch (error) {
    logger.warn('Teams webhook rejected: signature length mismatch');
    return false;
  }
}

/**
 * Microsoft Teams webhook adapter for signal ingestion.
 * Converts Teams activity into signals.
 */
export async function handleTeamsWebhook(payload: any): Promise<void> {
  // Teams activity structure: https://docs.microsoft.com/en-us/microsoftteams/platform/webhooks-and-connectors/how-to/connectors-using
  if (payload.type === 'message') {
    const signal: RawSignal = {
      source: 'teams',
      id: payload.id || payload.timestamp,
      type: 'message',
      text: payload.text || payload.summary || '',
      metadata: {
        from: payload.from,
        channelId: payload.channelId,
        conversation: payload.conversation,
        timestamp: payload.timestamp
      }
    };
    
    await ingestSignal(signal);
  }
  
  // Handle Teams mentions
  if (payload.type === 'mention') {
    const signal: RawSignal = {
      source: 'teams',
      id: payload.id || payload.timestamp,
      type: 'mention',
      text: payload.text || '',
      metadata: {
        mentioned: payload.mentioned,
        channelId: payload.channelId,
        timestamp: payload.timestamp
      }
    };
    
    await ingestSignal(signal);
  }
}

/**
 * Teams webhook endpoint handler
 */
export function createTeamsWebhookHandler() {
  return async (req: any, res: any) => {
    try {
      // Validate webhook signature
      if (!verifyTeamsSignature(req)) {
        logger.warn('Teams webhook rejected: invalid signature', {
          ip: req.ip,
          hasAuth: !!req.headers['authorization']
        });
        return res.status(401).json({
          error: 'Invalid signature',
          message: 'Webhook signature verification failed'
        });
      }

      logger.info('Teams webhook signature verified successfully');
      await handleTeamsWebhook(req.body);
      res.status(200).json({ ok: true });
    } catch (error: any) {
      logger.error('Teams webhook processing error', {
        error: error.message,
        stack: error.stack
      });
      res.status(500).json({ error: error.message });
    }
  };
}
