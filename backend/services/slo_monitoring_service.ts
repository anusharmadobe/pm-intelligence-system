import { getDbPool } from '../db/connection';
import { logger } from '../utils/logger';

export interface SLOMetric {
  metric_name: string;
  metric_value: number;
  labels?: Record<string, string>;
  recorded_at: Date;
}

export interface SLOBreach {
  slo_name: string;
  target: number;
  current_value: number;
  breach_severity: 'warning' | 'critical';
  breach_duration_minutes: number;
  first_breached_at: Date;
}

export interface SLOStatus {
  slo_name: string;
  target: number;
  current_value: number;
  status: 'healthy' | 'warning' | 'critical';
  measurement_window: string;
  last_checked: Date;
}

/**
 * SLO Monitoring Service
 * Tracks 6 critical SLOs for production readiness:
 * 1. Entity resolution accuracy (>85%)
 * 2. Ingestion pipeline uptime (>99%)
 * 3. MCP tool response time (p95 <5s)
 * 4. Neo4j sync latency (<30s)
 * 5. Extraction success rate (>95%)
 * 6. Knowledge graph consistency (<1% divergence)
 */
export class SLOMonitoringService {
  private pool = getDbPool();

  /**
   * Record entity resolution accuracy
   * Target: >85% over 30 days, >92% over 90 days
   */
  async recordEntityResolutionAccuracy(accuracy: number, windowDays: number = 7): Promise<void> {
    await this.recordMetric('entity_resolution_accuracy', accuracy, {
      window_days: windowDays.toString()
    });
    logger.debug('Recorded entity resolution accuracy', { accuracy, windowDays });
  }

  /**
   * Record ingestion success/failure
   * Target: >99% uptime
   */
  async recordIngestionSuccess(source: string, success: boolean): Promise<void> {
    await this.recordMetric('ingestion_success', success ? 1 : 0, { source });
    logger.debug('Recorded ingestion success', { source, success });
  }

  /**
   * Record MCP tool latency
   * Target: p95 <5s
   */
  async recordMCPToolLatency(tool: string, latencyMs: number): Promise<void> {
    await this.recordMetric('mcp_tool_latency_ms', latencyMs, { tool });
    logger.debug('Recorded MCP tool latency', { tool, latencyMs });
  }

  /**
   * Record Neo4j sync latency
   * Target: <30s from PostgreSQL write to Neo4j write
   */
  async recordNeo4jSyncLatency(latencyMs: number): Promise<void> {
    await this.recordMetric('neo4j_sync_latency_ms', latencyMs);
    logger.debug('Recorded Neo4j sync latency', { latencyMs });
  }

  /**
   * Record extraction success/failure
   * Target: >95% success rate
   */
  async recordExtractionResult(success: boolean, extractionType: string = 'llm'): Promise<void> {
    await this.recordMetric('extraction_success', success ? 1 : 0, {
      extraction_type: extractionType
    });
    logger.debug('Recorded extraction result', { success, extractionType });
  }

  /**
   * Record knowledge graph consistency divergence
   * Target: <1% divergence between PostgreSQL and Neo4j
   */
  async recordGraphConsistency(divergencePercent: number): Promise<void> {
    await this.recordMetric('graph_consistency_divergence_pct', divergencePercent);
    logger.debug('Recorded graph consistency', { divergencePercent });
  }

  /**
   * Generic metric recording
   */
  private async recordMetric(
    name: string,
    value: number,
    labels: Record<string, string> = {}
  ): Promise<void> {
    try {
      await this.pool.query(
        `INSERT INTO system_metrics (metric_name, metric_value, labels, recorded_at)
         VALUES ($1, $2, $3, NOW())`,
        [name, value, JSON.stringify(labels)]
      );
    } catch (error: any) {
      logger.error('Failed to record metric', {
        metric_name: name,
        error: error.message
      });
    }
  }

  /**
   * Check all SLOs and return current status
   */
  async checkAllSLOs(): Promise<SLOStatus[]> {
    const statuses: SLOStatus[] = [];

    // 1. Entity Resolution Accuracy (30-day window)
    const erAccuracy = await this.getEntityResolutionAccuracy(30);
    statuses.push({
      slo_name: 'entity_resolution_accuracy_30d',
      target: 0.85,
      current_value: erAccuracy,
      status: erAccuracy >= 0.85 ? 'healthy' : erAccuracy >= 0.80 ? 'warning' : 'critical',
      measurement_window: '30 days',
      last_checked: new Date()
    });

    // 2. Ingestion Pipeline Uptime (24-hour window)
    const ingestionUptime = await this.getIngestionUptime(24);
    statuses.push({
      slo_name: 'ingestion_uptime_24h',
      target: 0.995,
      current_value: ingestionUptime,
      status: ingestionUptime >= 0.995 ? 'healthy' : ingestionUptime >= 0.99 ? 'warning' : 'critical',
      measurement_window: '24 hours',
      last_checked: new Date()
    });

    // 3. MCP Tool Response Time p95 (1-hour window)
    const mcpP95 = await this.getMCPToolP95Latency(1);
    statuses.push({
      slo_name: 'mcp_tool_p95_latency_1h',
      target: 5000,
      current_value: mcpP95,
      status: mcpP95 <= 5000 ? 'healthy' : mcpP95 <= 8000 ? 'warning' : 'critical',
      measurement_window: '1 hour',
      last_checked: new Date()
    });

    // 4. Neo4j Sync Latency (1-hour average)
    const neo4jLatency = await this.getNeo4jSyncLatency(1);
    statuses.push({
      slo_name: 'neo4j_sync_latency_1h',
      target: 30000,
      current_value: neo4jLatency,
      status: neo4jLatency <= 30000 ? 'healthy' : neo4jLatency <= 60000 ? 'warning' : 'critical',
      measurement_window: '1 hour',
      last_checked: new Date()
    });

    // 5. Extraction Success Rate (24-hour window)
    const extractionSuccess = await this.getExtractionSuccessRate(24);
    statuses.push({
      slo_name: 'extraction_success_rate_24h',
      target: 0.95,
      current_value: extractionSuccess,
      status: extractionSuccess >= 0.95 ? 'healthy' : extractionSuccess >= 0.90 ? 'warning' : 'critical',
      measurement_window: '24 hours',
      last_checked: new Date()
    });

    // 6. Knowledge Graph Consistency (nightly check)
    const graphConsistency = await this.getGraphConsistencyDivergence();
    statuses.push({
      slo_name: 'graph_consistency',
      target: 0.01,
      current_value: graphConsistency,
      status: graphConsistency <= 0.01 ? 'healthy' : graphConsistency <= 0.02 ? 'warning' : 'critical',
      measurement_window: 'latest',
      last_checked: new Date()
    });

    return statuses;
  }

  /**
   * Get SLO breaches (currently breached SLOs)
   */
  async getSLOBreaches(): Promise<SLOBreach[]> {
    const statuses = await this.checkAllSLOs();
    const breaches: SLOBreach[] = [];

    for (const status of statuses) {
      if (status.status === 'warning' || status.status === 'critical') {
        // Determine how long it's been breached
        const breachDuration = await this.getBreachDuration(status.slo_name);

        breaches.push({
          slo_name: status.slo_name,
          target: status.target,
          current_value: status.current_value,
          breach_severity: status.status,
          breach_duration_minutes: breachDuration,
          first_breached_at: new Date(Date.now() - breachDuration * 60 * 1000)
        });
      }
    }

    return breaches;
  }

  /**
   * Calculate entity resolution accuracy over window
   */
  private async getEntityResolutionAccuracy(windowDays: number): Promise<number> {
    try {
      const result = await this.pool.query(
        `SELECT
           COUNT(*) FILTER (WHERE resolution_result = 'auto_merged' AND confidence >= 0.85) as correct,
           COUNT(*) as total
         FROM entity_resolution_log
         WHERE created_at >= NOW() - INTERVAL '${windowDays} days'`
      );

      if (result.rows.length === 0 || result.rows[0].total === 0) {
        return 1.0; // No data = assume healthy
      }

      return result.rows[0].correct / result.rows[0].total;
    } catch (error) {
      logger.error('Failed to calculate ER accuracy', { error });
      return 0;
    }
  }

  /**
   * Calculate ingestion uptime over window (hours)
   */
  private async getIngestionUptime(windowHours: number): Promise<number> {
    try {
      const result = await this.pool.query(
        `SELECT
           AVG(CASE WHEN metric_value = 1 THEN 1.0 ELSE 0.0 END) as uptime
         FROM system_metrics
         WHERE metric_name = 'ingestion_success'
           AND recorded_at >= NOW() - INTERVAL '${windowHours} hours'`
      );

      if (result.rows.length === 0 || result.rows[0].uptime === null) {
        return 1.0; // No data = assume healthy
      }

      return result.rows[0].uptime;
    } catch (error) {
      logger.error('Failed to calculate ingestion uptime', { error });
      return 0;
    }
  }

  /**
   * Calculate MCP tool p95 latency over window (hours)
   */
  private async getMCPToolP95Latency(windowHours: number): Promise<number> {
    try {
      const result = await this.pool.query(
        `SELECT PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY metric_value) as p95
         FROM system_metrics
         WHERE metric_name = 'mcp_tool_latency_ms'
           AND recorded_at >= NOW() - INTERVAL '${windowHours} hours'`
      );

      if (result.rows.length === 0 || result.rows[0].p95 === null) {
        return 0; // No data = assume healthy
      }

      return result.rows[0].p95;
    } catch (error) {
      logger.error('Failed to calculate MCP tool p95', { error });
      return 0;
    }
  }

  /**
   * Calculate Neo4j sync latency average over window (hours)
   */
  private async getNeo4jSyncLatency(windowHours: number): Promise<number> {
    try {
      const result = await this.pool.query(
        `SELECT AVG(metric_value) as avg_latency
         FROM system_metrics
         WHERE metric_name = 'neo4j_sync_latency_ms'
           AND recorded_at >= NOW() - INTERVAL '${windowHours} hours'`
      );

      if (result.rows.length === 0 || result.rows[0].avg_latency === null) {
        return 0; // No data = assume healthy
      }

      return result.rows[0].avg_latency;
    } catch (error) {
      logger.error('Failed to calculate Neo4j sync latency', { error });
      return 0;
    }
  }

  /**
   * Calculate extraction success rate over window (hours)
   */
  private async getExtractionSuccessRate(windowHours: number): Promise<number> {
    try {
      const result = await this.pool.query(
        `SELECT
           AVG(CASE WHEN metric_value = 1 THEN 1.0 ELSE 0.0 END) as success_rate
         FROM system_metrics
         WHERE metric_name = 'extraction_success'
           AND recorded_at >= NOW() - INTERVAL '${windowHours} hours'`
      );

      if (result.rows.length === 0 || result.rows[0].success_rate === null) {
        return 1.0; // No data = assume healthy
      }

      return result.rows[0].success_rate;
    } catch (error) {
      logger.error('Failed to calculate extraction success rate', { error });
      return 0;
    }
  }

  /**
   * Get latest graph consistency divergence
   */
  private async getGraphConsistencyDivergence(): Promise<number> {
    try {
      const result = await this.pool.query(
        `SELECT metric_value
         FROM system_metrics
         WHERE metric_name = 'graph_consistency_divergence_pct'
         ORDER BY recorded_at DESC
         LIMIT 1`
      );

      if (result.rows.length === 0) {
        return 0; // No data = assume healthy
      }

      return result.rows[0].metric_value / 100; // Convert to decimal
    } catch (error) {
      logger.error('Failed to get graph consistency', { error });
      return 0;
    }
  }

  /**
   * Get breach duration in minutes
   */
  private async getBreachDuration(sloName: string): Promise<number> {
    // For simplicity, assume breach started in last check window
    // In production, track breach start times in a dedicated table
    return 5; // Default: 5 minutes
  }
}
