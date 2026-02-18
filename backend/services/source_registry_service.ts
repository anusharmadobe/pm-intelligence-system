import { logger } from '../utils/logger';
import { getDbPool } from '../db/connection';

export type SourceStatus = 'connected' | 'error' | 'disabled';

export interface SourceRegistryRecord {
  id: string;
  source_name: string;
  source_type: string;
  status: SourceStatus;
  config: Record<string, unknown>;
  last_synced_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

export class SourceRegistryService {
  async listSources(filters?: { type?: string; status?: SourceStatus }): Promise<SourceRegistryRecord[]> {
    const pool = getDbPool();
    const params: any[] = [];
    let where = 'WHERE 1=1';
    if (filters?.type) {
      params.push(filters.type);
      where += ` AND source_type = $${params.length}`;
    }
    if (filters?.status) {
      params.push(filters.status);
      where += ` AND status = $${params.length}`;
    }
    const result = await pool.query(
      `SELECT * FROM source_registry ${where} ORDER BY updated_at DESC`,
      params
    );
    return result.rows;
  }

  async getSourceById(id: string): Promise<SourceRegistryRecord | null> {
    const pool = getDbPool();
    const result = await pool.query(`SELECT * FROM source_registry WHERE id = $1`, [id]);
    return result.rows[0] || null;
  }

  async registerSource(params: {
    source_name: string;
    source_type: string;
    config?: Record<string, unknown>;
    status?: SourceStatus;
  }): Promise<SourceRegistryRecord> {
    const pool = getDbPool();
    const result = await pool.query(
      `INSERT INTO source_registry (source_name, source_type, config, status)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (source_name)
       DO UPDATE SET config = EXCLUDED.config, status = EXCLUDED.status, updated_at = NOW()
       RETURNING *`,
      [
        params.source_name,
        params.source_type,
        JSON.stringify(params.config || {}),
        params.status || 'connected'
      ]
    );
    return result.rows[0];
  }

  async updateStatus(id: string, status: SourceStatus, lastError?: string | null): Promise<void> {
    const pool = getDbPool();
    await pool.query(
      `UPDATE source_registry
       SET status = $2, last_error = $3, updated_at = NOW()
       WHERE id = $1`,
      [id, status, lastError || null]
    );
  }

  async updateSource(
    id: string,
    params: { status?: SourceStatus; config?: Record<string, unknown> }
  ): Promise<SourceRegistryRecord | null> {
    const pool = getDbPool();
    const current = await pool.query(`SELECT * FROM source_registry WHERE id = $1`, [id]);
    if (!current.rows[0]) return null;
    const mergedConfig = {
      ...(current.rows[0].config || {}),
      ...(params.config || {})
    };
    const status = params.status || current.rows[0].status;
    const result = await pool.query(
      `UPDATE source_registry
       SET status = $2, config = $3, updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [id, status, JSON.stringify(mergedConfig)]
    );
    return result.rows[0] || null;
  }

  async recordSync(id: string, success: boolean, errorMessage?: string): Promise<void> {
    const pool = getDbPool();
    await pool.query(
      `UPDATE source_registry
       SET status = $2,
           last_synced_at = NOW(),
           last_error = $3,
           updated_at = NOW()
       WHERE id = $1`,
      [id, success ? 'connected' : 'error', errorMessage || null]
    );
  }
}
