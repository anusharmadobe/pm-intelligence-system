import { Pool } from 'pg';
import { config } from '../config/env';

let pool: Pool | null = null;

export function getDbPool(): Pool {
  if (!pool) {
    const poolConfig: any = {
      host: config.db.host,
      port: config.db.port,
      database: config.db.database,
      user: config.db.user,
    };
    
    // Only add password if it's not empty and is a valid string
    if (config.db.password && typeof config.db.password === 'string' && config.db.password.trim() !== '') {
      poolConfig.password = config.db.password.trim();
    }
    
    pool = new Pool(poolConfig);
  }
  return pool;
}

export async function closeDbPool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
