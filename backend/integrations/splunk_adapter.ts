import { ingestSignal, RawSignal } from '../processing/signal_extractor';

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
      await handleSplunkWebhook(req.body);
      res.status(200).json({ ok: true });
    } catch (error: any) {
      console.error('Splunk webhook error:', error);
      res.status(500).json({ error: error.message });
    }
  };
}
