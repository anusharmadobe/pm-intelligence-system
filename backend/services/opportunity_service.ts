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
import { logger } from '../utils/logger';
import { computeSignalTrends, TrendResult } from './trend_analysis_service';
import { getChannelConfig } from './channel_registry_service';

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
  // Early termination: Check source requirement first (cheapest check)
  if (config.requireSameSource && signal1.source !== signal2.source) {
    return false;
  }

  // Early termination: Check signal type requirement
  if (config.requireSameType && signal1.signal_type !== signal2.signal_type) {
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

  return similarity >= config.similarityThreshold;
}

/**
 * Creates an opportunity from a cluster of signals.
 * Improved title generation using customer names, topics, and meaningful words.
 * NO INFERENCE - uses simple aggregation of signal data.
 */
async function createOpportunityFromCluster(cluster: Signal[]): Promise<Opportunity> {
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

  // Extract topics from all signals
  const allTopics = new Set<string>();
  cluster.forEach(signal => {
    const topics = extractTopics(signal.content);
    topics.forEach(t => allTopics.add(t));
  });

  // Enrich with LLM extraction entities (customers, features, issues, themes)
  const signalIds = cluster.map(signal => signal.id);
  if (signalIds.length > 0) {
    const extractionsResult = await pool.query(
      `SELECT extraction FROM signal_extractions WHERE signal_id = ANY($1)`,
      [signalIds]
    );
    for (const row of extractionsResult.rows) {
      try {
        const extraction = typeof row.extraction === 'string'
          ? JSON.parse(row.extraction)
          : row.extraction;
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

  return {
    id: randomUUID(),
    title: title.substring(0, 150), // Increased from 100 to 150
    description: descriptionParts.join('. ') + '.',
    status: 'new',
    created_at: new Date()
  };
}

/**
 * Stores an opportunity and links it to its signals.
 * Uses batch insert for signal links for better performance.
 */
export async function storeOpportunity(opportunity: Opportunity, signalIds: string[]): Promise<void> {
  const pool = getDbPool();
  
  // Insert opportunity
  await pool.query(
    `INSERT INTO opportunities (id, title, description, status, created_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [opportunity.id, opportunity.title, opportunity.description, opportunity.status, opportunity.created_at]
  );

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
  for (const newSignal of newSignals) {
    let matched = false;
    
    for (const { opportunity, signals } of existingOpportunities) {
      // Check if signal matches any signal in this opportunity
      for (const existingSignal of signals) {
        if (areSignalsRelated(newSignal, existingSignal, finalConfig)) {
          // Add signal to existing opportunity
          await addSignalToOpportunity(opportunity.id, newSignal.id);
          matchedSignals.add(newSignal.id);
          matched = true;
          
          if (!updatedOpportunities.find(o => o.id === opportunity.id)) {
            updatedOpportunities.push(opportunity);
          }
          
          break;
        }
      }
      
      if (matched) break;
    }
  }
  
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
  const finalConfig = { ...DEFAULT_CONFIG, ...config };
  const clusters: Signal[][] = [];
  const processed = new Set<string>();

  for (const signal of signals) {
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
  }

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
  const pool = getDbPool();
  
  // Get signals from both opportunities
  const primarySignals = await getSignalsForOpportunity(primaryOpportunityId);
  const secondarySignals = await getSignalsForOpportunity(secondaryOpportunityId);
  const allSignals = [...primarySignals, ...secondarySignals];
  
  // Create merged opportunity
  const merged = await createOpportunityFromCluster(allSignals);
  
  // Update primary opportunity
  await pool.query(
    `UPDATE opportunities 
     SET title = $1, description = $2
     WHERE id = $3`,
    [merged.title, merged.description, primaryOpportunityId]
  );
  
  // Move all signals from secondary to primary
  await pool.query(
    `UPDATE opportunity_signals 
     SET opportunity_id = $1
     WHERE opportunity_id = $2`,
    [primaryOpportunityId, secondaryOpportunityId]
  );
  
  // Delete secondary opportunity
  await pool.query(
    `DELETE FROM opportunities WHERE id = $1`,
    [secondaryOpportunityId]
  );
  
  logger.info('Opportunities merged', {
    primaryId: primaryOpportunityId,
    secondaryId: secondaryOpportunityId,
    totalSignals: allSignals.length
  });
  
  // Return updated primary opportunity
  const result = await pool.query('SELECT * FROM opportunities WHERE id = $1', [primaryOpportunityId]);
  return {
    ...result.rows[0],
    created_at: new Date(result.rows[0].created_at)
  };
}

/**
 * Finds and merges related opportunities.
 * Uses similarity threshold to determine if opportunities should be merged.
 */
export async function mergeRelatedOpportunities(
  similarityThreshold: number = 0.3
): Promise<number> {
  let mergeCount = 0;
  let hasMore = true;
  
  // Keep merging until no more merges are found
  while (hasMore) {
    const opportunities = await getAllOpportunities();
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
          processed.add(opp1.id);
          processed.add(opp2.id);
          hasMore = true;
          break; // Restart from beginning after merge
        }
      }
      
      if (hasMore) break; // Restart outer loop
    }
  }
  
  logger.info('Related opportunities merged', { mergeCount });
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
  
  return Math.min(customerScore + tierBoost + volumeBoost, 100);
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
  
  return Math.min(recencyScore + trendScore + volumeScore, 100);
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
  const finalConfig = { ...DEFAULT_EMBEDDING_CLUSTER_CONFIG, ...config };
  const clusters: SignalWithEmbedding[][] = [];
  const processed = new Set<string>();
  
  logger.info('Starting embedding-based clustering', {
    signalCount: signals.length,
    withEmbeddings: signals.filter(s => s.embedding).length,
    config: finalConfig
  });
  
  // Sort by embedding availability (prioritize signals with embeddings)
  const sortedSignals = [...signals].sort((a, b) => {
    const aHas = a.embedding ? 1 : 0;
    const bHas = b.embedding ? 1 : 0;
    return bHas - aHas;
  });
  
  for (const signal of sortedSignals) {
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
  }
  
  logger.info('Embedding-based clustering complete', {
    totalClusters: clusters.length,
    validClusters: clusters.filter(c => c.length >= finalConfig.minClusterSize).length
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

  let refined = mergeOverlappingClusters(clusters, overlapThreshold);
  refined = reassignSignalsToBestCluster(refined, config);
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
