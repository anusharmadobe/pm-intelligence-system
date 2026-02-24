import { getDbPool } from '../db/connection';
import { logger } from '../utils/logger';

export interface DeduplicationConfig {
  similarityThreshold?: number;
  timeWindowHours?: number;
  sameChannelOnly?: boolean;
  maxSignals?: number;
}

interface DuplicateCandidate {
  id: string;
  metadata: Record<string, any> | null;
  similarity: number;
}

function parseMetadata(value: unknown): Record<string, any> | null {
  if (!value) return null;
  return typeof value === 'string' ? JSON.parse(value) : value;
}

function getNormalizedQuality(metadata: Record<string, any> | null): number {
  if (!metadata) return 0;
  const raw = metadata?.quality_dimensions?.compositeScore ?? metadata?.quality_score ?? 0;
  return typeof raw === 'number' && raw > 1 ? raw / 100 : raw;
}

export async function findDuplicateSignals(
  signalId: string,
  config: Partial<DeduplicationConfig> = {}
): Promise<DuplicateCandidate[]> {
  try {
    const pool = getDbPool();
    const finalConfig = {
      similarityThreshold: 0.9,
      timeWindowHours: 24,
      sameChannelOnly: true,
      ...config
    };

    const channelFilter = finalConfig.sameChannelOnly
      ? `AND (s1.metadata->>'channelId') = (s2.metadata->>'channelId')`
      : '';

    const result = await pool.query(
      `
      SELECT s2.id, s2.metadata, 1 - (se2.embedding <=> se1.embedding) AS similarity
      FROM signal_embeddings se1
      JOIN signal_embeddings se2 ON se2.signal_id != se1.signal_id
      JOIN signals s1 ON s1.id = se1.signal_id
      JOIN signals s2 ON s2.id = se2.signal_id
      WHERE se1.signal_id = $1
        AND s1.is_duplicate_of IS NULL
        AND s2.is_duplicate_of IS NULL
        AND (1 - (se2.embedding <=> se1.embedding)) >= $2
        AND s2.created_at BETWEEN s1.created_at - ($3 || ' hours')::interval
                            AND s1.created_at + ($3 || ' hours')::interval
        ${channelFilter}
      ORDER BY similarity DESC
      `,
      [signalId, finalConfig.similarityThreshold, finalConfig.timeWindowHours]
    );

    return result.rows.map((row: { id: string; metadata: unknown; similarity: number }) => ({
      id: row.id,
      metadata: parseMetadata(row.metadata),
      similarity: Number(row.similarity || 0)
    }));
  } catch (error: any) {
    logger.error('Failed to find duplicate signals', {
      signal_id: signalId,
      config,
      error: error.message,
      stack: error.stack
    });
    throw new Error(`Duplicate signal detection failed: ${error.message}`);
  }
}

export async function mergeDuplicateSignals(primaryId: string, duplicateIds: string[]): Promise<void> {
  if (duplicateIds.length === 0) return;

  try {
    const pool = getDbPool();

    await pool.query(
      `UPDATE signals
       SET is_duplicate_of = $1
       WHERE id = ANY($2)`,
      [primaryId, duplicateIds]
    );

    // Remove duplicate signals from existing opportunities
    await pool.query(
      `DELETE FROM opportunity_signals WHERE signal_id = ANY($1)`,
      [duplicateIds]
    );

    logger.info('Merged duplicate signals', {
      primary_id: primaryId,
      duplicate_count: duplicateIds.length
    });
  } catch (error: any) {
    logger.error('Failed to merge duplicate signals', {
      primary_id: primaryId,
      duplicate_ids: duplicateIds,
      error: error.message,
      stack: error.stack
    });
    throw new Error(`Duplicate signal merge failed: ${error.message}`);
  }
}

export async function runDeduplicationPass(
  config: Partial<DeduplicationConfig> = {}
): Promise<{ merged: number; remaining: number }> {
  try {
    const pool = getDbPool();
    const finalConfig = {
      similarityThreshold: 0.9,
      timeWindowHours: 24,
      sameChannelOnly: true,
      maxSignals: 1000,
      ...config
    };

    const candidatesResult = await pool.query(
      `
      SELECT s.id, s.metadata
      FROM signals s
      JOIN signal_embeddings se ON se.signal_id = s.id
      WHERE s.is_duplicate_of IS NULL
      ORDER BY s.created_at DESC
      LIMIT $1
      `,
      [finalConfig.maxSignals]
    );

    const processed = new Set<string>();
    let merged = 0;

    for (const row of candidatesResult.rows) {
      const signalId = row.id;
      if (processed.has(signalId)) continue;

      try {
        const duplicates = await findDuplicateSignals(signalId, finalConfig);
        if (duplicates.length === 0) {
          processed.add(signalId);
          continue;
        }

        const seed = { id: signalId, metadata: parseMetadata(row.metadata) };
        const group = [seed, ...duplicates];

        let primary = seed;
        let bestQuality = getNormalizedQuality(seed.metadata);
        for (const candidate of duplicates) {
          const quality = getNormalizedQuality(candidate.metadata);
          if (quality > bestQuality) {
            primary = candidate as unknown as typeof seed;
            bestQuality = quality;
          }
        }

        const duplicateIds = group.filter(g => g.id !== primary.id).map(g => g.id);
        if (duplicateIds.length > 0) {
          await mergeDuplicateSignals(primary.id, duplicateIds);
          merged += duplicateIds.length;
        }

        group.forEach(g => processed.add(g.id));
      } catch (signalError: any) {
        // Log error but continue with other signals
        logger.error('Failed to process signal for deduplication, continuing', {
          signal_id: signalId,
          error: signalError.message
        });
        processed.add(signalId);
        // Continue processing other signals
      }
    }

    const remainingResult = await pool.query(
      `SELECT COUNT(*) as count FROM signals WHERE is_duplicate_of IS NULL`
    );
    const remaining = parseInt(remainingResult.rows[0]?.count || '0', 10);

    logger.info('Deduplication pass completed', {
      merged,
      remaining,
      processed: processed.size
    });

    return { merged, remaining };
  } catch (error: any) {
    logger.error('Deduplication pass failed', {
      config,
      error: error.message,
      stack: error.stack
    });
    throw new Error(`Deduplication pass failed: ${error.message}`);
  }
}
