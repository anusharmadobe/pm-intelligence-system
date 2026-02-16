import { getDbPool } from '../db/connection';
import { logger } from '../utils/logger';
import {
  Signal,
  SignalExtraction,
  EntityResolutionLog,
  GraphragCommunity,
  buildSelectClause,
  SignalColumns,
  SignalExtractionColumns,
  EntityResolutionLogColumns,
  GraphragCommunityColumns
} from '../db/types';

export interface ProvenanceResult {
  signal: any | null;
  extraction: any | null;
  resolved_entities: Array<{
    entity_id: string;
    canonical_name: string;
    entity_type: string;
    confidence: number;
    resolution_result: string;
  }>;
  resolution_log: any[];
  graphrag_communities: any[];
  source_summary: Array<{ source: string; count: number }>;
}

export interface ProvenanceChain {
  insight_id?: string;
  insight_type?: string;
  opportunity_id?: string;
  opportunity_title?: string;
  signal_ids: string[];
  signals: Array<{
    id: string;
    source: string;
    type: string;
    text: string;
    created_at: Date;
  }>;
  entity_resolutions: Array<{
    entity_id: string;
    canonical_name: string;
    confidence: number;
    signal_id: string;
  }>;
  sources: Array<{ source: string; count: number }>;
  confidence: number;
  completeness: number; // 0.0 to 1.0
}

export interface ConfidenceFactors {
  signal_count: number;
  source_diversity: number; // 0.0 to 1.0 (unique sources / total possible sources)
  avg_entity_resolution_confidence: number;
  extraction_success_rate: number;
  recency_factor: number; // 0.0 to 1.0 (newer signals = higher)
}

export class ProvenanceService {
  /**
   * Get provenance for a single signal (legacy method)
   */
  async getSignalProvenance(signalId: string): Promise<ProvenanceResult> {
    const pool = getDbPool();
    const signalResult = await pool.query<Signal>(
      `SELECT ${buildSelectClause(SignalColumns)} FROM signals WHERE id = $1`,
      [signalId]
    );
    const extractionResult = await pool.query<SignalExtraction>(
      `SELECT ${buildSelectClause(SignalExtractionColumns)} FROM signal_extractions WHERE signal_id = $1`,
      [signalId]
    );
    const resolutionLog = await pool.query<EntityResolutionLog>(
      `SELECT ${buildSelectClause(EntityResolutionLogColumns)} FROM entity_resolution_log WHERE signal_id = $1 ORDER BY created_at ASC`,
      [signalId]
    );
    const resolvedEntities = await pool.query(
      `SELECT erl.resolved_to_entity_id AS entity_id,
              er.canonical_name,
              er.entity_type,
              erl.confidence,
              erl.resolution_result
       FROM entity_resolution_log erl
       LEFT JOIN entity_registry er ON er.id = erl.resolved_to_entity_id
       WHERE erl.signal_id = $1`,
      [signalId]
    );

    const sourceSummary = await pool.query(
      `SELECT source, COUNT(*)::int AS count
       FROM signals
       WHERE id = $1
       GROUP BY source`,
      [signalId]
    );

    const communities = await pool.query<GraphragCommunity>(
      `SELECT ${buildSelectClause(GraphragCommunityColumns)} FROM graphrag_communities
       WHERE $1 = ANY(signal_ids)
       ORDER BY created_at DESC`,
      [signalId]
    );

    return {
      signal: signalResult.rows[0] || null,
      extraction: extractionResult.rows[0] || null,
      resolved_entities: resolvedEntities.rows || [],
      resolution_log: resolutionLog.rows || [],
      graphrag_communities: communities.rows || [],
      source_summary: sourceSummary.rows || []
    };
  }

  /**
   * Get complete provenance chain for an opportunity (opportunity → signals → sources)
   */
  async getOpportunityProvenance(opportunityId: string): Promise<ProvenanceChain> {
    const pool = getDbPool();

    // Get opportunity details
    const opportunityResult = await pool.query(
      `SELECT id, title, signal_ids, created_at FROM opportunities WHERE id = $1`,
      [opportunityId]
    );

    if (opportunityResult.rows.length === 0) {
      throw new Error(`Opportunity not found: ${opportunityId}`);
    }

    const opportunity = opportunityResult.rows[0];
    const signalIds = opportunity.signal_ids || [];

    if (signalIds.length === 0) {
      return {
        opportunity_id: opportunityId,
        opportunity_title: opportunity.title,
        signal_ids: [],
        signals: [],
        entity_resolutions: [],
        sources: [],
        confidence: 0,
        completeness: 0
      };
    }

    // Get all signals for this opportunity
    const signalsResult = await pool.query(
      `SELECT id, source, type, text, created_at
       FROM signals
       WHERE id = ANY($1)
       ORDER BY created_at DESC`,
      [signalIds]
    );

    // Get entity resolutions for these signals
    const resolutionsResult = await pool.query(
      `SELECT erl.resolved_to_entity_id AS entity_id,
              er.canonical_name,
              erl.confidence,
              erl.signal_id
       FROM entity_resolution_log erl
       LEFT JOIN entity_registry er ON er.id = erl.resolved_to_entity_id
       WHERE erl.signal_id = ANY($1)
         AND erl.resolution_result IN ('auto_merged', 'alias_matched', 'new_entity')`,
      [signalIds]
    );

    // Get source diversity
    const sourcesResult = await pool.query(
      `SELECT source, COUNT(*)::int AS count
       FROM signals
       WHERE id = ANY($1)
       GROUP BY source
       ORDER BY count DESC`,
      [signalIds]
    );

    // Calculate confidence
    const confidence = await this.calculateConfidence({
      signal_ids: signalIds,
      entity_resolutions: resolutionsResult.rows
    });

    // Calculate completeness
    const completeness = await this.calculateCompleteness(signalIds);

    return {
      opportunity_id: opportunityId,
      opportunity_title: opportunity.title,
      signal_ids: signalIds,
      signals: signalsResult.rows,
      entity_resolutions: resolutionsResult.rows,
      sources: sourcesResult.rows,
      confidence,
      completeness
    };
  }

  /**
   * Get complete provenance chain for an insight (insight → opportunity → signals → sources)
   */
  async getInsightProvenance(insightId: string, insightType: string): Promise<ProvenanceChain> {
    const pool = getDbPool();

    // Insights are derived from opportunities, trends, or direct queries
    // For now, we'll trace back through opportunities (most common path)

    // Example: If insight is "Top customer pain points", it might reference opportunity IDs
    // This would require insight metadata to store opportunity_ids

    // For MVP, we'll implement a simpler version that traces signals directly
    // In production, you'd query an insights table with opportunity_ids

    // Get signals related to this insight (via metadata or direct reference)
    const signalsResult = await pool.query(
      `SELECT s.id, s.source, s.type, s.text, s.created_at
       FROM signals s
       WHERE s.metadata->>'insight_id' = $1
          OR s.id IN (
            SELECT unnest(signal_ids) FROM opportunities
            WHERE metadata->>'insight_id' = $1
          )
       ORDER BY s.created_at DESC
       LIMIT 100`,
      [insightId]
    );

    const signalIds = signalsResult.rows.map((s: any) => s.id);

    if (signalIds.length === 0) {
      logger.warn('No signals found for insight', { insightId, insightType });
      return {
        insight_id: insightId,
        insight_type: insightType,
        signal_ids: [],
        signals: [],
        entity_resolutions: [],
        sources: [],
        confidence: 0,
        completeness: 0
      };
    }

    // Get entity resolutions
    const resolutionsResult = await pool.query(
      `SELECT erl.resolved_to_entity_id AS entity_id,
              er.canonical_name,
              erl.confidence,
              erl.signal_id
       FROM entity_resolution_log erl
       LEFT JOIN entity_registry er ON er.id = erl.resolved_to_entity_id
       WHERE erl.signal_id = ANY($1)`,
      [signalIds]
    );

    // Get sources
    const sourcesResult = await pool.query(
      `SELECT source, COUNT(*)::int AS count
       FROM signals
       WHERE id = ANY($1)
       GROUP BY source`,
      [signalIds]
    );

    const confidence = await this.calculateConfidence({
      signal_ids: signalIds,
      entity_resolutions: resolutionsResult.rows
    });

    const completeness = await this.calculateCompleteness(signalIds);

    return {
      insight_id: insightId,
      insight_type: insightType,
      signal_ids: signalIds,
      signals: signalsResult.rows,
      entity_resolutions: resolutionsResult.rows,
      sources: sourcesResult.rows,
      confidence,
      completeness
    };
  }

  /**
   * Traverse provenance backward: from insight/opportunity to original sources
   */
  async traceBackToSources(entityType: 'opportunity' | 'insight', entityId: string): Promise<{
    chain: string[]; // ["insight_123", "opportunity_456", "signal_789", "source:slack"]
    metadata: any;
  }> {
    const pool = getDbPool();
    const chain: string[] = [];
    let metadata: any = {};

    if (entityType === 'opportunity') {
      chain.push(`opportunity:${entityId}`);

      // Get signals for opportunity
      const oppResult = await pool.query(
        `SELECT signal_ids, metadata FROM opportunities WHERE id = $1`,
        [entityId]
      );

      if (oppResult.rows.length > 0) {
        const signalIds = oppResult.rows[0].signal_ids || [];
        metadata.opportunity_metadata = oppResult.rows[0].metadata;

        for (const signalId of signalIds) {
          chain.push(`signal:${signalId}`);

          // Get signal source
          const sigResult = await pool.query(
            `SELECT source, metadata FROM signals WHERE id = $1`,
            [signalId]
          );

          if (sigResult.rows.length > 0) {
            chain.push(`source:${sigResult.rows[0].source}`);
            if (!metadata.sources) metadata.sources = [];
            metadata.sources.push({
              signal_id: signalId,
              source: sigResult.rows[0].source,
              source_metadata: sigResult.rows[0].metadata
            });
          }
        }
      }
    } else if (entityType === 'insight') {
      chain.push(`insight:${entityId}`);

      // Get opportunities related to insight
      const oppsResult = await pool.query(
        `SELECT id, signal_ids FROM opportunities
         WHERE metadata->>'insight_id' = $1`,
        [entityId]
      );

      for (const opp of oppsResult.rows) {
        chain.push(`opportunity:${opp.id}`);

        for (const signalId of opp.signal_ids || []) {
          chain.push(`signal:${signalId}`);

          const sigResult = await pool.query(
            `SELECT source FROM signals WHERE id = $1`,
            [signalId]
          );

          if (sigResult.rows.length > 0) {
            chain.push(`source:${sigResult.rows[0].source}`);
          }
        }
      }
    }

    return { chain, metadata };
  }

  /**
   * Calculate calibrated confidence score based on multiple factors
   */
  private async calculateConfidence(params: {
    signal_ids: string[];
    entity_resolutions: any[];
  }): Promise<number> {
    const pool = getDbPool();
    const { signal_ids, entity_resolutions } = params;

    if (signal_ids.length === 0) return 0;

    // Factor 1: Signal count (more signals = higher confidence, with diminishing returns)
    const signalCountFactor = Math.min(1.0, Math.log10(signal_ids.length + 1) / Math.log10(100));

    // Factor 2: Source diversity
    const sourcesResult = await pool.query(
      `SELECT COUNT(DISTINCT source)::int AS unique_sources
       FROM signals
       WHERE id = ANY($1)`,
      [signal_ids]
    );
    const uniqueSources = sourcesResult.rows[0]?.unique_sources || 1;
    const knownSources = ['slack', 'community_forum', 'jira', 'zendesk', 'email'];
    const sourceDiversityFactor = Math.min(1.0, uniqueSources / knownSources.length);

    // Factor 3: Average entity resolution confidence
    const avgEntityConfidence = entity_resolutions.length > 0
      ? entity_resolutions.reduce((sum: number, r: any) => sum + (r.confidence || 0), 0) / entity_resolutions.length
      : 0.5;

    // Factor 4: Extraction success rate
    const extractionsResult = await pool.query(
      `SELECT
         COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE status = 'completed')::int AS successful
       FROM signal_extractions
       WHERE signal_id = ANY($1)`,
      [signal_ids]
    );
    const extractionSuccessRate = extractionsResult.rows[0]?.total > 0
      ? extractionsResult.rows[0].successful / extractionsResult.rows[0].total
      : 0.5;

    // Factor 5: Recency (signals from last 30 days get boost)
    const recencyResult = await pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '30 days')::int AS recent,
         COUNT(*)::int AS total
       FROM signals
       WHERE id = ANY($1)`,
      [signal_ids]
    );
    const recencyFactor = recencyResult.rows[0]?.total > 0
      ? recencyResult.rows[0].recent / recencyResult.rows[0].total
      : 0.5;

    // Weighted combination
    const confidence =
      signalCountFactor * 0.25 +
      sourceDiversityFactor * 0.2 +
      avgEntityConfidence * 0.3 +
      extractionSuccessRate * 0.15 +
      recencyFactor * 0.1;

    return Math.round(confidence * 100) / 100; // Round to 2 decimals
  }

  /**
   * Calculate provenance completeness (0.0 to 1.0)
   * Measures: Do all signals have extractions? Entity resolutions? Source metadata?
   */
  private async calculateCompleteness(signalIds: string[]): Promise<number> {
    const pool = getDbPool();

    if (signalIds.length === 0) return 0;

    // Check: Do all signals have extractions?
    const extractionResult = await pool.query(
      `SELECT COUNT(DISTINCT signal_id)::int AS with_extraction
       FROM signal_extractions
       WHERE signal_id = ANY($1)
         AND status = 'completed'`,
      [signalIds]
    );
    const extractionCompleteness = extractionResult.rows[0]?.with_extraction / signalIds.length;

    // Check: Do all signals have entity resolutions?
    const resolutionResult = await pool.query(
      `SELECT COUNT(DISTINCT signal_id)::int AS with_resolution
       FROM entity_resolution_log
       WHERE signal_id = ANY($1)`,
      [signalIds]
    );
    const resolutionCompleteness = resolutionResult.rows[0]?.with_resolution / signalIds.length;

    // Check: Do all signals have source metadata?
    const metadataResult = await pool.query(
      `SELECT COUNT(*)::int AS with_metadata
       FROM signals
       WHERE id = ANY($1)
         AND metadata IS NOT NULL
         AND jsonb_typeof(metadata) = 'object'
         AND metadata != '{}'::jsonb`,
      [signalIds]
    );
    const metadataCompleteness = metadataResult.rows[0]?.with_metadata / signalIds.length;

    // Average of all completeness factors
    const completeness = (extractionCompleteness + resolutionCompleteness + metadataCompleteness) / 3;

    return Math.round(completeness * 100) / 100;
  }

  /**
   * Get provenance completeness report for the entire system
   */
  async getSystemProvenanceReport(): Promise<{
    total_signals: number;
    signals_with_extraction: number;
    signals_with_entity_resolution: number;
    signals_with_source_metadata: number;
    overall_completeness: number;
    opportunities_with_full_provenance: number;
    total_opportunities: number;
  }> {
    const pool = getDbPool();

    const report = await pool.query(`
      SELECT
        (SELECT COUNT(*)::int FROM signals) AS total_signals,
        (SELECT COUNT(DISTINCT signal_id)::int FROM signal_extractions WHERE status = 'completed') AS signals_with_extraction,
        (SELECT COUNT(DISTINCT signal_id)::int FROM entity_resolution_log) AS signals_with_entity_resolution,
        (SELECT COUNT(*)::int FROM signals WHERE metadata IS NOT NULL AND metadata != '{}'::jsonb) AS signals_with_source_metadata,
        (SELECT COUNT(*)::int FROM opportunities) AS total_opportunities
    `);

    const data = report.rows[0];
    const totalSignals = data.total_signals || 1; // Avoid division by zero

    const overallCompleteness =
      (data.signals_with_extraction / totalSignals +
       data.signals_with_entity_resolution / totalSignals +
       data.signals_with_source_metadata / totalSignals) / 3;

    // Count opportunities with full provenance (all signals have extraction + resolution)
    const oppResult = await pool.query(`
      SELECT COUNT(*)::int AS opportunities_with_full_provenance
      FROM opportunities o
      WHERE NOT EXISTS (
        SELECT 1 FROM unnest(o.signal_ids) AS sid
        WHERE NOT EXISTS (
          SELECT 1 FROM signal_extractions se
          WHERE se.signal_id = sid AND se.status = 'completed'
        )
      )
      AND array_length(o.signal_ids, 1) > 0
    `);

    return {
      total_signals: data.total_signals,
      signals_with_extraction: data.signals_with_extraction,
      signals_with_entity_resolution: data.signals_with_entity_resolution,
      signals_with_source_metadata: data.signals_with_source_metadata,
      overall_completeness: Math.round(overallCompleteness * 100) / 100,
      opportunities_with_full_provenance: oppResult.rows[0]?.opportunities_with_full_provenance || 0,
      total_opportunities: data.total_opportunities
    };
  }
}
