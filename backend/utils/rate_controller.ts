import { logger } from './logger';

export interface RateControllerOptions {
  minConcurrency?: number;
  maxConcurrency?: number;
  initialConcurrency?: number;
  latencyThresholdMs?: number;
  cooldownMs?: number;
}

type Sample = {
  latencyMs: number;
  statusCode?: number;
  error?: string;
};

/**
 * Adaptive controller that can be shared by LLM/embedding call sites.
 * It keeps a moving window of outcomes and adjusts concurrency on pressure.
 */
export class AdaptiveRateController {
  private readonly minConcurrency: number;
  private readonly maxConcurrency: number;
  private readonly latencyThresholdMs: number;
  private readonly cooldownMs: number;
  private concurrency: number;
  private samples: Sample[] = [];
  private inFlight = 0;
  private lastAdjustAt = 0;

  constructor(options: RateControllerOptions = {}) {
    this.minConcurrency = options.minConcurrency ?? 1;
    this.maxConcurrency = options.maxConcurrency ?? 20;
    this.latencyThresholdMs = options.latencyThresholdMs ?? 4000;
    this.cooldownMs = options.cooldownMs ?? 3000;
    this.concurrency = Math.min(
      this.maxConcurrency,
      Math.max(this.minConcurrency, options.initialConcurrency ?? 3)
    );
  }

  getConcurrency(): number {
    return this.concurrency;
  }

  getInFlight(): number {
    return this.inFlight;
  }

  async acquireSlot(): Promise<void> {
    while (this.inFlight >= this.concurrency) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    this.inFlight += 1;
  }

  releaseSlot(): void {
    this.inFlight = Math.max(0, this.inFlight - 1);
  }

  onSuccess(latencyMs: number, statusCode?: number): void {
    this.samples.push({ latencyMs, statusCode });
    this.trimSamples();
    this.maybeAdjust();
  }

  onFailure(latencyMs: number, error?: string, statusCode?: number): void {
    this.samples.push({ latencyMs, error, statusCode });
    this.trimSamples();
    this.maybeAdjust();
  }

  private trimSamples(): void {
    if (this.samples.length > 50) {
      this.samples = this.samples.slice(this.samples.length - 50);
    }
  }

  private maybeAdjust(): void {
    const now = Date.now();
    if (now - this.lastAdjustAt < this.cooldownMs || this.samples.length < 8) {
      return;
    }

    const recent = this.samples.slice(-12);
    const failures = recent.filter((s) => Boolean(s.error));
    const throttles = recent.filter((s) => s.statusCode === 429);
    const avgLatency =
      recent.reduce((sum, s) => sum + s.latencyMs, 0) / Math.max(1, recent.length);

    let next = this.concurrency;
    if (throttles.length > 0 || failures.length >= 4 || avgLatency > this.latencyThresholdMs) {
      next = Math.max(this.minConcurrency, this.concurrency - 1);
    } else if (failures.length === 0 && avgLatency < this.latencyThresholdMs * 0.6) {
      next = Math.min(this.maxConcurrency, this.concurrency + 1);
    }

    if (next !== this.concurrency) {
      logger.info('Adaptive rate controller adjusted concurrency', {
        from: this.concurrency,
        to: next,
        avgLatencyMs: Math.round(avgLatency),
        throttles: throttles.length,
        failures: failures.length
      });
      this.concurrency = next;
      this.lastAdjustAt = now;
    }
  }
}

let sharedController: AdaptiveRateController | null = null;

export function getAdaptiveRateController(): AdaptiveRateController {
  if (!sharedController) {
    sharedController = new AdaptiveRateController({
      minConcurrency: parseInt(process.env.RATE_CTRL_MIN_CONCURRENCY || '1', 10),
      maxConcurrency: parseInt(process.env.RATE_CTRL_MAX_CONCURRENCY || '20', 10),
      initialConcurrency: parseInt(process.env.RATE_CTRL_INITIAL_CONCURRENCY || '3', 10),
      latencyThresholdMs: parseInt(process.env.RATE_CTRL_LATENCY_THRESHOLD_MS || '4000', 10),
      cooldownMs: parseInt(process.env.RATE_CTRL_COOLDOWN_MS || '3000', 10)
    });
  }
  return sharedController;
}
