import express from 'express';
import { readFileSync } from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { AgentRegistryService } from './agent_registry_service';
import { IntelligenceService } from '../services/intelligence_service';
import { HeatmapService } from '../services/heatmap_service';
import { ReportGenerationService } from '../services/report_generation_service';
import { getOpportunitiesWithScores } from '../services/opportunity_service';
import { NormalizerService } from '../ingestion/normalizer_service';
import { IngestionPipelineService } from '../services/ingestion_pipeline_service';
import { getDbPool } from '../db/connection';
import { ProvenanceService } from '../services/provenance_service';
import { QueryEngineService } from '../services/query_engine_service';
import { logger } from '../utils/logger';
import { AgentRequest, createAgentAuthMiddleware, createAgentRateLimitMiddleware } from './auth_middleware';

type JsonRpcRequest = {
  jsonrpc: string;
  id?: string | number | null;
  method: string;
  params?: any;
};

const queryTrendsSchema = z.object({
  entity_type: z.enum(['issue', 'feature', 'customer', 'theme']),
  window_days: z.coerce.number().int().min(1).max(365).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  direction: z.string().optional()
});

const generateReportSchema = z.object({
  report_type: z.enum([
    'customer_health_summary',
    'roadmap_summary',
    'customer_impact_brief',
    'weekly_digest',
    'competitive_intel',
    'product_area_overview'
  ]),
  time_window_days: z.coerce.number().int().min(7).max(365).optional(),
  format: z.enum(['executive_summary', 'detailed', 'one_pager']).optional(),
  audience: z.enum(['leadership', 'engineering', 'design', 'cs_sales', 'general']).optional(),
  filter_customer: z.string().optional(),
  filter_area: z.string().optional()
});

const ingestSignalSchema = z.object({
  source: z.string().min(1),
  content: z.string().min(1),
  metadata: z.record(z.string(), z.unknown()).optional(),
  timestamp: z.string().optional(),
  idempotency_key: z.string().optional()
});

const queryKnowledgeSchema = z.object({
  query: z.string().min(3),
  limit: z.coerce.number().int().min(1).max(50).optional(),
  source: z.string().optional(),
  customer: z.string().optional(),
  feature: z.string().optional(),
  theme: z.string().optional()
});

function jsonRpcError(id: string | number | null | undefined, message: string, code = -32000) {
  return {
    jsonrpc: '2.0',
    id: id ?? null,
    error: {
      code,
      message
    }
  };
}

function jsonRpcResult(id: string | number | null | undefined, result: any) {
  return {
    jsonrpc: '2.0',
    id: id ?? null,
    result
  };
}

function loadAgentCard() {
  const cardPath = path.join(__dirname, 'agent_card.json');
  const raw = readFileSync(cardPath, 'utf-8');
  return JSON.parse(raw);
}

async function handleSkill(skillId: string, input: any, agent: { id: string } | null) {
  const intelligence = new IntelligenceService();
  const heatmapService = new HeatmapService();
  const reportService = new ReportGenerationService();
  const queryEngine = new QueryEngineService();
  const normalizer = new NormalizerService();
  const pipeline = new IngestionPipelineService();

  switch (skillId) {
    case 'query-customer-profile': {
      const name = input?.customer_name || input?.customer || input?.name;
      if (!name) throw new Error('customer_name is required');
      return intelligence.getCustomerProfile(name);
    }
    case 'query-heatmap': {
      if (!input?.dimension) throw new Error('dimension is required');
      return heatmapService.getHeatmap({
        dimension: input.dimension,
        metric: input.metric,
        limit: input.limit,
        date_from: input.date_from
      });
    }
    case 'query-trends': {
      const parsed = queryTrendsSchema.parse(input);
      const entityType = parsed.entity_type;
      const windowDays = parsed.window_days || 28;
      const limit = parsed.limit || 15;
      const direction = parsed.direction || 'all';
      const trends = await intelligence.getTrends(entityType, windowDays, limit * 2);
      return direction === 'all'
        ? trends.slice(0, limit)
        : trends.filter((trend) => trend.direction === direction).slice(0, limit);
    }
    case 'query-opportunities': {
      const status = input?.status && input.status !== 'all' ? input.status : undefined;
      const limit = input?.limit || 20;
      const scored = await getOpportunitiesWithScores({}, { status, limit });
      return scored.map((opp) => ({
        id: opp.id,
        title: opp.title,
        description: opp.description,
        status: opp.status,
        created_at: opp.created_at,
        signal_count: opp.signals.length,
        roadmap_score: opp.roadmapScore
      }));
    }
    case 'generate-report': {
      const parsed = generateReportSchema.parse(input);
      return reportService.generateReport(parsed);
    }
    case 'ingest-signal': {
      const parsed = ingestSignalSchema.parse(input);
      const idempotencyKey = parsed.idempotency_key || null;
      if (idempotencyKey && agent?.id) {
        const pool = getDbPool();
        const existing = await pool.query(
          `SELECT id FROM signals
           WHERE metadata->>'idempotency_key' = $1
             AND metadata->>'source_agent_id' = $2
           LIMIT 1`,
          [idempotencyKey, agent.id]
        );
        if (existing.rows[0]) {
          return { status: 'ok', signal_id: existing.rows[0].id, idempotent: true };
        }
      }
      const signal = normalizer.normalize({
        source: parsed.source,
        content: parsed.content,
        metadata: {
          ...(parsed.metadata || {}),
          source_agent_id: agent?.id,
          idempotency_key: idempotencyKey || undefined
        },
        timestamp: parsed.timestamp
      });
      await pipeline.ingest([signal]);
      return { status: 'ok', signal_id: signal.id, idempotent: false };
    }
    case 'propose-entity-change': {
      const pool = getDbPool();
      if (!input?.entity_type || !input?.canonical_name) {
        throw new Error('entity_type and canonical_name are required');
      }
      await pool.query(
        `INSERT INTO feedback_log
          (id, feedback_type, system_output, system_confidence, status, agent_output_type, source_agent_id)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6)`,
        [
          'agent_proposal_review',
          JSON.stringify(input),
          input?.confidence || 0.5,
          'pending',
          'entity_proposal',
          agent?.id || null
        ]
      );
      return { status: 'pending_review' };
    }
    case 'query-provenance': {
      if (!input?.signal_id) throw new Error('signal_id is required');
      const provenanceService = new ProvenanceService();
      return provenanceService.getSignalProvenance(input.signal_id);
    }
    case 'query-knowledge': {
      const parsed = queryKnowledgeSchema.parse(input);
      return queryEngine.answerQuery({
        query: parsed.query,
        limit: parsed.limit,
        source: parsed.source,
        customer: parsed.customer,
        feature: parsed.feature,
        theme: parsed.theme
      });
    }
    default:
      throw new Error(`Unsupported skill: ${skillId}`);
  }
}

export function createA2AServerRouter(): express.Router {
  const router = express.Router();
  const registry = new AgentRegistryService();

  router.get('/.well-known/agent.json', (req, res) => {
    try {
      const card = loadAgentCard();
      res.json(card);
    } catch (error: any) {
      logger.error('Failed to load agent card', { error });
      res.status(500).json({ error: 'Agent card unavailable' });
    }
  });

  router.post(
    '/a2a',
    createAgentAuthMiddleware(registry),
    createAgentRateLimitMiddleware(),
    async (req: AgentRequest, res) => {
    const correlationId = typeof req.headers['x-correlation-id'] === 'string'
      ? req.headers['x-correlation-id']
      : randomUUID();
    const agent = req.agent;
    if (!agent) {
      return res.status(401).json(jsonRpcError(null, 'Unauthorized', -32001));
    }

    const body = req.body as JsonRpcRequest;
    if (!body || body.jsonrpc !== '2.0') {
      return res.status(400).json(jsonRpcError(body?.id, 'Invalid JSON-RPC request', -32600));
    }

    if (body.method !== 'message/send') {
      return res.status(400).json(jsonRpcError(body.id, `Unsupported method ${body.method}`, -32601));
    }

    const params = body.params || {};
    const skillId =
      params.skill_id ||
      params.skillId ||
      params.skill?.id ||
      params.task?.skill_id;
    const input = params.input || params.arguments || params.data || params.task?.input || {};

    if (!skillId) {
      return res.status(400).json(jsonRpcError(body.id, 'skill_id is required'));
    }

    const taskId = randomUUID();
    try {
      if (
        ['ingest-signal', 'propose-entity-change'].includes(skillId) &&
        !agent.permissions?.write
      ) {
        return res.status(403).json(jsonRpcError(body.id, 'Write permission required', -32001));
      }

      const result = await handleSkill(skillId, input, agent);
      await registry.logActivity({
        agentId: agent.id,
        action: 'a2a',
        endpoint: '/a2a',
        requestParams: { skillId, input },
        responseStatus: 200,
        agentVersion: agent.current_version,
        correlationId
      });

      return res.json(
        jsonRpcResult(body.id, {
          task: {
            id: taskId,
            status: { state: 'completed' },
            artifacts: [
              {
                parts: [
                  {
                    kind: 'data',
                    data: result
                  }
                ]
              }
            ]
          }
        })
      );
    } catch (error: any) {
      logger.error('A2A request failed', { error, skillId, correlationId });
      await registry.logActivity({
        agentId: agent.id,
        action: 'a2a',
        endpoint: '/a2a',
        requestParams: { skillId, input },
        responseStatus: 500,
        errorMessage: error.message,
        agentVersion: agent.current_version,
        correlationId
      });
      return res.status(500).json(jsonRpcError(body.id, error.message));
    }
  });

  return router;
}
