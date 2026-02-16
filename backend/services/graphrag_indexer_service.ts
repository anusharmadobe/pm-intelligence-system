import { randomUUID } from 'crypto';
import { getDbPool } from '../db/connection';
import { config } from '../config/env';
import { logger } from '../utils/logger';

export interface GraphRAGSignalInput {
  id: string;
  content: string;
  entities?: Record<string, string[]>;
  relationships?: Array<{ from: string; to: string; type: string }>;
  metadata?: Record<string, unknown>;
}

export interface GraphRAGCommunity {
  community_key: string;
  label: string;
  level: number;
  signal_ids: string[];
  entity_counts: Record<string, number>;
  summary?: string;
}

export interface GraphRAGIndexResult {
  run_id: string;
  communities: GraphRAGCommunity[];
  stats: {
    signal_count: number;
    community_count: number;
  };
}

export class GraphRAGIndexerService {
  async indexSignals(signalIds?: string[], limit = 200): Promise<GraphRAGIndexResult> {
    const signals = await this.fetchSignals(signalIds, limit);
    if (!signals.length) {
      return { run_id: randomUUID(), communities: [], stats: { signal_count: 0, community_count: 0 } };
    }

    const payload = { signals };
    const result = await this.callIndexer(payload);
    await this.persistCommunities(result.run_id, result.communities);
    return result;
  }

  private async fetchSignals(signalIds?: string[], limit = 200): Promise<GraphRAGSignalInput[]> {
    const pool = getDbPool();
    if (signalIds && signalIds.length > 0) {
      const result = await pool.query(
        `SELECT s.id, s.content, s.metadata, se.extraction
         FROM signals s
         LEFT JOIN signal_extractions se ON s.id = se.signal_id
         WHERE s.id = ANY($1)`,
        [signalIds]
      );
      return result.rows.map((row) => ({
        id: row.id,
        content: row.content,
        entities: row.extraction?.entities || {},
        relationships: row.extraction?.relationships || [],
        metadata: row.metadata || {}
      }));
    }

    const result = await pool.query(
      `SELECT s.id, s.content, s.metadata, se.extraction
       FROM signals s
       LEFT JOIN signal_extractions se ON s.id = se.signal_id
       ORDER BY s.created_at DESC
       LIMIT $1`,
      [limit]
    );
    return result.rows.map((row) => ({
      id: row.id,
      content: row.content,
      entities: row.extraction?.entities || {},
      relationships: row.extraction?.relationships || [],
      metadata: row.metadata || {}
    }));
  }

  private async callIndexer(payload: { signals: GraphRAGSignalInput[] }): Promise<GraphRAGIndexResult> {
    if (!config.featureFlags.graphragIndexer) {
      return {
        run_id: randomUUID(),
        communities: [],
        stats: { signal_count: payload.signals.length, community_count: 0 }
      };
    }

    // GraphRAG Python service removed - deferred to Phase 2
    const url = `http://localhost:8002/index`; // Placeholder (feature flag prevents this from being called)
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!response.ok) {
      const text = await response.text();
      logger.warn('GraphRAG indexer failed', { status: response.status, text });
      throw new Error(`GraphRAG indexer failed: ${response.status}`);
    }
    const data = (await response.json()) as GraphRAGIndexResult;
    return data;
  }

  private async persistCommunities(runId: string, communities: GraphRAGCommunity[]): Promise<void> {
    if (!communities.length) return;
    const pool = getDbPool();
    for (const community of communities) {
      await pool.query(
        `INSERT INTO graphrag_communities
          (run_id, community_key, label, level, signal_ids, entity_counts, summary)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          runId,
          community.community_key,
          community.label,
          community.level || 0,
          community.signal_ids || [],
          JSON.stringify(community.entity_counts || {}),
          community.summary || null
        ]
      );
    }
  }
}
