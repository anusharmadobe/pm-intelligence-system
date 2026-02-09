import { ingestSignal, RawSignal } from '../processing/signal_extractor';

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
      await handleTeamsWebhook(req.body);
      res.status(200).json({ ok: true });
    } catch (error: any) {
      console.error('Teams webhook error:', error);
      res.status(500).json({ error: error.message });
    }
  };
}
