import { randomBytes, randomUUID } from 'crypto';
import bcrypt from 'bcryptjs';
import { getDbPool } from '../db/connection';
import { logger } from '../utils/logger';
import { config } from '../config/env';

export interface AgentRecord {
  id: string;
  agent_name: string;
  agent_class: string;
  api_key_hash: string;
  permissions: Record<string, boolean>;
  rate_limit_per_minute: number;
  event_subscriptions: string[];
  webhook_url: string | null;
  is_active: boolean;
  current_version: string;
}

export interface AgentRegistrationParams {
  agent_name: string;
  agent_class: 'orchestrator' | 'autonomous' | 'integration';
  permissions?: Record<string, boolean>;
  rate_limit_per_minute?: number;
  event_subscriptions?: string[];
  webhook_url?: string;
  a2a_agent_card_url?: string;
  a2a_capabilities?: Record<string, unknown>;
  max_monthly_cost_usd?: number;
  deployed_by?: string;
  correlation_id?: string;
}

export class AgentRegistryService {
  private defaultPermissions: Record<string, boolean> = {
    read: true,
    write: false,
    events: true
  };

  private generateApiKey(): string {
    return `agent_${randomUUID()}_${randomBytes(24).toString('hex')}`;
  }

  private async hashApiKey(apiKey: string): Promise<string> {
    return bcrypt.hash(apiKey, 10);
  }

  private async verifyApiKey(apiKey: string, hash: string): Promise<boolean> {
    return bcrypt.compare(apiKey, hash);
  }

  async registerAgent(params: AgentRegistrationParams): Promise<{ apiKey: string; agent: AgentRecord }> {
    const pool = getDbPool();
    const apiKey = this.generateApiKey();
    const apiKeyHash = await this.hashApiKey(apiKey);
    const permissions = params.permissions || this.defaultPermissions;
    const rateLimit = params.rate_limit_per_minute || config.agent.rateLimitRpm;
    const maxMonthlyCost = params.max_monthly_cost_usd || config.agent.maxMonthlyCostUsd;

    try {
      const result = await pool.query(
        `INSERT INTO agent_registry
          (id, agent_name, agent_class, api_key_hash, permissions, rate_limit_per_minute, event_subscriptions,
           webhook_url, a2a_agent_card_url, a2a_capabilities, max_monthly_cost_usd)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         RETURNING *`,
        [
          randomUUID(),
          params.agent_name,
          params.agent_class,
          apiKeyHash,
          JSON.stringify(permissions),
          rateLimit,
          params.event_subscriptions || [],
          params.webhook_url || null,
          params.a2a_agent_card_url || null,
          params.a2a_capabilities ? JSON.stringify(params.a2a_capabilities) : null,
          maxMonthlyCost
        ]
      );

      const agent = result.rows[0] as AgentRecord;

      await pool.query(
        `INSERT INTO agent_version_history
          (id, agent_id, version, config, deployed_by)
         VALUES (gen_random_uuid(), $1, $2, $3, $4)
         ON CONFLICT (agent_id, version) DO NOTHING`,
        [
          agent.id,
          agent.current_version,
          JSON.stringify({
            permissions,
            rate_limit_per_minute: rateLimit,
            event_subscriptions: params.event_subscriptions || [],
            webhook_url: params.webhook_url || null
          }),
          params.deployed_by || 'system'
        ]
      );

      return { apiKey, agent };
    } catch (error) {
      logger.error('Agent registration failed', { error, agent_name: params.agent_name, correlation_id: params.correlation_id });
      throw error;
    }
  }

  async rotateApiKey(agentId: string, correlationId?: string): Promise<string> {
    const pool = getDbPool();
    const apiKey = this.generateApiKey();
    const apiKeyHash = await this.hashApiKey(apiKey);

    try {
      await pool.query(
        `UPDATE agent_registry
         SET api_key_hash = $2, updated_at = NOW()
         WHERE id = $1`,
        [agentId, apiKeyHash]
      );
      return apiKey;
    } catch (error) {
      logger.error('Agent key rotation failed', { error, agentId, correlation_id: correlationId });
      throw error;
    }
  }

  async authenticate(apiKey: string, correlationId?: string): Promise<AgentRecord | null> {
    const pool = getDbPool();
    try {
      const result = await pool.query(
        `SELECT * FROM agent_registry WHERE is_active = true`
      );

      for (const row of result.rows) {
        const match = await this.verifyApiKey(apiKey, row.api_key_hash);
        if (match) {
          return row as AgentRecord;
        }
      }
      return null;
    } catch (error) {
      logger.error('Agent authentication failed', { error, correlation_id: correlationId });
      throw error;
    }
  }

  async logActivity(params: {
    agentId: string;
    action: string;
    endpoint: string;
    requestParams?: Record<string, unknown>;
    responseStatus?: number;
    responseTimeMs?: number;
    errorMessage?: string;
    agentVersion?: string;
    correlationId?: string;
  }): Promise<void> {
    const pool = getDbPool();
    try {
      await pool.query(
        `INSERT INTO agent_activity_log
          (id, agent_id, action, endpoint, request_params, response_status, response_time_ms, error_message, agent_version)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          params.agentId,
          params.action,
          params.endpoint,
          params.requestParams ? JSON.stringify(params.requestParams) : null,
          params.responseStatus || null,
          params.responseTimeMs || null,
          params.errorMessage || null,
          params.agentVersion || null
        ]
      );

      await pool.query(
        `UPDATE agent_registry
         SET last_seen_at = NOW(), total_requests = total_requests + 1, updated_at = NOW()
         WHERE id = $1`,
        [params.agentId]
      );
    } catch (error) {
      logger.error('Agent activity log failed', { error, agentId: params.agentId, correlation_id: params.correlationId });
    }
  }
}
