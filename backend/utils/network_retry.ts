import { logger } from './logger';
import { getAdaptiveRateController } from './rate_controller';

export interface RetryOptions {
  timeoutMs?: number;
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  operationName?: string;
}

function jitter(ms: number): number {
  const spread = Math.max(10, Math.floor(ms * 0.2));
  return ms + Math.floor((Math.random() * 2 - 1) * spread);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function isRetryableStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status <= 599);
}

export function isRetryableError(error: unknown): boolean {
  const message = (error as Error)?.message?.toLowerCase() || '';
  return (
    message.includes('fetch failed') ||
    message.includes('econnreset') ||
    message.includes('etimedout') ||
    message.includes('socket hang up') ||
    message.includes('network') ||
    message.includes('aborted')
  );
}

export async function fetchWithRetry(
  url: string,
  init: RequestInit,
  options: RetryOptions = {}
): Promise<Response> {
  const timeoutMs = options.timeoutMs ?? parseInt(process.env.AZURE_REQUEST_TIMEOUT_MS || '30000', 10);
  const maxAttempts = options.maxAttempts ?? parseInt(process.env.AZURE_RETRY_MAX_ATTEMPTS || '4', 10);
  const baseDelayMs = options.baseDelayMs ?? parseInt(process.env.AZURE_RETRY_BASE_DELAY_MS || '500', 10);
  const maxDelayMs = options.maxDelayMs ?? parseInt(process.env.AZURE_RETRY_MAX_DELAY_MS || '10000', 10);
  const operationName = options.operationName || 'network_call';
  const controller = getAdaptiveRateController();

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const startedAt = Date.now();
    await controller.acquireSlot();
    try {
      const response = await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(timeoutMs)
      });
      const latencyMs = Date.now() - startedAt;
      if (!response.ok && isRetryableStatus(response.status) && attempt < maxAttempts) {
        controller.onFailure(latencyMs, `http_${response.status}`, response.status);
        const backoff = Math.min(maxDelayMs, baseDelayMs * Math.pow(2, attempt - 1));
        const delay = jitter(backoff);
        logger.warn('Retryable HTTP failure; backing off', {
          operationName,
          attempt,
          maxAttempts,
          status: response.status,
          delayMs: delay
        });
        await sleep(delay);
        continue;
      }
      if (response.ok) {
        controller.onSuccess(latencyMs, response.status);
      } else {
        controller.onFailure(latencyMs, `http_${response.status}`, response.status);
      }
      return response;
    } catch (error) {
      const latencyMs = Date.now() - startedAt;
      controller.onFailure(latencyMs, (error as Error)?.message);
      if (!isRetryableError(error) || attempt >= maxAttempts) {
        throw error;
      }
      const backoff = Math.min(maxDelayMs, baseDelayMs * Math.pow(2, attempt - 1));
      const delay = jitter(backoff);
      logger.warn('Retryable network failure; backing off', {
        operationName,
        attempt,
        maxAttempts,
        delayMs: delay,
        error: (error as Error)?.message
      });
      await sleep(delay);
    } finally {
      controller.releaseSlot();
    }
  }

  throw new Error(`Network retry loop exhausted for ${operationName}`);
}
