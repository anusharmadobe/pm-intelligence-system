import { randomUUID } from 'crypto';
import { getDbPool } from '../db/connection';
import { Signal } from '../processing/signal_extractor';
import {
  calculateWeightedSimilarity,
  extractCustomerNames,
  extractTopics,
  extractMeaningfulWords,
  fuzzyCustomerMatch
} from '../utils/text_processing';
import { logger as globalLogger, createModuleLogger } from '../utils/logger';
import { computeSignalTrends, TrendResult } from './trend_analysis_service';
import { getChannelConfig } from './channel_registry_service';

// Create module-specific logger for opportunity operations
const logger = createModuleLogger('opportunity', 'LOG_LEVEL_OPPORTUNITY');

export interface Opportunity {
  id: string;
  title: string;
  description: string;
  status: string;
  created_at: Date;
}

/**
 * Configuration for opportunity detection.
 */
export interface OpportunityDetectionConfig {
  /** Minimum similarity threshold for clustering (0.0 to 1.0) */
  similarityThreshold: number;
  /** Minimum cluster size to create an opportunity */
  minClusterSize: number;
  /** Whether to require same source for clustering */
  requireSameSource: boolean;
  /** Whether to require same signal type for clustering */
  requireSameType: boolean;
  /** Time window in hours for time-based similarity */
  timeWindowHours: number;
}

const DEFAULT_CONFIG: OpportunityDetectionConfig = {
  similarityThreshold: 0.15, // Lowered from 0.2 to catch more related signals
  minClusterSize: 2,
  requireSameSource: true,
  requireSameType: false, // Allow different signal types to cluster
  timeWindowHours: 24 * 7 // 7 days
};

/**
 * Detects opportunities by clustering related signals.
 * Uses improved weighted similarity that considers:
 * - Word overlap (Jaccard similarity)
 * - Customer name overlap
 * - Topic overlap
 * - Time proximity
 * NO INFERENCE - only clusters signals based on similarity.
 */
export async function detectOpportunities(
  signals: Signal[],
  config: Partial<OpportunityDetectionConfig> = {}
): Promise<Opportunity[]> {
  if (signals.length === 0) return [];

  const finalConfig = { ...DEFAULT_CONFIG, ...config };
  logger.debug('Detecting opportunities', {
    signalCount: signals.length,
    config: finalConfig
  });

  const clusters: Signal[][] = [];
  const processed = new Set<string>();

  for (const signal of signals) {
    if (processed.has(signal.id)) continue;

    const cluster = [signal];
    processed.add(signal.id);

    // Cluster signals using improved similarity
    for (const otherSignal of signals) {
      if (processed.has(otherSignal.id)) continue;
      if (areSignalsRelated(signal, otherSignal, finalConfig)) {
        cluster.push(otherSignal);
        processed.add(otherSignal.id);
      }
    }

    if (cluster.length > 0) {
      clusters.push(cluster);
    }
  }

  // Only create opportunities for clusters meeting minimum size
  const validClusters = clusters.filter(cluster => cluster.length >= finalConfig.minClusterSize);
  
  logger.info('Opportunity detection complete', {
    totalClusters: clusters.length,
    validClusters: validClusters.length,
    totalSignals: signals.length
  });

  return Promise.all(validClusters.map(cluster => createOpportunityFromCluster(cluster)));
}

/**
 * Determines if two signals are related using weighted similarity.
 * Improved clustering logic with early termination for performance.
 */
function areSignalsRelated(
  signal1: Signal,
  signal2: Signal,
  config: OpportunityDetectionConfig
): boolean {
  logger.trace('Checking signal relationship', {
    stage: 'opportunity_clustering',
    signal1_id: signal1.id,
    signal2_id: signal2.id,
    signal1_source: signal1.source,
    signal2_source: signal2.source,
    signal1_type: signal1.signal_type,
    signal2_type: signal2.signal_type,
    config: {
      requireSameSource: config.requireSameSource,
      requireSameType: config.requireSameType,
      similarityThreshold: config.similarityThreshold
    }
  });

  // Early termination: Check source requirement first (cheapest check)
  if (config.requireSameSource && signal1.source !== signal2.source) {
    logger.trace('Signals not related: different sources', {
      stage: 'opportunity_clustering',
      signal1_id: signal1.id,
      signal2_id: signal2.id,
      source1: signal1.source,
      source2: signal2.source,
      reason: 'source_mismatch'
    });
    return false;
  }

  // Early termination: Check signal type requirement
  if (config.requireSameType && signal1.signal_type !== signal2.signal_type) {
    logger.trace('Signals not related: different types', {
      stage: 'opportunity_clustering',
      signal1_id: signal1.id,
      signal2_id: signal2.id,
      type1: signal1.signal_type,
      type2: signal2.signal_type,
      reason: 'type_mismatch'
    });
    return false;
  }

  // Early termination: Quick customer check using cached metadata
  // If both have customers and they don't match, skip expensive similarity calculation
  const customers1 = signal1.metadata?.customers || [];
  const customers2 = signal2.metadata?.customers || [];
  if (customers1.length > 0 && customers2.length > 0) {
    const hasMatchingCustomer = customers1.some((c1: string) =>
      customers2.some((c2: string) =>
        fuzzyCustomerMatch(c1, c2)
      )
    );
    // If customers don't match and customer weight is high, similarity will be low
    // But we still calculate to be safe (customer match is not required, just weighted)
  }

  // Calculate weighted similarity (uses cached entities from metadata)
  const similarity = calculateWeightedSimilarity(
    signal1,
    signal2,
    {
      wordSimilarityWeight: 0.4,
      customerWeight: 0.35, // Higher weight for customer matching
      topicWeight: 0.2,
      timeWeight: 0.05,
      timeWindowHours: config.timeWindowHours
    }
  );

  const related = similarity >= config.similarityThreshold;

  logger.trace('Signal similarity calculated', {
    stage: 'opportunity_clustering',
    signal1_id: signal1.id,
    signal2_id: signal2.id,
    similarity: similarity.toFixed(3),
    threshold: config.similarityThreshold,
    related,
    weights: {
      word: 0.4,
      customer: 0.35,
      topic: 0.2,
      time: 0.05
    }
  });

  return related;
}

/**
 * Creates an opportunity from a cluster of signals.
 * Improved title generation using customer names, topics, and meaningful words.
 * NO INFERENCE - uses simple aggregation of signal data.
 */
async function createOpportunityFromCluster(cluster: Signal[]): Promise<Opportunity> {
  logger.debug('Creating opportunity from cluster', {
    stage: 'opportunity_clustering',
    status: 'start',
    cluster_size: cluster.length,
    signal_ids: cluster.map(s => s.id)
  });

  const pool = getDbPool();
  const sources = [...new Set(cluster.map(s => s.source))];
  const types = [...new Set(cluster.map(s => s.signal_type))];

  // Extract customer names from all signals
  const allCustomers = new Set<string>();
  cluster.forEach(signal => {
    const metaCustomers = Array.isArray(signal.metadata?.customers) ? signal.metadata?.customers : null;
    const customers = metaCustomers && metaCustomers.length > 0
      ? metaCustomers
      : extractCustomerNames(signal.content, signal.metadata || null);
    customers.forEach(c => allCustomers.add(c));
  });

  logger.debug('Extracted customers for opportunity', {
    stage: 'opportunity_clustering',
    customers: Array.from(allCustomers),
    customer_count: allCustomers.size
  });

  // Extract topics from all signals
  const allTopics = new Set<string>();
  cluster.forEach(signal => {
    const topics = extractTopics(signal.content);
    topics.forEach(t => allTopics.add(t));
  });

  // Enrich with LLM extraction entities (customers, features, issues, themes)
  const signalIds = cluster.map((signal) => signal.id);
  if (signalIds.length > 0) {
    try {
      const extractionsResult = await pool.query(
        `SELECT extraction FROM signal_extractions WHERE signal_id = ANY($1)`,
        [signalIds]
      );
      for (const row of extractionsResult.rows) {
        try {
          const extraction =
            typeof row.extraction === 'string' ? JSON.parse(row.extraction) : row.extraction;
          const entities = extraction?.entities || {};
          (entities.customers || []).forEach((c: string) => {
            if (c) allCustomers.add(c);
          });
          (entities.features || []).forEach((f: string) => {
            if (f) allTopics.add(f);
          });
          (entities.issues || []).forEach((i: string) => {
            if (i) allTopics.add(i);
          });
          (entities.themes || []).forEach((t: string) => {
            if (t) allTopics.add(t);
          });
        } catch (error) {
          logger.debug('Failed to parse signal extraction for title enrichment', { error });
        }
      }
    } catch (error: any) {
      logger.error('Failed to fetch extractions for opportunity clustering', {
        error: error.message,
        errorClass: error.constructor.name,
        stack: error.stack,
        signalIds: signalIds.slice(0, 5) // Log first 5 signal IDs for context
      });
      // Continue with opportunity creation using basic extracted data
    }
  }
  
  // Extract meaningful words (excluding stop words)
  const isLikelySlackToken = (value: string) => /^w[a-z0-9]{7,}$/i.test(value);
  const allWords = cluster
    .flatMap(signal => extractMeaningfulWords(signal.normalized_content, 4))
    .filter(w => w.length >= 4 && !isLikelySlackToken(w)); // Longer words are more meaningful
  
  const wordCounts = new Map<string, number>();
  allWords.forEach(word => {
    wordCounts.set(word, (wordCounts.get(word) || 0) + 1);
  });
  
  // Build title: prioritize customer names, then topics, then common words
  const titleParts: string[] = [];
  
  // Add customer names (up to 2)
  if (allCustomers.size > 0) {
    const customerArray = Array.from(allCustomers).slice(0, 2);
    titleParts.push(customerArray.join(' & '));
  }
  
  // Add topics (up to 2)
  if (allTopics.size > 0 && titleParts.length < 2) {
    const topicArray = Array.from(allTopics).slice(0, 2 - titleParts.length);
    titleParts.push(...topicArray);
  }
  
  // Add most common meaningful words if we still need more
  if (titleParts.length < 3) {
    const topWords = [...wordCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3 - titleParts.length)
      .map(([word]) => word);
    titleParts.push(...topWords);
  }
  
  // Fallback: use signal count if no meaningful parts found
  const title = titleParts.length > 0
    ? `${titleParts.join(' - ')} (${cluster.length} signals)`
    : `Cluster of ${cluster.length} related signals`;

  logger.debug('Generated opportunity title', {
    stage: 'opportunity_clustering',
    title,
    title_parts: titleParts,
    customers: Array.from(allCustomers),
    topics: Array.from(allTopics),
    top_words: [...wordCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([word, count]) => ({ word, count }))
  });

  // Build description with more context
  const descriptionParts: string[] = [];
  descriptionParts.push(`Cluster of ${cluster.length} related signals`);
  
  if (allCustomers.size > 0) {
    descriptionParts.push(`Customers: ${Array.from(allCustomers).join(', ')}`);
  }
  
  if (allTopics.size > 0) {
    descriptionParts.push(`Topics: ${Array.from(allTopics).join(', ')}`);
  }
  
  descriptionParts.push(`Sources: ${sources.join(', ')}`);
  descriptionParts.push(`Types: ${types.join(', ')}`);

  const opportunity = {
    id: randomUUID(),
    title: title.substring(0, 150), // Increased from 100 to 150
    description: descriptionParts.join('. ') + '.',
    status: 'new',
    created_at: new Date()
  };

  logger.info('Opportunity created from cluster', {
    stage: 'opportunity_clustering',
    status: 'success',
    opportunity_id: opportunity.id,
    title: opportunity.title,
    signal_count: cluster.length,
    customer_count: allCustomers.size,
    topic_count: allTopics.size,
    sources,
    types
  });

  return opportunity;
}

/**
 * Stores an opportunity and links it to its signals.
 * Uses batch insert for signal links for better performance.
 */
export async function storeOpportunity(opportunity: Opportunity, signalIds: string[]): Promise<void> {
  const startTime = Date.now();
  const pool = getDbPool();

  logger.debug('Storing opportunity', {
    stage: 'opportunity_storage',
    status: 'start',
    opportunity_id: opportunity.id,
    title: opportunity.title,
    signal_count: signalIds.length
  });

  try {
    // Insert opportunity
    await pool.query(
      `INSERT INTO opportunities (id, title, description, status, created_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [opportunity.id, opportunity.title, opportunity.description, opportunity.status, opportunity.created_at]
    );

    logger.debug('Opportunity record inserted', {
      stage: 'opportunity_storage',
      status: 'record_inserted',
      opportunity_id: opportunity.id
    });

    // Batch insert signal links
    if (signalIds.length > 0) {
      const values = signalIds.map((_, index) =>
        `($${index * 2 + 1}, $${index * 2 + 2})`
      ).join(', ');

      const params = signalIds.flatMap(signalId => [opportunity.id, signalId]);

      await pool.query(
        `INSERT INTO opportunity_signals (opportunity_id, signal_id)
         VALUES ${values}
         ON CONFLICT DO NOTHING`,
        params
      );

      logger.debug('Signal links created', {
        stage: 'opportunity_storage',
        status: 'links_created',
        opportunity_id: opportunity.id,
        link_count: signalIds.length
      });
    }

    logger.info('Opportunity stored successfully', {
      stage: 'opportunity_storage',
      status: 'success',
      opportunity_id: opportunity.id,
      title: opportunity.title,
      signal_count: signalIds.length,
      duration_ms: Date.now() - startTime
    });
  } catch (error: any) {
    logger.error('Failed to store opportunity', {
      stage: 'opportunity_storage',
      status: 'error',
      opportunity_id: opportunity.id,
      error: error.message,
      stack: error.stack,
      duration_ms: Date.now() - startTime
    });
    throw error;
  }
}

/**
 * Gets signals that are not yet linked to any opportunity.
 */
export async function getUnlinkedSignals(sourceFilter?: string): Promise<Signal[]> {
  const pool = getDbPool();
  let query = `
    SELECT s.* FROM signals s
    LEFT JOIN opportunity_signals os ON s.id = os.signal_id
    WHERE os.signal_id IS NULL AND s.is_duplicate_of IS NULL
  `;
  const params: Array<string> = [];
  if (sourceFilter) {
    params.push(sourceFilter);
    query += ` AND s.source = $${params.length}`;
  }
  query += ' ORDER BY s.created_at DESC';
  const result = await pool.query(query, params);
  return result.rows.map(row => ({
    ...row,
    metadata: row.metadata ? (typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata) : null,
    created_at: new Date(row.created_at)
  }));
}

/**
 * Gets all existing opportunities with their linked signals.
 */
export async function getOpportunitiesWithSignals(): Promise<Array<{ opportunity: Opportunity; signals: Signal[] }>> {
  const opportunities = await getAllOpportunities();
  const result: Array<{ opportunity: Opportunity; signals: Signal[] }> = [];
  
  for (const opp of opportunities) {
    const signals = await getSignalsForOpportunity(opp.id);
    result.push({ opportunity: opp, signals });
  }
  
  return result;
}

/**
 * Adds a signal to an existing opportunity.
 */
export async function addSignalToOpportunity(opportunityId: string, signalId: string): Promise<void> {
  const pool = getDbPool();
  await pool.query(
    `INSERT INTO opportunity_signals (opportunity_id, signal_id)
     VALUES ($1, $2)
     ON CONFLICT DO NOTHING`,
    [opportunityId, signalId]
  );
  
  // Update opportunity title/description with new signal
  const signals = await getSignalsForOpportunity(opportunityId);
  if (signals.length > 0) {
    const updated = await createOpportunityFromCluster(signals);
    await pool.query(
      `UPDATE opportunities 
       SET title = $1, description = $2
       WHERE id = $3`,
      [updated.title, updated.description, opportunityId]
    );
  }
}

/**
 * Incremental opportunity detection - only processes new signals.
 * Much more efficient than re-clustering all signals.
 */
export async function detectAndStoreOpportunitiesIncremental(
  config: Partial<OpportunityDetectionConfig> = {}
): Promise<{
  newOpportunities: Opportunity[];
  updatedOpportunities: Opportunity[];
  signalsProcessed: number;
}> {
  const finalConfig = { ...DEFAULT_CONFIG, ...config };
  
  // Get only unlinked signals
  const newSignals = await getUnlinkedSignals();
  if (newSignals.length === 0) {
    logger.info('No new signals to process');
    return { newOpportunities: [], updatedOpportunities: [], signalsProcessed: 0 };
  }
  
  logger.info('Processing incremental opportunity detection', {
    newSignalsCount: newSignals.length
  });
  
  // Get existing opportunities with their signals
  const existingOpportunities = await getOpportunitiesWithSignals();
  
  const newOpportunities: Opportunity[] = [];
  const updatedOpportunities: Opportunity[] = [];
  const matchedSignals = new Set<string>();

  // Try to match new signals to existing opportunities
  const matchingStartTime = Date.now();
  let lastMatchLog = Date.now();
  const matchProgressInterval = 5000; // Log every 5 seconds

  logger.debug('Starting signal matching to existing opportunities', {
    stage: 'incremental_detection',
    status: 'matching_start',
    new_signals: newSignals.length,
    existing_opportunities: existingOpportunities.length
  });

  for (let sigIdx = 0; sigIdx < newSignals.length; sigIdx++) {
    const newSignal = newSignals[sigIdx];
    let matched = false;

    for (const { opportunity, signals } of existingOpportunities) {
      // Check if signal matches any signal in this opportunity
      for (const existingSignal of signals) {
        if (areSignalsRelated(newSignal, existingSignal, finalConfig)) {
          // Add signal to existing opportunity
          await addSignalToOpportunity(opportunity.id, newSignal.id);
          matchedSignals.add(newSignal.id);
          matched = true;

          logger.trace('Signal matched to existing opportunity', {
            stage: 'incremental_detection',
            signal_id: newSignal.id,
            opportunity_id: opportunity.id,
            opportunity_title: opportunity.title
          });

          if (!updatedOpportunities.find(o => o.id === opportunity.id)) {
            updatedOpportunities.push(opportunity);
          }

          break;
        }
      }

      if (matched) break;
    }

    // Periodic progress logging
    const now = Date.now();
    if (now - lastMatchLog >= matchProgressInterval) {
      const progress = ((sigIdx / newSignals.length) * 100).toFixed(1);
      const elapsed = now - matchingStartTime;
      const rate = sigIdx / (elapsed / 1000);
      const remaining = newSignals.length - sigIdx;
      const etaSeconds = remaining > 0 && rate > 0 ? (remaining / rate).toFixed(0) : 'N/A';

      logger.info('Signal matching progress', {
        stage: 'incremental_detection',
        status: 'matching_in_progress',
        processed: sigIdx,
        total: newSignals.length,
        progress_pct: progress,
        matched_so_far: matchedSignals.size,
        updated_opportunities: updatedOpportunities.length,
        rate_per_sec: rate.toFixed(2),
        eta_seconds: etaSeconds,
        elapsed_ms: elapsed
      });

      lastMatchLog = now;
    }
  }

  logger.info('Signal matching complete', {
    stage: 'incremental_detection',
    status: 'matching_complete',
    total_signals: newSignals.length,
    matched: matchedSignals.size,
    unmatched: newSignals.length - matchedSignals.size,
    opportunities_updated: updatedOpportunities.length,
    duration_ms: Date.now() - matchingStartTime
  });
  
  // Cluster remaining unmatched signals
  const unmatchedSignals = newSignals.filter(s => !matchedSignals.has(s.id));
  if (unmatchedSignals.length > 0) {
    const clusters = clusterSignals(unmatchedSignals, finalConfig);
    const validClusters = clusters.filter(cluster => cluster.length >= finalConfig.minClusterSize);
    
    for (const cluster of validClusters) {
      const opportunity = await createOpportunityFromCluster(cluster);
      await storeOpportunity(opportunity, cluster.map(s => s.id));
      newOpportunities.push(opportunity);
    }
  }
  
  logger.info('Incremental opportunity detection complete', {
    newSignalsProcessed: newSignals.length,
    newOpportunities: newOpportunities.length,
    updatedOpportunities: updatedOpportunities.length
  });
  
  return {
    newOpportunities,
    updatedOpportunities,
    signalsProcessed: newSignals.length
  };
}

/**
 * Detects and stores opportunities from signals (full re-clustering).
 * Use detectAndStoreOpportunitiesIncremental() for better performance.
 */
export async function detectAndStoreOpportunities(
  signals: Signal[],
  config: Partial<OpportunityDetectionConfig> = {}
): Promise<Opportunity[]> {
  const finalConfig = { ...DEFAULT_CONFIG, ...config };
  const clusters = clusterSignals(signals, finalConfig);
  const validClusters = clusters.filter(cluster => cluster.length >= finalConfig.minClusterSize);
  
  const opportunities: Opportunity[] = [];
  
  for (const cluster of validClusters) {
    const opportunity = await createOpportunityFromCluster(cluster);
    await storeOpportunity(opportunity, cluster.map(s => s.id));
    opportunities.push(opportunity);
  }
  
  return opportunities;
}

/**
 * Helper function to cluster signals (used internally).
 */
function clusterSignals(
  signals: Signal[],
  config: Partial<OpportunityDetectionConfig> = {}
): Signal[][] {
  const startTime = Date.now();
  const finalConfig = { ...DEFAULT_CONFIG, ...config };
  const progressEvery = Math.max(
    0,
    parseInt(process.env.OPPORTUNITY_CLUSTER_PROGRESS_EVERY || '500', 10)
  );

  logger.debug('Starting signal clustering', {
    stage: 'opportunity_clustering',
    status: 'start',
    signal_count: signals.length,
    config: finalConfig
  });

  const clusters: Signal[][] = [];
  const processed = new Set<string>();
  let processedCount = 0;
  let lastProgressLog = Date.now();
  const progressInterval = 5000; // Log progress every 5 seconds

  for (let idx = 0; idx < signals.length; idx++) {
    const signal = signals[idx];
    if (processed.has(signal.id)) continue;

    const cluster = [signal];
    processed.add(signal.id);

    for (const otherSignal of signals) {
      if (processed.has(otherSignal.id)) continue;
      if (areSignalsRelated(signal, otherSignal, finalConfig)) {
        cluster.push(otherSignal);
        processed.add(otherSignal.id);
      }
    }

    clusters.push(cluster);
    processedCount += 1;

    if (progressEvery > 0 && processedCount % progressEvery === 0) {
      logger.info('Signal clustering progress', {
        stage: 'opportunity_clustering',
        status: 'progress',
        processedCount,
        totalSignals: signals.length,
        progressPercent: Math.round((processedCount / signals.length) * 100),
        elapsedMs: Date.now() - startTime
      });
    }

    // Log at trace level to avoid spam when there are many clusters
    logger.trace('Cluster formed', {
      stage: 'opportunity_clustering',
      seed_signal_id: signal.id,
      cluster_size: cluster.length,
      signal_ids: cluster.map(s => s.id)
    });

    // Periodic progress logging based on time (every 5 seconds)
    const now = Date.now();
    if (now - lastProgressLog >= progressInterval) {
      const progress = ((idx / signals.length) * 100).toFixed(1);
      const elapsed = now - startTime;
      const rate = idx / (elapsed / 1000);
      const remainingSignals = signals.length - idx;
      const etaSeconds = remainingSignals > 0 && rate > 0 ? (remainingSignals / rate).toFixed(0) : 'N/A';

      logger.info('Clustering progress', {
        stage: 'opportunity_clustering',
        status: 'in_progress',
        processed: idx,
        total: signals.length,
        progress_pct: progress,
        clusters_formed: clusters.length,
        rate_per_sec: rate.toFixed(2),
        eta_seconds: etaSeconds,
        elapsed_ms: elapsed
      });

      lastProgressLog = now;
    }
  }

  const duration = Date.now() - startTime;
  const avgClusterSize = clusters.length > 0 ? (signals.length / clusters.length).toFixed(2) : '0';

  logger.info('Signal clustering complete', {
    stage: 'opportunity_clustering',
    status: 'success',
    signal_count: signals.length,
    cluster_count: clusters.length,
    avg_cluster_size: avgClusterSize,
    clusters_breakdown: clusters.map(c => c.length),
    duration_ms: duration
  });

  return clusters;
}

export interface OpportunityQueryOptions {
  status?: string;
  startDate?: Date;
  endDate?: Date;
  limit?: number;
  offset?: number;
  orderBy?: 'created_at' | 'title';
  orderDirection?: 'ASC' | 'DESC';
  signalSource?: string;
  requireExclusiveSource?: boolean;
}

/**
 * Retrieves opportunities with filtering and pagination.
 */
export async function getOpportunities(options: OpportunityQueryOptions = {}): Promise<Opportunity[]> {
  const pool = getDbPool();
  const {
    status,
    startDate,
    endDate,
    limit = 100,
    offset = 0,
    orderBy = 'created_at',
    orderDirection = 'DESC'
  } = options;
  
  let query = 'SELECT * FROM opportunities WHERE 1=1';
  const params: Array<string | number | Date> = [];
  let paramIndex = 1;
  
  if (status) {
    query += ` AND status = $${paramIndex++}`;
    params.push(status);
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
  const validOrderBy = ['created_at', 'title'].includes(orderBy) ? orderBy : 'created_at';
  const validDirection = orderDirection === 'ASC' ? 'ASC' : 'DESC';
  query += ` ORDER BY ${validOrderBy} ${validDirection}`;
  
  // Limit and offset
  query += ` LIMIT $${paramIndex++} OFFSET $${paramIndex++}`;
  params.push(limit, offset);
  
  const result = await pool.query(query, params);
  return result.rows.map(row => ({
    ...row,
    created_at: new Date(row.created_at)
  }));
}

/**
 * Retrieves all opportunities (backward compatibility).
 */
export async function getAllOpportunities(): Promise<Opportunity[]> {
  return getOpportunities({ limit: 1000 }); // Default limit for safety
}

/**
 * Counts opportunities matching the query options.
 */
export async function countOpportunities(options: Omit<OpportunityQueryOptions, 'limit' | 'offset' | 'orderBy' | 'orderDirection'> = {}): Promise<number> {
  const pool = getDbPool();
  const { status, startDate, endDate } = options;
  
  let query = 'SELECT COUNT(*) as count FROM opportunities WHERE 1=1';
  const params: Array<string | number | Date> = [];
  let paramIndex = 1;
  
  if (status) {
    query += ` AND status = $${paramIndex++}`;
    params.push(status);
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

/**
 * Retrieves signals for an opportunity.
 */
export async function getSignalsForOpportunity(opportunityId: string): Promise<Signal[]> {
  const pool = getDbPool();
  const result = await pool.query(
    `SELECT s.* FROM signals s
     INNER JOIN opportunity_signals os ON s.id = os.signal_id
     WHERE os.opportunity_id = $1
     ORDER BY s.created_at DESC`,
    [opportunityId]
  );
  return result.rows.map(row => ({
    ...row,
    metadata: row.metadata ? (typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata) : null,
    created_at: new Date(row.created_at)
  }));
}

/**
 * Merges two opportunities into one.
 * Combines signals, updates title/description, and deletes the duplicate.
 */
export async function mergeOpportunities(
  primaryOpportunityId: string,
  secondaryOpportunityId: string
): Promise<Opportunity> {
  logger.info('Starting opportunity merge', {
    stage: 'opportunity_merge',
    status: 'start',
    primary_id: primaryOpportunityId,
    secondary_id: secondaryOpportunityId
  });

  const pool = getDbPool();
  const client = await pool.connect();

  try {
    // Start transaction
    await client.query('BEGIN');
    logger.debug('Transaction started for opportunity merge', {
      stage: 'opportunity_merge',
      status: 'transaction_begin'
    });

    // Get signals from both opportunities
    logger.debug('Fetching signals for merge', {
      stage: 'opportunity_merge',
      primary_id: primaryOpportunityId,
      secondary_id: secondaryOpportunityId
    });

    const primarySignals = await getSignalsForOpportunity(primaryOpportunityId);
    const secondarySignals = await getSignalsForOpportunity(secondaryOpportunityId);

    // Validate that both opportunities exist
    if (primarySignals.length === 0) {
      logger.error('Primary opportunity not found or has no signals', {
        stage: 'opportunity_merge',
        status: 'validation_error',
        primary_id: primaryOpportunityId
      });
      throw new Error(`Primary opportunity ${primaryOpportunityId} not found or has no signals`);
    }

    if (secondarySignals.length === 0) {
      logger.warn('Secondary opportunity has no signals, proceeding with merge', {
        stage: 'opportunity_merge',
        status: 'validation_warning',
        secondary_id: secondaryOpportunityId
      });
    }

    const allSignals = [...primarySignals, ...secondarySignals];

    logger.debug('Signals fetched for merge', {
      stage: 'opportunity_merge',
      primary_signal_count: primarySignals.length,
      secondary_signal_count: secondarySignals.length,
      total_signals: allSignals.length
    });

    // Create merged opportunity
    const merged = await createOpportunityFromCluster(allSignals);

    // Update primary opportunity
    logger.debug('Updating primary opportunity', {
      stage: 'opportunity_merge',
      primary_id: primaryOpportunityId,
      new_title: merged.title,
      new_description: merged.description?.substring(0, 100)
    });

    await client.query(
      `UPDATE opportunities
       SET title = $1, description = $2
       WHERE id = $3`,
      [merged.title, merged.description, primaryOpportunityId]
    );

    // Move all signals from secondary to primary
    logger.debug('Migrating signals to primary opportunity', {
      stage: 'opportunity_merge',
      from: secondaryOpportunityId,
      to: primaryOpportunityId,
      signal_count: secondarySignals.length
    });

    await client.query(
      `UPDATE opportunity_signals
       SET opportunity_id = $1
       WHERE opportunity_id = $2`,
      [primaryOpportunityId, secondaryOpportunityId]
    );

    // Delete secondary opportunity
    logger.debug('Deleting secondary opportunity', {
      stage: 'opportunity_merge',
      secondary_id: secondaryOpportunityId
    });

    await client.query(
      `DELETE FROM opportunities WHERE id = $1`,
      [secondaryOpportunityId]
    );

    // Commit transaction
    await client.query('COMMIT');
    logger.info('Opportunity merge transaction committed successfully', {
      stage: 'opportunity_merge',
      status: 'transaction_commit',
      primary_id: primaryOpportunityId,
      secondary_id: secondaryOpportunityId
    });

    logger.info('Opportunities merged successfully', {
      stage: 'opportunity_merge',
      status: 'success',
      primary_id: primaryOpportunityId,
      secondary_id: secondaryOpportunityId,
      total_signals: allSignals.length,
      merged_title: merged.title
    });

    // Return updated primary opportunity
    const result = await pool.query('SELECT * FROM opportunities WHERE id = $1', [primaryOpportunityId]);
    return {
      ...result.rows[0],
      created_at: new Date(result.rows[0].created_at)
    };
  } catch (error: any) {
    // Rollback transaction on error
    try {
      await client.query('ROLLBACK');
      logger.error('Opportunity merge failed, transaction rolled back', {
        stage: 'opportunity_merge',
        status: 'rollback',
        primary_id: primaryOpportunityId,
        secondary_id: secondaryOpportunityId,
        error: error.message,
        stack: error.stack
      });
    } catch (rollbackError: any) {
      logger.error('Rollback failed during opportunity merge', {
        stage: 'opportunity_merge',
        status: 'rollback_error',
        rollbackError: rollbackError.message,
        originalError: error.message
      });
    }
    throw error;
  } finally {
    // Always release the client
    client.release();
    logger.debug('Transaction client released', {
      stage: 'opportunity_merge',
      status: 'cleanup'
    });
  }
}

/**
 * Finds and merges related opportunities.
 * Uses similarity threshold to determine if opportunities should be merged.
 */
export async function mergeRelatedOpportunities(
  similarityThreshold: number = 0.3
): Promise<number> {
  const startTime = Date.now();
  const progressEveryBase = Math.max(
    1,
    parseInt(process.env.OPPORTUNITY_CLUSTER_PROGRESS_EVERY || '500', 10)
  );
  const progressEveryPairs = Math.max(25, Math.floor(progressEveryBase / 2));
  const progressIntervalMs = 5000;
  const longCycleWarnMs = 60000;
  let mergeCount = 0;
  let hasMore = true;
  let cycleCount = 0;
  let restartCount = 0;
  let pairsChecked = 0;
  let lastProgressLog = startTime;

  logger.info('Starting related opportunity merge', {
    stage: 'opportunity_merge',
    status: 'start',
    similarityThreshold,
    progressEveryPairs
  });
  
  // Keep merging until no more merges are found
  while (hasMore) {
    cycleCount += 1;
    const cycleStart = Date.now();
    let longCycleWarned = false;
    const opportunities = await getAllOpportunities();
    logger.info('Opportunity merge cycle started', {
      stage: 'opportunity_merge',
      status: 'in_progress',
      cycle: cycleCount,
      opportunitiesCount: opportunities.length,
      mergeCount,
      pairsChecked
    });

    hasMore = false;
    const processed = new Set<string>();
    
    for (let i = 0; i < opportunities.length; i++) {
      const opp1 = opportunities[i];
      if (processed.has(opp1.id)) continue;
      
      for (let j = i + 1; j < opportunities.length; j++) {
        const opp2 = opportunities[j];
        if (processed.has(opp2.id)) continue;
        
        // Skip if same opportunity
        if (opp1.id === opp2.id) continue;

        pairsChecked += 1;
        
        const signals1 = await getSignalsForOpportunity(opp1.id);
        const signals2 = await getSignalsForOpportunity(opp2.id);
        
        // Check if any signals from opp1 match any signals from opp2
        let shouldMerge = false;
        for (const s1 of signals1) {
          for (const s2 of signals2) {
            const similarity = calculateWeightedSimilarity(s1, s2, {
              wordSimilarityWeight: 0.4,
              customerWeight: 0.35,
              topicWeight: 0.2,
              timeWeight: 0.05
            });
            
            if (similarity >= similarityThreshold) {
              shouldMerge = true;
              break;
            }
          }
          if (shouldMerge) break;
        }
        
        if (shouldMerge) {
          await mergeOpportunities(opp1.id, opp2.id);
          mergeCount++;
          restartCount++;
          processed.add(opp1.id);
          processed.add(opp2.id);
          hasMore = true;

          logger.info('Opportunity merge match found; restarting cycle', {
            stage: 'opportunity_merge',
            status: 'in_progress',
            cycle: cycleCount,
            primaryOpportunityId: opp1.id,
            secondaryOpportunityId: opp2.id,
            mergeCount,
            restartCount,
            pairsChecked,
            elapsed_ms: Date.now() - startTime
          });
          break; // Restart from beginning after merge
        }

        const now = Date.now();
        const shouldLogProgress =
          (pairsChecked > 0 && pairsChecked % progressEveryPairs === 0) ||
          now - lastProgressLog >= progressIntervalMs;
        if (shouldLogProgress) {
          const elapsedMs = now - startTime;
          const ratePerSec = elapsedMs > 0 ? pairsChecked / (elapsedMs / 1000) : 0;
          logger.info('Opportunity merge progress', {
            stage: 'opportunity_merge',
            status: 'in_progress',
            cycle: cycleCount,
            pairs_checked: pairsChecked,
            merge_count: mergeCount,
            restart_count: restartCount,
            elapsed_ms: elapsedMs,
            rate_per_sec: ratePerSec.toFixed(2),
            opportunitiesCount: opportunities.length
          });
          lastProgressLog = now;
        }

        if (!longCycleWarned && now - cycleStart >= longCycleWarnMs) {
          longCycleWarned = true;
          logger.warn('Opportunity merge cycle running longer than expected', {
            stage: 'opportunity_merge',
            status: 'slow_cycle',
            cycle: cycleCount,
            cycle_elapsed_ms: now - cycleStart,
            pairs_checked: pairsChecked,
            merge_count: mergeCount,
            restart_count: restartCount,
            nextAction: 'review opportunity_merge progress logs and pair-comparison throughput'
          });
        }
      }
      
      if (hasMore) break; // Restart outer loop
    }
  }
  
  const elapsedMs = Date.now() - startTime;
  const ratePerSec = elapsedMs > 0 ? pairsChecked / (elapsedMs / 1000) : 0;
  logger.info('Related opportunities merged', {
    stage: 'opportunity_merge',
    status: 'success',
    mergeCount,
    cycleCount,
    restartCount,
    pairs_checked: pairsChecked,
    elapsed_ms: elapsedMs,
    rate_per_sec: ratePerSec.toFixed(2)
  });
  return mergeCount;
}

// ============================================================================
// ROADMAP OPPORTUNITY SCORING
// ============================================================================

/**
 * Roadmap prioritization score components
 */
export interface RoadmapScore {
  // Overall composite score (0-100)
  overallScore: number;
  
  // Individual dimension scores (0-100)
  impactScore: number;      // Potential customer/business impact
  confidenceScore: number;  // Data quality and signal strength
  effortScore: number;      // Estimated effort (inverted - lower effort = higher score)
  strategicScore: number;   // Alignment with strategic priorities
  urgencyScore: number;     // Time sensitivity (trending, momentum)
  
  // Breakdown metadata
  breakdown: {
    signalCount: number;
    uniqueCustomers: number;
    customerTierWeight: number;
    themeCount: number;
    trendDirection: string;
    averageSignalQuality: number;
    channelDiversity: number;
  };
}

/**
 * Extended opportunity with roadmap scoring
 */
export interface ScoredOpportunity extends Opportunity {
  roadmapScore: RoadmapScore;
  signals: Signal[];
  themes: string[];
  customers: string[];
}

/**
 * Configuration for roadmap scoring weights
 */
export interface RoadmapScoringConfig {
  impactWeight: number;       // Weight for impact score (default 0.30)
  confidenceWeight: number;   // Weight for confidence (default 0.25)
  effortWeight: number;       // Weight for effort (default 0.15)
  strategicWeight: number;    // Weight for strategic alignment (default 0.15)
  urgencyWeight: number;      // Weight for urgency (default 0.15)
  
  // Customer tier weights (for impact calculation)
  customerTierWeights: {
    enterprise: number;
    growth: number;
    startup: number;
    unknown: number;
  };
  
  // Strategic priority themes (boost when matched)
  strategicPriorities: string[];
}

const DEFAULT_SCORING_CONFIG: RoadmapScoringConfig = {
  impactWeight: 0.30,
  confidenceWeight: 0.25,
  effortWeight: 0.15,
  strategicWeight: 0.15,
  urgencyWeight: 0.15,
  
  customerTierWeights: {
    enterprise: 3.0,
    growth: 2.0,
    startup: 1.0,
    unknown: 0.5
  },
  
  strategicPriorities: []  // Set by caller based on product strategy
};

/**
 * Calculates roadmap prioritization score for an opportunity
 */
export async function calculateRoadmapScore(
  opportunity: Opportunity,
  signals: Signal[],
  config: Partial<RoadmapScoringConfig> = {}
): Promise<RoadmapScore> {
  const finalConfig = { ...DEFAULT_SCORING_CONFIG, ...config };
  
  // Extract metadata from signals
  const customers = await extractUniqueCustomers(signals);
  const themes = extractUniqueThemes(signals);
  const channels = extractUniqueChannels(signals);
  
  // Calculate dimension scores
  const impactScore = await calculateImpactScore(signals, customers, finalConfig);
  const confidenceScore = calculateConfidenceScore(signals, channels);
  const effortScore = await estimateEffortScore(signals, themes);
  const strategicScore = calculateStrategicScore(themes, finalConfig.strategicPriorities);
  const urgencyScore = await calculateUrgencyScore(signals, themes);
  
  // Calculate overall weighted score
  const overallScore = Math.round(
    impactScore * finalConfig.impactWeight +
    confidenceScore * finalConfig.confidenceWeight +
    effortScore * finalConfig.effortWeight +
    strategicScore * finalConfig.strategicWeight +
    urgencyScore * finalConfig.urgencyWeight
  );
  
  // Build breakdown metadata
  const breakdown = {
    signalCount: signals.length,
    uniqueCustomers: customers.length,
    customerTierWeight: calculateCustomerTierWeight(signals, finalConfig.customerTierWeights),
    themeCount: themes.length,
    trendDirection: await getTrendDirection(themes),
    averageSignalQuality: calculateAverageSignalQuality(signals),
    channelDiversity: channels.length
  };
  
  return {
    overallScore,
    impactScore,
    confidenceScore,
    effortScore,
    strategicScore,
    urgencyScore,
    breakdown
  };
}

/**
 * Calculates impact score based on customer reach and tier
 */
async function calculateImpactScore(
  signals: Signal[],
  customers: string[],
  config: RoadmapScoringConfig
): Promise<number> {
  // Base score from customer count (logarithmic scaling)
  let customerScore = Math.min(Math.log2(customers.length + 1) * 20, 60);
  
  // Add tier weighting
  const tierWeight = calculateCustomerTierWeight(signals, config.customerTierWeights);
  const tierBoost = Math.min(tierWeight * 10, 30); // Cap at 30
  
  // Add signal volume boost (more signals = more validation)
  const volumeBoost = Math.min(signals.length * 2, 10); // Cap at 10

  // Add forum engagement boost (views/likes/replies as impact proxies).
  const engagementBoost = calculateEngagementBoost(signals);

  return Math.min(customerScore + tierBoost + volumeBoost + engagementBoost, 100);
}

function toFiniteNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function calculateEngagementBoost(signals: Signal[]): number {
  let totalViews = 0;
  let totalLikes = 0;
  let totalReplies = 0;

  for (const signal of signals) {
    totalViews += toFiniteNumber(signal.metadata?.views);
    totalLikes += toFiniteNumber(signal.metadata?.likes) + toFiniteNumber(signal.metadata?.comment_likes);
    totalReplies += toFiniteNumber(signal.metadata?.replies_count);
  }

  const viewScore = Math.min(Math.log10(totalViews + 1) * 15, 30);
  const likeScore = Math.min(totalLikes * 5, 20);
  const replyScore = Math.min(totalReplies * 3, 15);

  return Math.min(viewScore + likeScore + replyScore, 50);
}

/**
 * Calculates customer tier weight from signals
 */
function calculateCustomerTierWeight(
  signals: Signal[],
  tierWeights: RoadmapScoringConfig['customerTierWeights']
): number {
  let totalWeight = 0;
  let count = 0;
  
  for (const signal of signals) {
    const tier = signal.metadata?.customer_tier as string || 'unknown';
    const weight = tierWeights[tier as keyof typeof tierWeights] || tierWeights.unknown;
    totalWeight += weight;
    count++;
  }
  
  return count > 0 ? totalWeight / count : tierWeights.unknown;
}

/**
 * Calculates confidence score based on data quality
 */
function calculateConfidenceScore(signals: Signal[], channels: string[]): number {
  // Signal quality component
  const avgQuality = calculateAverageSignalQuality(signals);
  const qualityScore = avgQuality * 50; // 0-50 based on quality
  
  // Channel diversity component (more channels = more confidence)
  const diversityScore = Math.min(channels.length * 10, 25); // Cap at 25
  
  // Signal count component (more signals = more confidence)
  const volumeScore = Math.min(signals.length * 5, 25); // Cap at 25
  
  return Math.min(qualityScore + diversityScore + volumeScore, 100);
}

/**
 * Calculates average signal quality score
 */
function calculateAverageSignalQuality(signals: Signal[]): number {
  if (signals.length === 0) return 0;
  
  const totalQuality = signals.reduce((sum, signal) => {
    const quality = signal.metadata?.quality_dimensions?.compositeScore
      || signal.metadata?.quality_score
      || 0.5;
    // Normalize values stored on a 0-100 scale to 0-1.
    const normalized = typeof quality === 'number' && quality > 1 ? quality / 100 : quality;
    return sum + normalized;
  }, 0);
  
  return totalQuality / signals.length;
}

/**
 * Estimates effort score (inverted: lower effort = higher score)
 * Uses heuristics based on theme complexity and scope
 */
async function estimateEffortScore(signals: Signal[], themes: string[]): Promise<number> {
  // Start with base score (assume moderate effort)
  let score = 50;
  
  // Theme complexity heuristics
  const complexThemes = themes.filter(t => 
    t.includes('integration') || 
    t.includes('architecture') || 
    t.includes('security') ||
    t.includes('compliance') ||
    t.includes('migration')
  );
  
  const simpleThemes = themes.filter(t =>
    t.includes('ui') ||
    t.includes('ux') ||
    t.includes('documentation') ||
    t.includes('fix') ||
    t.includes('enhancement')
  );
  
  // Adjust based on theme complexity
  score += simpleThemes.length * 10;  // Simple themes increase score
  score -= complexThemes.length * 15; // Complex themes decrease score
  
  // More themes typically means more scope (lower score)
  if (themes.length > 3) {
    score -= (themes.length - 3) * 5;
  }

  // Adjust based on LLM extraction complexity (features/issues)
  const pool = getDbPool();
  const signalIds = signals.map(signal => signal.id);
  if (signalIds.length > 0) {
    const extractionResult = await pool.query(
      `SELECT extraction FROM signal_extractions WHERE signal_id = ANY($1)`,
      [signalIds]
    );
    let featureCount = 0;
    let issueCount = 0;
    let highSeverityIssues = 0;

    for (const row of extractionResult.rows) {
      try {
        const extraction = typeof row.extraction === 'string'
          ? JSON.parse(row.extraction)
          : row.extraction;
        const entities = extraction?.entities || {};
        featureCount += Array.isArray(entities?.features) ? entities.features.length : 0;
        if (Array.isArray(entities?.issues)) {
          issueCount += entities.issues.length;
        }
      } catch (error) {
        logger.debug('Failed to parse extraction for effort scoring', { error });
      }
    }

    const complexityPenalty = Math.min(featureCount * 3 + issueCount * 5 + highSeverityIssues * 3, 30);
    score -= complexityPenalty;
  }
  
  return Math.max(10, Math.min(score, 100));
}

/**
 * Calculates strategic alignment score
 */
function calculateStrategicScore(themes: string[], priorities: string[]): number {
  if (priorities.length === 0) {
    return 50; // Default to neutral if no priorities set
  }
  
  const matchedPriorities = themes.filter(theme =>
    priorities.some(priority => 
      theme.toLowerCase().includes(priority.toLowerCase()) ||
      priority.toLowerCase().includes(theme.toLowerCase())
    )
  );
  
  // Score based on priority matches
  const matchRatio = matchedPriorities.length / priorities.length;
  return Math.min(Math.round(matchRatio * 100 + 20), 100); // Base of 20, up to 100
}

/**
 * Calculates urgency score based on trends and momentum
 */
async function calculateUrgencyScore(signals: Signal[], themes: string[]): Promise<number> {
  // Check recency of signals
  const now = Date.now();
  const recentSignals = signals.filter(s => {
    const signalTime = new Date(s.created_at).getTime();
    return (now - signalTime) < 7 * 24 * 60 * 60 * 1000; // Last 7 days
  });
  
  const recencyRatio = signals.length > 0 ? recentSignals.length / signals.length : 0;
  const recencyScore = Math.min(recencyRatio * 80, 60); // Weight recent signals 2x
  
  // Check trend direction
  const trendDirection = await getTrendDirection(themes);
  let trendScore = 30; // Default to neutral
  
  switch (trendDirection) {
    case 'emerging':
      trendScore = 50;
      break;
    case 'growing':
      trendScore = 40;
      break;
    case 'stable':
      trendScore = 30;
      break;
    case 'declining':
      trendScore = 10;
      break;
  }
  
  // Volume acceleration (are signals coming in faster?)
  const volumeScore = Math.min(recentSignals.length * 6, 20);

  // Unresolved threads without accepted answers should be prioritized.
  const statusValues = signals
    .map((signal) => String(signal.metadata?.status || '').toLowerCase().trim())
    .filter(Boolean);
  const unresolvedCount = statusValues.filter((status) =>
    status.includes('unresolved') || status.includes('open')
  ).length;
  const unresolvedBoost =
    statusValues.length > 0 && unresolvedCount >= Math.ceil(statusValues.length / 2) ? 15 : 0;

  const hasAcceptedAnswer = signals.some((signal) => {
    if (signal.metadata?.is_accepted === true) return true;
    const acceptedAnswer = signal.metadata?.accepted_answer;
    return Boolean(acceptedAnswer);
  });
  const acceptedAnswerBoost = hasAcceptedAnswer ? 0 : 10;

  return Math.min(recencyScore + trendScore + volumeScore + unresolvedBoost + acceptedAnswerBoost, 100);
}

/**
 * Gets the dominant trend direction for themes
 */
async function getTrendDirection(themes: string[]): Promise<string> {
  if (themes.length === 0) return 'stable';
  
  try {
    const trends = await computeSignalTrends({ entityType: 'theme', minSignals: 1 });
    
    const matchingTrends = trends.filter(t => 
      themes.some(theme => 
        t.entityName.toLowerCase().includes(theme.toLowerCase()) ||
        theme.toLowerCase().includes(t.entityName.toLowerCase())
      )
    );
    
    if (matchingTrends.length === 0) return 'stable';
    
    // Return the most common trend direction
    const directions = matchingTrends.map(t => t.trend);
    const counts = directions.reduce((acc, dir) => {
      acc[dir] = (acc[dir] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    
    return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
  } catch (error) {
    logger.debug('Could not compute trends, defaulting to stable', { error });
    return 'stable';
  }
}

/**
 * Extracts unique customer names from signals
 */
function normalizeCustomerNameForScoring(value: string): string {
  const trimmed = value.replace(/\*+$/g, '').replace(/\s+/g, ' ').trim();
  const withoutSuffix = trimmed.replace(/\b(inc|corp|corporation|ltd|llc|co|company)\.?$/i, '').trim();
  return withoutSuffix.replace(/[,.;:]+$/g, '').trim();
}

async function extractUniqueCustomers(signals: Signal[]): Promise<string[]> {
  const customers = new Map<string, string>();
  const pool = getDbPool();

  const addCustomer = (name: string) => {
    const normalized = normalizeCustomerNameForScoring(name);
    if (!normalized) return;
    const key = normalized.toLowerCase();
    for (const existing of customers.values()) {
      if (fuzzyCustomerMatch(existing, normalized)) {
        return;
      }
    }
    if (!customers.has(key)) {
      customers.set(key, normalized);
    }
  };
  
  for (const signal of signals) {
    const metaCustomers = signal.metadata?.customers as string[] || [];
    metaCustomers.forEach(addCustomer);
    
    // Also extract from content if not in metadata
    if (metaCustomers.length === 0) {
      const extracted = extractCustomerNames(signal.content, signal.metadata);
      extracted.forEach(addCustomer);

      // For community forum signals, use author handles as pseudo-customers
      // when no structured customer entity is available.
      if (extracted.length === 0) {
        const pseudoCustomer = [
          signal.metadata?.author,
          signal.metadata?.comment_author,
          signal.metadata?.answer_author
        ].find((value) => typeof value === 'string' && value.trim().length > 0);
        if (typeof pseudoCustomer === 'string') {
          addCustomer(pseudoCustomer);
        }
      }
    }
  }

  const signalIds = signals.map(s => s.id);
  if (signalIds.length > 0) {
    const result = await pool.query(
      `SELECT DISTINCT c.name
       FROM signal_entities se
       JOIN customers c ON c.id = se.entity_id
       WHERE se.signal_id = ANY($1) AND se.entity_type = 'customer'`,
      [signalIds]
    );
    result.rows.forEach(row => addCustomer(row.name));
  }
  
  return Array.from(customers.values());
}

/**
 * Extracts unique themes from signals
 */
function extractUniqueThemes(signals: Signal[]): string[] {
  const themes = new Set<string>();
  
  for (const signal of signals) {
    const signalThemes = signal.metadata?.themes as string[] || [];
    signalThemes.forEach(t => themes.add(t));
    
    // Also check matched_themes
    const matchedThemes = signal.metadata?.matched_themes as Array<{ theme: string }> || [];
    matchedThemes.forEach(mt => themes.add(mt.theme));
  }
  
  return Array.from(themes);
}

/**
 * Extracts unique channels from signals
 */
function extractUniqueChannels(signals: Signal[]): string[] {
  const channels = new Set<string>();
  
  for (const signal of signals) {
    const channelId = signal.metadata?.channel_id as string;
    if (channelId) {
      channels.add(channelId);
    }
    // Also count source as a channel type
    channels.add(signal.source);
  }
  
  return Array.from(channels);
}

/**
 * Gets all opportunities with roadmap scores
 */
export async function getOpportunitiesWithScores(
  config: Partial<RoadmapScoringConfig> = {},
  queryOptions: OpportunityQueryOptions = {}
): Promise<ScoredOpportunity[]> {
  try {
    const opportunities = await getOpportunities(queryOptions);
    const scoredOpportunities: ScoredOpportunity[] = [];
    const { signalSource, requireExclusiveSource = false } = queryOptions;
    
    for (const opp of opportunities) {
      const signals = await getSignalsForOpportunity(opp.id);
      const filteredSignals = signalSource
        ? signals.filter(signal => signal.source === signalSource)
        : signals;

      if (filteredSignals.length === 0) {
        continue;
      }
      if (signalSource && requireExclusiveSource && filteredSignals.length !== signals.length) {
        continue;
      }

      const roadmapScore = await calculateRoadmapScore(opp, filteredSignals, config);
      const customers = await extractUniqueCustomers(filteredSignals);
      const themes = extractUniqueThemes(filteredSignals);
      
      scoredOpportunities.push({
        ...opp,
        roadmapScore,
        signals: filteredSignals,
        themes,
        customers
      });
    }
    
    return scoredOpportunities;
  } catch (error: any) {
    logger.error('Failed to score opportunities', {
      stage: 'roadmap_scoring',
      status: 'error',
      error: error?.message || String(error),
      signalSource: queryOptions.signalSource || 'all'
    });
    throw error;
  }
}

/**
 * Gets opportunities prioritized for roadmap planning
 * Returns opportunities sorted by overall roadmap score
 */
export async function getPrioritizedOpportunities(
  config: Partial<RoadmapScoringConfig> = {},
  limit: number = 20,
  queryOptions: OpportunityQueryOptions = {}
): Promise<ScoredOpportunity[]> {
  const scoredOpportunities = await getOpportunitiesWithScores(config, queryOptions);
  
  return scoredOpportunities
    .sort((a, b) => b.roadmapScore.overallScore - a.roadmapScore.overallScore)
    .slice(0, limit);
}

/**
 * Gets quick-win opportunities (high impact, low effort)
 */
export async function getQuickWinOpportunities(
  limit: number = 10,
  queryOptions: OpportunityQueryOptions = {}
): Promise<ScoredOpportunity[]> {
  const scoredOpportunities = await getOpportunitiesWithScores({}, queryOptions);
  
  // Quick wins: high impact + high effort score (low effort)
  return scoredOpportunities
    .filter(opp => opp.roadmapScore.effortScore >= 60)
    .sort((a, b) => {
      const scoreA = a.roadmapScore.impactScore + a.roadmapScore.effortScore;
      const scoreB = b.roadmapScore.impactScore + b.roadmapScore.effortScore;
      return scoreB - scoreA;
    })
    .slice(0, limit);
}

/**
 * Gets strategic opportunities aligned with priorities
 */
export async function getStrategicOpportunities(
  priorities: string[],
  limit: number = 10,
  queryOptions: OpportunityQueryOptions = {}
): Promise<ScoredOpportunity[]> {
  const config: Partial<RoadmapScoringConfig> = {
    strategicPriorities: priorities,
    strategicWeight: 0.40  // Boost strategic weight
  };
  
  const scoredOpportunities = await getOpportunitiesWithScores(config, queryOptions);
  
  return scoredOpportunities
    .filter(opp => opp.roadmapScore.strategicScore >= 50)
    .sort((a, b) => b.roadmapScore.strategicScore - a.roadmapScore.strategicScore)
    .slice(0, limit);
}

/**
 * Gets emerging opportunities (trending up)
 */
export async function getEmergingOpportunities(
  limit: number = 10,
  queryOptions: OpportunityQueryOptions = {}
): Promise<ScoredOpportunity[]> {
  const scoredOpportunities = await getOpportunitiesWithScores({}, queryOptions);
  
  return scoredOpportunities
    .filter(opp => 
      opp.roadmapScore.breakdown.trendDirection === 'emerging' ||
      opp.roadmapScore.breakdown.trendDirection === 'growing'
    )
    .sort((a, b) => b.roadmapScore.urgencyScore - a.roadmapScore.urgencyScore)
    .slice(0, limit);
}

/**
 * Gets high-confidence opportunities (strong signal quality)
 */
export async function getHighConfidenceOpportunities(
  minConfidence: number = 70,
  limit: number = 10,
  queryOptions: OpportunityQueryOptions = {}
): Promise<ScoredOpportunity[]> {
  const scoredOpportunities = await getOpportunitiesWithScores({}, queryOptions);
  
  return scoredOpportunities
    .filter(opp => opp.roadmapScore.confidenceScore >= minConfidence)
    .sort((a, b) => b.roadmapScore.confidenceScore - a.roadmapScore.confidenceScore)
    .slice(0, limit);
}

/**
 * Gets roadmap summary for dashboard
 */
export async function getRoadmapSummary(
  config: Partial<RoadmapScoringConfig> = {},
  queryOptions: OpportunityQueryOptions = {}
): Promise<{
  totalOpportunities: number;
  topPriorities: ScoredOpportunity[];
  quickWins: ScoredOpportunity[];
  emerging: ScoredOpportunity[];
  byImpact: { high: number; medium: number; low: number };
  byConfidence: { high: number; medium: number; low: number };
  averageScores: {
    impact: number;
    confidence: number;
    effort: number;
    strategic: number;
    urgency: number;
  };
}> {
  try {
    const scoredOpportunities = await getOpportunitiesWithScores(config, queryOptions);
    
    const byImpact = {
      high: scoredOpportunities.filter(o => o.roadmapScore.impactScore >= 70).length,
      medium: scoredOpportunities.filter(o => o.roadmapScore.impactScore >= 40 && o.roadmapScore.impactScore < 70).length,
      low: scoredOpportunities.filter(o => o.roadmapScore.impactScore < 40).length
    };
    
    const byConfidence = {
      high: scoredOpportunities.filter(o => o.roadmapScore.confidenceScore >= 70).length,
      medium: scoredOpportunities.filter(o => o.roadmapScore.confidenceScore >= 40 && o.roadmapScore.confidenceScore < 70).length,
      low: scoredOpportunities.filter(o => o.roadmapScore.confidenceScore < 40).length
    };
    
    const averageScores = {
      impact: average(scoredOpportunities.map(o => o.roadmapScore.impactScore)),
      confidence: average(scoredOpportunities.map(o => o.roadmapScore.confidenceScore)),
      effort: average(scoredOpportunities.map(o => o.roadmapScore.effortScore)),
      strategic: average(scoredOpportunities.map(o => o.roadmapScore.strategicScore)),
      urgency: average(scoredOpportunities.map(o => o.roadmapScore.urgencyScore))
    };
    
    return {
      totalOpportunities: scoredOpportunities.length,
      topPriorities: scoredOpportunities
        .sort((a, b) => b.roadmapScore.overallScore - a.roadmapScore.overallScore)
        .slice(0, 5),
      quickWins: scoredOpportunities
        .filter(o => o.roadmapScore.effortScore >= 60)
        .sort((a, b) => (b.roadmapScore.impactScore + b.roadmapScore.effortScore) - (a.roadmapScore.impactScore + a.roadmapScore.effortScore))
        .slice(0, 5),
      emerging: scoredOpportunities
        .filter(o => o.roadmapScore.breakdown.trendDirection === 'emerging' || o.roadmapScore.breakdown.trendDirection === 'growing')
        .slice(0, 5),
      byImpact,
      byConfidence,
      averageScores
    };
  } catch (error: any) {
    logger.error('Failed to build roadmap summary', {
      stage: 'roadmap_summary',
      status: 'error',
      error: error?.message || String(error),
      signalSource: queryOptions.signalSource || 'all'
    });
    throw error;
  }
}

function average(numbers: number[]): number {
  if (numbers.length === 0) return 0;
  return Math.round(numbers.reduce((a, b) => a + b, 0) / numbers.length);
}

// ============================================================================
// EMBEDDING-BASED SEMANTIC CLUSTERING
// ============================================================================

/**
 * Calculates cosine similarity between two embedding vectors
 */
function cosineSimilarity(vec1: number[], vec2: number[]): number {
  if (vec1.length !== vec2.length) return 0;
  
  let dotProduct = 0;
  let norm1 = 0;
  let norm2 = 0;
  
  for (let i = 0; i < vec1.length; i++) {
    dotProduct += vec1[i] * vec2[i];
    norm1 += vec1[i] * vec1[i];
    norm2 += vec2[i] * vec2[i];
  }
  
  if (norm1 === 0 || norm2 === 0) return 0;
  return dotProduct / (Math.sqrt(norm1) * Math.sqrt(norm2));
}

/**
 * Signal with embedding data
 */
interface SignalWithEmbedding extends Signal {
  embedding?: number[];
  contextualSummary?: string;
}

/**
 * Configuration for embedding-based clustering
 */
export interface EmbeddingClusterConfig {
  /** Minimum cosine similarity for clustering (0.0 to 1.0) */
  similarityThreshold: number;
  /** Minimum cluster size */
  minClusterSize: number;
  /** Weight for embedding similarity vs text similarity */
  embeddingWeight: number;
  /** Whether to use hybrid (embedding + text) or embedding-only */
  useHybrid: boolean;
  /** Minimum average signal quality (0-1) */
  minAverageQuality?: number;
  /** Overlap threshold for merging clusters */
  overlapMergeThreshold?: number;
}

const DEFAULT_EMBEDDING_CLUSTER_CONFIG: EmbeddingClusterConfig = {
  similarityThreshold: 0.75, // Higher threshold for semantic similarity
  minClusterSize: 2,
  embeddingWeight: 0.7, // Prioritize embeddings
  useHybrid: true,
  minAverageQuality: 0.5,
  overlapMergeThreshold: 0.5
};

const DEFAULT_MAX_REFINEMENT_CLUSTERS = 1500;
const MAX_REFINEMENT_CLUSTERS = (() => {
  const parsed = Number.parseInt(
    process.env.OPPORTUNITY_MAX_REFINEMENT_CLUSTERS || `${DEFAULT_MAX_REFINEMENT_CLUSTERS}`,
    10
  );
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_MAX_REFINEMENT_CLUSTERS;
})();

/**
 * Gets signals with their embeddings from the database
 */
export async function getSignalsWithEmbeddings(
  signalIds?: string[],
  limit: number = 500
): Promise<SignalWithEmbedding[]> {
  const pool = getDbPool();
  
  let query: string;
  let params: Array<string[] | number>;
  
  if (signalIds && signalIds.length > 0) {
    query = `
      SELECT s.*, se.embedding::text as embedding_text, se.contextual_summary
      FROM signals s
      LEFT JOIN signal_embeddings se ON s.id = se.signal_id
      WHERE s.id = ANY($1) AND s.is_duplicate_of IS NULL
      ORDER BY s.created_at DESC
    `;
    params = [signalIds];
  } else {
    query = `
      SELECT s.*, se.embedding::text as embedding_text, se.contextual_summary
      FROM signals s
      LEFT JOIN signal_embeddings se ON s.id = se.signal_id
      WHERE s.is_duplicate_of IS NULL
      ORDER BY s.created_at DESC
      LIMIT $1
    `;
    params = [limit];
  }
  
  const result = await pool.query(query, params);
  
  return result.rows.map(row => {
    let embedding: number[] | undefined;
    if (row.embedding_text) {
      try {
        const embeddingStr = row.embedding_text.replace('[', '').replace(']', '');
        embedding = embeddingStr.split(',').map((v: string) => parseFloat(v.trim()));
      } catch (e) {
        embedding = undefined;
      }
    }
    
    return {
      id: row.id,
      source: row.source,
      source_ref: row.source_ref,
      signal_type: row.signal_type,
      content: row.content,
      normalized_content: row.normalized_content,
      severity: row.severity,
      confidence: row.confidence,
      metadata: row.metadata ? (typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata) : null,
      created_at: new Date(row.created_at),
      embedding,
      contextualSummary: row.contextual_summary
    };
  });
}

/**
 * Calculates hybrid similarity using embeddings and text features
 */
function calculateHybridSimilarity(
  signal1: SignalWithEmbedding,
  signal2: SignalWithEmbedding,
  config: EmbeddingClusterConfig
): number {
  // Embedding similarity
  let embeddingSim = 0;
  if (signal1.embedding && signal2.embedding) {
    embeddingSim = cosineSimilarity(signal1.embedding, signal2.embedding);
  }
  
  // Text-based similarity (fallback when embeddings not available)
  const textSim = calculateWeightedSimilarity(signal1, signal2, {
    wordSimilarityWeight: 0.4,
    customerWeight: 0.35,
    topicWeight: 0.2,
    timeWeight: 0.05,
    timeWindowHours: 24 * 7
  });
  
  // Hybrid weighting
  if (signal1.embedding && signal2.embedding) {
    return embeddingSim * config.embeddingWeight + textSim * (1 - config.embeddingWeight);
  } else {
    // Fall back to text-only if embeddings not available
    return textSim;
  }
}

/**
 * Clusters signals using embedding similarity
 */
export async function clusterSignalsWithEmbeddings(
  signals: SignalWithEmbedding[],
  config: Partial<EmbeddingClusterConfig> = {}
): Promise<SignalWithEmbedding[][]> {
  const startTime = Date.now();
  const progressEvery = Math.max(
    1,
    parseInt(process.env.OPPORTUNITY_CLUSTER_PROGRESS_EVERY || '500', 10)
  );
  const progressInterval = 5000;
  const finalConfig = { ...DEFAULT_EMBEDDING_CLUSTER_CONFIG, ...config };
  const clusters: SignalWithEmbedding[][] = [];
  const processed = new Set<string>();
  let seedsProcessed = 0;
  let lastProgressLog = startTime;
  
  logger.info('Starting embedding-based clustering', {
    stage: 'opportunity_clustering',
    status: 'start',
    clustering_mode: 'embedding',
    signalCount: signals.length,
    withEmbeddings: signals.filter(s => s.embedding).length,
    config: finalConfig,
    progressEvery
  });
  
  // Sort by embedding availability (prioritize signals with embeddings)
  const sortedSignals = [...signals].sort((a, b) => {
    const aHas = a.embedding ? 1 : 0;
    const bHas = b.embedding ? 1 : 0;
    return bHas - aHas;
  });
  
  for (let idx = 0; idx < sortedSignals.length; idx++) {
    const signal = sortedSignals[idx];
    if (processed.has(signal.id)) continue;
    
    const cluster: SignalWithEmbedding[] = [signal];
    processed.add(signal.id);
    
    // Find similar signals
    for (const otherSignal of sortedSignals) {
      if (processed.has(otherSignal.id)) continue;
      
      const similarity = finalConfig.useHybrid
        ? calculateHybridSimilarity(signal, otherSignal, finalConfig)
        : (signal.embedding && otherSignal.embedding)
          ? cosineSimilarity(signal.embedding, otherSignal.embedding)
          : 0;
      
      if (similarity >= finalConfig.similarityThreshold) {
        cluster.push(otherSignal);
        processed.add(otherSignal.id);
      }
    }
    
    clusters.push(cluster);
    seedsProcessed += 1;

    const now = Date.now();
    const shouldLogProgress =
      (seedsProcessed > 0 && seedsProcessed % progressEvery === 0) ||
      now - lastProgressLog >= progressInterval;
    if (shouldLogProgress) {
      const processedItems = idx + 1;
      const elapsedMs = now - startTime;
      const ratePerSec = elapsedMs > 0 ? processedItems / (elapsedMs / 1000) : 0;
      const remaining = Math.max(0, sortedSignals.length - processedItems);
      const etaSeconds = ratePerSec > 0 ? Math.round(remaining / ratePerSec) : null;
      const progressPct = sortedSignals.length > 0
        ? ((processedItems / sortedSignals.length) * 100).toFixed(1)
        : '100.0';

      logger.info('Embedding clustering progress', {
        stage: 'opportunity_clustering',
        status: 'in_progress',
        clustering_mode: 'embedding',
        processed: processedItems,
        total: sortedSignals.length,
        progress_pct: progressPct,
        processed_seeds: seedsProcessed,
        clusters_formed: clusters.length,
        rate_per_sec: ratePerSec.toFixed(2),
        eta_seconds: etaSeconds === null ? 'N/A' : String(etaSeconds),
        elapsed_ms: elapsedMs
      });
      lastProgressLog = now;
    }
  }
  
  const durationMs = Date.now() - startTime;
  const ratePerSec = durationMs > 0 ? sortedSignals.length / (durationMs / 1000) : 0;
  logger.info('Embedding-based clustering complete', {
    stage: 'opportunity_clustering',
    status: 'success',
    clustering_mode: 'embedding',
    totalClusters: clusters.length,
    validClusters: clusters.filter(c => c.length >= finalConfig.minClusterSize).length,
    processed_seeds: seedsProcessed,
    elapsed_ms: durationMs,
    rate_per_sec: ratePerSec.toFixed(2)
  });
  
  return clusters;
}

function mergeOverlappingClusters(
  clusters: SignalWithEmbedding[][],
  overlapThreshold: number
): SignalWithEmbedding[][] {
  const remaining = [...clusters];
  const merged: SignalWithEmbedding[][] = [];

  while (remaining.length > 0) {
    const base = remaining.shift()!;
    const baseIds = new Set(base.map(s => s.id));
    let mergedCluster = [...base];

    for (let i = remaining.length - 1; i >= 0; i--) {
      const candidate = remaining[i];
      const candidateIds = new Set(candidate.map(s => s.id));
      let intersectionCount = 0;
      candidateIds.forEach(id => {
        if (baseIds.has(id)) intersectionCount++;
      });

      const minSize = Math.min(baseIds.size, candidateIds.size);
      const overlapRatio = minSize > 0 ? intersectionCount / minSize : 0;

      if (overlapRatio >= overlapThreshold) {
        mergedCluster = [...mergedCluster, ...candidate];
        remaining.splice(i, 1);
      }
    }

    // Deduplicate merged cluster by signal id
    const unique = new Map<string, SignalWithEmbedding>();
    mergedCluster.forEach(signal => unique.set(signal.id, signal));
    merged.push(Array.from(unique.values()));
  }

  return merged;
}

function reassignSignalsToBestCluster(
  clusters: SignalWithEmbedding[][],
  config: EmbeddingClusterConfig
): SignalWithEmbedding[][] {
  if (clusters.length <= 1) return clusters;

  const representatives = clusters.map(cluster =>
    cluster.find(signal => signal.embedding) || cluster[0] || null
  );
  const allSignals = new Map<string, SignalWithEmbedding>();
  clusters.forEach(cluster => cluster.forEach(signal => {
    if (!allSignals.has(signal.id)) allSignals.set(signal.id, signal);
  }));

  const reassigned: SignalWithEmbedding[][] = representatives.map(() => []);
  for (const signal of allSignals.values()) {
    let bestIndex = 0;
    let bestScore = -1;

    representatives.forEach((rep, index) => {
      if (!rep) return;
      const similarity = config.useHybrid
        ? calculateHybridSimilarity(signal, rep, config)
        : (signal.embedding && rep.embedding)
          ? cosineSimilarity(signal.embedding, rep.embedding)
          : 0;
      if (similarity > bestScore) {
        bestScore = similarity;
        bestIndex = index;
      }
    });

    reassigned[bestIndex].push(signal);
  }

  return reassigned.filter(cluster => cluster.length > 0);
}

function refineEmbeddingClusters(
  clusters: SignalWithEmbedding[][],
  config: EmbeddingClusterConfig
): SignalWithEmbedding[][] {
  const overlapThreshold = config.overlapMergeThreshold ?? 0.5;
  const minAverageQuality = config.minAverageQuality ?? 0.35;

  let refined = clusters;
  if (MAX_REFINEMENT_CLUSTERS > 0 && clusters.length > MAX_REFINEMENT_CLUSTERS) {
    logger.warn('Skipping expensive overlap/reassignment refinement for large cluster set', {
      stage: 'opportunity_clustering',
      status: 'degraded',
      clusterCount: clusters.length,
      maxRefinementClusters: MAX_REFINEMENT_CLUSTERS,
      overlapThreshold
    });
  } else {
    refined = mergeOverlappingClusters(clusters, overlapThreshold);
    refined = reassignSignalsToBestCluster(refined, config);
  }
  refined = refined.filter(cluster => calculateAverageSignalQuality(cluster) >= minAverageQuality);
  return refined;
}

/**
 * Detects opportunities using embedding-based semantic clustering
 */
export async function detectOpportunitiesWithEmbeddings(
  config: Partial<EmbeddingClusterConfig> = {}
): Promise<Opportunity[]> {
  const finalConfig = { ...DEFAULT_EMBEDDING_CLUSTER_CONFIG, ...config };
  
  // Get signals with embeddings
  const signals = await getSignalsWithEmbeddings(undefined, 1000);
  
  if (signals.length === 0) {
    logger.info('No signals found for embedding-based opportunity detection');
    return [];
  }
  
  // Cluster signals
  const clusters = await clusterSignalsWithEmbeddings(signals, finalConfig);
  const refinedClusters = refineEmbeddingClusters(clusters, finalConfig);
  
  // Create opportunities from valid clusters
  const validClusters = refinedClusters.filter(c => c.length >= finalConfig.minClusterSize);
  
  const opportunities = await Promise.all(validClusters.map(cluster => createOpportunityFromCluster(cluster)));
  
  logger.info('Embedding-based opportunity detection complete', {
    totalSignals: signals.length,
    totalClusters: refinedClusters.length,
    validClusters: validClusters.length,
    opportunities: opportunities.length
  });
  
  return opportunities;
}

/**
 * Finds similar signals using embedding similarity
 */
export async function findSimilarSignalsByEmbedding(
  signalId: string,
  limit: number = 10,
  minSimilarity: number = 0.7
): Promise<Array<{ signal: Signal; similarity: number }>> {
  const pool = getDbPool();
  
  // Get the target signal's embedding
  const targetResult = await pool.query(`
    SELECT embedding::text as embedding_text
    FROM signal_embeddings
    WHERE signal_id = $1
  `, [signalId]);
  
  if (targetResult.rows.length === 0) {
    logger.warn('No embedding found for signal', { signalId });
    return [];
  }
  
  // Parse target embedding
  const embeddingStr = targetResult.rows[0].embedding_text.replace('[', '').replace(']', '');
  const targetEmbedding = embeddingStr.split(',').map((v: string) => parseFloat(v.trim()));
  
  // Use pgvector similarity search
  const embeddingVector = `[${targetEmbedding.join(',')}]`;
  
  const result = await pool.query(`
    SELECT s.*, se.embedding <=> $1::vector as distance
    FROM signal_embeddings se
    JOIN signals s ON s.id = se.signal_id
    WHERE se.signal_id != $2
    ORDER BY se.embedding <=> $1::vector
    LIMIT $3
  `, [embeddingVector, signalId, limit]);
  
  return result.rows
    .map(row => ({
      signal: {
        id: row.id,
        source: row.source,
        source_ref: row.source_ref,
        signal_type: row.signal_type,
        content: row.content,
        normalized_content: row.normalized_content,
        severity: row.severity,
        confidence: row.confidence,
        metadata: row.metadata ? (typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata) : null,
        created_at: new Date(row.created_at)
      },
      similarity: 1 - row.distance // Convert distance to similarity
    }))
    .filter(r => r.similarity >= minSimilarity);
}

/**
 * Detects and stores opportunities incrementally using embeddings
 */
export async function detectAndStoreOpportunitiesWithEmbeddings(
  config: (Partial<EmbeddingClusterConfig> & { signalSource?: string }) = {}
): Promise<{
  newOpportunities: Opportunity[];
  signalsProcessed: number;
}> {
  const { signalSource, ...clusterConfig } = config;
  const finalConfig = { ...DEFAULT_EMBEDDING_CLUSTER_CONFIG, ...clusterConfig };
  
  // Get unlinked signals with embeddings
  const unlinkedSignals = await getUnlinkedSignals(signalSource);
  const signalIds = unlinkedSignals.map(s => s.id);
  
  if (signalIds.length === 0) {
    return { newOpportunities: [], signalsProcessed: 0 };
  }
  
  // Get signals with embeddings
  const signalsWithEmbeddings = await getSignalsWithEmbeddings(signalIds);
  const pool = getDbPool();
  const extractionDensityResult = await pool.query(
    `
      SELECT signal_id,
        (
          COALESCE(jsonb_array_length(extraction->'entities'->'customers'), 0) +
          COALESCE(jsonb_array_length(extraction->'entities'->'features'), 0) +
          COALESCE(jsonb_array_length(extraction->'entities'->'issues'), 0) +
          COALESCE(jsonb_array_length(extraction->'entities'->'themes'), 0) +
          COALESCE(jsonb_array_length(extraction->'entities'->'stakeholders'), 0)
        )::int AS entity_count
      FROM signal_extractions
      WHERE signal_id = ANY($1)
    `,
    [signalIds]
  );
  const extractionDensity = new Map<string, number>();
  extractionDensityResult.rows.forEach((row) => {
    extractionDensity.set(row.signal_id, Number(row.entity_count) || 0);
  });
  const eligibleSignals = signalsWithEmbeddings.filter(
    (signal) =>
      Boolean(signal.embedding) &&
      signal.content.length >= 80 &&
      (extractionDensity.get(signal.id) || 0) > 0
  );
  
  if (eligibleSignals.length === 0) {
    return { newOpportunities: [], signalsProcessed: 0 };
  }
  
  // Cluster using embeddings
  const clusters = await clusterSignalsWithEmbeddings(eligibleSignals, finalConfig);
  const refinedClusters = refineEmbeddingClusters(clusters, finalConfig);
  const validClusters = refinedClusters.filter(c => c.length >= finalConfig.minClusterSize);
  
  const newOpportunities: Opportunity[] = [];
  
  for (const cluster of validClusters) {
    const opportunity = await createOpportunityFromCluster(cluster);
    await storeOpportunity(opportunity, cluster.map(s => s.id));
    newOpportunities.push(opportunity);
  }
  
  logger.info('Incremental embedding-based opportunity detection complete', {
    signalsProcessed: eligibleSignals.length,
    newOpportunities: newOpportunities.length
  });
  
  return {
    newOpportunities,
    signalsProcessed: eligibleSignals.length
  };
}

/**
 * Gets semantic clusters summary for dashboard
 */
export async function getSemanticClustersSummary(): Promise<{
  totalClusters: number;
  avgClusterSize: number;
  largestCluster: number;
  signalsWithEmbeddings: number;
  signalsWithoutEmbeddings: number;
  clusters: Array<{
    size: number;
    themes: string[];
    customers: string[];
    avgSimilarity: number;
  }>;
}> {
  const signals = await getSignalsWithEmbeddings(undefined, 500);
  const withEmbeddings = signals.filter(s => s.embedding);
  
  if (withEmbeddings.length === 0) {
    return {
      totalClusters: 0,
      avgClusterSize: 0,
      largestCluster: 0,
      signalsWithEmbeddings: 0,
      signalsWithoutEmbeddings: signals.length,
      clusters: []
    };
  }
  
  const clusters = await clusterSignalsWithEmbeddings(withEmbeddings, DEFAULT_EMBEDDING_CLUSTER_CONFIG);
  const refinedClusters = refineEmbeddingClusters(clusters, DEFAULT_EMBEDDING_CLUSTER_CONFIG);
  const validClusters = refinedClusters.filter(c => c.length >= 2);
  
  const clusterDetails = validClusters.map(cluster => {
    // Calculate average similarity within cluster
    let totalSim = 0;
    let comparisons = 0;
    for (let i = 0; i < cluster.length; i++) {
      for (let j = i + 1; j < cluster.length; j++) {
        if (cluster[i].embedding && cluster[j].embedding) {
          totalSim += cosineSimilarity(cluster[i].embedding!, cluster[j].embedding!);
          comparisons++;
        }
      }
    }
    
    const themes = new Set<string>();
    const customers = new Set<string>();
    cluster.forEach(s => {
      (s.metadata?.themes as string[] || []).forEach(t => themes.add(t));
      (s.metadata?.customers as string[] || []).forEach(c => customers.add(c));
    });
    
    return {
      size: cluster.length,
      themes: Array.from(themes).slice(0, 5),
      customers: Array.from(customers).slice(0, 5),
      avgSimilarity: comparisons > 0 ? totalSim / comparisons : 0
    };
  });
  
  return {
    totalClusters: validClusters.length,
    avgClusterSize: validClusters.length > 0 
      ? Math.round(validClusters.reduce((a, c) => a + c.length, 0) / validClusters.length * 10) / 10
      : 0,
    largestCluster: Math.max(...validClusters.map(c => c.length), 0),
    signalsWithEmbeddings: withEmbeddings.length,
    signalsWithoutEmbeddings: signals.length - withEmbeddings.length,
    clusters: clusterDetails.slice(0, 10)
  };
}
