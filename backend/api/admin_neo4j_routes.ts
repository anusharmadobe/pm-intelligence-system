/**
 * Admin Neo4j Management API Routes
 *
 * Provides endpoints for managing Neo4j dead letter queue and sync operations (admin only)
 */

import { Router, Request, Response } from 'express';
import { Neo4jSyncService } from '../services/neo4j_sync_service';
import { logger } from '../utils/logger';

const router = Router();
const neo4jSyncService = new Neo4jSyncService();

/**
 * GET /api/admin/neo4j/dead-letter
 * Get dead letter queue items
 */
router.get('/neo4j/dead-letter', async (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string, 10) || 100;
    const unresolvedOnly = req.query.unresolved !== 'false';
    const operation = req.query.operation as string | undefined;

    const items = await neo4jSyncService.getDeadLetterItems({
      limit,
      unresolvedOnly,
      operation: operation as any
    });

    res.json({
      success: true,
      data: {
        items,
        count: items.length,
        filters: {
          limit,
          unresolved_only: unresolvedOnly,
          operation: operation || 'all'
        }
      }
    });
  } catch (error: any) {
    logger.error('Failed to get dead letter items', {
      error: error.message
    });
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve dead letter queue items'
    });
  }
});

/**
 * GET /api/admin/neo4j/dead-letter/stats
 * Get dead letter queue statistics
 */
router.get('/neo4j/dead-letter/stats', async (req: Request, res: Response) => {
  try {
    const stats = await neo4jSyncService.getDeadLetterStats();

    res.json({
      success: true,
      data: stats
    });
  } catch (error: any) {
    logger.error('Failed to get dead letter stats', {
      error: error.message
    });
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve dead letter queue statistics'
    });
  }
});

/**
 * POST /api/admin/neo4j/dead-letter/:itemId/reprocess
 * Reprocess a dead letter queue item
 */
router.post('/neo4j/dead-letter/:itemId/reprocess', async (req: Request, res: Response) => {
  try {
    const { itemId } = req.params;
    const result = await neo4jSyncService.reprocessDeadLetterItem(itemId);

    if (result.success) {
      res.json({
        success: true,
        message: 'Item successfully reprocessed and removed from dead letter queue'
      });
    } else {
      res.status(400).json({
        success: false,
        error: result.error || 'Reprocessing failed'
      });
    }
  } catch (error: any) {
    logger.error('Failed to reprocess dead letter item', {
      error: error.message,
      item_id: req.params.itemId
    });
    res.status(500).json({
      success: false,
      error: 'Failed to reprocess item'
    });
  }
});

/**
 * POST /api/admin/neo4j/dead-letter/:itemId/resolve
 * Mark a dead letter queue item as resolved
 */
router.post('/neo4j/dead-letter/:itemId/resolve', async (req: Request, res: Response) => {
  try {
    const { itemId } = req.params;
    const { resolved_by, notes } = req.body;

    if (!resolved_by) {
      return res.status(400).json({
        success: false,
        error: 'resolved_by is required'
      });
    }

    const updated = await neo4jSyncService.resolveDeadLetterItem(itemId, resolved_by, notes);

    if (updated) {
      res.json({
        success: true,
        message: 'Item marked as resolved'
      });
    } else {
      res.status(404).json({
        success: false,
        error: 'Item not found or already resolved'
      });
    }
  } catch (error: any) {
    logger.error('Failed to resolve dead letter item', {
      error: error.message,
      item_id: req.params.itemId
    });
    res.status(500).json({
      success: false,
      error: 'Failed to resolve item'
    });
  }
});

/**
 * POST /api/admin/neo4j/backlog/process
 * Manually trigger backlog processing
 */
router.post('/neo4j/backlog/process', async (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.body.limit, 10) || 50;

    await neo4jSyncService.processBacklog(limit);

    res.json({
      success: true,
      message: `Processed up to ${limit} backlog items`
    });
  } catch (error: any) {
    logger.error('Failed to process Neo4j backlog', {
      error: error.message
    });
    res.status(500).json({
      success: false,
      error: 'Failed to process backlog'
    });
  }
});

/**
 * GET /api/admin/neo4j/consistency
 * Run consistency check between PostgreSQL and Neo4j
 */
router.get('/neo4j/consistency', async (req: Request, res: Response) => {
  try {
    const result = await neo4jSyncService.runConsistencyCheck();

    const consistent = result.pgCount === result.neo4jCount;
    const difference = Math.abs(result.pgCount - result.neo4jCount);

    res.json({
      success: true,
      data: {
        postgresql_count: result.pgCount,
        neo4j_count: result.neo4jCount,
        consistent,
        difference,
        status: consistent ? 'in_sync' : 'out_of_sync'
      }
    });
  } catch (error: any) {
    logger.error('Failed to run consistency check', {
      error: error.message
    });
    res.status(500).json({
      success: false,
      error: 'Failed to run consistency check'
    });
  }
});

/**
 * GET /api/admin/neo4j/backlog/stats
 * Get backlog statistics
 */
router.get('/neo4j/backlog/stats', async (req: Request, res: Response) => {
  try {
    const stats = await neo4jSyncService.getBacklogStats();

    res.json({
      success: true,
      data: stats
    });
  } catch (error: any) {
    logger.error('Failed to get backlog stats', {
      error: error.message
    });
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve backlog statistics'
    });
  }
});

/**
 * POST /api/admin/neo4j/backlog/cleanup
 * Clean up old processed and failed items
 */
router.post('/neo4j/backlog/cleanup', async (req: Request, res: Response) => {
  try {
    const result = await neo4jSyncService.cleanupOldBacklogItems();

    res.json({
      success: true,
      message: `Cleaned up ${result.deleted} old backlog items`,
      data: result
    });
  } catch (error: any) {
    logger.error('Failed to clean up backlog', {
      error: error.message
    });
    res.status(500).json({
      success: false,
      error: 'Failed to clean up backlog'
    });
  }
});

export default router;
