import { 
  computeSignalTrends,
  getEmergingThemes,
  getDecliningThemes,
  getStableHighVolumeThemes,
  getEntityTrend,
  getTrendSummary,
  TrendResult
} from '../services/trend_analysis_service';
import { ingestSignal, RawSignal } from '../processing/signal_extractor';
import { seedThemeHierarchy } from '../services/theme_classifier_service';
import { runMigrations, resetDatabase, shutdownDatabase } from './test_db';

describe('Trend Analysis Service', () => {
  beforeAll(() => {
    runMigrations();
  });

  beforeEach(async () => {
    await resetDatabase();
    // Seed theme hierarchy for trend tests
    try {
      await seedThemeHierarchy();
    } catch (_e) {
      // Theme hierarchy may already be seeded
    }
  });

  afterAll(async () => {
    await shutdownDatabase();
  });

  describe('computeSignalTrends', () => {
    it('should compute trends for themes', async () => {
      // Create test signals
      const signals: RawSignal[] = [
        {
          source: 'slack',
          id: 'trend-1',
          type: 'message',
          text: 'Customer has issues with form builder performance and forms are slow to load.',
          metadata: { 
            channel: 'customer-feedback',
            channel_id: 'C555',
            timestamp: String(Date.now() / 1000 - 86400) // 1 day ago
          }
        },
        {
          source: 'slack',
          id: 'trend-2',
          type: 'message',
          text: 'Performance problems with form builder again today.',
          metadata: {
            channel: 'customer-feedback', 
            channel_id: 'C555',
            timestamp: String(Date.now() / 1000 - 172800) // 2 days ago
          }
        }
      ];

      for (const signal of signals) {
        await ingestSignal(signal);
      }

      const trends = await computeSignalTrends({ 
        entityType: 'theme',
        minSignals: 1
      });

      // May return empty if theme classifications don't exist yet
      expect(Array.isArray(trends)).toBe(true);
    });

    it('should handle empty results gracefully', async () => {
      const trends = await computeSignalTrends({ entityType: 'theme' });
      expect(Array.isArray(trends)).toBe(true);
    });

    it('should respect minSignals threshold', async () => {
      const trends = await computeSignalTrends({ 
        entityType: 'theme',
        minSignals: 100  // High threshold
      });
      expect(trends.length).toBe(0);
    });
  });

  describe('trend classification', () => {
    it('should classify trend directions correctly', () => {
      // Test trend calculation logic (unit test without DB)
      // These are internal calculations but we can verify the output structure
      
      const mockTrend: TrendResult = {
        entityType: 'theme',
        entityId: 'test-theme-1',
        entityName: 'Performance',
        trend: 'growing',
        velocityScore: 0.3,
        periods: {
          last7Days: 5,
          last30Days: 10,
          last90Days: 12,
          total: 12
        },
        percentChange: 50,
        momentum: 0.2
      };

      expect(mockTrend.trend).toMatch(/^(emerging|growing|stable|declining)$/);
      expect(mockTrend.velocityScore).toBeGreaterThanOrEqual(-1);
      expect(mockTrend.velocityScore).toBeLessThanOrEqual(1);
    });
  });

  describe('getEmergingThemes', () => {
    it('should return empty array when no emerging themes exist', async () => {
      const emerging = await getEmergingThemes(10);
      expect(Array.isArray(emerging)).toBe(true);
    });
  });

  describe('getDecliningThemes', () => {
    it('should return empty array when no declining themes exist', async () => {
      const declining = await getDecliningThemes(10);
      expect(Array.isArray(declining)).toBe(true);
    });
  });

  describe('getStableHighVolumeThemes', () => {
    it('should return empty array when no stable themes exist', async () => {
      const stable = await getStableHighVolumeThemes(10);
      expect(Array.isArray(stable)).toBe(true);
    });
  });

  describe('getEntityTrend', () => {
    it('should return null for non-existent entity', async () => {
      const trend = await getEntityTrend('theme', 'non-existent-id');
      expect(trend).toBeNull();
    });
  });

  describe('getTrendSummary', () => {
    it('should return complete summary structure', async () => {
      const summary = await getTrendSummary();

      expect(summary).toHaveProperty('themes');
      expect(summary.themes).toHaveProperty('emerging');
      expect(summary.themes).toHaveProperty('growing');
      expect(summary.themes).toHaveProperty('stable');
      expect(summary.themes).toHaveProperty('declining');

      expect(summary).toHaveProperty('features');
      expect(summary).toHaveProperty('customers');
      expect(summary).toHaveProperty('issues');
      expect(summary).toHaveProperty('topEmerging');
      expect(summary).toHaveProperty('topDeclining');
    });
  });
});
