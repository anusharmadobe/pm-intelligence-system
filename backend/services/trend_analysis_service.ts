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
 * Date range for temporal filtering
 */
export interface DateRange {
  startDate?: Date;
  endDate?: Date;
}

/**
 * Temporal aggregation period
 */
export type AggregationPeriod = 'day' | 'week' | 'month' | 'quarter' | 'year';

/**
 * Trend analysis options
 */
export interface TrendAnalysisOptions {
  entityType: TrendEntityType;
  lookbackDays?: number;
  dateRange?: DateRange;
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
    let params: Array<number> = [];
    
    switch (entityType) {
      case 'theme':
        ({ query, params } = buildThemeTrendQuery(lookbackDays, minSignals));
        break;
      case 'feature':
        ({ query, params } = buildFeatureTrendQuery(lookbackDays, minSignals));
        break;
      case 'customer':
        ({ query, params } = buildCustomerTrendQuery(lookbackDays, minSignals));
        break;
      case 'issue':
        ({ query, params } = buildIssueTrendQuery(lookbackDays, minSignals));
        break;
      default:
        throw new Error(`Unknown entity type: ${entityType}`);
    }

    const result = await pool.query(query, params);

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
function buildThemeTrendQuery(
  lookbackDays: number,
  minSignals: number
): { query: string; params: number[] } {
  const query = `
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
      WHERE s.created_at >= NOW() - INTERVAL '1 day' * $1
      GROUP BY sth.theme_id, th.name
      HAVING COUNT(*) >= $2
    )
    SELECT * FROM period_counts
    ORDER BY last_7d DESC, last_30d DESC
  `;
  return { query, params: [lookbackDays, minSignals] };
}

/**
 * Builds trend query for features
 */
function buildFeatureTrendQuery(
  lookbackDays: number,
  minSignals: number
): { query: string; params: number[] } {
  const query = `
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
        AND s.created_at >= NOW() - INTERVAL '1 day' * $1
      GROUP BY se.entity_id, f.canonical_name
      HAVING COUNT(*) >= $2
    )
    SELECT * FROM period_counts
    ORDER BY last_7d DESC, last_30d DESC
  `;
  return { query, params: [lookbackDays, minSignals] };
}

/**
 * Builds trend query for customers
 */
function buildCustomerTrendQuery(
  lookbackDays: number,
  minSignals: number
): { query: string; params: number[] } {
  const query = `
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
        AND s.created_at >= NOW() - INTERVAL '1 day' * $1
      GROUP BY se.entity_id, c.name
      HAVING COUNT(*) >= $2
    )
    SELECT * FROM period_counts
    ORDER BY last_7d DESC, last_30d DESC
  `;
  return { query, params: [lookbackDays, minSignals] };
}

/**
 * Builds trend query for issues
 */
function buildIssueTrendQuery(
  lookbackDays: number,
  minSignals: number
): { query: string; params: number[] } {
  const query = `
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
        AND s.created_at >= NOW() - INTERVAL '1 day' * $1
      GROUP BY se.entity_id, i.title
      HAVING COUNT(*) >= $2
    )
    SELECT * FROM period_counts
    ORDER BY last_7d DESC, last_30d DESC
  `;
  return { query, params: [lookbackDays, minSignals] };
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
  let weeksParamIndex = 2;

  switch (entityType) {
    case 'theme':
      joinTable = 'signal_theme_hierarchy sth';
      joinCondition = `sth.signal_id = s.id AND sth.theme_id = $1::uuid`;
      weeksParamIndex = 2;
      break;
    case 'feature':
    case 'customer':
    case 'issue':
      joinTable = 'signal_entities se';
      joinCondition = `se.signal_id = s.id AND se.entity_type = $2 AND se.entity_id = $1::uuid`;
      weeksParamIndex = 3;
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
    WHERE s.created_at >= NOW() - INTERVAL '1 week' * $${weeksParamIndex}
    GROUP BY DATE_TRUNC('week', s.created_at)
    ORDER BY week ASC
  `;
  const params =
    weeksParamIndex === 2 ? [entityId, weeks] : [entityId, entityType, weeks];
  const result = await pool.query(query, params);

  return result.rows.map(row => ({
    week: row.week.toISOString().split('T')[0],
    count: parseInt(row.count)
  }));
}

/**
 * Parse natural language date query into DateRange
 * Examples: "last 90 days", "since Q4", "this quarter", "Jan 1 to Mar 31"
 */
export function parseNaturalDateQuery(query: string): DateRange {
  const now = new Date();
  const lowerQuery = query.toLowerCase().trim();

  // "last X days"
  const lastDaysMatch = lowerQuery.match(/last (\d+) days?/);
  if (lastDaysMatch) {
    const days = parseInt(lastDaysMatch[1]);
    const startDate = new Date(now);
    startDate.setDate(startDate.getDate() - days);
    return { startDate, endDate: now };
  }

  // "since Q1/Q2/Q3/Q4" (current year)
  const sinceQuarterMatch = lowerQuery.match(/since q([1-4])/);
  if (sinceQuarterMatch) {
    const quarter = parseInt(sinceQuarterMatch[1]);
    const startDate = new Date(now.getFullYear(), (quarter - 1) * 3, 1);
    return { startDate, endDate: now };
  }

  // "this quarter"
  if (lowerQuery.includes('this quarter')) {
    const currentQuarter = Math.floor(now.getMonth() / 3);
    const startDate = new Date(now.getFullYear(), currentQuarter * 3, 1);
    return { startDate, endDate: now };
  }

  // "last quarter"
  if (lowerQuery.includes('last quarter')) {
    const currentQuarter = Math.floor(now.getMonth() / 3);
    const lastQuarter = currentQuarter === 0 ? 3 : currentQuarter - 1;
    const year = currentQuarter === 0 ? now.getFullYear() - 1 : now.getFullYear();
    const startDate = new Date(year, lastQuarter * 3, 1);
    const endDate = new Date(year, (lastQuarter + 1) * 3, 0); // Last day of quarter
    return { startDate, endDate };
  }

  // "this month"
  if (lowerQuery.includes('this month')) {
    const startDate = new Date(now.getFullYear(), now.getMonth(), 1);
    return { startDate, endDate: now };
  }

  // "last month"
  if (lowerQuery.includes('last month')) {
    const startDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const endDate = new Date(now.getFullYear(), now.getMonth(), 0); // Last day of previous month
    return { startDate, endDate };
  }

  // "this year"
  if (lowerQuery.includes('this year')) {
    const startDate = new Date(now.getFullYear(), 0, 1);
    return { startDate, endDate: now };
  }

  // Default: last 90 days
  logger.warn('Could not parse date query, defaulting to last 90 days', { query });
  const startDate = new Date(now);
  startDate.setDate(startDate.getDate() - 90);
  return { startDate, endDate: now };
}

/**
 * Get temporal trend data with flexible aggregation
 */
export async function getTemporalTrendData(
  entityType: TrendEntityType,
  entityId: string,
  options: {
    dateRange?: DateRange;
    aggregation?: AggregationPeriod;
    naturalQuery?: string; // e.g., "last 90 days", "since Q4"
  } = {}
): Promise<Array<{ period: string; count: number; periodStart: Date; periodEnd: Date }>> {
  const pool = getDbPool();

  // Parse date range
  let dateRange: DateRange;
  if (options.naturalQuery) {
    dateRange = parseNaturalDateQuery(options.naturalQuery);
  } else if (options.dateRange) {
    dateRange = options.dateRange;
  } else {
    // Default: last 90 days
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 90);
    dateRange = { startDate, endDate };
  }

  const aggregation = options.aggregation || 'week';
  const truncFunction = `DATE_TRUNC('${aggregation}', s.created_at)`;

  // Build query based on entity type
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
      joinCondition = `se.signal_id = s.id AND se.entity_type = $2 AND se.entity_id = $1::uuid`;
      break;
    default:
      throw new Error(`Unknown entity type: ${entityType}`);
  }

  const query = `
    SELECT
      ${truncFunction} as period_start,
      COUNT(*) as count
    FROM signals s
    JOIN ${joinTable} ON ${joinCondition}
    WHERE s.created_at >= $${entityType === 'theme' ? 2 : 3}
      AND s.created_at <= $${entityType === 'theme' ? 3 : 4}
    GROUP BY ${truncFunction}
    ORDER BY period_start ASC
  `;

  const params =
    entityType === 'theme'
      ? [entityId, dateRange.startDate, dateRange.endDate]
      : [entityId, entityType, dateRange.startDate, dateRange.endDate];

  const result = await pool.query(query, params);

  return result.rows.map(row => {
    const periodStart = new Date(row.period_start);
    const periodEnd = calculatePeriodEnd(periodStart, aggregation);

    return {
      period: formatPeriod(periodStart, aggregation),
      count: parseInt(row.count),
      periodStart,
      periodEnd
    };
  });
}

/**
 * Calculate end date for a period
 */
function calculatePeriodEnd(periodStart: Date, aggregation: AggregationPeriod): Date {
  const end = new Date(periodStart);

  switch (aggregation) {
    case 'day':
      end.setDate(end.getDate() + 1);
      break;
    case 'week':
      end.setDate(end.getDate() + 7);
      break;
    case 'month':
      end.setMonth(end.getMonth() + 1);
      break;
    case 'quarter':
      end.setMonth(end.getMonth() + 3);
      break;
    case 'year':
      end.setFullYear(end.getFullYear() + 1);
      break;
  }

  return end;
}

/**
 * Format period for display
 */
function formatPeriod(date: Date, aggregation: AggregationPeriod): string {
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const quarter = Math.floor(date.getMonth() / 3) + 1;

  switch (aggregation) {
    case 'day':
      return date.toISOString().split('T')[0];
    case 'week':
      // ISO week format: YYYY-WXX
      const weekNum = getWeekNumber(date);
      return `${year}-W${weekNum.toString().padStart(2, '0')}`;
    case 'month':
      return `${year}-${month.toString().padStart(2, '0')}`;
    case 'quarter':
      return `${year}-Q${quarter}`;
    case 'year':
      return year.toString();
  }
}

/**
 * Get ISO week number
 */
function getWeekNumber(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}

/**
 * Get trend comparison over time windows
 * Compares current period vs previous period
 */
export async function getTimePeriodComparison(
  entityType: TrendEntityType,
  entityId: string,
  options: {
    currentPeriod: DateRange;
    comparisonPeriod: DateRange;
  }
): Promise<{
  current: { count: number; avgPerDay: number };
  comparison: { count: number; avgPerDay: number };
  percentChange: number;
  trend: 'increasing' | 'decreasing' | 'stable';
}> {
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
      joinCondition = `se.signal_id = s.id AND se.entity_type = $2 AND se.entity_id = $1::uuid`;
      break;
    default:
      throw new Error(`Unknown entity type: ${entityType}`);
  }

  const query = `
    SELECT
      COUNT(*) FILTER (WHERE s.created_at >= $${entityType === 'theme' ? 2 : 3}
                          AND s.created_at <= $${entityType === 'theme' ? 3 : 4}) as current_count,
      COUNT(*) FILTER (WHERE s.created_at >= $${entityType === 'theme' ? 4 : 5}
                          AND s.created_at <= $${entityType === 'theme' ? 5 : 6}) as comparison_count
    FROM signals s
    JOIN ${joinTable} ON ${joinCondition}
    WHERE s.created_at >= $${entityType === 'theme' ? 4 : 5}
  `;

  const params =
    entityType === 'theme'
      ? [
          entityId,
          options.currentPeriod.startDate,
          options.currentPeriod.endDate,
          options.comparisonPeriod.startDate,
          options.comparisonPeriod.endDate
        ]
      : [
          entityId,
          entityType,
          options.currentPeriod.startDate,
          options.currentPeriod.endDate,
          options.comparisonPeriod.startDate,
          options.comparisonPeriod.endDate
        ];

  const result = await pool.query(query, params);
  const row = result.rows[0];

  const currentCount = parseInt(row.current_count) || 0;
  const comparisonCount = parseInt(row.comparison_count) || 0;

  // Calculate days in each period
  const currentDays = Math.ceil(
    ((options.currentPeriod.endDate?.getTime() || Date.now()) -
      (options.currentPeriod.startDate?.getTime() || Date.now())) /
      (1000 * 60 * 60 * 24)
  );
  const comparisonDays = Math.ceil(
    ((options.comparisonPeriod.endDate?.getTime() || Date.now()) -
      (options.comparisonPeriod.startDate?.getTime() || Date.now())) /
      (1000 * 60 * 60 * 24)
  );

  const currentAvgPerDay = currentDays > 0 ? currentCount / currentDays : 0;
  const comparisonAvgPerDay = comparisonDays > 0 ? comparisonCount / comparisonDays : 0;

  const percentChange =
    comparisonCount > 0 ? ((currentCount - comparisonCount) / comparisonCount) * 100 : 0;

  let trend: 'increasing' | 'decreasing' | 'stable';
  if (percentChange > 10) {
    trend = 'increasing';
  } else if (percentChange < -10) {
    trend = 'decreasing';
  } else {
    trend = 'stable';
  }

  return {
    current: {
      count: currentCount,
      avgPerDay: Math.round(currentAvgPerDay * 100) / 100
    },
    comparison: {
      count: comparisonCount,
      avgPerDay: Math.round(comparisonAvgPerDay * 100) / 100
    },
    percentChange: Math.round(percentChange * 100) / 100,
    trend
  };
}

/**
 * Get aggregated trends by multiple time periods
 * Useful for dashboards showing "this week vs last week", "this month vs last month", etc.
 */
export async function getMultiPeriodAggregation(
  entityType: TrendEntityType,
  entityId: string
): Promise<{
  thisWeek: number;
  lastWeek: number;
  thisMonth: number;
  lastMonth: number;
  thisQuarter: number;
  lastQuarter: number;
  thisYear: number;
  weekOverWeekChange: number;
  monthOverMonthChange: number;
  quarterOverQuarterChange: number;
}> {
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
      joinCondition = `se.signal_id = s.id AND se.entity_type = $2 AND se.entity_id = $1::uuid`;
      break;
    default:
      throw new Error(`Unknown entity type: ${entityType}`);
  }

  const query = `
    SELECT
      COUNT(*) FILTER (WHERE s.created_at >= DATE_TRUNC('week', NOW())) as this_week,
      COUNT(*) FILTER (WHERE s.created_at >= DATE_TRUNC('week', NOW()) - INTERVAL '1 week'
                          AND s.created_at < DATE_TRUNC('week', NOW())) as last_week,
      COUNT(*) FILTER (WHERE s.created_at >= DATE_TRUNC('month', NOW())) as this_month,
      COUNT(*) FILTER (WHERE s.created_at >= DATE_TRUNC('month', NOW()) - INTERVAL '1 month'
                          AND s.created_at < DATE_TRUNC('month', NOW())) as last_month,
      COUNT(*) FILTER (WHERE s.created_at >= DATE_TRUNC('quarter', NOW())) as this_quarter,
      COUNT(*) FILTER (WHERE s.created_at >= DATE_TRUNC('quarter', NOW()) - INTERVAL '3 months'
                          AND s.created_at < DATE_TRUNC('quarter', NOW())) as last_quarter,
      COUNT(*) FILTER (WHERE s.created_at >= DATE_TRUNC('year', NOW())) as this_year
    FROM signals s
    JOIN ${joinTable} ON ${joinCondition}
    WHERE s.created_at >= DATE_TRUNC('year', NOW()) - INTERVAL '1 year'
  `;

  const params = entityType === 'theme' ? [entityId] : [entityId, entityType];
  const result = await pool.query(query, params);
  const row = result.rows[0];

  const thisWeek = parseInt(row.this_week) || 0;
  const lastWeek = parseInt(row.last_week) || 0;
  const thisMonth = parseInt(row.this_month) || 0;
  const lastMonth = parseInt(row.last_month) || 0;
  const thisQuarter = parseInt(row.this_quarter) || 0;
  const lastQuarter = parseInt(row.last_quarter) || 0;
  const thisYear = parseInt(row.this_year) || 0;

  const weekOverWeekChange = lastWeek > 0 ? ((thisWeek - lastWeek) / lastWeek) * 100 : 0;
  const monthOverMonthChange = lastMonth > 0 ? ((thisMonth - lastMonth) / lastMonth) * 100 : 0;
  const quarterOverQuarterChange =
    lastQuarter > 0 ? ((thisQuarter - lastQuarter) / lastQuarter) * 100 : 0;

  return {
    thisWeek,
    lastWeek,
    thisMonth,
    lastMonth,
    thisQuarter,
    lastQuarter,
    thisYear,
    weekOverWeekChange: Math.round(weekOverWeekChange * 100) / 100,
    monthOverMonthChange: Math.round(monthOverMonthChange * 100) / 100,
    quarterOverQuarterChange: Math.round(quarterOverQuarterChange * 100) / 100
  };
}
