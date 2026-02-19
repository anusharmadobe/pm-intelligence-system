import { ingestSignal, RawSignal } from '../processing/signal_extractor';
import { logger } from '../utils/logger';
import crypto from 'crypto';

/**
 * Verify Splunk webhook authentication
 * Splunk webhooks can use either HEC token or custom HMAC signature
 */
function verifySplunkAuthentication(req: any): boolean {
  const splunkHecToken = process.env.SPLUNK_HEC_TOKEN;
  const splunkSecret = process.env.SPLUNK_WEBHOOK_SECRET;

  // Skip validation if no authentication configured (backward compatibility)
  if (!splunkHecToken && !splunkSecret) {
    logger.warn('SPLUNK_HEC_TOKEN or SPLUNK_WEBHOOK_SECRET not configured - webhook validation disabled');
    return true;
  }

  // Option 1: Check HEC token (Splunk HTTP Event Collector)
  if (splunkHecToken) {
    const authHeader = req.headers['authorization'] as string;
    const expectedAuth = `Splunk ${splunkHecToken}`;

    if (authHeader === expectedAuth) {
      return true;
    }
  }

  // Option 2: Check HMAC signature (custom webhook signature)
  if (splunkSecret) {
    const receivedSignature = req.headers['x-splunk-signature'] as string;
    const body = JSON.stringify(req.body);

    if (receivedSignature) {
      const hmac = crypto
        .createHmac('sha256', splunkSecret)
        .update(body)
        .digest('hex');

      try {
        if (crypto.timingSafeEqual(
          Buffer.from(receivedSignature),
          Buffer.from(hmac)
        )) {
          return true;
        }
      } catch {
        // Signature length mismatch
      }
    }
  }

  logger.warn('Splunk webhook rejected: invalid authentication', {
    hasAuthHeader: !!req.headers['authorization'],
    hasSignature: !!req.headers['x-splunk-signature']
  });
  return false;
}

/**
 * Splunk webhook adapter for signal ingestion.
 * Converts Splunk search results/alerts into signals.
 */
export async function handleSplunkWebhook(payload: any): Promise<void> {
  // Splunk webhook structure: https://docs.splunk.com/Documentation/Splunk/latest/Alert/Webhooks
  if (payload.results && Array.isArray(payload.results)) {
    for (const result of payload.results) {
      const signal: RawSignal = {
        source: 'splunk',
        id: result._cd || result._time || Date.now().toString(),
        type: 'search_result',
        text: JSON.stringify(result),
        severity: mapSplunkSeverity(result.severity || result.priority),
        metadata: {
          search_name: payload.search_name,
          owner: payload.owner,
          app: payload.app,
          result: result
        }
      };
      
      await ingestSignal(signal);
    }
  }
  
  // Handle Splunk alert format
  if (payload.alert) {
    const alert = payload.alert;
    const signal: RawSignal = {
      source: 'splunk',
      id: alert.alert_id || Date.now().toString(),
      type: 'alert',
      text: alert.message || alert.description || JSON.stringify(alert),
      severity: mapSplunkSeverity(alert.severity || alert.priority),
      metadata: {
        alert_name: alert.name,
        search_name: alert.search_name,
        trigger_time: alert.trigger_time,
        alert: alert
      }
    };
    
    await ingestSignal(signal);
  }
}

function mapSplunkSeverity(severity?: string | number): number | undefined {
  if (typeof severity === 'number') {
    return severity;
  }
  
  const severityMap: Record<string, number> = {
    critical: 5,
    high: 4,
    medium: 3,
    low: 2,
    info: 1
  };
  
  return severity ? severityMap[severity.toLowerCase()] : undefined;
}

/**
 * Splunk webhook endpoint handler
 */
export function createSplunkWebhookHandler() {
  return async (req: any, res: any) => {
    try {
      // Validate webhook authentication
      if (!verifySplunkAuthentication(req)) {
        logger.warn('Splunk webhook rejected: invalid authentication', {
          ip: req.ip
        });
        return res.status(401).json({
          error: 'Invalid authentication',
          message: 'Webhook authentication failed. Provide valid HEC token or signature.'
        });
      }

      logger.info('Splunk webhook authenticated successfully');
      await handleSplunkWebhook(req.body);
      res.status(200).json({ ok: true });
    } catch (error: any) {
      logger.error('Splunk webhook processing error', {
        error: error.message,
        stack: error.stack
      });
      res.status(500).json({ error: error.message });
    }
  };
}
