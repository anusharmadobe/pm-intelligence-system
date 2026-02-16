import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { dirname } from 'path';

type CounterName =
  | 'llm_calls'
  | 'llm_errors'
  | 'llm_429s'
  | 'embedding_calls'
  | 'embedding_errors'
  | 'signals_processed'
  | 'signals_failed';

export interface RunMetricsSnapshot {
  run_id: string;
  started_at: string;
  updated_at: string;
  elapsed_ms: number;
  counters: Record<CounterName, number>;
  llm_tokens_in: number;
  llm_tokens_out: number;
  embedding_tokens: number;
  estimated_cost_usd: number;
  signals_per_minute: number;
}

export class RunMetrics {
  private readonly runId = `run_${Date.now()}`;
  private readonly startedAt = Date.now();
  private counters: Record<CounterName, number> = {
    llm_calls: 0,
    llm_errors: 0,
    llm_429s: 0,
    embedding_calls: 0,
    embedding_errors: 0,
    signals_processed: 0,
    signals_failed: 0
  };
  private llmTokensIn = 0;
  private llmTokensOut = 0;
  private embeddingTokens = 0;
  private estimatedCostUsd = 0;

  increment(counter: CounterName, value = 1): void {
    this.counters[counter] += value;
  }

  addTokenUsage(input: number, output: number): void {
    this.llmTokensIn += Math.max(0, input);
    this.llmTokensOut += Math.max(0, output);
  }

  addEmbeddingTokens(count: number): void {
    this.embeddingTokens += Math.max(0, count);
  }

  addEstimatedCost(usd: number): void {
    this.estimatedCostUsd += Math.max(0, usd);
  }

  snapshot(): RunMetricsSnapshot {
    const now = Date.now();
    const elapsedMs = now - this.startedAt;
    const minutes = Math.max(1 / 60, elapsedMs / 60000);
    return {
      run_id: this.runId,
      started_at: new Date(this.startedAt).toISOString(),
      updated_at: new Date(now).toISOString(),
      elapsed_ms: elapsedMs,
      counters: { ...this.counters },
      llm_tokens_in: this.llmTokensIn,
      llm_tokens_out: this.llmTokensOut,
      embedding_tokens: this.embeddingTokens,
      estimated_cost_usd: Number(this.estimatedCostUsd.toFixed(6)),
      signals_per_minute: Number((this.counters.signals_processed / minutes).toFixed(2))
    };
  }

  exportToFile(path: string): void {
    if (!existsSync(dirname(path))) {
      mkdirSync(dirname(path), { recursive: true });
    }
    writeFileSync(path, JSON.stringify(this.snapshot(), null, 2));
  }
}

let sharedRunMetrics: RunMetrics | null = null;

export function getRunMetrics(): RunMetrics {
  if (!sharedRunMetrics) {
    sharedRunMetrics = new RunMetrics();
  }
  return sharedRunMetrics;
}
