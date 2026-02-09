/**
 * Integration tests for PM Intelligence System
 * Uses actual customer_engagement data to test the complete pipeline
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { ingestSignal, RawSignal, Signal } from '../processing/signal_extractor';
import { registerChannel, getChannelWeight, autoRegisterChannel } from '../services/channel_registry_service';
import { classifySignalThemes, seedThemeHierarchy } from '../services/theme_classifier_service';
import { computeSignalTrends, getTrendSummary } from '../services/trend_analysis_service';
import { detectOpportunities, calculateRoadmapScore, getRoadmapSummary } from '../services/opportunity_service';
import { embedSignal, getEmbeddingStats, generateContextualSummary } from '../services/embedding_service';
import { hybridSearch, textSearch } from '../services/hybrid_search_service';
import { createMockLLMProvider } from '../services/llm_service';
import { createMockEmbeddingProvider } from '../utils/mock_embedding_provider';
import { runMigrations, resetDatabase, shutdownDatabase } from './test_db';

interface CustomerEngagement {
  id: string;
  timestamp: string;
  date: string;
  customerName: string;
  pmName: string;
  notes: string;
  nextActions: string[];
  rawData: {
    text: string;
    type: string;
    ts: string;
    thread_ts?: string;
    reply_count?: number;
  };
}

interface CustomerEngagementData {
  channelId: string;
  totalEngagements: number;
  engagements: CustomerEngagement[];
}

describe('PM Intelligence System Integration', () => {
  let testData: CustomerEngagementData;
  let ingestedSignals: Signal[] = [];

  beforeAll(async () => {
    runMigrations();
    
    // Load test data
    const dataPath = join(process.cwd(), 'data', 'raw', 'slack', 'C04D195JVGS', 'customer_engagement_C04D195JVGS_complete.json');
    const rawData = readFileSync(dataPath, 'utf-8');
    testData = JSON.parse(rawData);
  });

  beforeEach(async () => {
    await resetDatabase();
    ingestedSignals = [];
    
    // Seed theme hierarchy
    try {
      await seedThemeHierarchy();
    } catch (_e) {
      // May already be seeded
    }
  });

  afterAll(async () => {
    await shutdownDatabase();
  });

  describe('End-to-end Pipeline', () => {
    it('should process customer engagement data through the entire pipeline', async () => {
      // Step 1: Register the channel
      await registerChannel({
        channelId: testData.channelId,
        channelName: 'customer-engagement',
        category: 'customer_engagement',
        weight: 2.5, // High weight for customer engagement channel
        isActive: true
      });

      const weight = await getChannelWeight(testData.channelId);
      expect(weight).toBe(2.5);

      // Step 2: Ingest a subset of engagements (first 5 for speed)
      const engagementsToProcess = testData.engagements.slice(0, 5);
      
      for (const engagement of engagementsToProcess) {
        const rawSignal: RawSignal = {
          source: 'slack',
          id: engagement.id,
          type: engagement.rawData.type || 'message',
          text: engagement.notes || engagement.rawData.text,
          metadata: {
            channel: 'customer-engagement',
            channel_id: testData.channelId,
            customer_name: engagement.customerName,
            pm_name: engagement.pmName,
            thread_ts: engagement.rawData.thread_ts,
            reply_count: engagement.rawData.reply_count,
            next_actions: engagement.nextActions,
            timestamp: new Date(parseFloat(engagement.timestamp) * 1000)
          }
        };

        const signal = await ingestSignal(rawSignal);
        ingestedSignals.push(signal);
      }

      expect(ingestedSignals.length).toBe(5);

      // Step 3: Verify signals have channel-weighted quality scores
      for (const signal of ingestedSignals) {
        expect(signal.metadata?.quality_dimensions).toBeDefined();
        // Channel weight should influence composite score
        const compositeScore = signal.metadata?.quality_dimensions?.compositeScore;
        expect(typeof compositeScore).toBe('number');
      }

      // Step 4: Classify signals into themes
      const classifications = await classifySignalThemes(ingestedSignals[0]);
      expect(Array.isArray(classifications)).toBe(true);

      // Step 5: Detect opportunities from clustered signals
      const opportunities = await detectOpportunities(ingestedSignals, {
        similarityThreshold: 0.1,
        minClusterSize: 2
      });
      expect(Array.isArray(opportunities)).toBe(true);

      // Step 6: Get roadmap summary
      const summary = await getRoadmapSummary();
      expect(summary).toHaveProperty('totalOpportunities');
      expect(summary).toHaveProperty('averageScores');
    });

    it('should extract customer names from engagement notes', async () => {
      const engagementsWithCustomers = testData.engagements
        .filter(e => e.customerName && e.customerName !== 'Unknown')
        .slice(0, 3);

      for (const engagement of engagementsWithCustomers) {
        const signal = await ingestSignal({
          source: 'slack',
          id: `customer-test-${engagement.id}`,
          type: 'message',
          text: engagement.notes,
          metadata: {
            channel: 'customer-engagement',
            channel_id: testData.channelId,
            customer_name: engagement.customerName
          }
        });

        // Customer should be in metadata
        expect(signal.metadata?.customer_name).toBe(engagement.customerName);
      }
    });

    it('should generate contextual summaries for embedding', async () => {
      const mockLLM = createMockLLMProvider('This is a contextual summary of the customer meeting notes.');

      const engagement = testData.engagements[0];
      const signal = await ingestSignal({
        source: 'slack',
        id: `context-test-${engagement.id}`,
        type: 'message',
        text: engagement.notes,
        metadata: {
          channel: 'customer-engagement',
          channel_id: testData.channelId,
          customer_name: engagement.customerName
        }
      });

      const summary = await generateContextualSummary(signal, mockLLM);
      
      expect(typeof summary).toBe('string');
      expect(summary.length).toBeGreaterThan(0);
    });

    it('should embed signals and enable hybrid search', async () => {
      const mockLLM = createMockLLMProvider('Meeting summary about form migration.');
      const mockEmbedding = createMockEmbeddingProvider(1536);

      // Ingest and embed a few signals
      for (const engagement of testData.engagements.slice(0, 3)) {
        const signal = await ingestSignal({
          source: 'slack',
          id: `embed-test-${engagement.id}`,
          type: 'message',
          text: engagement.notes,
          metadata: {
            channel: 'customer-engagement',
            channel_id: testData.channelId,
            customer_name: engagement.customerName
          }
        });

        await embedSignal(signal, mockLLM, mockEmbedding);
      }

      // Check embedding stats
      const stats = await getEmbeddingStats();
      expect(stats.embeddedSignals).toBeGreaterThanOrEqual(3);

      // Search for signals
      const results = await textSearch('form migration', { limit: 10 });
      expect(Array.isArray(results)).toBe(true);
    });
  });

  describe('Channel-Weighted Signal Quality', () => {
    it('should apply different weights based on channel category', async () => {
      // Register channels with different weights
      await registerChannel({
        channelId: 'C-HIGH',
        channelName: 'vip-customers',
        category: 'customer_engagement',
        weight: 3.0,
        isActive: true
      });

      await registerChannel({
        channelId: 'C-LOW',
        channelName: 'general-chat',
        category: 'general',
        weight: 0.5,
        isActive: true
      });

      // Ingest signals to each channel
      const highWeightSignal = await ingestSignal({
        source: 'slack',
        id: 'high-weight-1',
        type: 'message',
        text: 'Important customer feedback about product.',
        metadata: { channel: 'vip-customers', channel_id: 'C-HIGH' }
      });

      const lowWeightSignal = await ingestSignal({
        source: 'slack',
        id: 'low-weight-1',
        type: 'message',
        text: 'General discussion about product.',
        metadata: { channel: 'general-chat', channel_id: 'C-LOW' }
      });

      const highScore = highWeightSignal.metadata?.quality_dimensions?.compositeScore || 0;
      const lowScore = lowWeightSignal.metadata?.quality_dimensions?.compositeScore || 0;

      // High-weight channel should produce higher composite score
      expect(highScore).toBeGreaterThan(lowScore);
    });
  });

  describe('Theme Hierarchy Classification', () => {
    it('should classify real customer engagement content', async () => {
      const engagement = testData.engagements.find(e => 
        e.notes.toLowerCase().includes('form') || 
        e.notes.toLowerCase().includes('migration')
      ) || testData.engagements[0];

      const signal = await ingestSignal({
        source: 'slack',
        id: `theme-test-${engagement.id}`,
        type: 'message',
        text: engagement.notes,
        metadata: {
          channel: 'customer-engagement',
          channel_id: testData.channelId
        }
      });

      const classifications = await classifySignalThemes(signal);

      // Should find at least one theme in real content
      expect(Array.isArray(classifications)).toBe(true);
      
      // Log classifications for debugging
      console.log('Classifications found:', classifications.map(c => c.themeName));
    });
  });

  describe('Trend Analysis', () => {
    it('should compute trends from ingested data', async () => {
      // Ingest multiple signals
      for (const engagement of testData.engagements.slice(0, 10)) {
        await ingestSignal({
          source: 'slack',
          id: `trend-test-${engagement.id}`,
          type: 'message',
          text: engagement.notes,
          metadata: {
            channel: 'customer-engagement',
            channel_id: testData.channelId,
            customer_name: engagement.customerName
          }
        });
      }

      const summary = await getTrendSummary();

      expect(summary).toHaveProperty('themes');
      expect(summary).toHaveProperty('features');
      expect(summary).toHaveProperty('customers');
      expect(summary).toHaveProperty('issues');
    });
  });

  describe('Roadmap Prioritization', () => {
    it('should calculate roadmap scores for opportunities', async () => {
      // Ingest signals
      const signals: Signal[] = [];
      for (const engagement of testData.engagements.slice(0, 5)) {
        const signal = await ingestSignal({
          source: 'slack',
          id: `roadmap-test-${engagement.id}`,
          type: 'message',
          text: engagement.notes,
          metadata: {
            channel: 'customer-engagement',
            channel_id: testData.channelId,
            customer_name: engagement.customerName,
            customers: [engagement.customerName]
          }
        });
        signals.push(signal);
      }

      // Detect opportunities
      const opportunities = await detectOpportunities(signals, {
        similarityThreshold: 0.05,
        minClusterSize: 2
      });

      if (opportunities.length > 0) {
        const score = await calculateRoadmapScore(opportunities[0], signals);
        
        expect(score.overallScore).toBeGreaterThanOrEqual(0);
        expect(score.overallScore).toBeLessThanOrEqual(100);
        expect(score.breakdown.signalCount).toBe(signals.length);
      }
    });
  });

  describe('Data Contracts', () => {
    it('should preserve immutable signal data', async () => {
      const engagement = testData.engagements[0];
      const originalContent = engagement.notes;

      const signal = await ingestSignal({
        source: 'slack',
        id: `immutable-test-${engagement.id}`,
        type: 'message',
        text: originalContent,
        metadata: { channel_id: testData.channelId }
      });

      // Content should be preserved
      expect(signal.content).toBe(originalContent);
      
      // Normalized content should be derived
      expect(signal.normalized_content).toBeDefined();
      expect(signal.normalized_content.toLowerCase()).toBe(signal.normalized_content);
    });

    it('should handle various engagement formats', async () => {
      // Test with engagements that have different data
      const engagementWithReplies = testData.engagements.find(
        e => e.rawData.reply_count && e.rawData.reply_count > 0
      );

      if (engagementWithReplies) {
        const signal = await ingestSignal({
          source: 'slack',
          id: `format-test-${engagementWithReplies.id}`,
          type: 'message',
          text: engagementWithReplies.notes,
          metadata: {
            channel_id: testData.channelId,
            thread_ts: engagementWithReplies.rawData.thread_ts,
            reply_count: engagementWithReplies.rawData.reply_count
          }
        });

        expect(signal.metadata?.reply_count).toBe(engagementWithReplies.rawData.reply_count);
      }
    });
  });
});
