import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import multer from 'multer';
import path from 'path';
import { ingestSignal, RawSignal, getSignals, countSignals, SignalQueryOptions } from '../processing/signal_extractor';
import { detectAndStoreOpportunities, detectAndStoreOpportunitiesIncremental, getAllOpportunities, getOpportunities, countOpportunities, OpportunityQueryOptions, mergeRelatedOpportunities, getPrioritizedOpportunities, getQuickWinOpportunities, getStrategicOpportunities, getEmergingOpportunities, getHighConfidenceOpportunities, getRoadmapSummary, getSignalsForOpportunity } from '../services/opportunity_service';
import { createJudgment, getJudgmentsForOpportunity, createJudgmentFromData } from '../services/judgment_service';
import { createArtifact, createArtifactFromData, getArtifactsForJudgment } from '../services/artifact_service';
import { getAllSignals } from '../processing/signal_extractor';
import { getAdoptionMetrics } from '../services/metrics_service';
import { createSlackWebhookHandler } from '../integrations/slack_adapter';
import { createTeamsWebhookHandler } from '../integrations/teams_adapter';
import { createGrafanaWebhookHandler } from '../integrations/grafana_adapter';
import { createSplunkWebhookHandler } from '../integrations/splunk_adapter';
import { getFeatureUsageByCustomer, getFeatureBottlenecks } from '../services/slack_query_service';
import { getStrategicInsights } from '../services/slack_insight_service';
import { ingestSlackExtraction } from '../services/slack_llm_extraction_service';
import { logger } from '../utils/logger';
import { rateLimiters, createRateLimitMiddleware } from '../utils/rate_limiter';
import { requireAuth, requireAdmin, requirePermissions, logApiKeyUsage, AuthenticatedRequest } from '../middleware/auth_middleware';

// New service imports for enhanced PM Intelligence
import { registerChannel, getActiveChannels, getAllChannels, getChannelConfig, updateChannelConfig, deactivateChannel, activateChannel, getChannelsByCategory, autoRegisterChannel } from '../services/channel_registry_service';
import { computeSignalTrends, getEmergingThemes, getDecliningThemes, getStableHighVolumeThemes, getTrendSummary, getWeeklyTrendData, TrendEntityType } from '../services/trend_analysis_service';
import { classifySignalThemes, seedThemeHierarchy, getSignalThemeClassifications, getSignalsByTheme, getThemeStats } from '../services/theme_classifier_service';
import { getThemeHierarchy, getThemesAtLevel, getThemeById, getThemeBySlug, getThemePath, getThemeDescendants, getAllThemes } from '../config/theme_dictionary';
import { getEmbeddingStats, getSignalsWithoutEmbeddings, queueSignalForEmbedding, processEmbeddingQueue, getSignalEmbedding } from '../services/embedding_service';
import { hybridSearch, textSearch, vectorSearch, findSimilarSignals, searchByTheme, searchByCustomer, HybridSearchOptions } from '../services/hybrid_search_service';
import { createEmbeddingProviderFromEnv } from '../services/embedding_provider';
import { createAgentGatewayRouter } from '../agents/gateway';
import { createA2AServerRouter } from '../agents/a2a_server';
import { getSystemHealth } from '../services/health_service';
import healthRouter from './health';
import { correlationMiddleware } from '../utils/correlation';
import { config } from '../config/env';
import { NormalizerService } from '../ingestion/normalizer_service';
import { TranscriptAdapter } from '../ingestion/transcript_adapter';
import { DocumentAdapter } from '../ingestion/document_adapter';
import { WebScrapeAdapter } from '../ingestion/web_scrape_adapter';
import { IngestionPipelineService } from '../services/ingestion_pipeline_service';
import { validateFileUpload, sanitizeFilename, ALLOWED_MIME_TYPES, ALLOWED_EXTENSIONS } from '../services/file_validation_service';
import costRoutes from './cost_routes';
import adminCostRoutes from './admin_cost_routes';
import adminNeo4jRoutes from './admin_neo4j_routes';
import adminObservabilityRoutes from './admin_observability_routes';

const app = express();

// Security headers with Helmet.js
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"], // Allow inline scripts for compatibility
      styleSrc: ["'self'", "'unsafe-inline'"], // Allow inline styles
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"]
    }
  },
  hsts: {
    maxAge: 31536000, // 1 year in seconds
    includeSubDomains: true,
    preload: true
  },
  noSniff: true, // X-Content-Type-Options: nosniff
  xssFilter: true, // X-XSS-Protection (legacy browsers)
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' }
}));

// Enhanced multer configuration with file type validation
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const uploadDir = process.env.UPLOAD_DIR || '/tmp/uploads';
      cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
      // Sanitize filename and add timestamp
      const sanitized = sanitizeFilename(file.originalname);
      const timestamp = Date.now();
      const random = Math.random().toString(36).substring(7);
      const unique = `${timestamp}-${random}-${sanitized}`;
      cb(null, unique);
    }
  }),
  fileFilter: (req, file, cb) => {
    // Quick validation before upload
    const ext = path.extname(file.originalname).toLowerCase();
    const mimeType = file.mimetype.toLowerCase();

    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      return cb(new Error(`File extension ${ext} not allowed. Allowed: ${ALLOWED_EXTENSIONS.join(', ')}`));
    }

    if (!ALLOWED_MIME_TYPES.includes(mimeType)) {
      return cb(new Error(`MIME type ${mimeType} not allowed`));
    }

    cb(null, true);
  },
  limits: {
    fileSize: config.ingestion.maxFileSizeMb * 1024 * 1024,
    files: 1 // Only allow single file uploads for security
  }
});

// Request and response logging middleware
app.use((req, res, next) => {
  const startTime = Date.now();

  // Log request
  logger.info('API request', {
    method: req.method,
    path: req.path,
    ip: req.ip,
    user_agent: req.get('user-agent'),
    correlation_id: req.headers['x-correlation-id']
  });

  // Log response when finished
  res.on('finish', () => {
    const duration = Date.now() - startTime;
    const authReq = req as AuthenticatedRequest;

    logger.info('API response', {
      method: req.method,
      path: req.path,
      status: res.statusCode,
      duration_ms: duration,
      authenticated: !!authReq.apiKey,
      api_key_name: authReq.apiKey?.name,
      success: res.statusCode < 400
    });
  });

  next();
});

app.use(express.json({ limit: '10mb' }));

// Correlation ID middleware - must be early in the chain for request tracing
app.use(correlationMiddleware);

// CORS configuration - support multiple origins including Chat UI
const allowedOrigins = [
  'http://localhost:3001', // Chat UI development
  'http://localhost:3000', // Backend development
  ...(process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',') : [])
];

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (like mobile apps or curl requests)
      if (!origin) return callback(null, true);

      // In development, allow all origins
      if (process.env.NODE_ENV === 'development') {
        return callback(null, true);
      }

      // In production, check against allowlist
      if (allowedOrigins.indexOf(origin) !== -1 || process.env.CORS_ORIGIN === '*') {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    },
    credentials: true
  })
);

// Authentication middleware
// Apply to all /api/* routes except health endpoints
app.use('/api', (req: AuthenticatedRequest, res, next) => {
  // Skip authentication for health endpoints
  if (req.path === '/health' || req.path.startsWith('/health/')) {
    return next();
  }

  // Skip authentication in development if explicitly disabled
  if (process.env.DISABLE_AUTH === 'true' && process.env.NODE_ENV === 'development') {
    logger.warn('SECURITY: Authentication disabled for request', {
      security_event: 'auth_bypass',
      audit: true,
      environment: 'development',
      path: req.path,
      method: req.method,
      ip: req.ip,
      warning: 'This should NEVER appear in production logs'
    });
    return next();
  }

  // Apply authentication
  return requireAuth(req, res, next);
});

// API key usage logging (after auth, for authenticated requests only)
app.use('/api', logApiKeyUsage);

// Rate limiting middleware (disabled in dev when explicitly opted out)
const disableRateLimiting =
  process.env.DISABLE_RATE_LIMITING === 'true' ||
  process.env.NODE_ENV === 'development';

if (!disableRateLimiting) {
  app.use(createRateLimitMiddleware(rateLimiters.general));
}

// Error handling middleware
app.use((err: any, req: any, res: any, _next: any) => {
  logger.error('API error', {
    error: err.message,
    stack: err.stack,
    method: req.method,
    path: req.path
  });
  if (res.headersSent) {
    return;
  }
  res.status(500).json({
    error: 'Internal server error',
    request_id: req.headers['x-request-id']
  });
});

// Static UI (V2)
app.use('/ui', express.static(path.join(__dirname, '../../frontend')));

// OpenAPI specs for integrations (ChatGPT Actions)
app.use('/openapi', express.static(path.join(__dirname, '../../docs/v2/openapi')));

// Health check
// Health check endpoints (comprehensive monitoring)
// Mounted before authentication middleware for load balancer access
app.use('/health', healthRouter);

// Backward compatibility aliases - use simple redirects
app.get('/ready', async (req, res) => {
  return res.redirect(307, '/health/readiness');
});

app.get('/live', (req, res) => {
  return res.redirect(307, '/health/liveness');
});

// Aggregated system health (V2) - Keep for backward compatibility
app.get('/api/health', async (req, res) => {
  try {
    const health = await getSystemHealth();
    const criticalStatuses = [
      health.postgresql,
      health.redis,
      health.neo4j
    ];
    const degraded = criticalStatuses.some((status) => status !== 'healthy');
    res.status(degraded ? 503 : 200).json({
      status: degraded ? 'degraded' : 'ok',
      timestamp: new Date().toISOString(),
      ...health
    });
  } catch (error: any) {
    logger.error('System health endpoint failed', { error: error.message });
    res.status(500).json({ status: 'error', error: error.message });
  }
});

/**
 * POST /api/signals
 * Ingest a signal from external source
 * Rate limiting: Enforced for all requests
 * Authentication: Requires write:signals permission or admin role
 */
app.post('/api/signals', (req, res, next) => {
  // Apply rate limiting middleware (5000 requests/minute)
  const middleware = createRateLimitMiddleware(rateLimiters.signalIngestion);
  return middleware(req, res, next);
}, requirePermissions('write:signals'), async (req, res) => {
  try {
    logger.info('Signal ingestion request', { source: req.body.source });
    
    const rawSignal: RawSignal = {
      source: req.body.source,
      id: req.body.id,
      type: req.body.type,
      text: req.body.text || req.body.content,
      severity: req.body.severity,
      confidence: req.body.confidence,
      metadata: req.body.metadata
    };

    // Validate required fields
    if (!rawSignal.source || !rawSignal.text) {
      logger.warn('Signal ingestion failed: missing required fields', { body: req.body });
      return res.status(400).json({
        error: 'Missing required fields: source and text/content are required'
      });
    }

    const signal = await ingestSignal(rawSignal);
    logger.info('Signal ingested via API', { signalId: signal.id, source: signal.source });
    res.status(201).json(signal);
  } catch (error: any) {
    logger.error('Signal ingestion error', { error: error.message, stack: error.stack });
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/ingest/transcript
 * Ingest a transcript (manual upload)
 * Authentication: Requires admin role
 */
app.post('/api/ingest/transcript', requireAdmin, async (req, res) => {
  try {
    const { title, content, meeting_type, customer, date, metadata } = req.body || {};
    if (!title || !content) {
      return res.status(400).json({ error: 'title and content are required' });
    }
    const normalizer = new NormalizerService();
    const adapter = new TranscriptAdapter(normalizer);
    const pipeline = new IngestionPipelineService();
    const signals = adapter.ingest({ title, content, meeting_type, customer, date, metadata });
    await pipeline.ingest(signals);

    logger.info('Admin ingestion operation completed', {
      security_event: 'admin_operation',
      audit: true,
      operation: 'ingest_transcript',
      performed_by: (req as AuthenticatedRequest).apiKey?.name,
      performed_by_id: (req as AuthenticatedRequest).apiKey?.id,
      source_ref: title,
      signals_created: signals.length,
      ip: req.ip
    });

    return res.status(201).json({ status: 'ok', signal_count: signals.length });
  } catch (error: any) {
    logger.error('Transcript ingestion failed', { error: error.message });
    return res.status(400).json({ error: error.message });
  }
});

/**
 * POST /api/ingest/document
 * Ingest a document file (multipart/form-data)
 * Authentication: Requires admin role
 */
app.post('/api/ingest/document', requireAdmin, upload.single('file'), async (req, res) => {
  let uploadedFilePath: string | undefined;

  try {
    if (!req.file) {
      return res.status(400).json({ error: 'file is required' });
    }

    uploadedFilePath = req.file.path;

    // Additional security validation after upload
    logger.info('Validating uploaded file', {
      filename: req.file.originalname,
      mimetype: req.file.mimetype,
      size: req.file.size
    });

    const validationResult = await validateFileUpload(
      req.file.path,
      req.file.originalname,
      req.file.mimetype,
      config.ingestion.maxFileSizeMb
    );

    if (!validationResult.valid) {
      logger.warn('File upload validation failed', {
        filename: req.file.originalname,
        reason: validationResult.reason,
        details: validationResult
      });

      // Delete the uploaded file
      try {
        await require('fs').promises.unlink(req.file.path);
        logger.warn('File deleted after validation failure', {
          security_event: 'file_deleted',
          reason: validationResult.reason,
          filename: req.file.originalname,
          file_path: req.file.path,
          deleted_by: 'system'
        });
      } catch (unlinkError) {
        logger.error('Failed to delete invalid uploaded file', {
          path: req.file.path,
          error: unlinkError
        });
      }

      return res.status(400).json({
        error: 'File validation failed',
        reason: validationResult.reason
      });
    }

    logger.info('File upload validated successfully', {
      security_event: 'file_upload',
      audit: true,
      filename: req.file.originalname,
      detected_mime: validationResult.detectedMimeType,
      file_size_bytes: validationResult.fileSize,
      uploaded_by: (req as AuthenticatedRequest).apiKey?.name,
      uploaded_by_id: (req as AuthenticatedRequest).apiKey?.id,
      ip: req.ip
    });

    let metadata: Record<string, unknown> | undefined;
    if (req.body?.metadata) {
      try {
        metadata = JSON.parse(req.body.metadata);
      } catch {
        return res.status(400).json({ error: 'metadata must be valid JSON' });
      }
    }

    const normalizer = new NormalizerService();
    const adapter = new DocumentAdapter(normalizer);
    const pipeline = new IngestionPipelineService();
    const signals = await adapter.ingest({
      filename: req.file.originalname,
      buffer: req.file.buffer,
      metadata
    });
    await pipeline.ingest(signals);

    logger.info('Admin ingestion operation completed', {
      security_event: 'admin_operation',
      audit: true,
      operation: 'ingest_document',
      performed_by: (req as AuthenticatedRequest).apiKey?.name,
      performed_by_id: (req as AuthenticatedRequest).apiKey?.id,
      source_ref: req.file.originalname,
      signals_created: signals.length,
      ip: req.ip
    });

    // Clean up uploaded file after successful processing
    try {
      await require('fs').promises.unlink(req.file.path);
    } catch (unlinkError) {
      logger.warn('Failed to delete processed file', {
        path: req.file.path,
        error: unlinkError
      });
    }

    return res.status(201).json({
      status: 'ok',
      signal_count: signals.length,
      file_size: validationResult.fileSize,
      file_type: validationResult.detectedMimeType
    });
  } catch (error: any) {
    logger.error('Document ingestion failed', {
      error: error.message,
      stack: error.stack
    });

    // Clean up uploaded file on error
    if (uploadedFilePath) {
      try {
        await require('fs').promises.unlink(uploadedFilePath);
        logger.warn('File deleted after processing error', {
          security_event: 'file_deleted',
          reason: error.message,
          filename: req.file?.originalname,
          file_path: uploadedFilePath,
          deleted_by: 'system'
        });
      } catch (unlinkError) {
        logger.warn('Failed to delete file after error', {
          path: uploadedFilePath,
          error: unlinkError
        });
      }
    }

    return res.status(400).json({ error: error.message });
  }
});

/**
 * POST /api/ingest/crawled
 * Ingest crawled web content
 * Authentication: Requires admin role
 */
app.post('/api/ingest/crawled', requireAdmin, async (req, res) => {
  try {
    const { url, content, captured_at, metadata } = req.body || {};
    if (!url || !content) {
      return res.status(400).json({ error: 'url and content are required' });
    }
    const normalizer = new NormalizerService();
    const adapter = new WebScrapeAdapter(normalizer);
    const pipeline = new IngestionPipelineService();
    const signals = adapter.ingest({ url, content, captured_at, metadata });
    await pipeline.ingest(signals);

    logger.info('Admin ingestion operation completed', {
      security_event: 'admin_operation',
      audit: true,
      operation: 'ingest_crawled_content',
      performed_by: (req as AuthenticatedRequest).apiKey?.name,
      performed_by_id: (req as AuthenticatedRequest).apiKey?.id,
      source_ref: url,
      signals_created: 1,
      ip: req.ip
    });

    return res.status(201).json({ status: 'ok', signal_count: 1 });
  } catch (error: any) {
    logger.error('Web crawl ingestion failed', { error: error.message });
    return res.status(400).json({ error: error.message });
  }
});

/**
 * GET /api/signals
 * List signals with filtering and pagination
 * Query params: source, signalType, customer, topic, startDate, endDate, minQualityScore, limit, offset, orderBy, orderDirection
 */
app.get('/api/signals', async (req, res) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 100;
    if (Number.isNaN(limit) || limit < 1 || limit > 1000) {
      return res.status(400).json({ error: 'limit must be between 1 and 1000' });
    }
    const offset = req.query.offset ? parseInt(req.query.offset as string, 10) : 0;
    if (Number.isNaN(offset) || offset < 0) {
      return res.status(400).json({ error: 'offset must be 0 or greater' });
    }
    const orderBy = req.query.orderBy as string | undefined;
    if (orderBy && !['created_at', 'quality_score', 'severity'].includes(orderBy)) {
      return res.status(400).json({ error: 'orderBy must be created_at, quality_score, or severity' });
    }
    const orderDirection = req.query.orderDirection as string | undefined;
    if (orderDirection && !['ASC', 'DESC'].includes(orderDirection)) {
      return res.status(400).json({ error: 'orderDirection must be ASC or DESC' });
    }

    const minQualityScore = req.query.minQualityScore
      ? parseInt(req.query.minQualityScore as string, 10)
      : undefined;
    if (req.query.minQualityScore && Number.isNaN(minQualityScore)) {
      return res.status(400).json({ error: 'minQualityScore must be a number' });
    }

    const options: SignalQueryOptions = {
      source: req.query.source as string | undefined,
      signalType: req.query.signalType as string | undefined,
      customer: req.query.customer as string | undefined,
      topic: req.query.topic as string | undefined,
      startDate: req.query.startDate ? new Date(req.query.startDate as string) : undefined,
      endDate: req.query.endDate ? new Date(req.query.endDate as string) : undefined,
      minQualityScore,
      limit,
      offset,
      orderBy: (orderBy as 'created_at' | 'quality_score' | 'severity') || 'created_at',
      orderDirection: (orderDirection as 'ASC' | 'DESC') || 'DESC'
    };
    
    const [signals, total] = await Promise.all([
      getSignals(options),
      countSignals(options)
    ]);
    
    res.json({
      signals,
      pagination: {
        total,
        limit: options.limit,
        offset: options.offset,
        hasMore: (options.offset || 0) + signals.length < total
      }
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/opportunities/detect
 * Detect opportunities from existing signals (full re-clustering)
 */
app.post('/api/opportunities/detect', createRateLimitMiddleware(rateLimiters.opportunityDetection), async (req, res) => {
  try {
    const signals = await getAllSignals();
    const opportunities = await detectAndStoreOpportunities(signals);
    res.json(opportunities);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/opportunities/detect/incremental
 * Incremental opportunity detection (only processes new signals)
 */
app.post('/api/opportunities/detect/incremental', createRateLimitMiddleware(rateLimiters.opportunityDetection), async (req, res) => {
  try {
    const result = await detectAndStoreOpportunitiesIncremental();
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/opportunities/merge
 * Merge related opportunities
 */
app.post('/api/opportunities/merge', createRateLimitMiddleware(rateLimiters.opportunityDetection), async (req, res) => {
  try {
    const similarityThreshold = req.body.similarityThreshold || 0.3;
    const mergeCount = await mergeRelatedOpportunities(similarityThreshold);
    res.json({ merged: mergeCount });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/opportunities/:opportunityId/signals
 * Get signals for a specific opportunity
 */
app.get('/api/opportunities/:opportunityId/signals', async (req, res) => {
  try {
    const { getSignalsForOpportunity } = require('../services/opportunity_service');
    const signals = await getSignalsForOpportunity(req.params.opportunityId);
    res.json(signals);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/opportunities
 * List opportunities with filtering and pagination
 * Query params: status, startDate, endDate, limit, offset, orderBy, orderDirection
 */
app.get('/api/opportunities', async (req, res) => {
  try {
    const options: OpportunityQueryOptions = {
      status: req.query.status as string | undefined,
      startDate: req.query.startDate ? new Date(req.query.startDate as string) : undefined,
      endDate: req.query.endDate ? new Date(req.query.endDate as string) : undefined,
      limit: req.query.limit ? parseInt(req.query.limit as string, 10) : 100,
      offset: req.query.offset ? parseInt(req.query.offset as string, 10) : 0,
      orderBy: (req.query.orderBy as 'created_at' | 'title') || 'created_at',
      orderDirection: (req.query.orderDirection as 'ASC' | 'DESC') || 'DESC'
    };
    
    const [opportunities, total] = await Promise.all([
      getOpportunities(options),
      countOpportunities(options)
    ]);
    
    res.json({
      opportunities,
      pagination: {
        total,
        limit: options.limit,
        offset: options.offset,
        hasMore: (options.offset || 0) + opportunities.length < total
      }
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/judgments
 * Create a judgment (extension provides LLM-generated content)
 */
app.post('/api/judgments', async (req, res) => {
  try {
    const { opportunityId, userId, analysis, recommendation, confidence, reasoning } = req.body;
    
    if (!opportunityId || !userId || !analysis || !recommendation || confidence === undefined) {
      return res.status(400).json({
        error: 'Missing required fields: opportunityId, userId, analysis, recommendation, confidence'
      });
    }

    // Dynamic import to ensure function is available
    const judgmentModule = await import('../services/judgment_service');
    const createJudgmentFromDataFunc = judgmentModule.createJudgmentFromData;
    
    if (!createJudgmentFromDataFunc || typeof createJudgmentFromDataFunc !== 'function') {
      logger.error('createJudgmentFromData not available', {
        availableExports: Object.keys(judgmentModule),
        type: typeof createJudgmentFromDataFunc
      });
      return res.status(500).json({ 
        error: 'Judgment creation function not available. Available exports: ' + Object.keys(judgmentModule).join(', ')
      });
    }
    
    // Create judgment with provided data (LLM content comes from extension)
    const judgment = await createJudgmentFromDataFunc({
      opportunityId,
      userId,
      analysis,
      recommendation,
      confidence,
      reasoning
    });

    res.status(201).json(judgment);
  } catch (error: any) {
    logger.error('Judgment creation error', { error: error.message, stack: error.stack });
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/judgments/:opportunityId
 * Get judgments for an opportunity
 */
app.get('/api/judgments/:opportunityId', async (req, res) => {
  try {
    const judgments = await getJudgmentsForOpportunity(req.params.opportunityId);
    res.json(judgments);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/artifacts
 * Create an artifact (extension provides content)
 */
app.post('/api/artifacts', async (req, res) => {
  try {
    const { judgmentId, type, content } = req.body;
    if (!judgmentId || !type || !content) {
      return res.status(400).json({
        error: 'Missing required fields: judgmentId, type, content'
      });
    }

    const artifact = await createArtifactFromData({
      judgmentId,
      artifactType: type,
      content
    });

    res.status(201).json(artifact);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/artifacts/:judgmentId
 * Get artifacts for a judgment
 */
app.get('/api/artifacts/:judgmentId', async (req, res) => {
  try {
    const artifacts = await getArtifactsForJudgment(req.params.judgmentId);
    res.json(artifacts);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/metrics
 * Get adoption metrics
 */
app.get('/api/metrics', async (req, res) => {
  try {
    const metrics = await getAdoptionMetrics();
    res.json(metrics);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/slack/features/usage
 * Query params: feature (required), limit
 */
app.get('/api/slack/features/usage', async (req, res) => {
  try {
    const feature = (req.query.feature as string | undefined)?.trim();
    if (!feature) {
      return res.status(400).json({ error: 'feature query param is required' });
    }
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 50;
    const results = await getFeatureUsageByCustomer(feature, limit);
    res.json({ feature, results });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/slack/features/bottlenecks
 * Query params: feature (required), limit
 */
app.get('/api/slack/features/bottlenecks', async (req, res) => {
  try {
    const feature = (req.query.feature as string | undefined)?.trim();
    if (!feature) {
      return res.status(400).json({ error: 'feature query param is required' });
    }
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 20;
    const results = await getFeatureBottlenecks(feature, limit);
    res.json({ feature, results });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/slack/insights/strategic
 * Query params: limit, lookbackDays
 */
app.get('/api/slack/insights/strategic', async (req, res) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 20;
    const lookbackDays = req.query.lookbackDays ? parseInt(req.query.lookbackDays as string, 10) : 180;
    const results = await getStrategicInsights({ limit, lookbackDays });
    res.json({ results });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/slack/extractions
 * Ingest LLM-assisted extraction results for a Slack signal.
 */
app.post('/api/slack/extractions', async (req, res) => {
  try {
    const signalId = req.body.signal_id || req.body.signalId;
    const extraction = req.body.extraction;
    const source = req.body.source || 'llm';
    const model = req.body.model || null;

    if (!signalId || !extraction) {
      return res.status(400).json({ error: 'signal_id and extraction are required' });
    }

    await ingestSlackExtraction(signalId, extraction, source, model);
    res.status(201).json({ status: 'ok' });
  } catch (error: any) {
    logger.error('Slack extraction ingestion error', { error: error.message, stack: error.stack });
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// CHANNEL REGISTRY ENDPOINTS
// ============================================================================

/**
 * GET /api/channels
 * List all registered channels
 * Query params: active (boolean), category
 */
app.get('/api/channels', async (req, res) => {
  try {
    const activeOnly = req.query.active === 'true';
    const category = req.query.category as string | undefined;
    
    let channels;
    if (category) {
      channels = await getChannelsByCategory(category as any);
    } else if (activeOnly) {
      channels = await getActiveChannels();
    } else {
      channels = await getAllChannels();
    }
    
    res.json({ channels });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/channels
 * Register a new channel
 */
app.post('/api/channels', async (req, res) => {
  try {
    const { channelId, channelName, category, weight, isActive, workspaceId, description, metadata } = req.body;
    
    if (!channelId || !channelName) {
      return res.status(400).json({ error: 'channelId and channelName are required' });
    }
    
    const id = await registerChannel({
      channelId,
      channelName,
      category: category || 'general',
      weight: weight || 1.0,
      isActive: isActive !== false,
      workspaceId,
      description,
      metadata
    });
    
    res.status(201).json({ id, channelId });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/channels/auto-register
 * Auto-register a channel with category inference
 */
app.post('/api/channels/auto-register', async (req, res) => {
  try {
    const { channelId, channelName } = req.body;
    
    if (!channelId || !channelName) {
      return res.status(400).json({ error: 'channelId and channelName are required' });
    }
    
    const config = await autoRegisterChannel(channelId, channelName);
    res.status(201).json(config);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/channels/:channelId
 * Get channel configuration
 */
app.get('/api/channels/:channelId', async (req, res) => {
  try {
    const config = await getChannelConfig(req.params.channelId);
    if (!config) {
      return res.status(404).json({ error: 'Channel not found' });
    }
    res.json(config);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * PATCH /api/channels/:channelId
 * Update channel configuration
 */
app.patch('/api/channels/:channelId', async (req, res) => {
  try {
    const { category, weight, description, metadata } = req.body;
    await updateChannelConfig(req.params.channelId, { category, weight, description, metadata });
    const updated = await getChannelConfig(req.params.channelId);
    res.json(updated);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/channels/:channelId/deactivate
 * Deactivate a channel
 */
app.post('/api/channels/:channelId/deactivate', async (req, res) => {
  try {
    await deactivateChannel(req.params.channelId);
    res.json({ status: 'deactivated' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/channels/:channelId/activate
 * Activate a channel
 */
app.post('/api/channels/:channelId/activate', async (req, res) => {
  try {
    await activateChannel(req.params.channelId);
    res.json({ status: 'activated' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// TREND ANALYSIS ENDPOINTS
// ============================================================================

/**
 * GET /api/trends
 * Get signal trends for entities
 * Query params: entityType (theme|feature|customer|issue), lookbackDays, minSignals
 */
app.get('/api/trends', async (req, res) => {
  try {
    const entityType = (req.query.entityType as TrendEntityType) || 'theme';
    const lookbackDays = req.query.lookbackDays ? parseInt(req.query.lookbackDays as string, 10) : 90;
    const minSignals = req.query.minSignals ? parseInt(req.query.minSignals as string, 10) : 2;
    
    const trends = await computeSignalTrends({
      entityType,
      lookbackDays,
      minSignals,
      includeInactive: req.query.includeInactive === 'true'
    });
    
    res.json({ entityType, trends });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/trends/summary
 * Get trend summary for dashboard
 */
app.get('/api/trends/summary', async (req, res) => {
  try {
    const summary = await getTrendSummary();
    res.json(summary);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/trends/emerging
 * Get emerging themes
 */
app.get('/api/trends/emerging', async (req, res) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 10;
    const emerging = await getEmergingThemes(limit);
    res.json({ emerging });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/trends/declining
 * Get declining themes
 */
app.get('/api/trends/declining', async (req, res) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 10;
    const declining = await getDecliningThemes(limit);
    res.json({ declining });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/trends/stable
 * Get stable high-volume themes
 */
app.get('/api/trends/stable', async (req, res) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 10;
    const stable = await getStableHighVolumeThemes(limit);
    res.json({ stable });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/trends/weekly/:entityType/:entityId
 * Get weekly trend data for charting
 */
app.get('/api/trends/weekly/:entityType/:entityId', async (req, res) => {
  try {
    const { entityType, entityId } = req.params;
    const weeks = req.query.weeks ? parseInt(req.query.weeks as string, 10) : 12;
    
    const data = await getWeeklyTrendData(entityType as TrendEntityType, entityId, weeks);
    res.json({ entityType, entityId, data });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// THEME HIERARCHY ENDPOINTS
// ============================================================================

/**
 * GET /api/themes
 * Get theme hierarchy
 * Query params: level (1-4), flat (boolean)
 */
app.get('/api/themes', async (req, res) => {
  try {
    const level = req.query.level ? parseInt(req.query.level as string, 10) : undefined;
    const flat = req.query.flat === 'true';
    
    if (flat) {
      const themes = getAllThemes();
      res.json({ themes });
    } else if (level) {
      const themes = getThemesAtLevel(level as 1 | 2 | 3 | 4);
      res.json({ level, themes });
    } else {
      const hierarchy = getThemeHierarchy();
      res.json({ hierarchy });
    }
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/themes/seed
 * Seed theme hierarchy to database
 */
app.post('/api/themes/seed', async (req, res) => {
  try {
    const result = await seedThemeHierarchy();
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/themes/:themeId
 * Get theme by ID
 */
app.get('/api/themes/:themeId', async (req, res) => {
  try {
    const theme = getThemeById(req.params.themeId);
    if (!theme) {
      return res.status(404).json({ error: 'Theme not found' });
    }
    res.json(theme);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/themes/slug/:slug
 * Get theme by slug
 */
app.get('/api/themes/slug/:slug', async (req, res) => {
  try {
    const theme = getThemeBySlug(req.params.slug);
    if (!theme) {
      return res.status(404).json({ error: 'Theme not found' });
    }
    res.json(theme);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/themes/:themeId/path
 * Get path from root to theme
 */
app.get('/api/themes/:themeId/path', async (req, res) => {
  try {
    const path = getThemePath(req.params.themeId);
    res.json({ path });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/themes/:themeId/descendants
 * Get all descendants of a theme
 */
app.get('/api/themes/:themeId/descendants', async (req, res) => {
  try {
    const descendants = getThemeDescendants(req.params.themeId);
    res.json({ descendants });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/themes/:themeId/signals
 * Get signals classified under a theme
 */
app.get('/api/themes/:themeId/signals', async (req, res) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 50;
    const includeDescendants = req.query.includeDescendants !== 'false';
    
    const signals = await getSignalsByTheme(req.params.themeId, {
      limit,
      includeDescendants
    });
    res.json({ themeId: req.params.themeId, signals });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/themes/:themeId/stats
 * Get statistics for a theme
 */
app.get('/api/themes/:themeId/stats', async (req, res) => {
  try {
    const stats = await getThemeStats(req.params.themeId);
    res.json(stats);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/signals/:signalId/classify
 * Classify a signal into themes
 */
app.post('/api/signals/:signalId/classify', async (req, res) => {
  try {
    const { getDbPool } = require('../db/connection');
    const pool = getDbPool();
    const result = await pool.query('SELECT * FROM signals WHERE id = $1', [req.params.signalId]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Signal not found' });
    }
    
    const signal = {
      ...result.rows[0],
      metadata: result.rows[0].metadata || {},
      created_at: new Date(result.rows[0].created_at)
    };
    
    const classifications = await classifySignalThemes(signal);
    res.json({ signalId: req.params.signalId, classifications });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/signals/:signalId/themes
 * Get theme classifications for a signal
 */
app.get('/api/signals/:signalId/themes', async (req, res) => {
  try {
    const classifications = await getSignalThemeClassifications(req.params.signalId);
    res.json({ signalId: req.params.signalId, classifications });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// ROADMAP PRIORITIZATION ENDPOINTS
// ============================================================================

/**
 * GET /api/roadmap/summary
 * Get roadmap summary for dashboard
 */
app.get('/api/roadmap/summary', async (req, res) => {
  try {
    const priorities = req.query.priorities 
      ? (req.query.priorities as string).split(',') 
      : [];
    
    const summary = await getRoadmapSummary({ strategicPriorities: priorities });
    res.json(summary);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/roadmap/priorities
 * Get prioritized opportunities
 */
app.get('/api/roadmap/priorities', async (req, res) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 20;
    const priorities = req.query.strategicPriorities 
      ? (req.query.strategicPriorities as string).split(',') 
      : [];
    
    const opportunities = await getPrioritizedOpportunities({ strategicPriorities: priorities }, limit);
    res.json({ opportunities });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/roadmap/quick-wins
 * Get quick-win opportunities (high impact, low effort)
 */
app.get('/api/roadmap/quick-wins', async (req, res) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 10;
    const opportunities = await getQuickWinOpportunities(limit);
    res.json({ opportunities });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/roadmap/strategic
 * Get strategic opportunities aligned with priorities
 */
app.get('/api/roadmap/strategic', async (req, res) => {
  try {
    const priorities = req.query.priorities 
      ? (req.query.priorities as string).split(',') 
      : [];
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 10;
    
    if (priorities.length === 0) {
      return res.status(400).json({ error: 'priorities query param is required (comma-separated)' });
    }
    
    const opportunities = await getStrategicOpportunities(priorities, limit);
    res.json({ priorities, opportunities });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/roadmap/emerging
 * Get emerging opportunities (trending up)
 */
app.get('/api/roadmap/emerging', async (req, res) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 10;
    const opportunities = await getEmergingOpportunities(limit);
    res.json({ opportunities });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/roadmap/high-confidence
 * Get high-confidence opportunities
 */
app.get('/api/roadmap/high-confidence', async (req, res) => {
  try {
    const minConfidence = req.query.minConfidence ? parseInt(req.query.minConfidence as string, 10) : 70;
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 10;
    
    const opportunities = await getHighConfidenceOpportunities(minConfidence, limit);
    res.json({ minConfidence, opportunities });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// EMBEDDING ENDPOINTS
// ============================================================================

/**
 * GET /api/embeddings/stats
 * Get embedding statistics
 */
app.get('/api/embeddings/stats', async (req, res) => {
  try {
    const stats = await getEmbeddingStats();
    res.json(stats);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/embeddings/pending
 * Get signals that need embeddings
 */
app.get('/api/embeddings/pending', async (req, res) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 100;
    const signals = await getSignalsWithoutEmbeddings(limit);
    res.json({ count: signals.length, signals });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/embeddings/queue/:signalId
 * Queue a signal for embedding
 */
app.post('/api/embeddings/queue/:signalId', async (req, res) => {
  try {
    await queueSignalForEmbedding(req.params.signalId);
    res.json({ status: 'queued', signalId: req.params.signalId });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/embeddings/process
 * Process embedding queue (requires LLM and embedding providers configured)
 */
app.post('/api/embeddings/process', async (req, res) => {
  try {
    const batchSize = req.body.batchSize || 10;
    
    // Check if providers are configured
    const llmProvider = req.body.llmProvider; // Would come from configured provider
    const embeddingProvider = req.body.embeddingProvider; // Would come from configured provider
    
    if (!llmProvider || !embeddingProvider) {
      return res.status(400).json({ 
        error: 'LLM and embedding providers must be configured. Set LLM_PROVIDER and EMBEDDING_PROVIDER environment variables.' 
      });
    }
    
    const result = await processEmbeddingQueue(llmProvider, embeddingProvider, batchSize);
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/signals/:signalId/embedding
 * Get embedding for a signal
 */
app.get('/api/signals/:signalId/embedding', async (req, res) => {
  try {
    const embedding = await getSignalEmbedding(req.params.signalId);
    if (!embedding) {
      return res.status(404).json({ error: 'Embedding not found for signal' });
    }
    res.json(embedding);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// HYBRID SEARCH ENDPOINTS
// ============================================================================

/**
 * POST /api/search
 * Hybrid search (vector + full-text)
 */
app.post('/api/search', async (req, res) => {
  try {
    const { query, limit, vectorWeight, textWeight, minScore, filters } = req.body;
    
    if (!query) {
      return res.status(400).json({ error: 'query is required' });
    }
    
    // Try to get embedding provider from environment
    let embeddingProvider;
    try {
      embeddingProvider = createEmbeddingProviderFromEnv();
    } catch (e) {
      // Fall back to text-only search if no embedding provider
      logger.info('No embedding provider configured, using text-only search');
    }
    
    const options: HybridSearchOptions = {
      query,
      limit: limit || 20,
      vectorWeight: vectorWeight || 0.5,
      textWeight: textWeight || 0.5,
      minScore: minScore || 0.1,
      filters
    };
    
    if (!embeddingProvider) {
      const results = await textSearch(query, { limit: options.limit, filters });
      return res.json({ query, results });
    }

    const results = await hybridSearch(options, embeddingProvider);
    res.json({ query, results });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/search/text
 * Full-text search only
 */
app.get('/api/search/text', async (req, res) => {
  try {
    const query = req.query.q as string;
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 20;
    
    if (!query) {
      return res.status(400).json({ error: 'q query param is required' });
    }
    
    const results = await textSearch(query, { limit });
    res.json({ query, results });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/search/similar/:signalId
 * Find signals similar to a given signal
 */
app.get('/api/search/similar/:signalId', async (req, res) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 10;
    let embeddingProvider;
    try {
      embeddingProvider = createEmbeddingProviderFromEnv();
    } catch (e) {
      return res.status(400).json({ error: 'Embedding provider not configured' });
    }

    const similar = await findSimilarSignals(req.params.signalId, embeddingProvider, { limit });
    res.json({ signalId: req.params.signalId, similar });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/search/theme/:theme
 * Search signals by theme
 */
app.get('/api/search/theme/:theme', async (req, res) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 20;
    let embeddingProvider;
    try {
      embeddingProvider = createEmbeddingProviderFromEnv();
    } catch (e) {
      return res.status(400).json({ error: 'Embedding provider not configured' });
    }

    const signals = await searchByTheme(req.params.theme, embeddingProvider, { limit });
    res.json({ theme: req.params.theme, signals });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/search/customer/:customer
 * Search signals by customer
 */
app.get('/api/search/customer/:customer', async (req, res) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 20;
    let embeddingProvider;
    try {
      embeddingProvider = createEmbeddingProviderFromEnv();
    } catch (e) {
      return res.status(400).json({ error: 'Embedding provider not configured' });
    }

    const signals = await searchByCustomer(req.params.customer, embeddingProvider, { limit });
    res.json({ customer: req.params.customer, signals });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// JIRA ISSUE GENERATION ENDPOINTS
// ============================================================================

import { 
  generateJiraIssue,
  generateJiraIssuesForTopOpportunities,
  generateJiraIssuesFromExtractions,
  storeJiraIssueTemplate,
  getStoredJiraTemplates,
  exportJiraTemplatesToJson,
  JiraIssueTemplate
} from '../services/jira_issue_service';

/**
 * POST /api/jira/generate
 * Generate JIRA issues for top opportunities
 */
app.post('/api/jira/generate', async (req, res) => {
  try {
    const { limit = 10, config } = req.body;
    
    logger.info('Generating JIRA issues', { limit });
    
    const issues = await generateJiraIssuesForTopOpportunities(limit, config || {});
    
    // Store generated templates
    for (const issue of issues) {
      await storeJiraIssueTemplate(issue);
    }
    
    res.json({
      success: true,
      count: issues.length,
      issues: issues.map(i => ({
        summary: i.summary,
        issueType: i.issueType,
        priority: i.priority,
        area: i.area,
        customerImpact: i.customerImpact,
        estimatedComplexity: i.estimatedComplexity,
        uniqueCustomers: i.uniqueCustomers,
        evidenceCount: i.evidenceCount,
        labels: i.labels,
        components: i.components,
        affectedCustomers: i.affectedCustomers,
        sourceOpportunityId: i.sourceOpportunityId,
        confidenceScore: i.confidenceScore
      }))
    });
  } catch (error: any) {
    logger.error('JIRA generation failed', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/jira/generate/opportunity/:id
 * Generate JIRA issue for a specific opportunity
 */
app.post('/api/jira/generate/opportunity/:id', async (req, res) => {
  try {
    const opportunityId = req.params.id;
    const { config } = req.body;
    
    // Get opportunity and signals
    const { getDbPool } = require('../db/connection');
    const pool = getDbPool();
    
    const oppResult = await pool.query('SELECT * FROM opportunities WHERE id = $1', [opportunityId]);
    if (oppResult.rows.length === 0) {
      return res.status(404).json({ error: 'Opportunity not found' });
    }
    
    const signals = await getSignalsForOpportunity(opportunityId);
    
    const issue = await generateJiraIssue(oppResult.rows[0], signals, config || {});
    await storeJiraIssueTemplate(issue);
    
    res.json({
      success: true,
      issue
    });
  } catch (error: any) {
    logger.error('JIRA generation failed', { error: error.message, opportunityId: req.params.id });
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/jira/generate/from-extractions
 * Generate JIRA issues from LLM extractions
 */
app.post('/api/jira/generate/from-extractions', async (req, res) => {
  try {
    const { minSignals = 3, limit = 10 } = req.body;
    
    logger.info('Generating JIRA issues from extractions', { minSignals, limit });
    
    const issues = await generateJiraIssuesFromExtractions(minSignals, limit);
    
    // Store generated templates
    for (const issue of issues) {
      await storeJiraIssueTemplate(issue);
    }
    
    res.json({
      success: true,
      count: issues.length,
      issues
    });
  } catch (error: any) {
    logger.error('JIRA generation from extractions failed', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/jira/templates
 * Get all stored JIRA issue templates
 */
app.get('/api/jira/templates', async (req, res) => {
  try {
    const templates = await getStoredJiraTemplates();
    res.json({ count: templates.length, templates });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/jira/templates/export
 * Export JIRA templates as JSON for import
 */
app.get('/api/jira/templates/export', async (req, res) => {
  try {
    const templates = await getStoredJiraTemplates();
    const exportJson = exportJiraTemplatesToJson(templates);
    
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="jira_issues_${new Date().toISOString().split('T')[0]}.json"`);
    res.send(exportJson);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/jira/stats
 * Get JIRA generation statistics
 */
app.get('/api/jira/stats', async (req, res) => {
  try {
    const { getDbPool } = require('../db/connection');
    const pool = getDbPool();
    
    // Check if table exists
    const tableCheck = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'jira_issue_templates'
      )
    `);
    
    if (!tableCheck.rows[0].exists) {
      return res.json({
        totalTemplates: 0,
        byType: {},
        byPriority: {},
        avgConfidence: 0,
        exported: 0
      });
    }
    
    const [total, byType, byPriority, avgConf, exported] = await Promise.all([
      pool.query('SELECT COUNT(*) as count FROM jira_issue_templates'),
      pool.query(`
        SELECT issue_type, COUNT(*) as count 
        FROM jira_issue_templates 
        GROUP BY issue_type
      `),
      pool.query(`
        SELECT priority, COUNT(*) as count 
        FROM jira_issue_templates 
        GROUP BY priority
      `),
      pool.query('SELECT AVG(confidence_score) as avg FROM jira_issue_templates'),
      pool.query('SELECT COUNT(*) as count FROM jira_issue_templates WHERE exported_at IS NOT NULL')
    ]);
    
    res.json({
      totalTemplates: parseInt(total.rows[0].count),
      byType: Object.fromEntries(byType.rows.map((r: { issue_type: string; count: string }) => [r.issue_type, parseInt(r.count)])),
      byPriority: Object.fromEntries(byPriority.rows.map((r: { priority: string; count: string }) => [r.priority, parseInt(r.count)])),
      avgConfidence: parseFloat(avgConf.rows[0].avg || 0),
      exported: parseInt(exported.rows[0].count)
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// EMBEDDING-BASED CLUSTERING ENDPOINTS
// ============================================================================

import {
  detectAndStoreOpportunitiesWithEmbeddings,
  getSemanticClustersSummary,
  findSimilarSignalsByEmbedding
} from '../services/opportunity_service';

/**
 * POST /api/opportunities/detect-semantic
 * Detect opportunities using embedding-based semantic clustering
 */
app.post('/api/opportunities/detect-semantic', async (req, res) => {
  try {
    const { similarityThreshold = 0.7, minClusterSize = 2 } = req.body;
    
    logger.info('Running embedding-based opportunity detection', { similarityThreshold, minClusterSize });
    
    const result = await detectAndStoreOpportunitiesWithEmbeddings({
      similarityThreshold,
      minClusterSize,
      useHybrid: true
    });
    
    res.json({
      success: true,
      newOpportunities: result.newOpportunities.length,
      signalsProcessed: result.signalsProcessed,
      opportunities: result.newOpportunities.map(o => ({
        id: o.id,
        title: o.title,
        status: o.status
      }))
    });
  } catch (error: any) {
    logger.error('Semantic opportunity detection failed', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/opportunities/clusters
 * Get semantic clusters summary
 */
app.get('/api/opportunities/clusters', async (req, res) => {
  try {
    const summary = await getSemanticClustersSummary();
    res.json(summary);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/signals/:id/similar-semantic
 * Find semantically similar signals using embeddings
 */
app.get('/api/signals/:id/similar-semantic', async (req, res) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 10;
    const minSimilarity = req.query.minSimilarity ? parseFloat(req.query.minSimilarity as string) : 0.7;
    
    const similar = await findSimilarSignalsByEmbedding(req.params.id, limit, minSimilarity);
    
    res.json({
      signalId: req.params.id,
      count: similar.length,
      similar
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Webhook endpoints for signal sources (with rate limiting)
app.post('/webhooks/slack', createRateLimitMiddleware(rateLimiters.webhooks), createSlackWebhookHandler());
app.post('/webhooks/teams', createRateLimitMiddleware(rateLimiters.webhooks), createTeamsWebhookHandler());
app.post('/webhooks/grafana', createRateLimitMiddleware(rateLimiters.webhooks), createGrafanaWebhookHandler());
app.post('/webhooks/splunk', createRateLimitMiddleware(rateLimiters.webhooks), createSplunkWebhookHandler());

// Cost Tracking & Monitoring API
app.use('/api/cost', costRoutes);
app.use('/api/admin', requireAdmin, adminCostRoutes);

// Neo4j Admin API
app.use('/api/admin', requireAdmin, adminNeo4jRoutes);

// Observability & Monitoring API
app.use('/api/admin', requireAdmin, adminObservabilityRoutes);

// Agent Gateway (V2)
if (config.featureFlags.agentGateway) {
  app.use('/api/agents/v1', createAgentGatewayRouter());
} else {
  logger.info('Agent Gateway disabled via feature flag');
}
// A2A Server (V2)
if (config.featureFlags.a2aServer) {
  app.use('/', createA2AServerRouter());
} else {
  logger.info('A2A Server disabled via feature flag');
}

export default app;
