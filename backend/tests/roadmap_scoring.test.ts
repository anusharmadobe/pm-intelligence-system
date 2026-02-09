import {
  calculateRoadmapScore,
  getOpportunitiesWithScores,
  getPrioritizedOpportunities,
  getQuickWinOpportunities,
  getStrategicOpportunities,
  getEmergingOpportunities,
  getHighConfidenceOpportunities,
  getRoadmapSummary,
  detectOpportunities,
  storeOpportunity,
  Opportunity,
  RoadmapScore,
  ScoredOpportunity
} from '../services/opportunity_service';
import { ingestSignal, RawSignal, Signal } from '../processing/signal_extractor';
import { runMigrations, resetDatabase, shutdownDatabase } from './test_db';

describe('Roadmap Opportunity Scoring', () => {
  beforeAll(() => {
    runMigrations();
  });

  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await shutdownDatabase();
  });

  describe('calculateRoadmapScore', () => {
    it('should calculate complete roadmap score', async () => {
      const opportunity: Opportunity = {
        id: 'test-opp-1',
        title: 'Performance Improvements',
        description: 'Cluster of signals about performance issues',
        status: 'new',
        created_at: new Date()
      };

      const signals: Signal[] = [
        {
          id: '11111111-1111-1111-1111-111111111111',
          source: 'slack',
          source_ref: '11111111-1111-1111-1111-111111111111',
          signal_type: 'message',
          content: 'Customer Adobe is experiencing performance issues with the form builder.',
          normalized_content: 'customer adobe is experiencing performance issues with the form builder',
          severity: null,
          confidence: null,
          created_at: new Date(),
          metadata: {
            customer_name: 'Adobe',
            customer_tier: 'enterprise',
            customers: ['Adobe'],
            themes: ['performance'],
            quality_dimensions: { compositeScore: 0.8 }
          }
        },
        {
          id: '22222222-2222-2222-2222-222222222222',
          source: 'slack',
          source_ref: '22222222-2222-2222-2222-222222222222',
          signal_type: 'message',
          content: 'Microsoft also reports slow loading times.',
          normalized_content: 'microsoft also reports slow loading times',
          severity: null,
          confidence: null,
          created_at: new Date(),
          metadata: {
            customer_name: 'Microsoft',
            customer_tier: 'enterprise',
            customers: ['Microsoft'],
            themes: ['performance'],
            quality_dimensions: { compositeScore: 0.7 }
          }
        }
      ];

      const score = await calculateRoadmapScore(opportunity, signals);

      expect(score.overallScore).toBeGreaterThanOrEqual(0);
      expect(score.overallScore).toBeLessThanOrEqual(100);
      expect(score.impactScore).toBeGreaterThanOrEqual(0);
      expect(score.confidenceScore).toBeGreaterThanOrEqual(0);
      expect(score.effortScore).toBeGreaterThanOrEqual(0);
      expect(score.strategicScore).toBeGreaterThanOrEqual(0);
      expect(score.urgencyScore).toBeGreaterThanOrEqual(0);

      // Check breakdown
      expect(score.breakdown.signalCount).toBe(2);
      expect(score.breakdown.uniqueCustomers).toBe(2);
      expect(score.breakdown.themeCount).toBeGreaterThanOrEqual(1);
    });

    it('should give higher impact score for enterprise customers', async () => {
      const opportunity: Opportunity = {
        id: 'test-opp-2',
        title: 'Enterprise Issue',
        description: 'Issue from enterprise customers',
        status: 'new',
        created_at: new Date()
      };

      const enterpriseSignals: Signal[] = [
        {
          id: '33333333-3333-3333-3333-333333333333',
          source: 'slack',
          source_ref: '33333333-3333-3333-3333-333333333333',
          signal_type: 'message',
          content: 'Enterprise customer issue',
          normalized_content: 'enterprise customer issue',
          severity: null,
          confidence: null,
          created_at: new Date(),
          metadata: {
            customer_tier: 'enterprise',
            customers: ['BigCorp'],
            quality_dimensions: { compositeScore: 0.8 }
          }
        }
      ];

      const startupSignals: Signal[] = [
        {
          id: '44444444-4444-4444-4444-444444444444',
          source: 'slack',
          source_ref: '44444444-4444-4444-4444-444444444444',
          signal_type: 'message',
          content: 'Startup customer issue',
          normalized_content: 'startup customer issue',
          severity: null,
          confidence: null,
          created_at: new Date(),
          metadata: {
            customer_tier: 'startup',
            customers: ['SmallCo'],
            quality_dimensions: { compositeScore: 0.8 }
          }
        }
      ];

      const enterpriseScore = await calculateRoadmapScore(opportunity, enterpriseSignals);
      const startupScore = await calculateRoadmapScore(
        { ...opportunity, id: 'test-opp-3' },
        startupSignals
      );

      // Enterprise should have higher impact due to tier weight
      expect(enterpriseScore.breakdown.customerTierWeight).toBeGreaterThan(
        startupScore.breakdown.customerTierWeight
      );
    });

    it('should give higher effort score for simple themes', async () => {
      const opportunity: Opportunity = {
        id: 'test-opp-4',
        title: 'UI Enhancement',
        description: 'Simple UI fix',
        status: 'new',
        created_at: new Date()
      };

      const simpleSignals: Signal[] = [
        {
          id: '55555555-5555-5555-5555-555555555555',
          source: 'slack',
          source_ref: '55555555-5555-5555-5555-555555555555',
          signal_type: 'message',
          content: 'Need UI fix for button alignment',
          normalized_content: 'need ui fix for button alignment',
          severity: null,
          confidence: null,
          created_at: new Date(),
          metadata: { themes: ['ui', 'fix'], customers: ['Customer1'] }
        }
      ];

      const complexSignals: Signal[] = [
        {
          id: '66666666-6666-6666-6666-666666666666',
          source: 'slack',
          source_ref: '66666666-6666-6666-6666-666666666666',
          signal_type: 'message',
          content: 'Need integration with security compliance migration',
          normalized_content: 'need integration with security compliance migration',
          severity: null,
          confidence: null,
          created_at: new Date(),
          metadata: { themes: ['integration', 'security', 'compliance', 'migration'], customers: ['Customer2'] }
        }
      ];

      const simpleScore = await calculateRoadmapScore(opportunity, simpleSignals);
      const complexScore = await calculateRoadmapScore(
        { ...opportunity, id: 'test-opp-5' },
        complexSignals
      );

      // Simple themes should have higher effort score (lower effort = higher score)
      expect(simpleScore.effortScore).toBeGreaterThan(complexScore.effortScore);
    });

    it('should boost strategic score for priority-aligned themes', async () => {
      const opportunity: Opportunity = {
        id: 'test-opp-6',
        title: 'Priority Feature',
        description: 'Aligned with strategy',
        status: 'new',
        created_at: new Date()
      };

      const signals: Signal[] = [
        {
          id: '77777777-7777-7777-7777-777777777777',
          source: 'slack',
          source_ref: '77777777-7777-7777-7777-777777777777',
          signal_type: 'message',
          content: 'AI-powered feature request',
          normalized_content: 'ai powered feature request',
          severity: null,
          confidence: null,
          created_at: new Date(),
          metadata: { themes: ['ai', 'automation'], customers: ['Customer'] }
        }
      ];

      const scoreWithPriorities = await calculateRoadmapScore(
        opportunity, 
        signals,
        { strategicPriorities: ['ai', 'automation'] }
      );

      const scoreWithoutPriorities = await calculateRoadmapScore(
        opportunity,
        signals,
        { strategicPriorities: ['unrelated', 'other'] }
      );

      expect(scoreWithPriorities.strategicScore).toBeGreaterThan(
        scoreWithoutPriorities.strategicScore
      );
    });
  });

  describe('Roadmap Retrieval Functions', () => {
    beforeEach(async () => {
      // Create test signals and opportunities
      const rawSignals: RawSignal[] = [
        {
          source: 'slack',
          id: 'roadmap-sig-1',
          type: 'message',
          text: 'Adobe needs better performance for form builder.',
          metadata: { 
            channel: 'feedback', 
            channel_id: 'C123',
            customer_name: 'Adobe'
          }
        },
        {
          source: 'slack',
          id: 'roadmap-sig-2',
          type: 'message',
          text: 'Adobe also wants faster loading.',
          metadata: { 
            channel: 'feedback', 
            channel_id: 'C123',
            customer_name: 'Adobe'
          }
        }
      ];

      for (const raw of rawSignals) {
        await ingestSignal(raw);
      }
    });

    it('should get opportunities with scores', async () => {
      const scored = await getOpportunitiesWithScores();
      expect(Array.isArray(scored)).toBe(true);
    });

    it('should get prioritized opportunities sorted by score', async () => {
      const prioritized = await getPrioritizedOpportunities({}, 10);
      expect(Array.isArray(prioritized)).toBe(true);
      
      // If there are results, they should be sorted by score descending
      if (prioritized.length > 1) {
        for (let i = 1; i < prioritized.length; i++) {
          expect(prioritized[i-1].roadmapScore.overallScore)
            .toBeGreaterThanOrEqual(prioritized[i].roadmapScore.overallScore);
        }
      }
    });

    it('should get quick win opportunities', async () => {
      const quickWins = await getQuickWinOpportunities(10);
      expect(Array.isArray(quickWins)).toBe(true);
      
      // Quick wins should have high effort scores (low effort)
      for (const opp of quickWins) {
        expect(opp.roadmapScore.effortScore).toBeGreaterThanOrEqual(60);
      }
    });

    it('should get strategic opportunities', async () => {
      const strategic = await getStrategicOpportunities(['performance', 'speed'], 10);
      expect(Array.isArray(strategic)).toBe(true);
    });

    it('should get emerging opportunities', async () => {
      const emerging = await getEmergingOpportunities(10);
      expect(Array.isArray(emerging)).toBe(true);
    });

    it('should get high confidence opportunities', async () => {
      const highConf = await getHighConfidenceOpportunities(70, 10);
      expect(Array.isArray(highConf)).toBe(true);
      
      // All should have confidence >= threshold
      for (const opp of highConf) {
        expect(opp.roadmapScore.confidenceScore).toBeGreaterThanOrEqual(70);
      }
    });
  });

  describe('getRoadmapSummary', () => {
    it('should return complete roadmap summary', async () => {
      const summary = await getRoadmapSummary();

      expect(summary).toHaveProperty('totalOpportunities');
      expect(summary).toHaveProperty('topPriorities');
      expect(summary).toHaveProperty('quickWins');
      expect(summary).toHaveProperty('emerging');
      expect(summary).toHaveProperty('byImpact');
      expect(summary).toHaveProperty('byConfidence');
      expect(summary).toHaveProperty('averageScores');

      expect(summary.byImpact).toHaveProperty('high');
      expect(summary.byImpact).toHaveProperty('medium');
      expect(summary.byImpact).toHaveProperty('low');

      expect(summary.averageScores).toHaveProperty('impact');
      expect(summary.averageScores).toHaveProperty('confidence');
      expect(summary.averageScores).toHaveProperty('effort');
      expect(summary.averageScores).toHaveProperty('strategic');
      expect(summary.averageScores).toHaveProperty('urgency');
    });
  });
});
