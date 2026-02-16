import { EntityResolutionService } from '../services/entity_resolution_service';
import { EntityRegistryService } from '../services/entity_registry_service';
import { getDbPool } from '../db/connection';
import goldenDataset from './fixtures/golden_dataset_entities.json';

describe('Entity Resolution Accuracy (Golden Dataset)', () => {
  let entityResolutionService: EntityResolutionService;
  let entityRegistryService: EntityRegistryService;
  const pool = getDbPool();

  beforeAll(async () => {
    entityResolutionService = new EntityResolutionService();
    entityRegistryService = new EntityRegistryService();

    // Create ground truth entities from golden dataset
    const uniqueEntities = new Map<string, any>();
    for (const testCase of goldenDataset) {
      if (!uniqueEntities.has(testCase.ground_truth_entity_id)) {
        uniqueEntities.set(testCase.ground_truth_entity_id, {
          id: testCase.ground_truth_entity_id,
          canonical_name: testCase.ground_truth_canonical_name,
          entity_type: testCase.entity_type
        });
      }
    }

    // Insert ground truth entities into database
    for (const [id, entity] of uniqueEntities) {
      try {
        await pool.query(
          `INSERT INTO entity_registry (id, canonical_name, entity_type, created_at, updated_at)
           VALUES ($1, $2, $3, NOW(), NOW())
           ON CONFLICT (id) DO NOTHING`,
          [entity.id, entity.canonical_name, entity.entity_type]
        );
      } catch (error) {
        console.warn(`Failed to insert ground truth entity ${id}:`, error);
      }
    }
  });

  afterAll(async () => {
    // Clean up: Remove test entities from entity_registry
    const entityIds = Array.from(
      new Set(goldenDataset.map(tc => tc.ground_truth_entity_id))
    );

    try {
      await pool.query(
        `DELETE FROM entity_resolution_log
         WHERE resolved_to_entity_id = ANY($1)`,
        [entityIds]
      );

      await pool.query(
        `DELETE FROM entity_registry
         WHERE id = ANY($1)`,
        [entityIds]
      );
    } catch (error) {
      console.warn('Cleanup failed:', error);
    }
  });

  it('achieves >85% accuracy on golden dataset', async () => {
    let correct = 0;
    let total = 0;
    const results: any[] = [];

    for (const testCase of goldenDataset) {
      try {
        const result = await entityResolutionService.resolveEntityMention({
          mention: testCase.mention,
          entityType: testCase.entity_type,
          signalText: testCase.context
        });

        const predicted = result.entity_id;
        const expected = testCase.ground_truth_entity_id;
        const isCorrect = predicted === expected;

        if (isCorrect) {
          correct++;
        }

        results.push({
          mention: testCase.mention,
          expected,
          predicted,
          correct: isCorrect,
          confidence: result.confidence,
          status: result.status,
          notes: testCase.notes
        });

        total++;
      } catch (error: any) {
        console.error(`Test case failed for mention "${testCase.mention}":`, error.message);
        results.push({
          mention: testCase.mention,
          expected: testCase.ground_truth_entity_id,
          predicted: null,
          correct: false,
          error: error.message,
          notes: testCase.notes
        });
        total++;
      }
    }

    const accuracy = correct / total;

    // Log detailed results
    console.log('\n=== Entity Resolution Accuracy Test Results ===');
    console.log(`Total test cases: ${total}`);
    console.log(`Correct predictions: ${correct}`);
    console.log(`Incorrect predictions: ${total - correct}`);
    console.log(`Accuracy: ${(accuracy * 100).toFixed(2)}%`);
    console.log(`Target: >85%\n`);

    // Log failures for debugging
    const failures = results.filter(r => !r.correct);
    if (failures.length > 0) {
      console.log('=== Failed Predictions ===');
      failures.forEach(f => {
        console.log(`\nMention: "${f.mention}"`);
        console.log(`Expected: ${f.expected}`);
        console.log(`Predicted: ${f.predicted || 'null'}`);
        console.log(`Confidence: ${f.confidence || 'N/A'}`);
        console.log(`Status: ${f.status || 'error'}`);
        console.log(`Notes: ${f.notes}`);
        if (f.error) {
          console.log(`Error: ${f.error}`);
        }
      });
    }

    // Log accuracy by entity type
    const byType: Record<string, { correct: number; total: number }> = {};
    results.forEach(r => {
      const entityType = goldenDataset.find(tc => tc.mention === r.mention)?.entity_type || 'unknown';
      if (!byType[entityType]) {
        byType[entityType] = { correct: 0, total: 0 };
      }
      byType[entityType].total++;
      if (r.correct) {
        byType[entityType].correct++;
      }
    });

    console.log('\n=== Accuracy by Entity Type ===');
    Object.entries(byType).forEach(([type, stats]) => {
      const typeAccuracy = (stats.correct / stats.total * 100).toFixed(2);
      console.log(`${type}: ${typeAccuracy}% (${stats.correct}/${stats.total})`);
    });

    // Assertion: Must achieve >85% accuracy
    expect(accuracy).toBeGreaterThan(0.85);
  }, 120000); // 2 minute timeout for LLM calls

  it('achieves high confidence (>0.85) for exact matches', async () => {
    // Test that exact canonical name matches get high confidence
    const exactMatchCases = goldenDataset.filter(tc =>
      tc.mention.toLowerCase() === tc.ground_truth_canonical_name.toLowerCase()
    );

    let highConfidenceCount = 0;

    for (const testCase of exactMatchCases) {
      const result = await entityResolutionService.resolveEntityMention({
        mention: testCase.mention,
        entityType: testCase.entity_type,
        signalText: testCase.context
      });

      if (result.confidence >= 0.85) {
        highConfidenceCount++;
      }
    }

    const highConfidenceRate = highConfidenceCount / exactMatchCases.length;

    console.log(`\nExact match high confidence rate: ${(highConfidenceRate * 100).toFixed(2)}%`);

    // At least 80% of exact matches should have high confidence
    expect(highConfidenceRate).toBeGreaterThan(0.8);
  }, 60000);

  it('performance: resolves entities in <2s (p95)', async () => {
    const latencies: number[] = [];
    const sampleSize = Math.min(10, goldenDataset.length); // Test with 10 samples

    for (let i = 0; i < sampleSize; i++) {
      const testCase = goldenDataset[i];
      const startTime = Date.now();

      await entityResolutionService.resolveEntityMention({
        mention: testCase.mention,
        entityType: testCase.entity_type,
        signalText: testCase.context
      });

      const latency = Date.now() - startTime;
      latencies.push(latency);
    }

    // Calculate p95 latency
    latencies.sort((a, b) => a - b);
    const p95Index = Math.ceil(latencies.length * 0.95) - 1;
    const p95Latency = latencies[p95Index];

    console.log(`\n=== Performance Results ===`);
    console.log(`Sample size: ${sampleSize}`);
    console.log(`Min latency: ${Math.min(...latencies)}ms`);
    console.log(`Max latency: ${Math.max(...latencies)}ms`);
    console.log(`Avg latency: ${(latencies.reduce((a, b) => a + b, 0) / latencies.length).toFixed(0)}ms`);
    console.log(`P95 latency: ${p95Latency}ms`);
    console.log(`Target: <2000ms`);

    // P95 should be under 2 seconds
    expect(p95Latency).toBeLessThan(2000);
  }, 60000);
});
