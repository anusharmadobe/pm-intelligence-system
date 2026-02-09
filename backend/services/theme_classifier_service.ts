import { getDbPool } from '../db/connection';
import { Signal } from '../processing/signal_extractor';
import { LLMProvider } from './llm_service';
import { 
  HierarchicalTheme, 
  ThemeMatch,
  matchHierarchicalThemes,
  getThemeById,
  getThemePath,
  getThemeHierarchy,
  getAllThemes
} from '../config/theme_dictionary';
import { logger } from '../utils/logger';

/**
 * Theme classification result
 */
export interface ThemeClassification {
  themeId: string;
  themeName: string;
  themePath: string[];
  level: number;
  confidence: number;
  matchedKeywords: string[];
  source: 'keyword' | 'llm' | 'hybrid';
}

/**
 * Classification options
 */
export interface ClassificationOptions {
  useLLMFallback?: boolean;
  llmMode?: 'fallback' | 'always' | 'hybrid';
  minConfidence?: number;
  maxThemes?: number;
  preferSpecific?: boolean;  // Prefer more specific (L3/L4) themes
}

/**
 * Classifies a signal into hierarchical themes
 * Uses keyword matching first, with optional LLM fallback
 */
export async function classifySignalThemes(
  signal: Signal,
  options?: ClassificationOptions,
  llmProvider?: LLMProvider
): Promise<ThemeClassification[]> {
  const {
    useLLMFallback = true,
    llmMode = 'hybrid',
    minConfidence = 0.2,
    maxThemes = 5,
    preferSpecific = true
  } = options || {};

  const textToClassify = `${signal.content} ${signal.metadata?.topics?.join(' ') || ''}`;
  
  const shouldUseLLM = useLLMFallback && !!llmProvider;
  let classifications: ThemeClassification[] = [];

  // Step 1: Keyword-based classification (unless LLM-only mode)
  if (llmMode !== 'always') {
    const keywordMatches = matchHierarchicalThemes(textToClassify);
    classifications = keywordMatches
      .filter(m => m.confidence >= minConfidence)
      .map(m => ({
        themeId: m.theme.id,
        themeName: m.theme.name,
        themePath: m.path,
        level: m.theme.level,
        confidence: m.confidence,
        matchedKeywords: m.matchedKeywords,
        source: 'keyword' as const
      }));
  }

  // Prefer more specific themes if enabled
  if (preferSpecific && classifications.length > 0) {
    // Group by L1 theme and prefer the most specific match in each group
    const byL1 = new Map<string, ThemeClassification[]>();
    for (const c of classifications) {
      const l1 = c.themePath[0] || 'unknown';
      if (!byL1.has(l1)) byL1.set(l1, []);
      byL1.get(l1)!.push(c);
    }
    
    // Take the most specific from each L1 group
    const refined: ThemeClassification[] = [];
    for (const group of byL1.values()) {
      // Sort by level (most specific first) then confidence
      group.sort((a, b) => {
        if (b.level !== a.level) return b.level - a.level;
        return b.confidence - a.confidence;
      });
      refined.push(group[0]);
    }
    classifications = refined;
  }

  // Step 2: LLM classification (fallback/always/hybrid)
  const shouldRunLLM =
    shouldUseLLM &&
    (llmMode === 'always' || llmMode === 'hybrid' || (llmMode === 'fallback' && classifications.length === 0));

  if (shouldRunLLM && llmProvider) {
    try {
      const llmClassifications = await classifyWithLLM(signal, llmProvider);
      const filteredLLM = llmClassifications
        .filter(c => c.confidence >= minConfidence)
        .map(c => ({ ...c, source: 'llm' as const }));

      if (llmMode === 'hybrid') {
        const merged = new Map<string, ThemeClassification>();
        classifications.forEach(c => merged.set(c.themeId, c));
        filteredLLM.forEach(c => merged.set(c.themeId, c)); // LLM overrides keywords
        classifications = Array.from(merged.values());
      } else {
        classifications = filteredLLM;
      }
    } catch (error: any) {
      logger.warn('LLM theme classification failed', { error: error.message, signalId: signal.id });
    }
  }

  // Limit results
  return classifications.slice(0, maxThemes);
}

/**
 * Classifies signal using LLM
 */
async function classifyWithLLM(
  signal: Signal,
  llmProvider: LLMProvider
): Promise<ThemeClassification[]> {
  // Build theme options for LLM
  const themeOptions = getAllThemes()
    .filter(t => t.level >= 3) // Only L3 and L4 themes
    .map(t => `- ${t.id}: ${t.name} (${getThemePath(t.id).join(' > ')})`)
    .join('\n');

  const prompt = `Classify this customer signal into product themes.

Available themes:
${themeOptions}

Signal content:
${signal.content.substring(0, 1500)}

Customer: ${signal.metadata?.customers?.join(', ') || 'Unknown'}
Topics mentioned: ${signal.metadata?.topics?.join(', ') || 'None'}

Respond with a JSON array of theme IDs and confidence scores (0-1).
Only include themes with confidence > 0.5.
Example: [{"themeId": "authoring-ux", "confidence": 0.8}]

JSON response:`;

  try {
    const response = await llmProvider(prompt);
    const jsonMatch = response.match(/\[[\s\S]*?\]/);
    
    if (!jsonMatch) {
      return [];
    }

    const parsed = JSON.parse(jsonMatch[0]);
    const classifications: ThemeClassification[] = [];

    for (const item of parsed) {
      const theme = getThemeById(item.themeId);
      if (theme) {
        classifications.push({
          themeId: theme.id,
          themeName: theme.name,
          themePath: getThemePath(theme.id),
          level: theme.level,
          confidence: item.confidence || 0.6,
          matchedKeywords: [],
          source: 'llm'
        });
      }
    }

    return classifications;
  } catch (error: any) {
    logger.warn('Failed to parse LLM theme classification', { error: error.message });
    return [];
  }
}

/**
 * Stores signal-theme classifications in the database
 */
export async function storeSignalThemeClassifications(
  signalId: string,
  classifications: ThemeClassification[]
): Promise<void> {
  const pool = getDbPool();

  for (const classification of classifications) {
    try {
      // First ensure the theme exists in the database
      await pool.query(
        `INSERT INTO theme_hierarchy (id, name, slug, level, parent_id, keywords, priority)
         SELECT $1::uuid, $2, $3, $4, $5::uuid, $6::text[], $7
         WHERE NOT EXISTS (SELECT 1 FROM theme_hierarchy WHERE id = $1::uuid)`,
        [
          classification.themeId,
          classification.themeName,
          classification.themeId, // Use id as slug
          classification.level,
          classification.themePath.length > 1 ? getParentThemeId(classification.themeId) : null,
          classification.matchedKeywords,
          0
        ]
      );

      // Then store the classification
      await pool.query(
        `INSERT INTO signal_theme_hierarchy (signal_id, theme_id, confidence, matched_at_level, matched_keywords)
         VALUES ($1, $2::uuid, $3, $4, $5)
         ON CONFLICT (signal_id, theme_id) DO UPDATE SET
           confidence = GREATEST(signal_theme_hierarchy.confidence, EXCLUDED.confidence),
           matched_keywords = EXCLUDED.matched_keywords`,
        [
          signalId,
          classification.themeId,
          classification.confidence,
          classification.level,
          classification.matchedKeywords
        ]
      );
    } catch (error: any) {
      logger.warn('Failed to store theme classification', { 
        error: error.message, 
        signalId, 
        themeId: classification.themeId 
      });
    }
  }
}

/**
 * Helper to get parent theme ID from the hierarchy
 */
function getParentThemeId(themeId: string): string | null {
  const theme = getThemeById(themeId);
  return theme?.parentId || null;
}

/**
 * Gets all theme classifications for a signal
 */
export async function getSignalThemeClassifications(signalId: string): Promise<ThemeClassification[]> {
  const pool = getDbPool();

  const result = await pool.query(
    `SELECT sth.theme_id, sth.confidence, sth.matched_at_level, sth.matched_keywords,
            th.name, th.slug
     FROM signal_theme_hierarchy sth
     JOIN theme_hierarchy th ON th.id = sth.theme_id
     WHERE sth.signal_id = $1
     ORDER BY sth.confidence DESC`,
    [signalId]
  );

  return result.rows.map(row => ({
    themeId: row.theme_id,
    themeName: row.name,
    themePath: getThemePath(row.theme_id),
    level: row.matched_at_level,
    confidence: row.confidence,
    matchedKeywords: row.matched_keywords || [],
    source: 'keyword' as const
  }));
}

/**
 * Gets signals by theme (including descendant themes)
 */
export async function getSignalsByTheme(
  themeId: string,
  options?: {
    includeDescendants?: boolean;
    limit?: number;
    minConfidence?: number;
  }
): Promise<Array<{ signal: Signal; classification: ThemeClassification }>> {
  const { includeDescendants = true, limit = 100, minConfidence = 0.3 } = options || {};
  const pool = getDbPool();

  let query: string;
  let params: any[];

  if (includeDescendants) {
    query = `
      SELECT s.*, sth.theme_id, sth.confidence, sth.matched_at_level, sth.matched_keywords,
             th.name as theme_name
      FROM signals s
      JOIN signal_theme_hierarchy sth ON s.id = sth.signal_id
      JOIN theme_hierarchy th ON th.id = sth.theme_id
      WHERE (sth.theme_id = $1::uuid OR sth.theme_id IN (
        SELECT descendant_id FROM get_theme_descendants($1::uuid)
      ))
      AND sth.confidence >= $2
      ORDER BY sth.confidence DESC, s.created_at DESC
      LIMIT $3
    `;
    params = [themeId, minConfidence, limit];
  } else {
    query = `
      SELECT s.*, sth.theme_id, sth.confidence, sth.matched_at_level, sth.matched_keywords,
             th.name as theme_name
      FROM signals s
      JOIN signal_theme_hierarchy sth ON s.id = sth.signal_id
      JOIN theme_hierarchy th ON th.id = sth.theme_id
      WHERE sth.theme_id = $1::uuid
      AND sth.confidence >= $2
      ORDER BY sth.confidence DESC, s.created_at DESC
      LIMIT $3
    `;
    params = [themeId, minConfidence, limit];
  }

  const result = await pool.query(query, params);

  return result.rows.map(row => ({
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
    classification: {
      themeId: row.theme_id,
      themeName: row.theme_name,
      themePath: getThemePath(row.theme_id),
      level: row.matched_at_level,
      confidence: row.confidence,
      matchedKeywords: row.matched_keywords || [],
      source: 'keyword' as const
    }
  }));
}

/**
 * Gets theme statistics
 */
export async function getThemeStats(themeId: string): Promise<{
  signalCount: number;
  signalCountWithDescendants: number;
  avgConfidence: number;
  topKeywords: string[];
  recentSignals: number;
}> {
  const pool = getDbPool();

  const [directCount, descendantCount, avgConf, keywords, recent] = await Promise.all([
    pool.query(
      `SELECT COUNT(*) as count FROM signal_theme_hierarchy WHERE theme_id = $1::uuid`,
      [themeId]
    ),
    pool.query(
      `SELECT count_signals_by_theme_with_descendants($1::uuid) as count`,
      [themeId]
    ),
    pool.query(
      `SELECT AVG(confidence) as avg FROM signal_theme_hierarchy WHERE theme_id = $1::uuid`,
      [themeId]
    ),
    pool.query(
      `SELECT unnest(matched_keywords) as kw, COUNT(*) as cnt
       FROM signal_theme_hierarchy 
       WHERE theme_id = $1::uuid
       GROUP BY kw
       ORDER BY cnt DESC
       LIMIT 5`,
      [themeId]
    ),
    pool.query(
      `SELECT COUNT(*) as count 
       FROM signal_theme_hierarchy sth
       JOIN signals s ON s.id = sth.signal_id
       WHERE sth.theme_id = $1::uuid
       AND s.created_at >= NOW() - INTERVAL '7 days'`,
      [themeId]
    )
  ]);

  return {
    signalCount: parseInt(directCount.rows[0]?.count || '0'),
    signalCountWithDescendants: parseInt(descendantCount.rows[0]?.count || '0'),
    avgConfidence: parseFloat(avgConf.rows[0]?.avg || '0'),
    topKeywords: keywords.rows.map(r => r.kw),
    recentSignals: parseInt(recent.rows[0]?.count || '0')
  };
}

/**
 * Batch classify signals
 */
export async function batchClassifySignals(
  signals: Signal[],
  options?: ClassificationOptions,
  llmProvider?: LLMProvider
): Promise<Map<string, ThemeClassification[]>> {
  const results = new Map<string, ThemeClassification[]>();

  for (const signal of signals) {
    try {
      const classifications = await classifySignalThemes(signal, options, llmProvider);
      results.set(signal.id, classifications);
      
      // Store in database
      if (classifications.length > 0) {
        await storeSignalThemeClassifications(signal.id, classifications);
      }
    } catch (error: any) {
      logger.warn('Failed to classify signal', { error: error.message, signalId: signal.id });
      results.set(signal.id, []);
    }
  }

  return results;
}

/**
 * Seeds the theme hierarchy into the database
 */
export async function seedThemeHierarchy(): Promise<void> {
  const pool = getDbPool();
  const themes = getAllThemes();

  logger.info('Seeding theme hierarchy', { themeCount: themes.length });

  for (const theme of themes) {
    try {
      await pool.query(
        `INSERT INTO theme_hierarchy (id, name, slug, level, parent_id, keywords, description, priority, is_active)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, TRUE)
         ON CONFLICT (slug) DO UPDATE SET
           name = EXCLUDED.name,
           level = EXCLUDED.level,
           parent_id = EXCLUDED.parent_id,
           keywords = EXCLUDED.keywords,
           description = EXCLUDED.description,
           priority = EXCLUDED.priority`,
        [
          theme.id,
          theme.name,
          theme.slug,
          theme.level,
          theme.parentId || null,
          theme.keywords,
          theme.description || null,
          theme.priority || 0
        ]
      );
    } catch (error: any) {
      logger.warn('Failed to seed theme', { error: error.message, themeId: theme.id });
    }
  }

  logger.info('Theme hierarchy seeded successfully');
}
