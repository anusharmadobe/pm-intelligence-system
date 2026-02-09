import { getDbPool } from '../db/connection';
import { logger } from '../utils/logger';

/**
 * Entity types that can be analyzed for trends
 */
export type TrendEntityType = 'theme' | 'feature' | 'customer' | 'issue';

/**
 * Trend direction classification
 */
export type TrendDirection = 'emerging' | 'growing' | 'stable' | 'declining';

/**
 * Trend analysis result
 */
export interface TrendResult {
  entityType: TrendEntityType;
  entityId: string;
  entityName: string;
  trend: TrendDirection;
  velocityScore: number;  // Rate of change (-1 to 1)
  periods: {
    last7Days: number;
    last30Days: number;
    last90Days: number;
    total: number;
  };
  percentChange: number;  // Change vs previous period
  momentum: number;  // Acceleration of trend
  seasonality?: string;  // Optional seasonality pattern
}

/**
 * Trend analysis options
 */
export interface TrendAnalysisOptions {
  entityType: TrendEntityType;
  lookbackDays?: number;
  minSignals?: number;
  includeInactive?: boolean;
}

/**
 * Computes signal trends for a given entity type
 */
export async function computeSignalTrends(
  options: TrendAnalysisOptions
): Promise<TrendResult[]> {
  const { 
    entityType, 
    lookbackDays = 90, 
    minSignals = 2,
    includeInactive = false 
  } = options;

  const pool = getDbPool();
  const startTime = Date.now();

  try {
    let query: string;
    
    switch (entityType) {
      case 'theme':
        query = buildThemeTrendQuery(lookbackDays, minSignals);
        break;
      case 'feature':
        query = buildFeatureTrendQuery(lookbackDays, minSignals);
        break;
      case 'customer':
        query = buildCustomerTrendQuery(lookbackDays, minSignals);
        break;
      case 'issue':
        query = buildIssueTrendQuery(lookbackDays, minSignals);
        break;
      default:
        throw new Error(`Unknown entity type: ${entityType}`);
    }

    const result = await pool.query(query);

    const trends: TrendResult[] = result.rows.map(row => {
      const last7d = parseInt(row.last_7d) || 0;
      const last30d = parseInt(row.last_30d) || 0;
      const last90d = parseInt(row.last_90d) || 0;
      const total = parseInt(row.total) || 0;

      // Calculate trend direction
      const { trend, velocityScore, percentChange, momentum } = calculateTrendMetrics(
        last7d, 
        last30d, 
        last90d
      );

      return {
        entityType,
        entityId: row.entity_id,
        entityName: row.entity_name,
        trend,
        velocityScore,
        periods: {
          last7Days: last7d,
          last30Days: last30d,
          last90Days: last90d,
          total
        },
        percentChange,
        momentum
      };
    });

    // Filter inactive if needed
    const filtered = includeInactive 
      ? trends 
      : trends.filter(t => t.periods.last30Days > 0);

    logger.debug('Trend analysis completed', {
      entityType,
      resultCount: filtered.length,
      durationMs: Date.now() - startTime
    });

    return filtered;
  } catch (error: any) {
    logger.error('Trend analysis failed', { error: error.message, entityType });
    throw error;
  }
}

/**
 * Calculates trend metrics from period counts
 */
function calculateTrendMetrics(
  last7d: number,
  last30d: number,
  last90d: number
): {
  trend: TrendDirection;
  velocityScore: number;
  percentChange: number;
  momentum: number;
} {
  // Weekly averages
  const weeklyAvg7d = last7d;
  const weeklyAvg30d = (last30d - last7d) / 3.3; // Approx 3.3 weeks in remaining days
  const weeklyAvg90d = (last90d - last30d) / 8.6; // Approx 8.6 weeks in remaining days

  // Calculate velocity (rate of change)
  let velocityScore = 0;
  if (weeklyAvg30d > 0) {
    velocityScore = (weeklyAvg7d - weeklyAvg30d) / weeklyAvg30d;
  } else if (weeklyAvg7d > 0) {
    velocityScore = 1; // New trend
  }
  
  // Clamp velocity to -1 to 1
  velocityScore = Math.max(-1, Math.min(1, velocityScore));

  // Calculate momentum (acceleration)
  let momentum = 0;
  if (weeklyAvg90d > 0) {
    const recentAccel = (weeklyAvg7d - weeklyAvg30d);
    const pastAccel = (weeklyAvg30d - weeklyAvg90d);
    momentum = recentAccel - pastAccel;
  }

  // Percent change
  const percentChange = weeklyAvg30d > 0 
    ? ((weeklyAvg7d - weeklyAvg30d) / weeklyAvg30d) * 100 
    : (weeklyAvg7d > 0 ? 100 : 0);

  // Determine trend direction
  let trend: TrendDirection;
  if (last7d > 0 && last30d === last7d && last90d === 0) {
    // Brand new signals only in last 7 days
    trend = 'emerging';
  } else if (velocityScore > 0.5) {
    trend = 'emerging';
  } else if (velocityScore > 0.15) {
    trend = 'growing';
  } else if (velocityScore < -0.3) {
    trend = 'declining';
  } else {
    trend = 'stable';
  }

  return { trend, velocityScore, percentChange, momentum };
}

/**
 * Builds trend query for themes
 */
function buildThemeTrendQuery(lookbackDays: number, minSignals: number): string {
  return `
    WITH period_counts AS (
      SELECT 
        sth.theme_id as entity_id,
        th.name as entity_name,
        SUM(CASE WHEN s.created_at >= NOW() - INTERVAL '7 days' THEN 1 ELSE 0 END) as last_7d,
        SUM(CASE WHEN s.created_at >= NOW() - INTERVAL '30 days' THEN 1 ELSE 0 END) as last_30d,
        SUM(CASE WHEN s.created_at >= NOW() - INTERVAL '90 days' THEN 1 ELSE 0 END) as last_90d,
        COUNT(*) as total
      FROM signal_theme_hierarchy sth
      JOIN signals s ON s.id = sth.signal_id
      JOIN theme_hierarchy th ON th.id = sth.theme_id
      WHERE s.created_at >= NOW() - INTERVAL '${lookbackDays} days'
      GROUP BY sth.theme_id, th.name
      HAVING COUNT(*) >= ${minSignals}
    )
    SELECT * FROM period_counts
    ORDER BY last_7d DESC, last_30d DESC
  `;
}

/**
 * Builds trend query for features
 */
function buildFeatureTrendQuery(lookbackDays: number, minSignals: number): string {
  return `
    WITH period_counts AS (
      SELECT 
        se.entity_id::text as entity_id,
        f.canonical_name as entity_name,
        SUM(CASE WHEN s.created_at >= NOW() - INTERVAL '7 days' THEN 1 ELSE 0 END) as last_7d,
        SUM(CASE WHEN s.created_at >= NOW() - INTERVAL '30 days' THEN 1 ELSE 0 END) as last_30d,
        SUM(CASE WHEN s.created_at >= NOW() - INTERVAL '90 days' THEN 1 ELSE 0 END) as last_90d,
        COUNT(*) as total
      FROM signal_entities se
      JOIN signals s ON s.id = se.signal_id
      JOIN features f ON f.id = se.entity_id
      WHERE se.entity_type = 'feature'
        AND s.created_at >= NOW() - INTERVAL '${lookbackDays} days'
      GROUP BY se.entity_id, f.canonical_name
      HAVING COUNT(*) >= ${minSignals}
    )
    SELECT * FROM period_counts
    ORDER BY last_7d DESC, last_30d DESC
  `;
}

/**
 * Builds trend query for customers
 */
function buildCustomerTrendQuery(lookbackDays: number, minSignals: number): string {
  return `
    WITH period_counts AS (
      SELECT 
        se.entity_id::text as entity_id,
        c.name as entity_name,
        SUM(CASE WHEN s.created_at >= NOW() - INTERVAL '7 days' THEN 1 ELSE 0 END) as last_7d,
        SUM(CASE WHEN s.created_at >= NOW() - INTERVAL '30 days' THEN 1 ELSE 0 END) as last_30d,
        SUM(CASE WHEN s.created_at >= NOW() - INTERVAL '90 days' THEN 1 ELSE 0 END) as last_90d,
        COUNT(*) as total
      FROM signal_entities se
      JOIN signals s ON s.id = se.signal_id
      JOIN customers c ON c.id = se.entity_id
      WHERE se.entity_type = 'customer'
        AND s.created_at >= NOW() - INTERVAL '${lookbackDays} days'
      GROUP BY se.entity_id, c.name
      HAVING COUNT(*) >= ${minSignals}
    )
    SELECT * FROM period_counts
    ORDER BY last_7d DESC, last_30d DESC
  `;
}

/**
 * Builds trend query for issues
 */
function buildIssueTrendQuery(lookbackDays: number, minSignals: number): string {
  return `
    WITH period_counts AS (
      SELECT 
        se.entity_id::text as entity_id,
        i.title as entity_name,
        SUM(CASE WHEN s.created_at >= NOW() - INTERVAL '7 days' THEN 1 ELSE 0 END) as last_7d,
        SUM(CASE WHEN s.created_at >= NOW() - INTERVAL '30 days' THEN 1 ELSE 0 END) as last_30d,
        SUM(CASE WHEN s.created_at >= NOW() - INTERVAL '90 days' THEN 1 ELSE 0 END) as last_90d,
        COUNT(*) as total
      FROM signal_entities se
      JOIN signals s ON s.id = se.signal_id
      JOIN issues i ON i.id = se.entity_id
      WHERE se.entity_type = 'issue'
        AND s.created_at >= NOW() - INTERVAL '${lookbackDays} days'
      GROUP BY se.entity_id, i.title
      HAVING COUNT(*) >= ${minSignals}
    )
    SELECT * FROM period_counts
    ORDER BY last_7d DESC, last_30d DESC
  `;
}

/**
 * Gets emerging themes (new or rapidly growing)
 */
export async function getEmergingThemes(limit: number = 10): Promise<TrendResult[]> {
  const trends = await computeSignalTrends({ entityType: 'theme' });
  
  return trends
    .filter(t => t.trend === 'emerging' || t.trend === 'growing')
    .sort((a, b) => b.velocityScore - a.velocityScore)
    .slice(0, limit);
}

/**
 * Gets declining themes
 */
export async function getDecliningThemes(limit: number = 10): Promise<TrendResult[]> {
  const trends = await computeSignalTrends({ entityType: 'theme', includeInactive: true });
  
  return trends
    .filter(t => t.trend === 'declining')
    .sort((a, b) => a.velocityScore - b.velocityScore)
    .slice(0, limit);
}

/**
 * Gets stable themes with high volume
 */
export async function getStableHighVolumeThemes(limit: number = 10): Promise<TrendResult[]> {
  const trends = await computeSignalTrends({ entityType: 'theme' });
  
  return trends
    .filter(t => t.trend === 'stable')
    .sort((a, b) => b.periods.last30Days - a.periods.last30Days)
    .slice(0, limit);
}

/**
 * Gets trend for a specific entity
 */
export async function getEntityTrend(
  entityType: TrendEntityType,
  entityId: string
): Promise<TrendResult | null> {
  const trends = await computeSignalTrends({ 
    entityType, 
    minSignals: 1,
    includeInactive: true 
  });
  
  return trends.find(t => t.entityId === entityId) || null;
}

/**
 * Gets cross-entity trend comparison
 */
export async function compareTrends(
  entityType: TrendEntityType,
  entityIds: string[]
): Promise<TrendResult[]> {
  const trends = await computeSignalTrends({ 
    entityType, 
    minSignals: 1,
    includeInactive: true 
  });
  
  return trends.filter(t => entityIds.includes(t.entityId));
}

/**
 * Gets trend summary for dashboard
 */
export async function getTrendSummary(): Promise<{
  themes: { emerging: number; growing: number; stable: number; declining: number };
  features: { emerging: number; growing: number; stable: number; declining: number };
  customers: { active: number; growing: number; declining: number };
  issues: { emerging: number; total: number };
  topEmerging: TrendResult[];
  topDeclining: TrendResult[];
}> {
  const [themeTrends, featureTrends, customerTrends, issueTrends] = await Promise.all([
    computeSignalTrends({ entityType: 'theme', includeInactive: true }),
    computeSignalTrends({ entityType: 'feature', includeInactive: true }),
    computeSignalTrends({ entityType: 'customer', includeInactive: true }),
    computeSignalTrends({ entityType: 'issue', includeInactive: true })
  ]);

  const countByTrend = (trends: TrendResult[]) => ({
    emerging: trends.filter(t => t.trend === 'emerging').length,
    growing: trends.filter(t => t.trend === 'growing').length,
    stable: trends.filter(t => t.trend === 'stable').length,
    declining: trends.filter(t => t.trend === 'declining').length
  });

  const topEmerging = [...themeTrends, ...featureTrends, ...issueTrends]
    .filter(t => t.trend === 'emerging')
    .sort((a, b) => b.velocityScore - a.velocityScore)
    .slice(0, 5);

  const topDeclining = [...themeTrends, ...featureTrends]
    .filter(t => t.trend === 'declining')
    .sort((a, b) => a.velocityScore - b.velocityScore)
    .slice(0, 5);

  return {
    themes: countByTrend(themeTrends),
    features: countByTrend(featureTrends),
    customers: {
      active: customerTrends.filter(t => t.periods.last30Days > 0).length,
      growing: customerTrends.filter(t => t.trend === 'growing' || t.trend === 'emerging').length,
      declining: customerTrends.filter(t => t.trend === 'declining').length
    },
    issues: {
      emerging: issueTrends.filter(t => t.trend === 'emerging').length,
      total: issueTrends.length
    },
    topEmerging,
    topDeclining
  };
}

/**
 * Gets weekly trend data for charts
 */
export async function getWeeklyTrendData(
  entityType: TrendEntityType,
  entityId: string,
  weeks: number = 12
): Promise<Array<{ week: string; count: number }>> {
  const pool = getDbPool();

  let joinTable: string;
  let joinCondition: string;

  switch (entityType) {
    case 'theme':
      joinTable = 'signal_theme_hierarchy sth';
      joinCondition = `sth.signal_id = s.id AND sth.theme_id = $1::uuid`;
      break;
    case 'feature':
    case 'customer':
    case 'issue':
      joinTable = 'signal_entities se';
      joinCondition = `se.signal_id = s.id AND se.entity_type = '${entityType}' AND se.entity_id = $1::uuid`;
      break;
    default:
      throw new Error(`Unknown entity type: ${entityType}`);
  }

  const query = `
    SELECT 
      DATE_TRUNC('week', s.created_at) as week,
      COUNT(*) as count
    FROM signals s
    JOIN ${joinTable} ON ${joinCondition}
    WHERE s.created_at >= NOW() - INTERVAL '${weeks} weeks'
    GROUP BY DATE_TRUNC('week', s.created_at)
    ORDER BY week ASC
  `;

  const result = await pool.query(query, [entityId]);

  return result.rows.map(row => ({
    week: row.week.toISOString().split('T')[0],
    count: parseInt(row.count)
  }));
}
