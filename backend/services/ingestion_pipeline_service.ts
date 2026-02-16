import { Queue, Worker } from 'bullmq';
import { config } from '../config/env';
import { getDbPool } from '../db/connection';
import { logger } from '../utils/logger';
import { LLMExtractionService } from './llm_extraction_service';
import { EntityResolutionService } from './entity_resolution_service';
import { Neo4jSyncService } from './neo4j_sync_service';
import { RelationshipExtractionService } from './relationship_extraction_service';
import { GraphRAGIndexerService } from './graphrag_indexer_service';
import { createEmbeddingProvider, EmbeddingProviderConfig } from './embedding_provider';
import { createLLMProviderFromEnv } from './llm_service';
import { generateContextualEmbedding, storeSignalEmbedding } from './embedding_service';
import { RawSignal } from '../ingestion/normalizer_service';
import { Signal } from '../processing/signal_extractor';
import { eventBus } from '../agents/event_bus';
import { getSharedRedis } from '../config/redis';
import { getRunMetrics } from '../utils/run_metrics';

export class IngestionPipelineService {
  private extractionService = new LLMExtractionService();
  private entityResolutionService = new EntityResolutionService();
  private neo4jSyncService = new Neo4jSyncService();
  private relationshipExtractionService = new RelationshipExtractionService();
  private graphragIndexerService = new GraphRAGIndexerService();
  private queue: Queue | null = null;
  private worker: Worker | null = null;

  private getQueue(): Queue {
    if (!this.queue) {
      const connection = getSharedRedis();
      this.queue = new Queue('ingestion_pipeline', { connection });
    }
    return this.queue;
  }

  startWorker(): Worker {
    if (!this.worker) {
      const connection = getSharedRedis();
      this.worker = new Worker(
        'ingestion_pipeline',
        async (job) => {
          await this.processSignal(job.data as RawSignal);
        },
        { connection }
      );
      this.worker.on('completed', (job) => {
        logger.info('Ingestion job completed', { jobId: job.id });
      });
      this.worker.on('failed', (job, error) => {
        logger.error('Ingestion job failed', { jobId: job?.id, error });
      });
    }
    return this.worker;
  }

  async ingest(rawSignals: RawSignal[]): Promise<void> {
    try {
      const useBatchExtraction = process.env.INGESTION_BATCH_EXTRACTION !== 'false';
      const precomputedExtractions = useBatchExtraction
        ? await this.extractionService.extractBatch(rawSignals.map((signal) => signal.content))
        : [];
      const concurrency = Math.max(1, config.ingestion.concurrency || 1);
      let index = 0;
      const workers = Array.from({ length: Math.min(concurrency, rawSignals.length) }).map(async () => {
        while (index < rawSignals.length) {
          const current = index;
          index += 1;
          await this.processSignal(
            rawSignals[current],
            useBatchExtraction ? precomputedExtractions[current] : undefined
          );
        }
      });
      await Promise.all(workers);
    } catch (error) {
      logger.error('Ingestion pipeline failed', { error });
      throw error;
    }
  }

  async enqueue(rawSignals: RawSignal[]): Promise<void> {
    try {
      const queue = this.getQueue();
      for (const rawSignal of rawSignals) {
        await queue.add('process_signal', rawSignal, { removeOnComplete: true, attempts: 3 });
      }
    } catch (error) {
      logger.error('Failed to enqueue ingestion jobs', { error });
      throw error;
    }
  }

  private async processSignal(rawSignal: RawSignal, precomputedExtraction?: any): Promise<void> {
    try {
      const pool = getDbPool();
      const signal: Signal = {
        id: rawSignal.id,
        source: rawSignal.source,
        source_ref: (rawSignal.metadata?.source_ref as string) || '',
        signal_type: (rawSignal.metadata?.signal_type as string) || 'message',
        content: rawSignal.content,
        normalized_content: rawSignal.normalized_content,
        severity: null,
        confidence: null,
        metadata: rawSignal.metadata,
        created_at: new Date(rawSignal.created_at)
      };

      await pool.query(
        `INSERT INTO signals
          (id, source, source_ref, signal_type, content, normalized_content, severity, confidence, metadata, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (id) DO NOTHING`,
        [
          signal.id,
          signal.source,
          signal.source_ref,
          signal.signal_type,
          signal.content,
          signal.normalized_content,
          signal.severity,
          signal.confidence,
          JSON.stringify(signal.metadata || {}),
          signal.created_at
        ]
      );

      if (config.featureFlags.eventBus) {
        await eventBus.publish({
          event_type: 'signal.ingested',
          source_service: 'ingestion_pipeline',
          payload: {
            signal_id: signal.id,
            source: signal.source
          },
          metadata: {
            signal_ids: [signal.id],
            severity: 'info'
          }
        });
      }

      const extraction = precomputedExtraction || (await this.extractionService.extract(signal.content));

      await pool.query(
        `INSERT INTO signal_extractions (signal_id, extraction, source, model, created_at)
         VALUES ($1, $2, $3, $4, NOW())
         ON CONFLICT (signal_id) DO UPDATE SET extraction = EXCLUDED.extraction, created_at = NOW()`,
        [signal.id, JSON.stringify(extraction), 'llm', config.llm.fastDeployment]
      );

      const entityMentions: Array<{ name: string; type: string }> = [
        ...extraction.entities.customers.map((name: string) => ({ name, type: 'customer' })),
        ...extraction.entities.features.map((name: string) => ({ name, type: 'feature' })),
        ...extraction.entities.issues.map((name: string) => ({ name, type: 'issue' })),
        ...extraction.entities.themes.map((name: string) => ({ name, type: 'theme' })),
        ...(extraction.entities.stakeholders || []).map((name: string) => ({ name, type: 'stakeholder' }))
      ];

      for (const mention of entityMentions) {
        const resolved = await this.entityResolutionService.resolveEntityMention({
          mention: mention.name,
          entityType: mention.type,
          signalId: signal.id
        });

        await this.neo4jSyncService.syncEntity({
          id: resolved.entity_id,
          entity_type: mention.type,
          canonical_name: mention.name
        });
      }

      const relationships = await this.relationshipExtractionService.extractRelationships({
        signalId: signal.id,
        extraction
      });
      for (const rel of relationships) {
        await this.neo4jSyncService.syncRelationship(rel);
      }

      if (config.featureFlags.graphragIndexer) {
        try {
          await this.graphragIndexerService.indexSignals([signal.id]);
        } catch (error) {
          logger.warn('GraphRAG indexing skipped', { error, signalId: signal.id });
        }
      }

      try {
        const provider =
          (process.env.EMBEDDING_PROVIDER as EmbeddingProviderConfig['provider']) || 'mock';
        const embeddingProvider = createEmbeddingProvider({
          provider,
          dimensions: provider === 'mock' ? 1536 : undefined
        });
        const llmProvider = createLLMProviderFromEnv();
        const embeddingResult = await generateContextualEmbedding(signal, llmProvider, embeddingProvider);
        await storeSignalEmbedding(
          embeddingResult.signalId,
          embeddingResult.embedding,
          embeddingResult.contextualSummary,
          embeddingResult.model
        );
      } catch (error) {
        logger.warn('Embedding generation skipped', { error });
      }

      if (config.featureFlags.eventBus) {
        await eventBus.publish({
          event_type: 'pipeline.completed',
          source_service: 'ingestion_pipeline',
          payload: {
            signal_id: signal.id
          },
          metadata: {
            signal_ids: [signal.id],
            severity: 'info'
          }
        });
      }
      getRunMetrics().increment('signals_processed');
    } catch (error) {
      getRunMetrics().increment('signals_failed');
      logger.error('Failed to process signal', { error, signalId: rawSignal.id });
      throw error;
    }
  }
}
