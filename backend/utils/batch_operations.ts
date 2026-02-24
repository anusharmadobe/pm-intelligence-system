/**
 * Batch Operations
 *
 * Utilities for performing batch operations efficiently
 */

import { getDbPool } from '../db/connection';
import { logger } from './logger';

export interface BatchResult<T = any> {
  successful: T[];
  failed: Array<{ item: any; error: string }>;
  totalProcessed: number;
  successCount: number;
  failureCount: number;
}

/**
 * Process items in batches with concurrency control
 */
export async function processBatch<T, R>(
  items: T[],
  processor: (item: T) => Promise<R>,
  options: {
    batchSize?: number;
    concurrency?: number;
    continueOnError?: boolean;
    onProgress?: (processed: number, total: number) => void;
  } = {}
): Promise<BatchResult<R>> {
  const {
    batchSize = 100,
    concurrency = 5,
    continueOnError = true,
    onProgress
  } = options;

  const result: BatchResult<R> = {
    successful: [],
    failed: [],
    totalProcessed: 0,
    successCount: 0,
    failureCount: 0
  };

  // Process in chunks
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);

    // Process batch with concurrency limit
    const promises = batch.map(async (item) => {
      try {
        const res = await processor(item);
        result.successful.push(res);
        result.successCount++;
        return { success: true, result: res };
      } catch (error: any) {
        result.failed.push({ item, error: error.message });
        result.failureCount++;

        if (!continueOnError) {
          throw error;
        }

        return { success: false, error: error.message };
      } finally {
        result.totalProcessed++;
        if (onProgress) {
          onProgress(result.totalProcessed, items.length);
        }
      }
    });

    // Limit concurrency
    const chunks = [];
    for (let j = 0; j < promises.length; j += concurrency) {
      chunks.push(promises.slice(j, j + concurrency));
    }

    for (const chunk of chunks) {
      await Promise.all(chunk);
    }
  }

  return result;
}

/**
 * Batch insert records into database
 */
export async function batchInsert<T extends Record<string, any>>(
  table: string,
  records: T[],
  options: {
    batchSize?: number;
    onConflict?: 'ignore' | 'update';
    conflictColumns?: string[];
    updateColumns?: string[];
  } = {}
): Promise<number> {
  if (records.length === 0) return 0;

  const pool = getDbPool();
  const { batchSize = 1000, onConflict, conflictColumns, updateColumns } = options;

  let totalInserted = 0;

  // Get column names from first record
  const columns = Object.keys(records[0]);
  const columnList = columns.join(', ');

  // Process in batches
  for (let i = 0; i < records.length; i += batchSize) {
    const batch = records.slice(i, i + batchSize);

    // Build VALUES clause
    const values: any[] = [];
    const valuePlaceholders = batch.map((record, batchIndex) => {
      const placeholders = columns.map((col, colIndex) => {
        const paramIndex = batchIndex * columns.length + colIndex + 1;
        values.push(record[col]);
        return `$${paramIndex}`;
      });
      return `(${placeholders.join(', ')})`;
    }).join(', ');

    // Build query
    let query = `INSERT INTO ${table} (${columnList}) VALUES ${valuePlaceholders}`;

    if (onConflict === 'ignore' && conflictColumns) {
      query += ` ON CONFLICT (${conflictColumns.join(', ')}) DO NOTHING`;
    } else if (onConflict === 'update' && conflictColumns && updateColumns) {
      const updates = updateColumns.map(col => `${col} = EXCLUDED.${col}`).join(', ');
      query += ` ON CONFLICT (${conflictColumns.join(', ')}) DO UPDATE SET ${updates}`;
    }

    try {
      const result = await pool.query(query, values);
      totalInserted += result.rowCount || 0;
    } catch (error: any) {
      logger.error('Batch insert failed', {
        error: error.message,
        table,
        batchStart: i,
        batchSize: batch.length
      });
      throw error;
    }
  }

  return totalInserted;
}

/**
 * Batch update records
 */
export async function batchUpdate(
  table: string,
  updates: Array<{ id: string; data: Record<string, any> }>,
  options: {
    batchSize?: number;
    idColumn?: string;
  } = {}
): Promise<number> {
  if (updates.length === 0) return 0;

  const pool = getDbPool();
  const { batchSize = 1000, idColumn = 'id' } = options;

  let totalUpdated = 0;

  // Process in batches
  for (let i = 0; i < updates.length; i += batchSize) {
    const batch = updates.slice(i, i + batchSize);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      for (const update of batch) {
        const columns = Object.keys(update.data);
        const setClause = columns.map((col, idx) => `${col} = $${idx + 2}`).join(', ');
        const values = [update.id, ...columns.map(col => update.data[col])];

        const result = await client.query(
          `UPDATE ${table} SET ${setClause} WHERE ${idColumn} = $1`,
          values
        );

        totalUpdated += result.rowCount || 0;
      }

      await client.query('COMMIT');
    } catch (error: any) {
      await client.query('ROLLBACK');
      logger.error('Batch update failed', {
        error: error.message,
        table,
        batchStart: i
      });
      throw error;
    } finally {
      client.release();
    }
  }

  return totalUpdated;
}

/**
 * Batch delete records
 */
export async function batchDelete(
  table: string,
  ids: string[],
  options: {
    batchSize?: number;
    idColumn?: string;
  } = {}
): Promise<number> {
  if (ids.length === 0) return 0;

  const pool = getDbPool();
  const { batchSize = 1000, idColumn = 'id' } = options;

  let totalDeleted = 0;

  // Process in batches
  for (let i = 0; i < ids.length; i += batchSize) {
    const batch = ids.slice(i, i + batchSize);

    const placeholders = batch.map((_, idx) => `$${idx + 1}`).join(', ');

    try {
      const result = await pool.query(
        `DELETE FROM ${table} WHERE ${idColumn} IN (${placeholders})`,
        batch
      );

      totalDeleted += result.rowCount || 0;
    } catch (error: any) {
      logger.error('Batch delete failed', {
        error: error.message,
        table,
        batchStart: i,
        batchSize: batch.length
      });
      throw error;
    }
  }

  return totalDeleted;
}

/**
 * Batch execute queries in transaction
 */
export async function batchExecute(
  queries: Array<{ sql: string; params: any[] }>,
  options: {
    transaction?: boolean;
  } = {}
): Promise<BatchResult> {
  const pool = getDbPool();
  const { transaction = true } = options;

  const result: BatchResult = {
    successful: [],
    failed: [],
    totalProcessed: 0,
    successCount: 0,
    failureCount: 0
  };

  if (transaction) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      for (const query of queries) {
        try {
          const res = await client.query(query.sql, query.params);
          result.successful.push(res);
          result.successCount++;
        } catch (error: any) {
          result.failed.push({ item: query, error: error.message });
          result.failureCount++;
          throw error; // Rollback on first error
        }
        result.totalProcessed++;
      }

      await client.query('COMMIT');
    } catch (error: any) {
      await client.query('ROLLBACK');
      logger.error('Batch transaction failed', {
        error: error.message,
        totalQueries: queries.length,
        processed: result.totalProcessed
      });
      throw error;
    } finally {
      client.release();
    }
  } else {
    for (const query of queries) {
      try {
        const res = await pool.query(query.sql, query.params);
        result.successful.push(res);
        result.successCount++;
      } catch (error: any) {
        result.failed.push({ item: query, error: error.message });
        result.failureCount++;
      }
      result.totalProcessed++;
    }
  }

  return result;
}
