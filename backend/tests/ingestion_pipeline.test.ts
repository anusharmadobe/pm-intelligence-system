import { randomUUID } from 'crypto';
import { IngestionPipelineService } from '../services/ingestion_pipeline_service';
import { LLMExtractionService } from '../services/llm_extraction_service';
import { RelationshipExtractionService } from '../services/relationship_extraction_service';
import * as embeddingService from '../services/embedding_service';
import { getDbPool } from '../db/connection';
import { runMigrations, resetDatabase, shutdownDatabase } from './test_db';

describe('IngestionPipelineService', () => {
  beforeAll(() => {
    runMigrations();
  });

  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await shutdownDatabase();
  });

  it('ingests a signal and stores extraction', async () => {
    const signalId = randomUUID();
    jest.spyOn(LLMExtractionService.prototype, 'extract').mockResolvedValue({
      entities: { customers: [], features: [], issues: [], themes: [], stakeholders: [] },
      relationships: [],
      summary: ''
    });
    jest.spyOn(RelationshipExtractionService.prototype, 'extractRelationships').mockResolvedValue([]);
    jest.spyOn(embeddingService, 'generateContextualEmbedding').mockResolvedValue({
      signalId,
      embedding: [0.1, 0.2, 0.3],
      contextualSummary: 'summary',
      model: 'mock'
    });
    jest.spyOn(embeddingService, 'storeSignalEmbedding').mockResolvedValue();

    const pipeline = new IngestionPipelineService();
    await pipeline.ingest([
      {
        id: signalId,
        source: 'manual',
        content: 'Acme Corp reports an issue with FeatureX.',
        normalized_content: 'Acme Corp reports an issue with FeatureX.',
        metadata: {},
        content_hash: 'hash',
        created_at: new Date().toISOString()
      }
    ]);

    const pool = getDbPool();
    const signals = await pool.query(`SELECT id FROM signals WHERE id = $1`, [signalId]);
    const extractions = await pool.query(
      `SELECT signal_id FROM signal_extractions WHERE signal_id = $1`,
      [signalId]
    );
    expect(signals.rows.length).toBe(1);
    expect(extractions.rows.length).toBe(1);
  });
});
