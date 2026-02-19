import { randomBytes, randomUUID } from 'crypto';
import bcrypt from 'bcryptjs';
import { getDbPool } from '../db/connection';
import { logger } from '../utils/logger';

export interface ApiKey {
  id: string;
  name: string;
  key_hash: string;
  key_prefix: string;
  scopes: string[];
  created_by: string | null;
  expires_at: Date | null;
  last_used_at: Date | null;
  is_active: boolean;
  metadata: Record<string, any>;
  created_at: Date;
  updated_at: Date;
}

export interface CreateApiKeyParams {
  name: string;
  scopes: string[];
  created_by?: string;
  expires_at?: Date;
  metadata?: Record<string, any>;
}

export interface ApiKeyWithSecret extends ApiKey {
  api_key: string; // The actual secret key (only returned once at creation)
}

export class ApiKeyService {
  /**
   * Generate a new API key with format: pk_{uuid}_{random}
   */
  private generateApiKey(): { key: string; prefix: string } {
    const uuid = randomUUID().replace(/-/g, '');
    const random = randomBytes(24).toString('hex');
    const key = `pk_${uuid}_${random}`;
    const prefix = `pk_${uuid.substring(0, 8)}...`;
    return { key, prefix };
  }

  /**
   * Hash an API key for secure storage
   */
  private async hashApiKey(apiKey: string): Promise<string> {
    return bcrypt.hash(apiKey, 10);
  }

  /**
   * Verify an API key against its hash
   */
  private async verifyApiKey(apiKey: string, hash: string): Promise<boolean> {
    return bcrypt.compare(apiKey, hash);
  }

  /**
   * Create a new API key
   * Returns the plaintext key (only shown once!)
   */
  async createApiKey(params: CreateApiKeyParams): Promise<ApiKeyWithSecret> {
    const pool = getDbPool();
    const { key, prefix } = this.generateApiKey();
    const keyHash = await this.hashApiKey(key);

    try {
      const result = await pool.query<ApiKey>(
        `INSERT INTO api_keys
          (id, name, key_hash, key_prefix, scopes, created_by, expires_at, metadata, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())
         RETURNING *`,
        [
          randomUUID(),
          params.name,
          keyHash,
          prefix,
          params.scopes,
          params.created_by || null,
          params.expires_at || null,
          JSON.stringify(params.metadata || {})
        ]
      );

      const apiKeyRecord = result.rows[0];

      logger.info('API key created', {
        api_key_id: apiKeyRecord.id,
        name: params.name,
        scopes: params.scopes,
        created_by: params.created_by
      });

      return {
        ...apiKeyRecord,
        api_key: key // Only returned at creation time
      };
    } catch (error: any) {
      logger.error('Failed to create API key', {
        error: error.message,
        stack: error.stack,
        name: params.name
      });
      throw error;
    }
  }

  /**
   * Validate an API key and return the key record if valid
   */
  async validateApiKey(apiKey: string): Promise<ApiKey | null> {
    const pool = getDbPool();

    try {
      // Get all active keys (we need to check hash for each)
      const result = await pool.query<ApiKey>(
        `SELECT * FROM api_keys WHERE is_active = true`
      );

      // Check each key's hash
      for (const keyRecord of result.rows) {
        const isValid = await this.verifyApiKey(apiKey, keyRecord.key_hash);

        if (isValid) {
          // Check expiration
          if (keyRecord.expires_at && new Date(keyRecord.expires_at) < new Date()) {
            logger.warn('Expired API key used', {
              api_key_id: keyRecord.id,
              name: keyRecord.name,
              expires_at: keyRecord.expires_at
            });
            return null;
          }

          // Update last_used_at
          await pool.query(
            `UPDATE api_keys SET last_used_at = NOW(), updated_at = NOW() WHERE id = $1`,
            [keyRecord.id]
          );

          return keyRecord;
        }
      }

      // No matching key found
      logger.warn('Invalid API key attempted', {
        key_prefix: apiKey.substring(0, Math.min(10, apiKey.length)) + '...'
      });
      return null;
    } catch (error: any) {
      logger.error('API key validation error', {
        error: error.message,
        stack: error.stack
      });
      return null;
    }
  }

  /**
   * Revoke an API key (soft delete - sets is_active to false)
   */
  async revokeApiKey(apiKeyId: string, revokedBy?: string): Promise<boolean> {
    const pool = getDbPool();

    try {
      const result = await pool.query(
        `UPDATE api_keys
         SET is_active = false, updated_at = NOW()
         WHERE id = $1 AND is_active = true
         RETURNING *`,
        [apiKeyId]
      );

      if (result.rows.length > 0) {
        logger.info('API key revoked', {
          api_key_id: apiKeyId,
          name: result.rows[0].name,
          revoked_by: revokedBy
        });
        return true;
      }

      return false;
    } catch (error: any) {
      logger.error('Failed to revoke API key', {
        error: error.message,
        stack: error.stack,
        api_key_id: apiKeyId
      });
      throw error;
    }
  }

  /**
   * List all API keys (excluding the actual key values)
   */
  async listApiKeys(includeInactive = false): Promise<ApiKey[]> {
    const pool = getDbPool();

    try {
      const query = includeInactive
        ? `SELECT * FROM api_keys ORDER BY created_at DESC`
        : `SELECT * FROM api_keys WHERE is_active = true ORDER BY created_at DESC`;

      const result = await pool.query<ApiKey>(query);
      return result.rows;
    } catch (error: any) {
      logger.error('Failed to list API keys', {
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  /**
   * Get API key by ID
   */
  async getApiKeyById(apiKeyId: string): Promise<ApiKey | null> {
    const pool = getDbPool();

    try {
      const result = await pool.query<ApiKey>(
        `SELECT * FROM api_keys WHERE id = $1`,
        [apiKeyId]
      );

      return result.rows[0] || null;
    } catch (error: any) {
      logger.error('Failed to get API key', {
        error: error.message,
        stack: error.stack,
        api_key_id: apiKeyId
      });
      throw error;
    }
  }

  /**
   * Update API key scopes or metadata
   */
  async updateApiKey(
    apiKeyId: string,
    updates: {
      name?: string;
      scopes?: string[];
      metadata?: Record<string, any>;
      expires_at?: Date | null;
    }
  ): Promise<ApiKey | null> {
    const pool = getDbPool();

    try {
      const setClauses: string[] = ['updated_at = NOW()'];
      const values: any[] = [];
      let paramIndex = 1;

      if (updates.name !== undefined) {
        setClauses.push(`name = $${paramIndex++}`);
        values.push(updates.name);
      }

      if (updates.scopes !== undefined) {
        setClauses.push(`scopes = $${paramIndex++}`);
        values.push(updates.scopes);
      }

      if (updates.metadata !== undefined) {
        setClauses.push(`metadata = $${paramIndex++}`);
        values.push(JSON.stringify(updates.metadata));
      }

      if (updates.expires_at !== undefined) {
        setClauses.push(`expires_at = $${paramIndex++}`);
        values.push(updates.expires_at);
      }

      if (setClauses.length === 1) {
        // Only updated_at, nothing to update
        return await this.getApiKeyById(apiKeyId);
      }

      values.push(apiKeyId);

      const result = await pool.query<ApiKey>(
        `UPDATE api_keys
         SET ${setClauses.join(', ')}
         WHERE id = $${paramIndex}
         RETURNING *`,
        values
      );

      if (result.rows.length > 0) {
        logger.info('API key updated', {
          api_key_id: apiKeyId,
          updates: Object.keys(updates)
        });
      }

      return result.rows[0] || null;
    } catch (error: any) {
      logger.error('Failed to update API key', {
        error: error.message,
        stack: error.stack,
        api_key_id: apiKeyId
      });
      throw error;
    }
  }

  /**
   * Log API key usage
   */
  async logUsage(params: {
    api_key_id: string;
    endpoint: string;
    method: string;
    status_code?: number;
    response_time_ms?: number;
    error_message?: string;
    ip_address?: string;
    user_agent?: string;
  }): Promise<void> {
    const pool = getDbPool();

    try {
      await pool.query(
        `INSERT INTO api_key_usage_log
          (id, api_key_id, endpoint, method, status_code, response_time_ms, error_message, ip_address, user_agent, created_at)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, NOW())`,
        [
          params.api_key_id,
          params.endpoint,
          params.method,
          params.status_code || null,
          params.response_time_ms || null,
          params.error_message || null,
          params.ip_address || null,
          params.user_agent || null
        ]
      );
    } catch (error: any) {
      // Don't throw - logging should not break the request
      logger.error('Failed to log API key usage', {
        error: error.message,
        api_key_id: params.api_key_id
      });
    }
  }

  /**
   * Get API key statistics
   */
  async getApiKeyStats(apiKeyId: string): Promise<{
    requests_24h: number;
    requests_7d: number;
    errors_24h: number;
    avg_response_ms_24h: number;
  } | null> {
    const pool = getDbPool();

    try {
      const result = await pool.query(
        `SELECT * FROM api_key_stats WHERE id = $1`,
        [apiKeyId]
      );

      if (result.rows.length === 0) {
        return null;
      }

      return {
        requests_24h: parseInt(result.rows[0].requests_24h) || 0,
        requests_7d: parseInt(result.rows[0].requests_7d) || 0,
        errors_24h: parseInt(result.rows[0].errors_24h) || 0,
        avg_response_ms_24h: parseFloat(result.rows[0].avg_response_ms_24h) || 0
      };
    } catch (error: any) {
      logger.error('Failed to get API key stats', {
        error: error.message,
        stack: error.stack,
        api_key_id: apiKeyId
      });
      throw error;
    }
  }

  /**
   * Check if an API key has a specific scope
   */
  hasScope(apiKey: ApiKey, requiredScope: string): boolean {
    // Admin scope grants all permissions
    if (apiKey.scopes.includes('admin')) {
      return true;
    }

    // Check for exact scope match
    if (apiKey.scopes.includes(requiredScope)) {
      return true;
    }

    // Check for wildcard scopes (e.g., "read:*" matches "read:signals")
    const wildcardScopes = apiKey.scopes.filter(s => s.endsWith(':*'));
    for (const wildcardScope of wildcardScopes) {
      const prefix = wildcardScope.replace(':*', ':');
      if (requiredScope.startsWith(prefix)) {
        return true;
      }
    }

    return false;
  }
}

// Export singleton instance
export const apiKeyService = new ApiKeyService();
