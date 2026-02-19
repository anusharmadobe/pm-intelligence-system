import { Request, Response, Router } from 'express';
import { getDbPool } from '../db/connection';
import { checkRedisHealth, getRedisStatus } from '../config/redis';
import { createModuleLogger } from '../utils/logger';

const logger = createModuleLogger('health', 'LOG_LEVEL_HEALTH');

/**
 * Health check endpoints for monitoring and load balancer integration
 *
 * Endpoints:
 * - GET /health - Comprehensive health check with dependency status
 * - GET /health/liveness - Simple liveness probe (is process alive?)
 * - GET /health/readiness - Readiness probe (can accept traffic?)
 */

export interface HealthCheck {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  uptime: number;
  version?: string;
  checks: {
    database: CheckResult;
    redis: CheckResult;
    memory?: CheckResult;
    diskSpace?: CheckResult;
  };
}

export interface CheckResult {
  status: 'pass' | 'warn' | 'fail';
  message?: string;
  responseTime?: number;
  details?: Record<string, any>;
}

const router = Router();

/**
 * Check database connectivity and health
 */
async function checkDatabase(): Promise<CheckResult> {
  const startTime = Date.now();

  try {
    const pool = getDbPool();

    // Simple connectivity check
    await pool.query('SELECT 1');

    // Check pool status
    const totalCount = pool.totalCount;
    const idleCount = pool.idleCount;
    const waitingCount = pool.waitingCount;

    const responseTime = Date.now() - startTime;

    // Warn if pool is near capacity
    const utilizationPercent = ((totalCount - idleCount) / totalCount) * 100;
    const status = utilizationPercent > 90 ? 'warn' : 'pass';

    logger.debug('Database health check completed', {
      status,
      response_time_ms: responseTime,
      total_connections: totalCount,
      idle_connections: idleCount,
      utilization_percent: utilizationPercent.toFixed(1)
    });

    return {
      status,
      responseTime,
      message: status === 'warn' ? 'Database pool near capacity' : undefined,
      details: {
        totalConnections: totalCount,
        idleConnections: idleCount,
        waitingConnections: waitingCount,
        utilizationPercent: utilizationPercent.toFixed(1)
      }
    };
  } catch (error: any) {
    return {
      status: 'fail',
      message: error.message,
      responseTime: Date.now() - startTime
    };
  }
}

/**
 * Check Redis connectivity and health
 */
async function checkRedis(): Promise<CheckResult> {
  const startTime = Date.now();

  try {
    const healthy = await checkRedisHealth();
    const status = getRedisStatus();

    if (!healthy) {
      return {
        status: 'fail',
        message: 'Redis ping failed',
        responseTime: Date.now() - startTime,
        details: status
      };
    }

    // Warn if reconnecting
    const checkStatus = status.reconnectionAttempts > 0 ? 'warn' : 'pass';

    return {
      status: checkStatus,
      responseTime: Date.now() - startTime,
      message: status.reconnectionAttempts > 0 ? 'Redis reconnecting' : undefined,
      details: {
        connected: status.connected,
        reconnectionAttempts: status.reconnectionAttempts
      }
    };
  } catch (error: any) {
    return {
      status: 'fail',
      message: error.message,
      responseTime: Date.now() - startTime
    };
  }
}

/**
 * Check memory usage
 */
function checkMemory(): CheckResult {
  const memUsage = process.memoryUsage();
  const heapUsedMB = memUsage.heapUsed / 1024 / 1024;
  const heapTotalMB = memUsage.heapTotal / 1024 / 1024;
  const rssMB = memUsage.rss / 1024 / 1024;

  const heapUsagePercent = (heapUsedMB / heapTotalMB) * 100;

  // Warn if heap usage > 85%
  const status = heapUsagePercent > 85 ? 'warn' : 'pass';

  return {
    status,
    message: status === 'warn' ? 'High memory usage' : undefined,
    details: {
      heapUsedMB: heapUsedMB.toFixed(2),
      heapTotalMB: heapTotalMB.toFixed(2),
      heapUsagePercent: heapUsagePercent.toFixed(1),
      rssMB: rssMB.toFixed(2),
      externalMB: (memUsage.external / 1024 / 1024).toFixed(2)
    }
  };
}

/**
 * Comprehensive health check
 */
async function performHealthCheck(): Promise<HealthCheck> {
  const [dbCheck, redisCheck] = await Promise.all([
    checkDatabase(),
    checkRedis()
  ]);

  const memCheck = checkMemory();

  // Determine overall status
  const checks = [dbCheck, redisCheck, memCheck];
  const failedChecks = checks.filter(c => c.status === 'fail');
  const warnChecks = checks.filter(c => c.status === 'warn');

  let overallStatus: 'healthy' | 'degraded' | 'unhealthy';

  if (failedChecks.length > 0) {
    // Critical dependencies failed
    const criticalFailed = [dbCheck, redisCheck].some(c => c.status === 'fail');
    overallStatus = criticalFailed ? 'unhealthy' : 'degraded';
  } else if (warnChecks.length > 0) {
    overallStatus = 'degraded';
  } else {
    overallStatus = 'healthy';
  }

  logger.info('Health check completed', {
    overall_status: overallStatus,
    db_status: dbCheck.status,
    redis_status: redisCheck.status,
    memory_status: memCheck.status,
    checks_passed: checks.filter(c => c.status === 'pass').length,
    checks_failed: failedChecks.length,
    checks_warned: warnChecks.length
  });

  return {
    status: overallStatus,
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    version: process.env.APP_VERSION || 'unknown',
    checks: {
      database: dbCheck,
      redis: redisCheck,
      memory: memCheck
    }
  };
}

/**
 * GET /health
 * Comprehensive health check with all dependency statuses
 * Returns 200 (healthy), 200 (degraded), or 503 (unhealthy)
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const health = await performHealthCheck();

    // Return 503 only for unhealthy state
    // Degraded state still returns 200 but with warnings
    const statusCode = health.status === 'unhealthy' ? 503 : 200;

    res.status(statusCode).json(health);
  } catch (error: any) {
    logger.error('Health check failed', {
      error: error.message,
      errorClass: error.constructor.name,
      stack: error.stack
    });

    res.status(503).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      error: error.message
    });
  }
});

/**
 * GET /health/liveness
 * Simple liveness probe - is the process alive and able to respond?
 * Used by Kubernetes/Docker to determine if container should be restarted
 * Always returns 200 if process can respond
 */
router.get('/liveness', (req: Request, res: Response) => {
  res.status(200).json({
    status: 'alive',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

/**
 * GET /health/readiness
 * Readiness probe - is the service ready to accept traffic?
 * Used by load balancers to determine if traffic should be routed
 * Returns 200 if ready, 503 if not ready
 */
router.get('/readiness', async (req: Request, res: Response) => {
  try {
    const health = await performHealthCheck();

    // Only ready if healthy or degraded (not unhealthy)
    const ready = health.status !== 'unhealthy';

    if (ready) {
      res.status(200).json({
        ready: true,
        status: health.status,
        timestamp: new Date().toISOString(),
        checks: health.checks
      });
    } else {
      logger.warn('Readiness check failed', {
        ready: false,
        status: health.status,
        failed_checks: Object.entries(health.checks)
          .filter(([_, check]) => check.status === 'fail')
          .map(([name]) => name)
      });

      res.status(503).json({
        ready: false,
        status: health.status,
        timestamp: new Date().toISOString(),
        checks: health.checks,
        message: 'Service not ready to accept traffic'
      });
    }
  } catch (error: any) {
    logger.error('Readiness check failed', {
      error: error.message,
      errorClass: error.constructor.name
    });

    res.status(503).json({
      ready: false,
      timestamp: new Date().toISOString(),
      error: error.message
    });
  }
});

/**
 * GET /health/startup
 * Startup probe - has the service finished initialization?
 * Used by Kubernetes for slow-starting containers
 * Returns 200 when startup is complete
 */
router.get('/startup', async (req: Request, res: Response) => {
  try {
    // Check if critical dependencies are available
    const [dbCheck, redisCheck] = await Promise.all([
      checkDatabase(),
      checkRedis()
    ]);

    const criticalFailed = [dbCheck, redisCheck].some(c => c.status === 'fail');

    if (criticalFailed) {
      res.status(503).json({
        started: false,
        timestamp: new Date().toISOString(),
        checks: {
          database: dbCheck,
          redis: redisCheck
        },
        message: 'Service still starting up'
      });
    } else {
      res.status(200).json({
        started: true,
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        checks: {
          database: dbCheck,
          redis: redisCheck
        }
      });
    }
  } catch (error: any) {
    res.status(503).json({
      started: false,
      timestamp: new Date().toISOString(),
      error: error.message
    });
  }
});

export default router;
