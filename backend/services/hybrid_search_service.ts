import { getDbPool } from '../db/connection';
import { Signal } from '../processing/signal_extractor';
import { EmbeddingProvider } from './embedding_provider';
import { createModuleLogger } from '../utils/logger';

const logger = createModuleLogger('hybrid_search', 'LOG_LEVEL_HYBRID_SEARCH');

/**
 * Hybrid search options combining vector and full-text search
 */
export interface HybridSearchOptions {
  query: string;
  limit?: number;
  vectorWeight?: number;  // 0-1, weight for vector similarity (default 0.6)
  textWeight?: number;    // 0-1, weight for text search (default 0.4)
  minScore?: number;      // Minimum combined score threshold
  filters?: {
    source?: string;
    customer?: string;
    feature?: string;
    theme?: string;
    startDate?: Date;
    endDate?: Date;
    channelId?: string;
  };
}

/**
 * Hybrid search result
 */
export interface HybridSearchResult {
  signal: Signal;
  vectorScore: number;
  textScore: number;
  combinedScore: number;
  contextualSummary?: string;
}

/**
 * Performs hybrid search combining vector similarity and full-text search
 */
export async function hybridSearch(
  options: HybridSearchOptions,
  embeddingProvider: EmbeddingProvider
): Promise<HybridSearchResult[]> {
  const {
    query,
    limit = 20,
    vectorWeight = 0.6,
    textWeight = 0.4,
    minScore = 0.3,
    filters = {}
  } = options;
  const safeVectorWeight = Number.isFinite(vectorWeight) ? vectorWeight : 0.6;
  const safeTextWeight = Number.isFinite(textWeight) ? textWeight : 0.4;
  const safeMinScore = Number.isFinite(minScore) ? minScore : 0.3;

  const startTime = Date.now();
  logger.info('Hybrid search started', {
    query: query.substring(0, 50),
    vector_weight: safeVectorWeight,
    text_weight: safeTextWeight,
    min_score: safeMinScore,
    filters: Object.keys(filters).length > 0 ? filters : 'none'
  });

  const pool = getDbPool();

  try {
    // Generate query embedding
    const queryEmbedding = await embeddingProvider(query);
    const embeddingStr = `[${queryEmbedding.join(',')}]`;

    // Build filter conditions
    const filterConditions: string[] = [];
    const filterParams: any[] = [];
    let paramIndex = 7; // Starting after vector, query text, limit, weights, minScore

    if (filters.source) {
      filterConditions.push(`s.source = $${paramIndex++}`);
      filterParams.push(filters.source);
    }

    if (filters.startDate) {
      filterConditions.push(`s.created_at >= $${paramIndex++}`);
      filterParams.push(filters.startDate);
    }

    if (filters.endDate) {
      filterConditions.push(`s.created_at <= $${paramIndex++}`);
      filterParams.push(filters.endDate);
    }

    if (filters.channelId) {
      filterConditions.push(`s.metadata->>'channel_id' = $${paramIndex++}`);
      filterParams.push(filters.channelId);
    }

    if (filters.customer) {
      filterConditions.push(`s.normalized_content ILIKE $${paramIndex++}`);
      filterParams.push(`%${filters.customer.toLowerCase()}%`);
    }

    if (filters.feature) {
      filterConditions.push(`s.normalized_content ILIKE $${paramIndex++}`);
      filterParams.push(`%${filters.feature.toLowerCase()}%`);
    }

    if (filters.theme) {
      filterConditions.push(`s.normalized_content ILIKE $${paramIndex++}`);
      filterParams.push(`%${filters.theme.toLowerCase()}%`);
    }

    if (filterConditions.length > 0) {
      logger.debug('Search filters applied', {
        filter_count: filterConditions.length,
        filters: {
          source: !!filters.source,
          customer: !!filters.customer,
          feature: !!filters.feature,
          theme: !!filters.theme,
          date_range: !!(filters.startDate || filters.endDate),
          channel: !!filters.channelId
        }
      });
    }

    const filterClause = filterConditions.length > 0
      ? `AND ${filterConditions.join(' AND ')}`
      : '';

    // Hybrid search query combining vector similarity and full-text search
    const hybridQuery = `
      WITH vector_results AS (
        SELECT 
          se.signal_id,
          se.contextual_summary,
          (1 - (se.embedding <=> $1::vector)) as vector_score
        FROM signal_embeddings se
        JOIN signals s ON s.id = se.signal_id
        WHERE TRUE ${filterClause}
        ORDER BY se.embedding <=> $1::vector
        LIMIT $3 * 2
      ),
      text_results AS (
        SELECT 
          s.id as signal_id,
          ts_rank_cd(
            to_tsvector('english', s.normalized_content),
            plainto_tsquery('english', $2)
          ) as text_score
        FROM signals s
        WHERE to_tsvector('english', s.normalized_content) @@ plainto_tsquery('english', $2)
          ${filterClause}
        LIMIT $3 * 2
      ),
      combined AS (
        SELECT 
          COALESCE(vr.signal_id, tr.signal_id) as signal_id,
          COALESCE(vr.contextual_summary, '') as contextual_summary,
          COALESCE(vr.vector_score, 0) as vector_score,
          COALESCE(tr.text_score, 0) as text_score,
          (COALESCE(vr.vector_score, 0) * $4 + 
           COALESCE(tr.text_score, 0) * $5) as combined_score
        FROM vector_results vr
        FULL OUTER JOIN text_results tr ON vr.signal_id = tr.signal_id
      )
      SELECT 
        s.*,
        c.vector_score,
        c.text_score,
        c.combined_score,
        c.contextual_summary
      FROM combined c
      JOIN signals s ON s.id = c.signal_id
      WHERE c.combined_score >= $6
      ORDER BY c.combined_score DESC
      LIMIT $3
    `;

    const result = await pool.query(
      hybridQuery,
      [embeddingStr, query, limit, safeVectorWeight, safeTextWeight, safeMinScore, ...filterParams]
    );

    const results: HybridSearchResult[] = result.rows.map(row => ({
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
      vectorScore: parseFloat(row.vector_score) || 0,
      textScore: parseFloat(row.text_score) || 0,
      combinedScore: parseFloat(row.combined_score) || 0,
      contextualSummary: row.contextual_summary || undefined
    }));

    logger.debug('Hybrid search completed', {
      query: query.substring(0, 50),
      resultCount: results.length,
      durationMs: Date.now() - startTime
    });

    return results;
  } catch (error: any) {
    logger.error('Hybrid search failed', {
      operation: 'hybridSearch',
      query: query.substring(0, 50),
      error: error.message,
      errorClass: error.constructor.name,
      stack: error.stack,
      filters,
      vectorWeight: safeVectorWeight,
      textWeight: safeTextWeight,
      durationMs: Date.now() - startTime
    });
    throw error;
  }
}

/**
 * Performs vector-only search (semantic similarity)
 */
export async function vectorSearch(
  query: string,
  embeddingProvider: EmbeddingProvider,
  options?: {
    limit?: number;
    minSimilarity?: number;
    filters?: HybridSearchOptions['filters'];
  }
): Promise<HybridSearchResult[]> {
  const { limit = 20, minSimilarity = 0.7, filters = {} } = options || {};
  const pool = getDbPool();
  const startTime = Date.now();

  try {
    const queryEmbedding = await embeddingProvider(query);
    const embeddingStr = `[${queryEmbedding.join(',')}]`;

    // Build filter conditions
    const filterConditions: string[] = [];
    const filterParams: any[] = [];
    let paramIndex = 3;

    if (filters.source) {
      filterConditions.push(`s.source = $${paramIndex++}`);
      filterParams.push(filters.source);
    }

    if (filters.startDate) {
      filterConditions.push(`s.created_at >= $${paramIndex++}`);
      filterParams.push(filters.startDate);
    }

    if (filters.endDate) {
      filterConditions.push(`s.created_at <= $${paramIndex++}`);
      filterParams.push(filters.endDate);
    }

    const filterClause = filterConditions.length > 0 
      ? `AND ${filterConditions.join(' AND ')}` 
      : '';

    const limitParamIndex = paramIndex;
    const vectorQuery = `
      SELECT 
        s.*,
        se.contextual_summary,
        (1 - (se.embedding <=> $1::vector)) as similarity
      FROM signal_embeddings se
      JOIN signals s ON s.id = se.signal_id
      WHERE (1 - (se.embedding <=> $1::vector)) >= $2
        ${filterClause}
      ORDER BY se.embedding <=> $1::vector
      LIMIT $${limitParamIndex}
    `;

    const result = await pool.query(vectorQuery, [embeddingStr, minSimilarity, ...filterParams, limit]);

    const results: HybridSearchResult[] = result.rows.map(row => ({
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
      vectorScore: parseFloat(row.similarity) || 0,
      textScore: 0,
      combinedScore: parseFloat(row.similarity) || 0,
      contextualSummary: row.contextual_summary || undefined
    }));

    logger.debug('Vector search completed', {
      query: query.substring(0, 50),
      resultCount: results.length,
      durationMs: Date.now() - startTime
    });

    return results;
  } catch (error: any) {
    logger.error('Vector search failed', {
      operation: 'vectorSearch',
      query: query.substring(0, 50),
      error: error.message,
      errorClass: error.constructor.name,
      stack: error.stack,
      filters,
      minSimilarity,
      durationMs: Date.now() - startTime
    });
    throw error;
  }
}

/**
 * Performs full-text search only
 */
export async function textSearch(
  query: string,
  options?: {
    limit?: number;
    filters?: HybridSearchOptions['filters'];
  }
): Promise<HybridSearchResult[]> {
  const { limit = 20, filters = {} } = options || {};
  const pool = getDbPool();
  const startTime = Date.now();

  try {
    const filterConditions: string[] = [];
    const filterParams: any[] = [query, limit];
    let paramIndex = 3;

    if (filters.source) {
      filterConditions.push(`s.source = $${paramIndex++}`);
      filterParams.push(filters.source);
    }

    if (filters.startDate) {
      filterConditions.push(`s.created_at >= $${paramIndex++}`);
      filterParams.push(filters.startDate);
    }

    if (filters.endDate) {
      filterConditions.push(`s.created_at <= $${paramIndex++}`);
      filterParams.push(filters.endDate);
    }

    const filterClause = filterConditions.length > 0 
      ? `AND ${filterConditions.join(' AND ')}` 
      : '';

    const textQuery = `
      SELECT 
        s.*,
        ts_rank_cd(
          to_tsvector('english', s.normalized_content),
          plainto_tsquery('english', $1)
        ) as text_score
      FROM signals s
      WHERE to_tsvector('english', s.normalized_content) @@ plainto_tsquery('english', $1)
        ${filterClause}
      ORDER BY text_score DESC
      LIMIT $2
    `;

    const result = await pool.query(textQuery, filterParams);

    const results: HybridSearchResult[] = result.rows.map(row => ({
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
      vectorScore: 0,
      textScore: parseFloat(row.text_score) || 0,
      combinedScore: parseFloat(row.text_score) || 0
    }));

    logger.debug('Text search completed', {
      query: query.substring(0, 50),
      resultCount: results.length,
      durationMs: Date.now() - startTime
    });

    return results;
  } catch (error: any) {
    logger.error('Text search failed', {
      operation: 'textSearch',
      query: query.substring(0, 50),
      error: error.message,
      errorClass: error.constructor.name,
      stack: error.stack,
      filters,
      durationMs: Date.now() - startTime
    });
    throw error;
  }
}

/**
 * Finds similar signals to a given signal
 */
export async function findSimilarSignals(
  signalId: string,
  embeddingProvider: EmbeddingProvider,
  options?: {
    limit?: number;
    minSimilarity?: number;
  }
): Promise<HybridSearchResult[]> {
  const { limit = 10, minSimilarity = 0.7 } = options || {};
  const pool = getDbPool();

  try {
    // Get the source signal's embedding
    const embeddingResult = await pool.query(
      `SELECT embedding::text, contextual_summary 
       FROM signal_embeddings 
       WHERE signal_id = $1`,
      [signalId]
    );

    if (embeddingResult.rows.length === 0) {
      logger.warn('Signal has no embedding', { signalId });
      return [];
    }

    // Use the database function for similarity search
    const similarResult = await pool.query(
      `SELECT * FROM find_signals_similar_to($1, $2, $3)`,
      [signalId, limit, minSimilarity]
    );

    // Get full signal data
    if (similarResult.rows.length === 0) {
      return [];
    }

    const similarIds = similarResult.rows.map(r => r.signal_id);
    const similarityMap = new Map(similarResult.rows.map(r => [r.signal_id, r.similarity]));

    const signalsResult = await pool.query(
      `SELECT s.*, se.contextual_summary
       FROM signals s
       LEFT JOIN signal_embeddings se ON s.id = se.signal_id
       WHERE s.id = ANY($1)`,
      [similarIds]
    );

    return signalsResult.rows.map(row => ({
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
      vectorScore: similarityMap.get(row.id) || 0,
      textScore: 0,
      combinedScore: similarityMap.get(row.id) || 0,
      contextualSummary: row.contextual_summary || undefined
    })).sort((a, b) => b.combinedScore - a.combinedScore);
  } catch (error: any) {
    logger.error('Find similar signals failed', {
      operation: 'findSimilarSignals',
      signalId,
      error: error.message,
      errorClass: error.constructor.name,
      stack: error.stack,
      limit,
      minSimilarity
    });
    throw error;
  }
}

/**
 * Search for signals related to a specific theme
 */
export async function searchByTheme(
  themeName: string,
  embeddingProvider: EmbeddingProvider,
  options?: {
    limit?: number;
    minScore?: number;
  }
): Promise<HybridSearchResult[]> {
  const themeQuery = `signals related to ${themeName} theme in product context`;
  return hybridSearch(
    {
      query: themeQuery,
      limit: options?.limit,
      minScore: options?.minScore,
      vectorWeight: 0.7,
      textWeight: 0.3
    },
    embeddingProvider
  );
}

/**
 * Search for signals related to a specific customer
 */
export async function searchByCustomer(
  customerName: string,
  embeddingProvider: EmbeddingProvider,
  options?: {
    limit?: number;
    includeRelated?: boolean;
  }
): Promise<HybridSearchResult[]> {
  const { limit = 20, includeRelated = true } = options || {};

  if (includeRelated) {
    // Use hybrid search to find semantically related signals
    return hybridSearch(
      {
        query: `customer ${customerName} feedback and issues`,
        limit,
        filters: { customer: customerName },
        vectorWeight: 0.5,
        textWeight: 0.5
      },
      embeddingProvider
    );
  } else {
    // Direct filter by customer name
    return textSearch(`${customerName}`, { limit, filters: { customer: customerName } });
  }
}

/**
 * Search only in Slack messages and threads
 */
export async function searchSlack(
  query: string,
  embeddingProvider: EmbeddingProvider,
  options?: { channelId?: string; limit?: number }
): Promise<HybridSearchResult[]> {
  return hybridSearch(
    {
      query,
      filters: {
        source: 'slack',
        channelId: options?.channelId
      },
      limit: options?.limit || 20
    },
    embeddingProvider
  );
}

/**
 * Search only in documents (PDFs, specs, etc.)
 */
export async function searchDocuments(
  query: string,
  embeddingProvider: EmbeddingProvider,
  options?: { limit?: number }
): Promise<HybridSearchResult[]> {
  return hybridSearch(
    {
      query,
      filters: { source: 'document' },
      limit: options?.limit || 20
    },
    embeddingProvider
  );
}

/**
 * Search only in meeting transcripts
 */
export async function searchTranscripts(
  query: string,
  embeddingProvider: EmbeddingProvider,
  options?: { limit?: number; customer?: string }
): Promise<HybridSearchResult[]> {
  return hybridSearch(
    {
      query,
      filters: {
        source: 'transcript',
        customer: options?.customer
      },
      limit: options?.limit || 20
    },
    embeddingProvider
  );
}

/**
 * Search only in web content (blogs, changelogs, etc.)
 */
export async function searchWebContent(
  query: string,
  embeddingProvider: EmbeddingProvider,
  options?: { limit?: number; competitor?: string }
): Promise<HybridSearchResult[]> {
  // Search in web_scrape source
  const results = await hybridSearch(
    {
      query,
      filters: { source: 'web_scrape' },
      limit: options?.limit || 20
    },
    embeddingProvider
  );

  // Post-filter by competitor if specified
  if (options?.competitor) {
    return results.filter(r =>
      r.signal.metadata?.competitor === options.competitor
    );
  }

  return results;
}
