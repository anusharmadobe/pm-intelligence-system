import { randomUUID } from 'crypto';
import { getDbPool } from '../db/connection';
import { validateSignal } from '../validation/signal_validator';
import { logger } from '../utils/logger';
import { processSlackSignal } from '../services/slack_structuring_service';

export interface RawSignal {
  source: string;
  id?: string;
  type?: string;
  text: string;
  severity?: number;
  confidence?: number;
  metadata?: Record<string, any>;
}

/**
 * Signal quality dimensions for multi-dimensional scoring
 */
export interface SignalQualityDimensions {
  textQuality: number;      // Based on text length and structure
  entityRichness: number;   // Based on extracted entities
  channelWeight: number;    // Based on channel importance (1.0 default)
  compositeScore: number;   // Final weighted score
}

export interface Signal {
  id: string;
  source: string;
  source_ref: string;
  signal_type: string;
  content: string;
  normalized_content: string;
  severity: number | null;
  confidence: number | null;
  metadata: Record<string, any> | null;
  created_at: Date;
}

import { normalizeTextForSimilarity, extractCustomerNames, extractTopics, extractDates, extractAssignees } from '../utils/text_processing';

/**
 * Calculates base quality score components (synchronous)
 */
function calculateBaseQualityScore(raw: RawSignal, customers: string[], topics: string[]): {
  textQuality: number;
  entityRichness: number;
  baseScore: number;
} {
  const textLength = raw.text.trim().length;
  
  // Text quality: based on length and structure
  const textQuality = textLength > 200 ? 40 : 
                      textLength > 100 ? 35 :
                      textLength > 50 ? 30 : 
                      textLength > 20 ? 20 : 10;
  
  // Entity richness: based on extracted entities
  const entityRichness = (customers.length > 0 ? 15 : 0) + 
                         (topics.length > 0 ? 15 : 0) +
                         (raw.severity ? 10 : 0) +
                         (raw.confidence ? 10 : 0);
  
  const baseScore = textQuality + entityRichness;
  
  return { textQuality, entityRichness, baseScore };
}

/**
 * Enriches signal metadata with extracted entities.
 * This caches extracted entities to avoid re-extraction during clustering.
 */
function enrichSignalMetadata(raw: RawSignal, existingMetadata: Record<string, any> | null = null): Record<string, any> {
  const metadata = { ...(existingMetadata || {}) };
  
  // Extract and cache entities
  const customers = extractCustomerNames(raw.text, metadata);
  const topics = extractTopics(raw.text);
  const dates = extractDates(raw.text);
  const assignees = extractAssignees(raw.text);
  
  if (customers.length > 0) {
    metadata.customers = customers;
  }
  if (topics.length > 0) {
    metadata.topics = topics;
  }
  if (dates.length > 0) {
    metadata.dates = dates;
  }
  if (assignees.length > 0) {
    metadata.assignees = assignees;
  }
  
  // Calculate base quality score components
  const { textQuality, entityRichness, baseScore } = calculateBaseQualityScore(raw, customers, topics);
  
  // Store quality dimensions for later channel weight application
  metadata.quality_dimensions = {
    textQuality,
    entityRichness,
    channelWeight: 1.0, // Default, will be updated async if channel info available
    compositeScore: Math.min(100, baseScore)
  } as SignalQualityDimensions;
  
  // Legacy quality_score for backward compatibility
  metadata.quality_score = Math.min(100, baseScore);
  
  return metadata;
}

/**
 * Applies channel weight to signal quality score (async)
 * Called after signal is created if channel info is available
 */
export async function applyChannelWeightToSignal(signal: Signal): Promise<Signal> {
  if (signal.source !== 'slack' || !signal.metadata?.channel_id) {
    return signal;
  }
  
  try {
    // Dynamic import to avoid circular dependency
    const { getChannelWeight } = await import('../services/channel_registry_service');
    const channelWeight = await getChannelWeight(signal.metadata.channel_id);
    
    if (signal.metadata.quality_dimensions) {
      const dimensions = signal.metadata.quality_dimensions as SignalQualityDimensions;
      dimensions.channelWeight = channelWeight;
      
      // Recalculate composite score with channel weight
      const baseScore = dimensions.textQuality + dimensions.entityRichness;
      dimensions.compositeScore = Math.min(100, Math.round(baseScore * channelWeight));
      
      // Update legacy quality_score
      signal.metadata.quality_score = dimensions.compositeScore;
    } else {
      // Fallback: just apply weight to existing score
      const baseScore = signal.metadata.quality_score || 50;
      signal.metadata.quality_score = Math.min(100, Math.round(baseScore * channelWeight));
      signal.metadata.channel_weight = channelWeight;
    }
    
    logger.debug('Channel weight applied to signal', {
      signalId: signal.id,
      channelId: signal.metadata.channel_id,
      channelWeight,
      newScore: signal.metadata.quality_score
    });
  } catch (error: any) {
    // Non-fatal: continue without channel weight
    logger.warn('Failed to apply channel weight', { error: error.message, signalId: signal.id });
  }
  
  return signal;
}

/**
 * Extracts and normalizes a signal from raw input.
 * Signals are immutable and never contain summaries or insights.
 * Uses improved text normalization for better similarity matching.
 * Enriches metadata with extracted entities for caching.
 */
export function extractSignal(raw: RawSignal): Signal {
  const enrichedMetadata = enrichSignalMetadata(raw, raw.metadata);
  
  return {
    id: randomUUID(),
    source: raw.source,
    source_ref: raw.id || '',
    signal_type: raw.type || 'unknown',
    content: raw.text,
    normalized_content: normalizeTextForSimilarity(raw.text), // Improved normalization
    severity: raw.severity ?? null,
    confidence: raw.confidence ?? null,
    metadata: enrichedMetadata,
    created_at: new Date()
  };
}

/**
 * Checks if a signal with the same source and source_ref already exists.
 * Prevents duplicate signal ingestion.
 */
export async function signalExists(source: string, sourceRef: string): Promise<boolean> {
  const pool = getDbPool();
  const result = await pool.query(
    'SELECT 1 FROM signals WHERE source = $1 AND source_ref = $2 LIMIT 1',
    [source, sourceRef]
  );
  return result.rows.length > 0;
}

/**
 * Stores a signal in the database.
 * Signals are immutable - once stored, they cannot be modified.
 * Checks for duplicates before inserting.
 */
export async function storeSignal(signal: Signal): Promise<void> {
  const pool = getDbPool();
  
  // Check for duplicate
  if (signal.source_ref && await signalExists(signal.source, signal.source_ref)) {
    logger.debug('Signal already exists, skipping', { 
      source: signal.source, 
      sourceRef: signal.source_ref 
    });
    return;
  }
  
  try {
    await pool.query(
      `INSERT INTO signals (id, source, source_ref, signal_type, content, normalized_content, severity, confidence, metadata, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        signal.id,
        signal.source,
        signal.source_ref,
        signal.signal_type,
        signal.content,
        signal.normalized_content,
        signal.severity,
        signal.confidence,
        signal.metadata ? JSON.stringify(signal.metadata) : null,
        signal.created_at
      ]
    );
    logger.debug('Signal stored in database', { signalId: signal.id });
  } catch (error: any) {
    // Handle unique constraint violation (duplicate)
    if (error.code === '23505') { // PostgreSQL unique violation
      logger.debug('Signal duplicate detected (unique constraint)', { 
        source: signal.source, 
        sourceRef: signal.source_ref 
      });
      return;
    }
    logger.error('Failed to store signal', { error: error.message, signalId: signal.id });
    throw error;
  }
}

/**
 * Ingests a raw signal: extracts and stores it.
 * Validates the signal before ingestion.
 * Applies channel weight for Slack signals.
 */
export async function ingestSignal(raw: RawSignal): Promise<Signal> {
  logger.info('Ingesting signal', { source: raw.source, type: raw.type });
  
  // Validate signal before processing
  const validationErrors = validateSignal(raw);
  if (validationErrors.length > 0) {
    const errorMessages = validationErrors.map(e => `${e.field}: ${e.message}`).join(', ');
    logger.warn('Signal validation failed', { errors: validationErrors, raw });
    throw new Error(`Signal validation failed: ${errorMessages}`);
  }

  let signal = extractSignal(raw);

  // If this is a reply, inherit customer name from parent thread message
  const threadTs = raw.metadata?.thread_ts;
  const messageTs = raw.metadata?.timestamp || raw.metadata?.ts;
  if (threadTs && messageTs && threadTs !== messageTs) {
    try {
      const pool = getDbPool();
      const parent = await pool.query(
        'SELECT metadata FROM signals WHERE source = $1 AND source_ref = $2 LIMIT 1',
        [raw.source, String(threadTs)]
      );
      if (parent.rows.length > 0) {
        const parentMetadata = parseMetadata(parent.rows[0].metadata);
        const parentCustomers = parentMetadata?.customers;
        if (Array.isArray(parentCustomers) && parentCustomers.length > 0) {
          signal.metadata = {
            ...(signal.metadata || {}),
            customers: parentCustomers
          };
        }
      }
    } catch (error: any) {
      logger.warn('Failed to inherit parent thread customer', {
        error: error.message,
        source: raw.source,
        threadTs
      });
    }
  }

  // Apply channel weight for Slack signals (enhances quality scoring)
  if (signal.source === 'slack' && signal.metadata?.channel_id) {
    signal = await applyChannelWeightToSignal(signal);
  }

  await storeSignal(signal);

  if (signal.source === 'slack') {
    try {
      await processSlackSignal(signal);
    } catch (error: any) {
      logger.warn('Slack structuring failed', { error: error.message, signalId: signal.id });
    }
  }
  
  logger.info('Signal ingested successfully', { 
    signalId: signal.id, 
    source: signal.source,
    type: signal.signal_type,
    qualityScore: signal.metadata?.quality_score
  });
  
  return signal;
}

export interface SignalQueryOptions {
  source?: string;
  signalType?: string;
  customer?: string;
  topic?: string;
  startDate?: Date;
  endDate?: Date;
  minQualityScore?: number;
  limit?: number;
  offset?: number;
  orderBy?: 'created_at' | 'quality_score' | 'severity';
  orderDirection?: 'ASC' | 'DESC';
}

/**
 * Helper function to parse metadata safely.
 */
function parseMetadata(metadata: any): Record<string, any> | null {
  if (!metadata) return null;
  if (typeof metadata === 'object' && !Array.isArray(metadata)) return metadata;
  if (typeof metadata === 'string') {
    try {
      return JSON.parse(metadata);
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Retrieves signals with filtering and pagination.
 */
export async function getSignals(options: SignalQueryOptions = {}): Promise<Signal[]> {
  const pool = getDbPool();
  const {
    source,
    signalType,
    customer,
    topic,
    startDate,
    endDate,
    minQualityScore,
    limit = 100,
    offset = 0,
    orderBy = 'created_at',
    orderDirection = 'DESC'
  } = options;
  
  let query = 'SELECT * FROM signals WHERE 1=1';
  const params: any[] = [];
  let paramIndex = 1;
  
  if (source) {
    query += ` AND source = $${paramIndex++}`;
    params.push(source);
  }
  
  if (signalType) {
    query += ` AND signal_type = $${paramIndex++}`;
    params.push(signalType);
  }
  
  if (startDate) {
    query += ` AND created_at >= $${paramIndex++}`;
    params.push(startDate);
  }
  
  if (endDate) {
    query += ` AND created_at <= $${paramIndex++}`;
    params.push(endDate);
  }
  
  // Order by
  const validOrderBy = ['created_at', 'quality_score', 'severity'].includes(orderBy) 
    ? orderBy 
    : 'created_at';
  const validDirection = orderDirection === 'ASC' ? 'ASC' : 'DESC';
  query += ` ORDER BY ${validOrderBy} ${validDirection}`;
  
  // Limit and offset
  query += ` LIMIT $${paramIndex++} OFFSET $${paramIndex++}`;
  params.push(limit, offset);
  
  const result = await pool.query(query, params);
  let signals = result.rows.map(row => ({
    ...row,
    metadata: parseMetadata(row.metadata),
    created_at: new Date(row.created_at)
  }));
  
  // Filter by customer/topic/quality score in memory (could be optimized with DB queries)
  if (customer || topic || minQualityScore !== undefined) {
    signals = signals.filter(signal => {
      const metadata = signal.metadata || {};
      
      if (customer) {
        const customers = metadata.customers || [];
        if (!customers.some((c: string) => c.toLowerCase().includes(customer.toLowerCase()))) {
          return false;
        }
      }
      
      if (topic) {
        const topics = metadata.topics || [];
        if (!topics.some((t: string) => t.toLowerCase().includes(topic.toLowerCase()))) {
          return false;
        }
      }
      
      if (minQualityScore !== undefined) {
        const qualityScore = metadata.quality_score || 0;
        if (qualityScore < minQualityScore) {
          return false;
        }
      }
      
      return true;
    });
  }
  
  return signals;
}

/**
 * Retrieves signals by source (backward compatibility).
 */
export async function getSignalsBySource(source: string): Promise<Signal[]> {
  return getSignals({ source });
}

/**
 * Retrieves all signals (backward compatibility).
 */
export async function getAllSignals(): Promise<Signal[]> {
  return getSignals({ limit: 1000 }); // Default limit for safety
}

/**
 * Counts signals matching the query options.
 */
export async function countSignals(options: Omit<SignalQueryOptions, 'limit' | 'offset' | 'orderBy' | 'orderDirection'> = {}): Promise<number> {
  const pool = getDbPool();
  const { source, signalType, startDate, endDate } = options;
  
  let query = 'SELECT COUNT(*) as count FROM signals WHERE 1=1';
  const params: any[] = [];
  let paramIndex = 1;
  
  if (source) {
    query += ` AND source = $${paramIndex++}`;
    params.push(source);
  }
  
  if (signalType) {
    query += ` AND signal_type = $${paramIndex++}`;
    params.push(signalType);
  }
  
  if (startDate) {
    query += ` AND created_at >= $${paramIndex++}`;
    params.push(startDate);
  }
  
  if (endDate) {
    query += ` AND created_at <= $${paramIndex++}`;
    params.push(endDate);
  }
  
  const result = await pool.query(query, params);
  return parseInt(result.rows[0].count, 10);
}
