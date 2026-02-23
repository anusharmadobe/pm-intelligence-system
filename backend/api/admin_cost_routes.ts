/**
 * Admin Cost Management API Routes
 *
 * Provides endpoints for managing agent budgets and costs (admin only)
 */

import { Router, Request, Response } from 'express';
import { getCostTrackingService } from '../services/cost_tracking_service';
import { logger } from '../utils/logger';

const router = Router();

/**
 * GET /api/admin/agents/:agentId/cost
 * Get detailed cost information for an agent
 */
router.get('/agents/:agentId/cost', async (req: Request, res: Response) => {
  try {
    const { agentId } = req.params;
    const costService = getCostTrackingService();

    // Get budget status
    const budgetStatus = await costService.checkAgentBudget(agentId);

    // Get cost summary for current month
    const currentMonthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    const costSummary = await costService.getCostSummary({
      agentId,
      dateFrom: currentMonthStart,
      dateTo: new Date()
    });

    res.json({
      success: true,
      data: {
        agent_id: agentId,
        budget: budgetStatus,
        current_month: costSummary
      }
    });
  } catch (error: any) {
    logger.error('Failed to get agent cost', {
      error: error.message,
      agent_id: req.params.agentId
    });
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve agent cost information'
    });
  }
});

/**
 * POST /api/admin/agents/:agentId/budget
 * Update agent budget limit
 *
 * Body: { max_monthly_cost_usd: number }
 */
router.post('/agents/:agentId/budget', async (req: Request, res: Response) => {
  try {
    const { agentId } = req.params;
    const { max_monthly_cost_usd } = req.body;

    if (typeof max_monthly_cost_usd !== 'number' || max_monthly_cost_usd < 0) {
      return res.status(400).json({
        success: false,
        error: 'max_monthly_cost_usd must be a positive number'
      });
    }

    const costService = getCostTrackingService();
    await costService.updateAgentBudget(agentId, max_monthly_cost_usd);

    logger.info('Agent budget updated', {
      agent_id: agentId,
      new_limit: max_monthly_cost_usd,
      updated_by: (req as any).user?.id || 'admin'
    });

    res.json({
      success: true,
      data: {
        agent_id: agentId,
        max_monthly_cost_usd
      }
    });
  } catch (error: any) {
    logger.error('Failed to update agent budget', {
      error: error.message,
      agent_id: req.params.agentId
    });
    res.status(500).json({
      success: false,
      error: 'Failed to update agent budget'
    });
  }
});

/**
 * POST /api/admin/agents/:agentId/budget/reset
 * Reset agent monthly cost counter
 */
router.post('/agents/:agentId/budget/reset', async (req: Request, res: Response) => {
  try {
    const { agentId } = req.params;
    const costService = getCostTrackingService();

    await costService.resetAgentMonthlyCost(agentId);

    logger.info('Agent monthly cost reset', {
      agent_id: agentId,
      reset_by: (req as any).user?.id || 'admin'
    });

    res.json({
      success: true,
      data: {
        agent_id: agentId,
        message: 'Monthly cost counter reset successfully'
      }
    });
  } catch (error: any) {
    logger.error('Failed to reset agent cost', {
      error: error.message,
      agent_id: req.params.agentId
    });
    res.status(500).json({
      success: false,
      error: 'Failed to reset agent monthly cost'
    });
  }
});

/**
 * POST /api/admin/agents/:agentId/unpause
 * Unpause an agent that was auto-paused due to budget
 */
router.post('/agents/:agentId/unpause', async (req: Request, res: Response) => {
  try {
    const { agentId } = req.params;
    const costService = getCostTrackingService();

    await costService.unpauseAgent(agentId);

    logger.info('Agent unpaused', {
      agent_id: agentId,
      unpaused_by: (req as any).user?.id || 'admin'
    });

    res.json({
      success: true,
      data: {
        agent_id: agentId,
        message: 'Agent unpaused successfully'
      }
    });
  } catch (error: any) {
    logger.error('Failed to unpause agent', {
      error: error.message,
      agent_id: req.params.agentId
    });
    res.status(500).json({
      success: false,
      error: 'Failed to unpause agent'
    });
  }
});

/**
 * POST /api/admin/agents/:agentId/pause
 * Manually pause an agent
 */
router.post('/agents/:agentId/pause', async (req: Request, res: Response) => {
  try {
    const { agentId } = req.params;
    const { reason } = req.body;
    const costService = getCostTrackingService();

    await costService.pauseAgent(agentId, reason || 'manual_pause');

    logger.info('Agent paused', {
      agent_id: agentId,
      reason: reason || 'manual_pause',
      paused_by: (req as any).user?.id || 'admin'
    });

    res.json({
      success: true,
      data: {
        agent_id: agentId,
        message: 'Agent paused successfully'
      }
    });
  } catch (error: any) {
    logger.error('Failed to pause agent', {
      error: error.message,
      agent_id: req.params.agentId
    });
    res.status(500).json({
      success: false,
      error: 'Failed to pause agent'
    });
  }
});

export default router;
