import express from 'express';
import { randomUUID } from 'crypto';
import * as z from 'zod/v4';
import { AgentRegistryService } from './agent_registry_service';
import { EntityRegistryService } from '../services/entity_registry_service';
import { IntelligenceService } from '../services/intelligence_service';
import { HeatmapService } from '../services/heatmap_service';
import { ReportGenerationService } from '../services/report_generation_service';
import { SourceRegistryService } from '../services/source_registry_service';
import { QueryEngineService } from '../services/query_engine_service';
import { getOpportunitiesWithScores } from '../services/opportunity_service';
import { hybridSearch, textSearch } from '../services/hybrid_search_service';
import { createEmbeddingProvider, EmbeddingProviderConfig } from '../services/embedding_provider';
import { NormalizerService } from '../ingestion/normalizer_service';
import { IngestionPipelineService } from '../services/ingestion_pipeline_service';
import { getDbPool } from '../db/connection';
import { ProvenanceService } from '../services/provenance_service';
// RateLimiter replaced with in-memory implementation below
import { logger } from '../utils/logger';
import { config } from '../config/env';
import { eventBus } from './event_bus';
import { AgentRequest, createAgentAuthMiddleware, createAgentRateLimitMiddleware, getApiKey } from './auth_middleware';
import { createEventStreamHandler } from './event_stream';

const registerSchema = z.object({
  agent_name: z.string().min(1),
  agent_class: z.enum(['orchestrator', 'autonomous', 'integration']),
  permissions: z.record(z.string(), z.boolean()).optional(),
  rate_limit_per_minute: z.number().int().min(1).max(10000).optional(),
  event_subscriptions: z.array(z.string()).optional(),
  webhook_url: z.string().url().optional(),
  a2a_agent_card_url: z.string().url().optional(),
  a2a_capabilities: z.record(z.string(), z.unknown()).optional(),
  max_monthly_cost_usd: z.number().min(0).optional(),
  deployed_by: z.string().optional()
});

const ingestSchema = z.object({
  source: z.string().min(1),
  content: z.string().min(1),
  timestamp: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional()
});

const entitiesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional()
});

const heatmapQuerySchema = z.object({
  dimension: z.enum([
    'issues_by_feature',
    'issues_by_customer',
    'features_by_customer',
    'themes_by_signal_volume'
  ]),
  metric: z.enum(['customer_count', 'signal_count', 'severity_weighted']).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  date_from: z.string().optional()
});

const trendsQuerySchema = z.object({
  entity_type: z.enum(['issue', 'feature', 'customer', 'theme']),
  window_days: z.coerce.number().int().min(1).max(365).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  direction: z.string().optional()
});

const sourcePatchSchema = z.object({
  status: z.enum(['connected', 'error', 'disabled']).optional(),
  config: z.record(z.string(), z.unknown()).optional()
});

const proposeEntitySchema = z.object({
  entity_type: z.enum(['customer', 'feature', 'issue', 'theme', 'stakeholder']),
  canonical_name: z.string().min(2),
  description: z.string().optional(),
  confidence: z.number().min(0).max(1).optional()
});

const flagIssueSchema = z.object({
  issue_name: z.string().min(2),
  severity: z.string().optional(),
  notes: z.string().optional()
});

const reportSchema = z.object({
  report_type: z.enum([
    'customer_health_summary',
    'roadmap_summary',
    'customer_impact_brief',
    'weekly_digest',
    'competitive_intel',
    'product_area_overview'
  ]),
  time_window_days: z.number().int().min(7).max(365).optional(),
  format: z.enum(['executive_summary', 'detailed', 'one_pager']).optional(),
  audience: z.enum(['leadership', 'engineering', 'design', 'cs_sales', 'general']).optional(),
  filter_area: z.string().optional(),
  filter_customer: z.string().optional()
});

const querySchema = z.object({
  query: z.string().min(2),
  limit: z.number().int().min(1).max(50).optional(),
  source: z.string().optional(),
  customer: z.string().optional(),
  feature: z.string().optional(),
  theme: z.string().optional()
});

const sourceRegistrySchema = z.object({
  source_name: z.string().min(1),
  source_type: z.enum(['slack', 'transcript', 'document', 'web_scrape', 'jira', 'wiki', 'email', 'manual']),
  status: z.enum(['connected', 'error', 'disabled']).optional(),
  config: z.record(z.string(), z.unknown()).optional()
});


function isPublicHttpsUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    if (url.protocol !== 'https:') return false;
    if (hostname === 'localhost' || hostname.endsWith('.local')) return false;
    if (hostname.startsWith('127.') || hostname.startsWith('10.') || hostname.startsWith('192.168.')) {
      return false;
    }
    if (hostname.startsWith('172.')) {
      const second = parseInt(hostname.split('.')[1] || '0', 10);
      if (second >= 16 && second <= 31) return false;
    }
    return true;
  } catch {
    return false;
  }
}

// Simple in-memory rate limiter for agent registration
const registrationAttempts = new Map<string, { count: number; resetTime: number }>();
const REGISTRATION_WINDOW_MS = 60 * 1000;
const MAX_REGISTRATION_REQUESTS = 5;

function checkRegistrationLimit(ip: string): { allowed: boolean; remaining: number; resetTime: number } {
  const now = Date.now();
  const entry = registrationAttempts.get(ip);

  if (!entry || now > entry.resetTime) {
    const resetTime = now + REGISTRATION_WINDOW_MS;
    registrationAttempts.set(ip, { count: 1, resetTime });
    return { allowed: true, remaining: MAX_REGISTRATION_REQUESTS - 1, resetTime };
  }

  entry.count++;
  const remaining = Math.max(0, MAX_REGISTRATION_REQUESTS - entry.count);
  return {
    allowed: entry.count <= MAX_REGISTRATION_REQUESTS,
    remaining,
    resetTime: entry.resetTime
  };
}

export function createAgentGatewayRouter(): express.Router {
  const router = express.Router();
  const registryService = new AgentRegistryService();
  const entityRegistry = new EntityRegistryService();
  const intelligence = new IntelligenceService();
  const heatmapService = new HeatmapService();
  const reportService = new ReportGenerationService();
  const sourceRegistry = new SourceRegistryService();
  const queryEngine = new QueryEngineService();
  const normalizer = new NormalizerService();
  const pipeline = new IngestionPipelineService();

  router.use((req: AgentRequest, res, next) => {
    const correlationId = typeof req.headers['x-correlation-id'] === 'string'
      ? req.headers['x-correlation-id']
      : randomUUID();
    req.correlationId = correlationId;
    res.setHeader('X-Correlation-ID', correlationId);
    next();
  });

  router.get('/health', async (req: AgentRequest, res) => {
    try {
      const pool = getDbPool();
      await pool.query('SELECT 1');
      return res.json({ status: 'ok', timestamp: new Date().toISOString() });
    } catch (error: any) {
      logger.error('Agent health check failed', { error, correlation_id: req.correlationId });
      return res.status(503).json({ status: 'degraded', error: error.message });
    }
  });

  router.post('/auth/register', async (req: AgentRequest, res) => {
    const startTime = Date.now();
    try {
      const requiredSecret = process.env.AGENT_REGISTRATION_SECRET;
      if (requiredSecret) {
        const provided = req.headers['x-registration-secret'];
        if (typeof provided !== 'string' || provided !== requiredSecret) {
          return res.status(401).json({ error: 'Invalid registration secret' });
        }
      }

      const limiterResult = checkRegistrationLimit(req.ip || 'unknown');
      res.setHeader('X-RateLimit-Limit', 5);
      res.setHeader('X-RateLimit-Remaining', limiterResult.remaining);
      res.setHeader('X-RateLimit-Reset', new Date(limiterResult.resetTime).toISOString());
      if (!limiterResult.allowed) {
        return res.status(429).json({
          error: 'Too many requests',
          message: `Rate limit exceeded. Try again after ${new Date(limiterResult.resetTime).toISOString()}`,
          retryAfter: Math.ceil((limiterResult.resetTime - Date.now()) / 1000)
        });
      }

      const parsed = registerSchema.parse(req.body);
      if (parsed.webhook_url && !isPublicHttpsUrl(parsed.webhook_url)) {
        return res.status(400).json({ error: 'webhook_url must be a public HTTPS URL' });
      }
      if (parsed.a2a_agent_card_url && !isPublicHttpsUrl(parsed.a2a_agent_card_url)) {
        return res.status(400).json({ error: 'a2a_agent_card_url must be a public HTTPS URL' });
      }

      const { apiKey, agent } = await registryService.registerAgent({
        ...parsed,
        correlation_id: req.correlationId
      });
      return res.status(201).json({ api_key: apiKey, agent });
    } catch (error: any) {
      logger.error('Agent registration failed', { error, correlation_id: req.correlationId });
      return res.status(400).json({ error: error.message });
    } finally {
      const duration = Date.now() - startTime;
      logger.info('Agent registration request', { duration_ms: duration, correlation_id: req.correlationId });
    }
  });

  router.post('/auth/rotate-key', async (req: AgentRequest, res) => {
    const apiKey = getApiKey(req);
    if (!apiKey) {
      return res.status(401).json({ error: 'Missing API key' });
    }

    try {
      const agent = await registryService.authenticate(apiKey, req.correlationId);
      if (!agent) {
        return res.status(401).json({ error: 'Invalid API key' });
      }

      const newKey = await registryService.rotateApiKey(agent.id, req.correlationId);
      return res.status(200).json({ api_key: newKey });
    } catch (error: any) {
      logger.error('Agent key rotation failed', { error, correlation_id: req.correlationId });
      return res.status(500).json({ error: 'Failed to rotate API key' });
    }
  });

  router.use(createAgentAuthMiddleware(registryService));
  router.use(createAgentRateLimitMiddleware());

  router.use((req: AgentRequest, res, next) => {
    const startTime = Date.now();
    res.on('finish', () => {
      if (!req.agent) return;
      registryService.logActivity({
        agentId: req.agent.id,
        action: req.method,
        endpoint: req.path,
        requestParams: req.body || req.query,
        responseStatus: res.statusCode,
        responseTimeMs: Date.now() - startTime,
        agentVersion: req.agent.current_version,
        correlationId: req.correlationId
      });
    });
    next();
  });

  router.get('/entities', async (req: AgentRequest, res) => {
    try {
      const parsedQuery = entitiesQuerySchema.safeParse(req.query);
      if (!parsedQuery.success) {
        return res.status(400).json({ error: 'Invalid query', details: parsedQuery.error.flatten() });
      }
      const query = typeof req.query.query === 'string' ? req.query.query : '';
      const limit = parsedQuery.data.limit ?? 25;
      if (!query) {
        const pool = getDbPool();
        const result = await pool.query(
          `SELECT id, canonical_name, entity_type, is_active
           FROM entity_registry
           WHERE is_active = true
           ORDER BY canonical_name ASC
           LIMIT $1`,
          [limit]
        );
        return res.json({ entities: result.rows });
      }
      const entities = await entityRegistry.search(query, limit);
      return res.json({ entities });
    } catch (error: any) {
      logger.error('Agent list entities failed', { error, correlation_id: req.correlationId });
      return res.status(500).json({ error: error.message });
    }
  });

  router.get('/entities/:id', async (req: AgentRequest, res) => {
    try {
      const result = await entityRegistry.getWithAliases(req.params.id);
      return res.json(result);
    } catch (error: any) {
      logger.error('Agent get entity failed', { error, correlation_id: req.correlationId });
      return res.status(500).json({ error: error.message });
    }
  });

  router.get('/signals', async (req: AgentRequest, res) => {
    try {
      const query = typeof req.query.query === 'string' ? req.query.query : '';
      if (!query) {
        return res.status(400).json({ error: 'query parameter is required' });
      }
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 20;
      const filters: {
        source?: string;
        customer?: string;
        feature?: string;
        theme?: string;
        startDate?: Date;
        endDate?: Date;
      } = {};

      if (typeof req.query.source === 'string' && req.query.source !== 'all') {
        filters.source = req.query.source === 'meeting_transcript' ? 'transcript' : req.query.source;
      }
      if (typeof req.query.customer === 'string') filters.customer = req.query.customer;
      if (typeof req.query.feature === 'string') filters.feature = req.query.feature;
      if (typeof req.query.theme === 'string') filters.theme = req.query.theme;
      if (typeof req.query.date_from === 'string') {
        const parsed = new Date(req.query.date_from);
        if (Number.isNaN(parsed.getTime())) {
          return res.status(400).json({ error: 'Invalid date_from' });
        }
        filters.startDate = parsed;
      }
      if (typeof req.query.date_to === 'string') {
        const parsed = new Date(req.query.date_to);
        if (Number.isNaN(parsed.getTime())) {
          return res.status(400).json({ error: 'Invalid date_to' });
        }
        filters.endDate = parsed;
      }

      let results;
      try {
        const provider = (process.env.EMBEDDING_PROVIDER as EmbeddingProviderConfig['provider']) || 'mock';
        const embeddingProvider = createEmbeddingProvider({ provider });
        results = await hybridSearch({ query, limit, filters }, embeddingProvider);
      } catch (error) {
        logger.warn('Hybrid search failed, falling back to text search', { error, correlation_id: req.correlationId });
        results = await textSearch(query, { limit, filters });
      }

      const summary = results.map((result) => ({
        id: result.signal.id,
        source: result.signal.source,
        created_at: result.signal.created_at,
        score: result.combinedScore,
        snippet: result.signal.content.substring(0, 160)
      }));
      return res.json({ results: summary });
    } catch (error: any) {
      logger.error('Agent search signals failed', { error, correlation_id: req.correlationId });
      return res.status(500).json({ error: error.message });
    }
  });

  router.get('/heatmap', async (req: AgentRequest, res) => {
    try {
      const parsedQuery = heatmapQuerySchema.safeParse(req.query);
      if (!parsedQuery.success) {
        return res.status(400).json({ error: 'Invalid query', details: parsedQuery.error.flatten() });
      }
      const { dimension, metric, limit, date_from } = parsedQuery.data;

      const response = await heatmapService.getHeatmap({
        dimension,
        metric,
        limit,
        date_from
      });
      return res.json(response);
    } catch (error: any) {
      logger.error('Agent heatmap failed', { error, correlation_id: req.correlationId });
      return res.status(500).json({ error: error.message });
    }
  });

  router.get('/trends', async (req: AgentRequest, res) => {
    try {
      const parsedQuery = trendsQuerySchema.safeParse(req.query);
      if (!parsedQuery.success) {
        return res.status(400).json({ error: 'Invalid query', details: parsedQuery.error.flatten() });
      }
      const entityType = parsedQuery.data.entity_type;
      const direction = parsedQuery.data.direction || 'all';
      const windowDays = parsedQuery.data.window_days ?? 28;
      const limit = parsedQuery.data.limit ?? 15;
      const trends = await intelligence.getTrends(entityType, windowDays, limit * 2);
      const filtered = direction === 'all' ? trends : trends.filter((trend) => trend.direction === direction);
      return res.json({ trends: filtered.slice(0, limit) });
    } catch (error: any) {
      logger.error('Agent trends failed', { error, correlation_id: req.correlationId });
      return res.status(500).json({ error: error.message });
    }
  });

  router.get('/opportunities', async (req: AgentRequest, res) => {
    try {
      const status = typeof req.query.status === 'string' && req.query.status !== 'all'
        ? req.query.status
        : undefined;
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 20;
      const scored = await getOpportunitiesWithScores({}, { status, limit });
      const opportunities = scored.map((opp) => ({
        id: opp.id,
        title: opp.title,
        description: opp.description,
        status: opp.status,
        created_at: opp.created_at,
        signal_count: opp.signals.length,
        roadmap_score: opp.roadmapScore
      }));
      return res.json({ opportunities });
    } catch (error: any) {
      logger.error('Agent opportunities failed', { error, correlation_id: req.correlationId });
      return res.status(500).json({ error: error.message });
    }
  });

  router.get('/customer/:name', async (req: AgentRequest, res) => {
    try {
      const profile = await intelligence.getCustomerProfile(req.params.name);
      return res.json(profile);
    } catch (error: any) {
      logger.error('Agent customer profile failed', { error, correlation_id: req.correlationId });
      return res.status(500).json({ error: error.message });
    }
  });

  router.get('/er-stats', async (req: AgentRequest, res) => {
    try {
      const pool = getDbPool();
      const result = await pool.query(
        `SELECT resolution_result, COUNT(*)::int AS count
         FROM entity_resolution_log
         GROUP BY resolution_result
         ORDER BY count DESC`
      );
      return res.json({ stats: result.rows });
    } catch (error: any) {
      logger.error('Agent ER stats failed', { error, correlation_id: req.correlationId });
      return res.status(500).json({ error: error.message });
    }
  });

  router.get('/provenance/:id', async (req: AgentRequest, res) => {
    try {
      const provenanceService = new ProvenanceService();
      const provenance = await provenanceService.getSignalProvenance(req.params.id);
      return res.json(provenance);
    } catch (error: any) {
      logger.error('Agent provenance failed', { error, correlation_id: req.correlationId });
      return res.status(500).json({ error: error.message });
    }
  });

  router.post('/query', async (req: AgentRequest, res) => {
    try {
      const parsed = querySchema.parse(req.body);
      const result = await queryEngine.answerQuery(parsed);
      return res.json(result);
    } catch (error: any) {
      logger.error('Agent query failed', { error, correlation_id: req.correlationId });
      return res.status(400).json({ error: error.message });
    }
  });

  router.get('/sources', async (req: AgentRequest, res) => {
    try {
      const type = typeof req.query.type === 'string' ? req.query.type : undefined;
      const status = typeof req.query.status === 'string' ? req.query.status : undefined;
      const sources = await sourceRegistry.listSources({
        type,
        status: status as any
      });
      return res.json({ sources });
    } catch (error: any) {
      logger.error('Agent source list failed', { error, correlation_id: req.correlationId });
      return res.status(500).json({ error: error.message });
    }
  });

  router.get('/sources/:id', async (req: AgentRequest, res) => {
    try {
      const source = await sourceRegistry.getSourceById(req.params.id);
      if (!source) {
        return res.status(404).json({ error: 'Source not found' });
      }
      return res.json({ source });
    } catch (error: any) {
      logger.error('Agent source fetch failed', { error, correlation_id: req.correlationId });
      return res.status(500).json({ error: error.message });
    }
  });

  router.post('/ingest', async (req: AgentRequest, res) => {
    if (!req.agent?.permissions?.write) {
      return res.status(403).json({ error: 'Write permission required' });
    }

    try {
      const parsed = ingestSchema.parse(req.body);
      const idempotencyKey =
        typeof req.headers['idempotency-key'] === 'string' ? req.headers['idempotency-key'] : null;
      if (idempotencyKey) {
        const pool = getDbPool();
        const existing = await pool.query(
          `SELECT id FROM signals
           WHERE metadata->>'idempotency_key' = $1
             AND metadata->>'source_agent_id' = $2
           LIMIT 1`,
          [idempotencyKey, req.agent?.id || '']
        );
        if (existing.rows[0]) {
          return res.status(200).json({ status: 'ok', signal_id: existing.rows[0].id, idempotent: true });
        }
      }

      const signal = normalizer.normalize({
        source: parsed.source,
        content: parsed.content,
        metadata: {
          ...parsed.metadata,
          source_agent_id: req.agent?.id,
          idempotency_key: idempotencyKey || undefined
        },
        timestamp: parsed.timestamp
      });
      await pipeline.ingest([signal]);
      return res.status(201).json({ status: 'ok', signal_id: signal.id, idempotent: false });
    } catch (error: any) {
      logger.error('Agent ingest failed', { error, correlation_id: req.correlationId });
      return res.status(400).json({ error: error.message });
    }
  });

  router.post('/sources', async (req: AgentRequest, res) => {
    if (!req.agent?.permissions?.write) {
      return res.status(403).json({ error: 'Write permission required' });
    }

    try {
      const parsed = sourceRegistrySchema.parse(req.body);
      const source = await sourceRegistry.registerSource(parsed);
      return res.status(201).json({ source });
    } catch (error: any) {
      logger.error('Agent source registration failed', { error, correlation_id: req.correlationId });
      return res.status(400).json({ error: error.message });
    }
  });

  router.patch('/sources/:id', async (req: AgentRequest, res) => {
    if (!req.agent?.permissions?.write) {
      return res.status(403).json({ error: 'Write permission required' });
    }

    try {
      const parsed = sourcePatchSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: 'Invalid request body', details: parsed.error.flatten() });
      }
      const { status, config } = parsed.data;
      const updated = await sourceRegistry.updateSource(req.params.id, {
        status: status as any,
        config
      });
      if (!updated) {
        return res.status(404).json({ error: 'Source not found' });
      }
      return res.json({ source: updated });
    } catch (error: any) {
      logger.error('Agent source update failed', { error, correlation_id: req.correlationId });
      return res.status(400).json({ error: error.message });
    }
  });

  router.post('/entities/propose', async (req: AgentRequest, res) => {
    if (!req.agent?.permissions?.write) {
      return res.status(403).json({ error: 'Write permission required' });
    }

    try {
      const parsed = proposeEntitySchema.parse(req.body);
      const pool = getDbPool();
      await pool.query(
        `INSERT INTO feedback_log
          (id, feedback_type, system_output, system_confidence, status, source_agent_id, agent_output_type)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6)`,
        [
          'agent_proposal_review',
          JSON.stringify(parsed),
          parsed.confidence || 0.5,
          'pending',
          req.agent?.id || null,
          'entity_proposal'
        ]
      );
      return res.status(202).json({ status: 'pending_review' });
    } catch (error: any) {
      logger.error('Agent entity proposal failed', { error, correlation_id: req.correlationId });
      return res.status(400).json({ error: error.message });
    }
  });

  router.post('/issues/flag', async (req: AgentRequest, res) => {
    if (!req.agent?.permissions?.write) {
      return res.status(403).json({ error: 'Write permission required' });
    }

    try {
      const parsed = flagIssueSchema.parse(req.body);
      const pool = getDbPool();
      await pool.query(
        `INSERT INTO feedback_log
          (id, feedback_type, system_output, system_confidence, status, source_agent_id, agent_output_type)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6)`,
        [
          'severity_correction',
          JSON.stringify(parsed),
          0.6,
          'pending',
          req.agent?.id || null,
          'issue_flag'
        ]
      );
      return res.status(202).json({ status: 'flagged' });
    } catch (error: any) {
      logger.error('Agent issue flag failed', { error, correlation_id: req.correlationId });
      return res.status(400).json({ error: error.message });
    }
  });

  router.post('/reports/generate', async (req: AgentRequest, res) => {
    if (!req.agent?.permissions?.write) {
      return res.status(403).json({ error: 'Write permission required' });
    }

    try {
      const parsed = reportSchema.parse(req.body);
      const report = await reportService.generateReport(parsed);
      return res.status(200).json({ report });
    } catch (error: any) {
      logger.error('Agent report generation failed', { error, correlation_id: req.correlationId });
      return res.status(400).json({ error: error.message });
    }
  });

  const streamHandler = createEventStreamHandler();
  router.get('/events/stream', streamHandler);
  router.get('/events/subscribe', streamHandler);

  router.get('/events/history', async (req: AgentRequest, res) => {
    if (!req.agent?.permissions?.events) {
      return res.status(403).json({ error: 'Events permission required' });
    }
    try {
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 50;
      const events = await eventBus.history(limit);
      return res.json({ events });
    } catch (error: any) {
      logger.error('Event history failed', { error, correlation_id: req.correlationId });
      return res.status(500).json({ error: error.message });
    }
  });

  router.post('/events/webhook', async (req: AgentRequest, res) => {
    if (!req.agent?.permissions?.events) {
      return res.status(403).json({ error: 'Events permission required' });
    }
    const webhookUrl = typeof req.body?.webhook_url === 'string' ? req.body.webhook_url : '';
    const subscriptions = Array.isArray(req.body?.event_subscriptions)
      ? req.body.event_subscriptions
      : [];
    if (!webhookUrl || !isPublicHttpsUrl(webhookUrl)) {
      return res.status(400).json({ error: 'webhook_url must be a public HTTPS URL' });
    }

    try {
      const pool = getDbPool();
      await pool.query(
        `UPDATE agent_registry
         SET webhook_url = $2, event_subscriptions = $3, updated_at = NOW()
         WHERE id = $1`,
        [req.agent?.id, webhookUrl, subscriptions]
      );
      return res.json({ status: 'registered', webhook_url: webhookUrl, event_subscriptions: subscriptions });
    } catch (error: any) {
      logger.error('Webhook registration failed', { error, correlation_id: req.correlationId });
      return res.status(500).json({ error: error.message });
    }
  });

  router.delete('/events/webhook/:id', async (req: AgentRequest, res) => {
    if (!req.agent?.permissions?.events) {
      return res.status(403).json({ error: 'Events permission required' });
    }
    try {
      const pool = getDbPool();
      await pool.query(
        `UPDATE agent_registry
         SET webhook_url = NULL, event_subscriptions = '{}', updated_at = NOW()
         WHERE id = $1`,
        [req.agent?.id]
      );
      return res.json({ status: 'unregistered' });
    } catch (error: any) {
      logger.error('Webhook unregister failed', { error, correlation_id: req.correlationId });
      return res.status(500).json({ error: error.message });
    }
  });

  router.delete('/events/webhook', async (req: AgentRequest, res) => {
    if (!req.agent?.permissions?.events) {
      return res.status(403).json({ error: 'Events permission required' });
    }
    try {
      const pool = getDbPool();
      await pool.query(
        `UPDATE agent_registry
         SET webhook_url = NULL, event_subscriptions = '{}', updated_at = NOW()
         WHERE id = $1`,
        [req.agent?.id]
      );
      return res.json({ status: 'unregistered' });
    } catch (error: any) {
      logger.error('Webhook unregister failed', { error, correlation_id: req.correlationId });
      return res.status(500).json({ error: error.message });
    }
  });

  return router;
}
