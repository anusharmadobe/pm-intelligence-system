/**
 * Admin Observability API Routes
 *
 * Provides endpoints for monitoring dashboards and observability data (admin only)
 */

import { Router, Request, Response } from 'express';
import {
  getSystemHealth,
  getModuleHealth,
  getSLAMetrics,
  getPerformanceTrends,
  getTopSlowOperations,
  getAlertConditions,
  exportPrometheusMetrics
} from '../utils/monitoring';
import {
  getPerformanceMetrics,
  getPerformanceStats,
  getSlowOperations
} from '../utils/performance_metrics';
import {
  getAggregatedErrors,
  getErrorOccurrences,
  getErrorStats,
  getErrorTrend,
  resolveError
} from '../utils/error_aggregation';
import {
  getTraceSpans,
  getTraceTree,
  getSlowTraces,
  getTraceStats
} from '../utils/tracing';
import { logger } from '../utils/logger';

const router = Router();

/**
 * GET /api/admin/observability/health
 * Get overall system health status
 */
router.get('/observability/health', async (req: Request, res: Response) => {
  try {
    const hours = parseInt(req.query.hours as string, 10) || 1;
    const health = await getSystemHealth(hours);

    res.json({
      success: true,
      data: health
    });
  } catch (error: any) {
    logger.error('Failed to get system health', {
      error: error.message
    });
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve system health'
    });
  }
});

/**
 * GET /api/admin/observability/health/:module
 * Get module-specific health status
 */
router.get('/observability/health/:module', async (req: Request, res: Response) => {
  try {
    const { module } = req.params;
    const hours = parseInt(req.query.hours as string, 10) || 1;

    const health = await getModuleHealth(module, hours);

    res.json({
      success: true,
      data: health
    });
  } catch (error: any) {
    logger.error('Failed to get module health', {
      error: error.message,
      module: req.params.module
    });
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve module health'
    });
  }
});

/**
 * GET /api/admin/observability/sla
 * Get SLA compliance metrics
 */
router.get('/observability/sla', async (req: Request, res: Response) => {
  try {
    const hours = parseInt(req.query.hours as string, 10) || 24;
    const sla = await getSLAMetrics(hours);

    res.json({
      success: true,
      data: sla
    });
  } catch (error: any) {
    logger.error('Failed to get SLA metrics', {
      error: error.message
    });
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve SLA metrics'
    });
  }
});

/**
 * GET /api/admin/observability/performance/metrics
 * Get performance metrics
 */
router.get('/observability/performance/metrics', async (req: Request, res: Response) => {
  try {
    const params = {
      module: req.query.module as string,
      operation: req.query.operation as string,
      startDate: req.query.startDate ? new Date(req.query.startDate as string) : undefined,
      endDate: req.query.endDate ? new Date(req.query.endDate as string) : undefined,
      limit: parseInt(req.query.limit as string, 10) || 100
    };

    const metrics = await getPerformanceMetrics(params);

    res.json({
      success: true,
      data: {
        metrics,
        count: metrics.length
      }
    });
  } catch (error: any) {
    logger.error('Failed to get performance metrics', {
      error: error.message
    });
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve performance metrics'
    });
  }
});

/**
 * GET /api/admin/observability/performance/stats
 * Get aggregated performance statistics
 */
router.get('/observability/performance/stats', async (req: Request, res: Response) => {
  try {
    const params = {
      module: req.query.module as string,
      operation: req.query.operation as string,
      hours: parseInt(req.query.hours as string, 10) || 24
    };

    const stats = await getPerformanceStats(params);

    res.json({
      success: true,
      data: stats
    });
  } catch (error: any) {
    logger.error('Failed to get performance stats', {
      error: error.message
    });
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve performance statistics'
    });
  }
});

/**
 * GET /api/admin/observability/performance/slow
 * Get slow operations
 */
router.get('/observability/performance/slow', async (req: Request, res: Response) => {
  try {
    const params = {
      thresholdMs: parseInt(req.query.thresholdMs as string, 10) || 1000,
      hours: parseInt(req.query.hours as string, 10) || 24,
      limit: parseInt(req.query.limit as string, 10) || 100
    };

    const slow = await getSlowOperations(params);

    res.json({
      success: true,
      data: {
        operations: slow,
        count: slow.length,
        thresholdMs: params.thresholdMs
      }
    });
  } catch (error: any) {
    logger.error('Failed to get slow operations', {
      error: error.message
    });
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve slow operations'
    });
  }
});

/**
 * GET /api/admin/observability/performance/trends
 * Get performance trends over time
 */
router.get('/observability/performance/trends', async (req: Request, res: Response) => {
  try {
    const params = {
      module: req.query.module as string,
      operation: req.query.operation as string,
      hours: parseInt(req.query.hours as string, 10) || 24,
      intervalHours: parseInt(req.query.intervalHours as string, 10) || 1
    };

    const trends = await getPerformanceTrends(params);

    res.json({
      success: true,
      data: trends
    });
  } catch (error: any) {
    logger.error('Failed to get performance trends', {
      error: error.message
    });
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve performance trends'
    });
  }
});

/**
 * GET /api/admin/observability/performance/top-slow
 * Get top slow operations
 */
router.get('/observability/performance/top-slow', async (req: Request, res: Response) => {
  try {
    const params = {
      hours: parseInt(req.query.hours as string, 10) || 24,
      limit: parseInt(req.query.limit as string, 10) || 10
    };

    const topSlow = await getTopSlowOperations(params);

    res.json({
      success: true,
      data: topSlow
    });
  } catch (error: any) {
    logger.error('Failed to get top slow operations', {
      error: error.message
    });
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve top slow operations'
    });
  }
});

/**
 * GET /api/admin/observability/errors
 * Get aggregated errors
 */
router.get('/observability/errors', async (req: Request, res: Response) => {
  try {
    const params = {
      module: req.query.module as string,
      errorType: req.query.errorType as string,
      unresolvedOnly: req.query.unresolvedOnly === 'true',
      minOccurrences: parseInt(req.query.minOccurrences as string, 10),
      hours: parseInt(req.query.hours as string, 10) || 24,
      limit: parseInt(req.query.limit as string, 10) || 100
    };

    const errors = await getAggregatedErrors(params);

    res.json({
      success: true,
      data: {
        errors,
        count: errors.length
      }
    });
  } catch (error: any) {
    logger.error('Failed to get aggregated errors', {
      error: error.message
    });
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve aggregated errors'
    });
  }
});

/**
 * GET /api/admin/observability/errors/:aggregationId/occurrences
 * Get error occurrences for a specific aggregation
 */
router.get('/observability/errors/:aggregationId/occurrences', async (req: Request, res: Response) => {
  try {
    const { aggregationId } = req.params;
    const limit = parseInt(req.query.limit as string, 10) || 50;

    const occurrences = await getErrorOccurrences(aggregationId, limit);

    res.json({
      success: true,
      data: {
        occurrences,
        count: occurrences.length
      }
    });
  } catch (error: any) {
    logger.error('Failed to get error occurrences', {
      error: error.message,
      aggregationId: req.params.aggregationId
    });
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve error occurrences'
    });
  }
});

/**
 * GET /api/admin/observability/errors/stats
 * Get error statistics
 */
router.get('/observability/errors/stats', async (req: Request, res: Response) => {
  try {
    const params = {
      module: req.query.module as string,
      hours: parseInt(req.query.hours as string, 10) || 24
    };

    const stats = await getErrorStats(params);

    res.json({
      success: true,
      data: stats
    });
  } catch (error: any) {
    logger.error('Failed to get error stats', {
      error: error.message
    });
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve error statistics'
    });
  }
});

/**
 * GET /api/admin/observability/errors/trend
 * Get error trend over time
 */
router.get('/observability/errors/trend', async (req: Request, res: Response) => {
  try {
    const params = {
      module: req.query.module as string,
      errorType: req.query.errorType as string,
      hours: parseInt(req.query.hours as string, 10) || 24,
      intervalMinutes: parseInt(req.query.intervalMinutes as string, 10) || 60
    };

    const trend = await getErrorTrend(params);

    res.json({
      success: true,
      data: trend
    });
  } catch (error: any) {
    logger.error('Failed to get error trend', {
      error: error.message
    });
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve error trend'
    });
  }
});

/**
 * POST /api/admin/observability/errors/:aggregationId/resolve
 * Mark an error as resolved
 */
router.post('/observability/errors/:aggregationId/resolve', async (req: Request, res: Response) => {
  try {
    const { aggregationId } = req.params;
    const { resolvedBy, resolutionNotes } = req.body;

    if (!resolvedBy) {
      return res.status(400).json({
        success: false,
        error: 'resolvedBy is required'
      });
    }

    const updated = await resolveError(aggregationId, resolvedBy, resolutionNotes);

    if (updated) {
      res.json({
        success: true,
        message: 'Error marked as resolved'
      });
    } else {
      res.status(404).json({
        success: false,
        error: 'Error not found or already resolved'
      });
    }
  } catch (error: any) {
    logger.error('Failed to resolve error', {
      error: error.message,
      aggregationId: req.params.aggregationId
    });
    res.status(500).json({
      success: false,
      error: 'Failed to resolve error'
    });
  }
});

/**
 * GET /api/admin/observability/traces/:traceId
 * Get trace spans
 */
router.get('/observability/traces/:traceId', async (req: Request, res: Response) => {
  try {
    const { traceId } = req.params;
    const tree = req.query.tree === 'true';

    const data = tree
      ? await getTraceTree(traceId)
      : await getTraceSpans(traceId);

    res.json({
      success: true,
      data
    });
  } catch (error: any) {
    logger.error('Failed to get trace', {
      error: error.message,
      traceId: req.params.traceId
    });
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve trace'
    });
  }
});

/**
 * GET /api/admin/observability/traces/slow
 * Get slow traces
 */
router.get('/observability/traces/slow', async (req: Request, res: Response) => {
  try {
    const params = {
      thresholdMs: parseInt(req.query.thresholdMs as string, 10) || 1000,
      hours: parseInt(req.query.hours as string, 10) || 24,
      limit: parseInt(req.query.limit as string, 10) || 50
    };

    const traces = await getSlowTraces(params);

    res.json({
      success: true,
      data: {
        traces,
        count: traces.length,
        thresholdMs: params.thresholdMs
      }
    });
  } catch (error: any) {
    logger.error('Failed to get slow traces', {
      error: error.message
    });
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve slow traces'
    });
  }
});

/**
 * GET /api/admin/observability/traces/stats
 * Get trace statistics
 */
router.get('/observability/traces/stats', async (req: Request, res: Response) => {
  try {
    const params = {
      module: req.query.module as string,
      operation: req.query.operation as string,
      hours: parseInt(req.query.hours as string, 10) || 24
    };

    const stats = await getTraceStats(params);

    res.json({
      success: true,
      data: stats
    });
  } catch (error: any) {
    logger.error('Failed to get trace stats', {
      error: error.message
    });
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve trace statistics'
    });
  }
});

/**
 * GET /api/admin/observability/alerts
 * Get current alert conditions
 */
router.get('/observability/alerts', async (req: Request, res: Response) => {
  try {
    const hours = parseInt(req.query.hours as string, 10) || 1;
    const alerts = await getAlertConditions(hours);

    res.json({
      success: true,
      data: {
        alerts,
        count: alerts.length,
        critical: alerts.filter(a => a.severity === 'critical').length,
        warning: alerts.filter(a => a.severity === 'warning').length,
        info: alerts.filter(a => a.severity === 'info').length
      }
    });
  } catch (error: any) {
    logger.error('Failed to get alerts', {
      error: error.message
    });
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve alerts'
    });
  }
});

/**
 * GET /api/admin/observability/metrics/prometheus
 * Export metrics in Prometheus format
 */
router.get('/observability/metrics/prometheus', async (req: Request, res: Response) => {
  try {
    const hours = parseInt(req.query.hours as string, 10) || 1;
    const metrics = await exportPrometheusMetrics(hours);

    res.setHeader('Content-Type', 'text/plain; version=0.0.4');
    res.send(metrics);
  } catch (error: any) {
    logger.error('Failed to export Prometheus metrics', {
      error: error.message
    });
    res.status(500).json({
      success: false,
      error: 'Failed to export Prometheus metrics'
    });
  }
});

export default router;
