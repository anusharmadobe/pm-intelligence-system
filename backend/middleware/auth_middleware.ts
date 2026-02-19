import { Request, Response, NextFunction } from 'express';
import { apiKeyService, ApiKey } from '../services/api_key_service';
import { logger } from '../utils/logger';

// Extend Express Request to include auth info
export interface AuthenticatedRequest extends Request {
  apiKey?: ApiKey;
  user?: {
    id: string;
    [key: string]: any;
  };
  authMethod?: 'api_key' | 'bearer_token';
  requestStartTime?: number;
}

/**
 * Extract API key or Bearer token from request headers
 */
function extractAuthToken(req: Request): { type: 'api_key' | 'bearer' | null; token: string | null } {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    return { type: null, token: null };
  }

  // Check for Bearer token (JWT)
  if (authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7).trim();
    return { type: 'bearer', token };
  }

  // Check for ApiKey format
  if (authHeader.startsWith('ApiKey ')) {
    const token = authHeader.substring(7).trim();
    return { type: 'api_key', token };
  }

  // Support bare API key without prefix (for backward compatibility)
  if (authHeader.startsWith('pk_')) {
    return { type: 'api_key', token: authHeader.trim() };
  }

  return { type: null, token: null };
}

/**
 * Core authentication middleware
 * Validates API keys or Bearer tokens
 */
export async function requireAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  req.requestStartTime = Date.now();

  const { type, token } = extractAuthToken(req);

  if (!token) {
    logger.warn('Authentication failed: missing credentials', {
      path: req.path,
      method: req.method,
      ip: req.ip
    });
    res.status(401).json({
      error: 'Authentication required',
      message: 'Please provide an API key or Bearer token in the Authorization header'
    });
    return;
  }

  try {
    if (type === 'api_key') {
      // Validate API key
      const apiKey = await apiKeyService.validateApiKey(token);

      if (!apiKey) {
        logger.warn('Authentication failed: invalid API key', {
          path: req.path,
          method: req.method,
          ip: req.ip,
          key_prefix: token.substring(0, 10) + '...'
        });
        res.status(401).json({
          error: 'Invalid API key',
          message: 'The provided API key is invalid or has been revoked'
        });
        return;
      }

      // Attach API key to request
      req.apiKey = apiKey;
      req.authMethod = 'api_key';

      logger.info('Authentication successful', {
        security_event: 'auth_success',
        auth_method: 'api_key',
        api_key_id: apiKey.id,
        key_name: apiKey.name,
        scopes: apiKey.scopes,
        path: req.path,
        method: req.method,
        ip: req.ip,
        user_agent: req.get('user-agent')
      });

      next();
    } else if (type === 'bearer') {
      // TODO: Implement JWT/Bearer token validation
      // For now, reject bearer tokens
      logger.warn('Authentication failed: Bearer tokens not yet implemented', {
        path: req.path,
        method: req.method,
        ip: req.ip
      });
      res.status(501).json({
        error: 'Bearer token authentication not yet implemented',
        message: 'Please use an API key for authentication'
      });
      return;
    } else {
      res.status(401).json({
        error: 'Invalid authorization format',
        message: 'Use "Authorization: ApiKey <key>" or "Authorization: Bearer <token>"'
      });
      return;
    }
  } catch (error: any) {
    logger.error('Authentication error', {
      error: error.message,
      stack: error.stack,
      path: req.path,
      method: req.method
    });
    res.status(500).json({
      error: 'Authentication error',
      message: 'An error occurred while validating credentials'
    });
  }
}

/**
 * Middleware to require specific permissions
 * Must be used after requireAuth
 */
export function requirePermissions(...requiredScopes: string[]) {
  return async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    if (!req.apiKey) {
      logger.error('requirePermissions called without authentication', {
        path: req.path,
        method: req.method
      });
      res.status(500).json({
        error: 'Internal server error',
        message: 'Authentication check missing'
      });
      return;
    }

    // Check if API key has all required scopes
    const missingScopes: string[] = [];
    for (const scope of requiredScopes) {
      if (!apiKeyService.hasScope(req.apiKey, scope)) {
        missingScopes.push(scope);
      }
    }

    if (missingScopes.length > 0) {
      logger.warn('Permission denied: missing scopes', {
        api_key_id: req.apiKey.id,
        name: req.apiKey.name,
        required_scopes: requiredScopes,
        missing_scopes: missingScopes,
        path: req.path,
        method: req.method
      });

      res.status(403).json({
        error: 'Insufficient permissions',
        message: `This API key does not have the required permissions: ${missingScopes.join(', ')}`,
        required: requiredScopes,
        missing: missingScopes
      });
      return;
    }

    logger.info('Permission check passed', {
      security_event: 'permission_granted',
      api_key_id: req.apiKey.id,
      required_scopes: requiredScopes,
      granted_scopes: req.apiKey.scopes,
      path: req.path,
      method: req.method
    });

    next();
  };
}

/**
 * Middleware to require admin role
 * Must be used after requireAuth
 */
export function requireAdmin(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  if (!req.apiKey) {
    res.status(500).json({
      error: 'Internal server error',
      message: 'Authentication check missing'
    });
    return;
  }

  if (!apiKeyService.hasScope(req.apiKey, 'admin')) {
    logger.warn('Admin access denied', {
      api_key_id: req.apiKey.id,
      name: req.apiKey.name,
      path: req.path,
      method: req.method
    });

    res.status(403).json({
      error: 'Admin access required',
      message: 'This endpoint requires admin permissions'
    });
    return;
  }

  logger.info('Admin access granted', {
    security_event: 'admin_access',
    api_key_id: req.apiKey.id,
    key_name: req.apiKey.name,
    path: req.path,
    method: req.method,
    ip: req.ip
  });

  next();
}

/**
 * Optional authentication middleware
 * Attempts to authenticate but doesn't fail if no credentials provided
 * Useful for endpoints that have different behavior for authenticated vs unauthenticated users
 */
export async function optionalAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  const { type, token } = extractAuthToken(req);

  if (!token) {
    // No authentication provided, continue without auth
    logger.info('Optional authentication bypassed', {
      security_event: 'auth_bypass_allowed',
      reason: 'optional_auth',
      path: req.path,
      ip: req.ip
    });
    next();
    return;
  }

  try {
    if (type === 'api_key') {
      const apiKey = await apiKeyService.validateApiKey(token);
      if (apiKey) {
        req.apiKey = apiKey;
        req.authMethod = 'api_key';

        logger.debug('Optional authentication succeeded', {
          security_event: 'optional_auth_success',
          api_key_id: apiKey.id,
          path: req.path
        });
      }
    }
    // Silently ignore authentication failures for optional auth
    next();
  } catch (error: any) {
    // Log error but don't fail the request
    logger.error('Optional authentication error', {
      error: error.message,
      path: req.path
    });
    next();
  }
}

/**
 * Middleware to log API key usage
 * Must be used after requireAuth and at the end of the request
 */
export function logApiKeyUsage(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  // Capture response finish event
  const originalSend = res.send;
  const originalJson = res.json;
  let responseSent = false;

  const logUsage = async () => {
    if (responseSent || !req.apiKey) return;
    responseSent = true;

    const responseTime = req.requestStartTime ? Date.now() - req.requestStartTime : undefined;

    try {
      await apiKeyService.logUsage({
        api_key_id: req.apiKey.id,
        endpoint: req.path,
        method: req.method,
        status_code: res.statusCode,
        response_time_ms: responseTime,
        ip_address: req.ip,
        user_agent: req.get('user-agent')
      });
    } catch (error: any) {
      logger.error('Failed to log API key usage', {
        error: error.message,
        api_key_id: req.apiKey.id
      });
    }
  };

  // Wrap res.send
  res.send = function (body: any): Response {
    logUsage();
    return originalSend.call(this, body);
  };

  // Wrap res.json
  res.json = function (body: any): Response {
    logUsage();
    return originalJson.call(this, body);
  };

  // Also capture on finish event (in case neither send nor json are called)
  res.on('finish', logUsage);

  next();
}

/**
 * Helper to check if request is authenticated
 */
export function isAuthenticated(req: AuthenticatedRequest): boolean {
  return !!(req.apiKey || req.user);
}

/**
 * Helper to get authenticated entity name (for logging)
 */
export function getAuthenticatedEntity(req: AuthenticatedRequest): string {
  if (req.apiKey) {
    return `API Key: ${req.apiKey.name} (${req.apiKey.key_prefix})`;
  }
  if (req.user) {
    return `User: ${req.user.id}`;
  }
  return 'Unauthenticated';
}
