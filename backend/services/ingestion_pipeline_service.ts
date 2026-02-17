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
  private static readonly SIGNAL_TIMEOUT_MS = parseInt(
    process.env.INGESTION_SIGNAL_TIMEOUT_MS || '60000',
    10
  );
  private extractionService = new LLMExtractionService();
  private entityResolutionService = new EntityResolutionService();
  private neo4jSyncService = new Neo4jSyncService();
  private relationshipExtractionService = new RelationshipExtractionService();
  private graphragIndexerService = new GraphRAGIndexerService();
  private queue: Queue | null = null;
  private worker: Worker | null = null;

  private buildLogContext(rawSignal: RawSignal) {
    const metadata = rawSignal.metadata || {};
    const runId = metadata.run_id as string | undefined;
    const batchIndexRaw = metadata.batch_index as number | string | undefined;
    const batchIndex =
      typeof batchIndexRaw === 'number'
        ? batchIndexRaw
        : batchIndexRaw
          ? Number(batchIndexRaw)
          : undefined;
    const fileIndex = metadata.file_index as number | undefined;
    const threadIndex = metadata.thread_index as number | undefined;
    return {
      runId,
      batchIndex,
      fileIndex,
      threadIndex,
      signalId: rawSignal.id,
      source: rawSignal.source,
      signalType: (rawSignal.metadata?.signal_type as string) || 'message'
    };
  }

  private async runWithTimeout<T>(
    operation: () => Promise<T>,
    timeoutMs: number,
    onTimeout: () => void
  ): Promise<T> {
    let timeoutHandle: NodeJS.Timeout | null = null;
    try {
      const timeoutPromise = new Promise<T>((_, reject) => {
        timeoutHandle = setTimeout(() => {
          onTimeout();
          reject(new Error(`Signal processing timeout after ${timeoutMs}ms`));
        }, timeoutMs);
      });
      return await Promise.race([operation(), timeoutPromise]);
    } finally {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
    }
  }

  private async runStage<T>(
    stage: string,
    context: ReturnType<IngestionPipelineService['buildLogContext']>,
    operation: () => Promise<T>,
    options: { allowFailure?: boolean; nextAction?: string } = {}
  ): Promise<T | null> {
    const startedAt = Date.now();
    logger.info('Ingestion stage start', {
      ...context,
      stage,
      status: 'start'
    });
    try {
      const result = await operation();
      logger.info('Ingestion stage complete', {
        ...context,
        stage,
        status: 'success',
        elapsedMs: Date.now() - startedAt
      });
      return result;
    } catch (error) {
      const errorClass = error instanceof Error ? error.name : 'Error';
      const errorMessage = error instanceof Error ? error.message : String(error);
      const payload = {
        ...context,
        stage,
        status: options.allowFailure ? 'skipped' : 'error',
        elapsedMs: Date.now() - startedAt,
        errorClass,
        errorMessage,
        nextAction: options.nextAction || (options.allowFailure ? 'skip_stage' : 'skip_signal')
      };
      if (options.allowFailure) {
        logger.warn('Ingestion stage skipped after failure', payload);
        return null;
      }
      logger.error('Ingestion stage failed', payload);
      throw error;
    }
  }

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
          await this.processSignalWithGuards(job.data as RawSignal);
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
          await this.processSignalWithGuards(
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

  private async processSignalWithGuards(rawSignal: RawSignal, precomputedExtraction?: any): Promise<void> {
    const context = this.buildLogContext(rawSignal);
    let currentStage = 'start';
    const signalStartedAt = Date.now();
    logger.info('Signal processing start', {
      ...context,
      stage: 'signal',
      status: 'start'
    });
    try {
      await this.runWithTimeout(
        async () => {
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

          currentStage = 'insert_signal';
          await this.runStage('insert_signal', context, async () => {
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
          });

          currentStage = 'publish_events';
          await this.runStage(
            'publish_events',
            context,
            async () => {
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
            },
            { allowFailure: true, nextAction: 'skip_event' }
          );

          currentStage = 'extract';
          const extraction = await this.runStage('extract', context, async () => {
            return precomputedExtraction || (await this.extractionService.extract(signal.content));
          });

          if (extraction) {
            currentStage = 'store_extraction';
            await this.runStage('store_extraction', context, async () => {
              await pool.query(
                `INSERT INTO signal_extractions (signal_id, extraction, source, model, created_at)
                 VALUES ($1, $2, $3, $4, NOW())
                 ON CONFLICT (signal_id) DO UPDATE SET extraction = EXCLUDED.extraction, created_at = NOW()`,
                [signal.id, JSON.stringify(extraction), 'llm', config.llm.fastDeployment]
              );
            });

            const entityMentions: Array<{ name: string; type: string }> = [
              ...extraction.entities.customers.map((name: string) => ({ name, type: 'customer' })),
              ...extraction.entities.features.map((name: string) => ({ name, type: 'feature' })),
              ...extraction.entities.issues.map((name: string) => ({ name, type: 'issue' })),
              ...extraction.entities.themes.map((name: string) => ({ name, type: 'theme' })),
              ...(extraction.entities.stakeholders || []).map((name: string) => ({ name, type: 'stakeholder' }))
            ];

            currentStage = 'resolve_entities';
            const resolvedEntities =
              (await this.runStage('resolve_entities', context, async () => {
                const resolved: Array<{ id: string; type: string; name: string }> = [];
                for (const mention of entityMentions) {
                  const resolvedEntity = await this.entityResolutionService.resolveEntityMention({
                    mention: mention.name,
                    entityType: mention.type,
                    signalId: signal.id,
                    signalText: signal.content
                  });
                  resolved.push({
                    id: resolvedEntity.entity_id,
                    type: mention.type,
                    name: mention.name
                  });
                }
                return resolved;
              })) || [];

            currentStage = 'sync_neo4j_entities';
            await this.runStage('sync_neo4j_entities', context, async () => {
              if (!resolvedEntities.length) return;
              for (const resolved of resolvedEntities) {
                await this.neo4jSyncService.syncEntity({
                  id: resolved.id,
                  entity_type: resolved.type,
                  canonical_name: resolved.name
                });
              }
            });

            currentStage = 'sync_neo4j_relationships';
            await this.runStage('sync_neo4j_relationships', context, async () => {
              const relationships = await this.relationshipExtractionService.extractRelationships({
                signalId: signal.id,
                signalText: signal.content,
                extraction
              });
              for (const rel of relationships) {
                await this.neo4jSyncService.syncRelationship(rel);
              }
            });
          }

          currentStage = 'graphrag_index';
          await this.runStage(
            'graphrag_index',
            context,
            async () => {
              if (config.featureFlags.graphragIndexer) {
                await this.graphragIndexerService.indexSignals([signal.id]);
              }
            },
            { allowFailure: true, nextAction: 'skip_graphrag' }
          );

          currentStage = 'embed';
          await this.runStage(
            'embed',
            context,
            async () => {
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
            },
            { allowFailure: true, nextAction: 'skip_embedding' }
          );

          currentStage = 'publish_events';
          await this.runStage(
            'publish_events',
            context,
            async () => {
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
            },
            { allowFailure: true, nextAction: 'skip_event' }
          );
        },
        IngestionPipelineService.SIGNAL_TIMEOUT_MS,
        () => {
          logger.error('Signal processing timed out', {
            ...context,
            stage: currentStage,
            status: 'timeout',
            elapsedMs: IngestionPipelineService.SIGNAL_TIMEOUT_MS,
            errorClass: 'TimeoutError',
            errorMessage: 'Signal processing timeout',
            nextAction: 'skip_signal'
          });
        }
      );
      getRunMetrics().increment('signals_processed');
      logger.info('Signal processing complete', {
        ...context,
        stage: 'signal',
        status: 'success',
        elapsedMs: Date.now() - signalStartedAt
      });
    } catch (error) {
      const errorClass = error instanceof Error ? error.name : 'Error';
      const errorMessage = error instanceof Error ? error.message : String(error);
      getRunMetrics().increment('signals_failed');
      logger.error('Failed to process signal', {
        ...context,
        stage: currentStage,
        status: 'error',
        elapsedMs: Date.now() - signalStartedAt,
        errorClass,
        errorMessage,
        nextAction: 'skip_signal'
      });
      throw error;
    }
  }
}
