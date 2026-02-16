import { AgentRegistryService } from './agent_registry_service';
import { logger } from '../utils/logger';

export async function deliverWebhookEvent(params: {
  registry: AgentRegistryService;
  agentId: string;
  webhookUrl: string;
  agentVersion: string | null;
  event: any;
}) {
  const started = Date.now();
  try {
    const response = await fetch(params.webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Event-Id': params.event.event_id
      },
      body: JSON.stringify(params.event),
      signal: AbortSignal.timeout(10_000)
    });
    await params.registry.logActivity({
      agentId: params.agentId,
      action: 'event_delivery',
      endpoint: params.webhookUrl,
      requestParams: { event_type: params.event.event_type },
      responseStatus: response.status,
      responseTimeMs: Date.now() - started,
      agentVersion: params.agentVersion || undefined
    });
  } catch (error: any) {
    logger.warn('Event delivery failed', { error, webhook_url: params.webhookUrl });
    await params.registry.logActivity({
      agentId: params.agentId,
      action: 'event_delivery',
      endpoint: params.webhookUrl,
      requestParams: { event_type: params.event.event_type },
      responseStatus: 500,
      responseTimeMs: Date.now() - started,
      errorMessage: error.message,
      agentVersion: params.agentVersion || undefined
    });
  }
}
