import { ingestSignal, RawSignal } from '../processing/signal_extractor';
import { logger } from '../utils/logger';

/**
 * Grafana webhook adapter for signal ingestion.
 * Converts Grafana alerts into signals.
 */
export async function handleGrafanaWebhook(payload: any): Promise<void> {
  // Grafana alert structure: https://grafana.com/docs/grafana/latest/alerting/alerting-rules/create-grafana-managed-rule/
  if (payload.alerts && Array.isArray(payload.alerts)) {
    for (const alert of payload.alerts) {
      const signal: RawSignal = {
        source: 'grafana',
        id: alert.fingerprint || alert.uid || Date.now().toString(),
        type: alert.status === 'firing' ? 'alert_firing' : 'alert_resolved',
        text: `${alert.annotations?.summary || alert.labels?.alertname || 'Alert'}: ${alert.annotations?.description || ''}`,
        severity: mapGrafanaSeverity(alert.labels?.severity),
        metadata: {
          status: alert.status,
          labels: alert.labels,
          annotations: alert.annotations,
          startsAt: alert.startsAt,
          endsAt: alert.endsAt,
          generatorURL: alert.generatorURL
        }
      };
      
      await ingestSignal(signal);
    }
  }
  
  // Handle Grafana test notifications
  if (payload.title === 'Test notification') {
    const signal: RawSignal = {
      source: 'grafana',
      id: Date.now().toString(),
      type: 'test',
      text: 'Grafana test notification',
      metadata: payload
    };
    
    await ingestSignal(signal);
  }
}

function mapGrafanaSeverity(severity?: string): number | undefined {
  const severityMap: Record<string, number> = {
    critical: 5,
    warning: 3,
    info: 1
  };
  return severity ? severityMap[severity.toLowerCase()] : undefined;
}

/**
 * Grafana webhook endpoint handler
 */
export function createGrafanaWebhookHandler() {
  return async (req: any, res: any) => {
    try {
      await handleGrafanaWebhook(req.body);
      res.status(200).json({ ok: true });
    } catch (error: any) {
      logger.error('Grafana webhook error', { error });
      res.status(500).json({ error: error.message });
    }
  };
}
