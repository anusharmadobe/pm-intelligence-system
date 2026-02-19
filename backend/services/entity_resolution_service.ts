import { config } from '../config/env';
import { getDbPool } from '../db/connection';
import { createModuleLogger } from '../utils/logger';
import { LRUCache } from '../utils/lru_cache';
import { EntityMatchingService } from './entity_matching_service';
import { EntityRegistryService } from './entity_registry_service';

const logger = createModuleLogger('entity_resolution', 'LOG_LEVEL_ENTITY_RESOLUTION');
import {
  EmbeddingProvider,
  cosineSimilarity,
  createEmbeddingProviderFromEnv
} from './embedding_provider';
import { LLMProvider, createLLMProviderFromEnv } from './llm_service';
import { LLMEntityMatcher, CanonicalEntity } from './llm_entity_matcher';

export interface ResolutionResult {
  status: 'alias_matched' | 'auto_merged' | 'human_review' | 'new_entity';
  entity_id: string;
  confidence: number;
  match_details?: Record<string, unknown>;
}

export class EntityResolutionService {
  private registryService = new EntityRegistryService();
  private matchingService = new EntityMatchingService();
  private llmMatcher: LLMEntityMatcher | null = null;
  private embeddingProvider: EmbeddingProvider | null = null;
  private llmProvider: LLMProvider | null = null;
  // LRU cache with max 10,000 entries to prevent unbounded memory growth
  private mentionEmbeddingCache = new LRUCache<string, number[]>(10000);
  private cacheAccessCount = 0;

  constructor() {
    // Initialize LLM Entity Matcher (primary mechanism)
    try {
      this.llmMatcher = new LLMEntityMatcher();
      logger.info('LLM Entity Matcher initialized successfully');
    } catch (error) {
      this.llmMatcher = null;
      logger.error('LLM Entity Matcher initialization failed - entity resolution will use fallback methods', { error });
    }

    // Initialize embeddings (fallback for matching)
    try {
      this.embeddingProvider = createEmbeddingProviderFromEnv();
    } catch (error) {
      // Entity resolution still works with string similarity when embeddings are unavailable.
      this.embeddingProvider = null;
      logger.warn('Entity name embedding provider unavailable; falling back to string-only matching', {
        error
      });
    }

    // Keep old LLM provider for legacy confirmation (will be phased out)
    if (config.featureFlags.erLlmConfirmation) {
      try {
        this.llmProvider = createLLMProviderFromEnv();
      } catch (error) {
        this.llmProvider = null;
        logger.warn('ER LLM confirmation disabled because no LLM provider is available', { error });
      }
    }
  }

  private normalizeEntityName(value: string): string {
    return value
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private parseEmbedding(raw: unknown): number[] | null {
    if (!Array.isArray(raw)) {
      return null;
    }
    const parsed = raw
      .map((value) => Number(value))
      .filter((value) => Number.isFinite(value));
    return parsed.length > 0 ? parsed : null;
  }

  private async getMentionEmbedding(mention: string): Promise<number[] | null> {
    if (!this.embeddingProvider) {
      return null;
    }
    const normalizedMention = this.normalizeEntityName(mention);
    if (!normalizedMention) {
      return null;
    }

    // Periodic cache stats logging (every 1000 lookups)
    this.cacheAccessCount++;
    if (this.cacheAccessCount % 1000 === 0) {
      const stats = this.mentionEmbeddingCache.getStats();
      logger.debug('Mention embedding cache statistics', {
        hit_rate: stats.hitRate.toFixed(3),
        total_hits: stats.hits,
        total_misses: stats.misses,
        cache_size: stats.size,
        utilization_percent: stats.utilizationPercent.toFixed(1)
      });
    }

    const cached = this.mentionEmbeddingCache.get(normalizedMention);
    if (cached) {
      return cached;
    }

    try {
      const embeddingStartTime = Date.now();
      const embedding = await this.embeddingProvider(normalizedMention);

      logger.debug('Mention embedding generated', {
        mention_length: mention.length,
        embedding_dimensions: embedding.length,
        duration_ms: Date.now() - embeddingStartTime
      });

      this.mentionEmbeddingCache.set(normalizedMention, embedding);
      return embedding;
    } catch (error) {
      logger.warn('Failed to embed entity mention', { mention, error });
      return null;
    }
  }

  async getMentionEmbeddingBatch(mentions: string[]): Promise<Map<string, number[]>> {
    const result = new Map<string, number[]>();
    if (!this.embeddingProvider || mentions.length === 0) {
      return result;
    }
    const uniqueMentions = Array.from(
      new Set(mentions.map((value) => this.normalizeEntityName(value)).filter(Boolean))
    );

    const uncached = uniqueMentions.filter((mention) => !this.mentionEmbeddingCache.has(mention));
    if (uncached.length > 0) {
      await Promise.all(
        uncached.map(async (mention) => {
          try {
            const embedding = await this.embeddingProvider!(mention);
            this.mentionEmbeddingCache.set(mention, embedding);
          } catch (error) {
            logger.warn('Failed to embed entity mention in batch', { mention, error });
          }
        })
      );
    }

    uniqueMentions.forEach((mention) => {
      const embedding = this.mentionEmbeddingCache.get(mention);
      if (embedding) {
        result.set(mention, embedding);
      }
    });
    return result;
  }

  private async getOrCreateEntityEmbedding(entityId: string, canonicalName: string): Promise<number[] | null> {
    if (!this.embeddingProvider) {
      return null;
    }
    const pool = getDbPool();
    try {
      const existing = await pool.query(
        `SELECT embedding
         FROM entity_name_embeddings
         WHERE entity_id = $1`,
        [entityId]
      );
      if (existing.rows.length > 0) {
        return this.parseEmbedding(existing.rows[0].embedding);
      }
    } catch (error) {
      logger.warn('Failed to read cached entity name embedding', { entityId, error });
    }

    try {
      const embedding = await this.embeddingProvider(this.normalizeEntityName(canonicalName));
      await pool.query(
        `INSERT INTO entity_name_embeddings (entity_id, embedding)
         VALUES ($1, $2::jsonb)
         ON CONFLICT (entity_id) DO UPDATE SET
           embedding = EXCLUDED.embedding,
           updated_at = NOW()`,
        [entityId, JSON.stringify(embedding)]
      );
      return embedding;
    } catch (error) {
      logger.warn('Failed to generate cached entity name embedding', { entityId, canonicalName, error });
      return null;
    }
  }

  private async confirmAmbiguousMerge(params: {
    mention: string;
    entityType: string;
    candidateName: string;
  }): Promise<{ confirmed: boolean; reasoning: string | null } | null> {
    if (!this.llmProvider) {
      return null;
    }
    const prompt = `You are validating entity resolution for a PM intelligence system.
Determine if these refer to the same ${params.entityType}.

Mention: "${params.mention}"
Candidate canonical entity: "${params.candidateName}"

Respond with strict JSON:
{"same_entity": true|false, "reasoning": "short reason"}`;
    try {
      const llmStartTime = Date.now();
      const response = await this.llmProvider(prompt);

      const sameEntityMatch = response.match(/"same_entity"\s*:\s*(true|false)/i);
      const confirmed = sameEntityMatch
        ? sameEntityMatch[1].toLowerCase() === 'true'
        : /^yes\b/i.test(response.trim());

      logger.debug('LLM confirmation completed', {
        entity_mention: params.mention,
        candidate_entity: params.candidateName,
        confirmed,
        duration_ms: Date.now() - llmStartTime
      });

      return { confirmed, reasoning: response.slice(0, 1000) };
    } catch (error) {
      logger.warn('ER LLM confirmation failed', { error, params });
      return null;
    }
  }

  private async logResolution(params: {
    mention: string;
    entityType: string;
    signalId?: string | null;
    resolutionResult: string;
    resolvedToEntityId: string;
    confidence: number;
    matchDetails?: Record<string, unknown>;
    llmReasoning?: string | null;
    resolvedBy?: string;
  }): Promise<void> {
    const pool = getDbPool();
    await pool.query(
      `INSERT INTO entity_resolution_log
        (id, entity_mention, entity_type, signal_id, resolution_result, resolved_to_entity_id,
         confidence, match_details, llm_reasoning, resolved_by)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        params.mention,
        params.entityType,
        params.signalId || null,
        params.resolutionResult,
        params.resolvedToEntityId,
        params.confidence,
        params.matchDetails ? JSON.stringify(params.matchDetails) : null,
        params.llmReasoning || null,
        params.resolvedBy || 'system'
      ]
    );
  }

  /**
   * Resolve entity mention within a transaction context
   * @param client - PostgreSQL client for transaction context
   * @param params - Resolution parameters
   */
  async resolveEntityMentionWithClient(
    client: any,
    params: {
      mention: string;
      entityType: string;
      signalId?: string | null;
      signalText: string;
    }
  ): Promise<ResolutionResult> {
    const { mention, entityType, signalId, signalText } = params;
    const startTime = Date.now();

    logger.debug('Entity resolution start (transaction)', {
      stage: 'entity_resolution',
      status: 'start',
      mention,
      entityType,
      signalId,
      signalTextLength: signalText.length,
      transactionMode: true
    });

    // Step 1: Exact alias match (fast path)
    const aliasResult = await client.query(
      `SELECT e.id, e.canonical_name, e.entity_type
       FROM entity_registry e
       JOIN entity_aliases a ON e.id = a.canonical_entity_id
       WHERE LOWER(a.alias) = LOWER($1)
       LIMIT 1`,
      [mention]
    );

    if (aliasResult.rows.length > 0) {
      const aliasMatch = aliasResult.rows[0];
      logger.info('Entity resolved via alias match (transaction)', {
        stage: 'entity_resolution',
        status: 'success',
        method: 'alias_match',
        mention,
        entityType,
        resolvedEntityId: aliasMatch.id,
        resolvedEntityName: aliasMatch.canonical_name,
        confidence: 1.0,
        elapsedMs: Date.now() - startTime,
        signalId
      });

      await this.logResolutionWithClient(client, {
        mention,
        entityType,
        signalId,
        resolutionResult: 'alias_matched',
        resolvedToEntityId: aliasMatch.id,
        confidence: 1.0
      });
      return { status: 'alias_matched', entity_id: aliasMatch.id, confidence: 1.0 };
    }

    // Step 2: Exact name match
    const nameResult = await client.query(
      `SELECT id, canonical_name, entity_type
       FROM entity_registry
       WHERE LOWER(canonical_name) = LOWER($1)
       LIMIT 1`,
      [mention]
    );

    if (nameResult.rows.length > 0) {
      const nameMatch = nameResult.rows[0];
      logger.info('Entity resolved via name match (transaction)', {
        stage: 'entity_resolution',
        status: 'success',
        method: 'name_match',
        mention,
        entityType,
        resolvedEntityId: nameMatch.id,
        resolvedEntityName: nameMatch.canonical_name,
        confidence: 1.0,
        elapsedMs: Date.now() - startTime,
        signalId
      });

      await this.logResolutionWithClient(client, {
        mention,
        entityType,
        signalId,
        resolutionResult: 'alias_matched',
        resolvedToEntityId: nameMatch.id,
        confidence: 1.0
      });
      return { status: 'alias_matched', entity_id: nameMatch.id, confidence: 1.0 };
    }

    // Step 3: LLM-based matching (within transaction)
    if (this.llmMatcher) {
      try {
        // Search for candidates using client
        const candidatesResult = await client.query(
          `SELECT id, canonical_name, entity_type
           FROM entity_registry
           ORDER BY created_at DESC
           LIMIT 10`
        );
        const candidates = candidatesResult.rows;

        logger.debug('Entity resolution candidates found (transaction)', {
          stage: 'entity_resolution',
          status: 'candidates_found',
          mention,
          entityType,
          candidateCount: candidates.length,
          signalId
        });

        if (candidates.length > 0) {
          // Fetch aliases for each candidate
          const llmCandidates: CanonicalEntity[] = await Promise.all(
            candidates.map(async (c: any) => {
              const aliasesResult = await client.query(
                `SELECT alias FROM entity_aliases WHERE canonical_entity_id = $1`,
                [c.id]
              );
              return {
                id: c.id,
                canonical_name: c.canonical_name,
                entity_type: c.entity_type,
                aliases: aliasesResult.rows.map((r: any) => r.alias)
              };
            })
          );

          // Use LLM to match
          const llmMatch = await this.llmMatcher.matchEntity(mention, llmCandidates, signalText);

          logger.info('LLM entity match result (transaction)', {
            stage: 'entity_resolution',
            status: 'llm_match_complete',
            mention,
            entityType,
            matchedEntityId: llmMatch.matchedEntityId,
            confidence: llmMatch.confidence,
            signalId
          });

          // High confidence: auto-merge
          if (llmMatch.matchedEntityId && llmMatch.confidence >= 0.85) {
            // Add mention as alias within transaction
            await client.query(
              `INSERT INTO entity_aliases (
                 canonical_entity_id,
                 alias,
                 alias_normalized,
                 alias_source,
                 signal_id
               )
               VALUES ($1, $2, LOWER($2), 'llm_auto_merge', $3)
               ON CONFLICT (alias_normalized, canonical_entity_id) DO NOTHING`,
              [llmMatch.matchedEntityId, mention, signalId || null]
            );

            logger.info('Entity auto-merged (high confidence, transaction)', {
              stage: 'entity_resolution',
              status: 'success',
              method: 'llm_auto_merge',
              mention,
              entityType,
              resolvedEntityId: llmMatch.matchedEntityId,
              confidence: llmMatch.confidence,
              elapsedMs: Date.now() - startTime,
              signalId
            });

            await this.logResolutionWithClient(client, {
              mention,
              entityType,
              signalId,
              resolutionResult: 'auto_merged',
              resolvedToEntityId: llmMatch.matchedEntityId,
              confidence: llmMatch.confidence,
              matchDetails: {
                method: 'llm',
                reasoning: llmMatch.reasoning
              },
              llmReasoning: llmMatch.reasoning
            });

            return {
              status: 'auto_merged',
              entity_id: llmMatch.matchedEntityId,
              confidence: llmMatch.confidence,
              match_details: {
                method: 'llm',
                reasoning: llmMatch.reasoning
              }
            };
          }

          // Medium confidence: human review
          if (llmMatch.matchedEntityId && llmMatch.confidence >= 0.65) {
            const matchedCandidate = candidates.find((c: any) => c.id === llmMatch.matchedEntityId);

            await client.query(
              `INSERT INTO feedback_log
                (id, feedback_type, system_output, system_confidence, status, signals_affected, entities_affected)
               VALUES (gen_random_uuid(), 'entity_merge', $1, $2, 'pending', 1, 1)`,
              [
                JSON.stringify({
                  entity_a: mention,
                  entity_b: matchedCandidate?.canonical_name || '',
                  entity_type: entityType,
                  candidate_entity_id: llmMatch.matchedEntityId,
                  llm_reasoning: llmMatch.reasoning,
                  match_details: {
                    method: 'llm',
                    confidence: llmMatch.confidence
                  }
                }),
                llmMatch.confidence
              ]
            );

            logger.info('Entity flagged for human review (transaction)', {
              stage: 'entity_resolution',
              status: 'success',
              method: 'llm_human_review',
              mention,
              entityType,
              resolvedEntityId: llmMatch.matchedEntityId,
              confidence: llmMatch.confidence,
              elapsedMs: Date.now() - startTime,
              signalId
            });

            await this.logResolutionWithClient(client, {
              mention,
              entityType,
              signalId,
              resolutionResult: 'human_review',
              resolvedToEntityId: llmMatch.matchedEntityId,
              confidence: llmMatch.confidence,
              matchDetails: {
                method: 'llm',
                reasoning: llmMatch.reasoning
              },
              llmReasoning: llmMatch.reasoning
            });

            return {
              status: 'human_review',
              entity_id: llmMatch.matchedEntityId,
              confidence: llmMatch.confidence,
              match_details: {
                method: 'llm',
                reasoning: llmMatch.reasoning
              }
            };
          }
        }
      } catch (error: any) {
        logger.error('LLM entity matching failed (transaction), creating new entity', {
          stage: 'entity_resolution',
          status: 'error',
          error: error.message,
          mention,
          entityType,
          signalId
        });
      }
    }

    // Step 4: Create new entity within transaction
    let canonicalName = mention;
    if (this.llmMatcher) {
      try {
        canonicalName = await this.llmMatcher.extractCanonicalForm(mention, signalText);
      } catch (error: any) {
        logger.warn('LLM canonical form extraction failed, using raw mention', {
          error: error.message,
          mention,
          signalId
        });
      }
    }

    const createResult = await client.query(
      `INSERT INTO entity_registry (entity_type, canonical_name)
       VALUES ($1, $2)
       RETURNING id`,
      [entityType, canonicalName]
    );

    const createdEntityId = createResult.rows[0].id;

    logger.info('New entity created (transaction)', {
      stage: 'entity_resolution',
      status: 'success',
      method: 'new_entity',
      mention,
      entityType,
      canonicalName,
      createdEntityId,
      confidence: 1.0,
      elapsedMs: Date.now() - startTime,
      signalId
    });

    await this.logResolutionWithClient(client, {
      mention,
      entityType,
      signalId,
      resolutionResult: 'new_entity',
      resolvedToEntityId: createdEntityId,
      confidence: 1.0
    });

    return { status: 'new_entity', entity_id: createdEntityId, confidence: 1.0 };
  }

  /**
   * Resolve entity mention (non-transaction wrapper for backward compatibility)
   */
  async resolveEntityMention(params: {
    mention: string;
    entityType: string;
    signalId?: string | null;
    signalText: string;
  }): Promise<ResolutionResult> {
    const { mention, entityType, signalId, signalText } = params;
    const startTime = Date.now();

    logger.debug('Entity resolution start', {
      stage: 'entity_resolution',
      status: 'start',
      mention,
      entityType,
      signalId,
      signalTextLength: signalText.length
    });

    // Step 1: Exact alias match (fast path)
    const aliasMatch = await this.registryService.findByAlias(mention);
    if (aliasMatch) {
      logger.info('Entity resolved via alias match', {
        stage: 'entity_resolution',
        status: 'success',
        method: 'alias_match',
        mention,
        entityType,
        resolvedEntityId: aliasMatch.id,
        resolvedEntityName: aliasMatch.canonical_name,
        confidence: 1.0,
        elapsedMs: Date.now() - startTime,
        signalId
      });

      await this.logResolution({
        mention,
        entityType,
        signalId,
        resolutionResult: 'alias_matched',
        resolvedToEntityId: aliasMatch.id,
        confidence: 1.0
      });
      return { status: 'alias_matched', entity_id: aliasMatch.id, confidence: 1.0 };
    }

    // Step 2: Exact name match
    const nameMatch = await this.registryService.findByName(mention);
    if (nameMatch) {
      logger.info('Entity resolved via name match', {
        stage: 'entity_resolution',
        status: 'success',
        method: 'name_match',
        mention,
        entityType,
        resolvedEntityId: nameMatch.id,
        resolvedEntityName: nameMatch.canonical_name,
        confidence: 1.0,
        elapsedMs: Date.now() - startTime,
        signalId
      });

      await this.logResolution({
        mention,
        entityType,
        signalId,
        resolutionResult: 'alias_matched',
        resolvedToEntityId: nameMatch.id,
        confidence: 1.0
      });
      return { status: 'alias_matched', entity_id: nameMatch.id, confidence: 1.0 };
    }

    // Step 3: LLM-based matching (PRIMARY MECHANISM)
    if (this.llmMatcher) {
      try {
        // Search for candidates
        const candidates = await this.registryService.search(mention, 10);

        if (candidates.length > 0) {
          // Convert to LLM matcher format - fetch aliases for each candidate
          const llmCandidates: CanonicalEntity[] = await Promise.all(
            candidates.map(async (c) => {
              const { aliases } = await this.registryService.getWithAliases(c.id);
              return {
                id: c.id,
                canonical_name: c.canonical_name,
                entity_type: c.entity_type,
                aliases: aliases.map((a) => a.alias)
              };
            })
          );

          // Use LLM to match
          const llmMatch = await this.llmMatcher.matchEntity(mention, llmCandidates, signalText);

          // High confidence: auto-merge
          if (llmMatch.matchedEntityId && llmMatch.confidence >= 0.85) {
            await this.registryService.addAlias(llmMatch.matchedEntityId, mention);

            logger.info('Entity auto-merged (high confidence)', {
              stage: 'entity_resolution',
              status: 'success',
              method: 'llm_auto_merge',
              mention,
              entityType,
              resolvedEntityId: llmMatch.matchedEntityId,
              confidence: llmMatch.confidence,
              elapsedMs: Date.now() - startTime,
              signalId
            });

            await this.logResolution({
              mention,
              entityType,
              signalId,
              resolutionResult: 'auto_merged',
              resolvedToEntityId: llmMatch.matchedEntityId,
              confidence: llmMatch.confidence,
              matchDetails: {
                method: 'llm',
                reasoning: llmMatch.reasoning
              },
              llmReasoning: llmMatch.reasoning
            });

            return {
              status: 'auto_merged',
              entity_id: llmMatch.matchedEntityId,
              confidence: llmMatch.confidence,
              match_details: {
                method: 'llm',
                reasoning: llmMatch.reasoning
              }
            };
          }

          // Medium confidence: human review
          if (llmMatch.matchedEntityId && llmMatch.confidence >= 0.65) {
            const pool = getDbPool();
            const matchedCandidate = candidates.find((c) => c.id === llmMatch.matchedEntityId);

            await pool.query(
              `INSERT INTO feedback_log
                (id, feedback_type, system_output, system_confidence, status, signals_affected, entities_affected)
               VALUES (gen_random_uuid(), 'entity_merge', $1, $2, 'pending', 1, 1)`,
              [
                JSON.stringify({
                  entity_a: mention,
                  entity_b: matchedCandidate?.canonical_name || '',
                  entity_type: entityType,
                  candidate_entity_id: llmMatch.matchedEntityId,
                  llm_reasoning: llmMatch.reasoning,
                  match_details: {
                    method: 'llm',
                    confidence: llmMatch.confidence
                  }
                }),
                llmMatch.confidence
              ]
            );

            await this.logResolution({
              mention,
              entityType,
              signalId,
              resolutionResult: 'human_review',
              resolvedToEntityId: llmMatch.matchedEntityId,
              confidence: llmMatch.confidence,
              matchDetails: {
                method: 'llm',
                reasoning: llmMatch.reasoning
              },
              llmReasoning: llmMatch.reasoning
            });

            return {
              status: 'human_review',
              entity_id: llmMatch.matchedEntityId,
              confidence: llmMatch.confidence,
              match_details: {
                method: 'llm',
                reasoning: llmMatch.reasoning
              }
            };
          }
        }
      } catch (error: any) {
        logger.error('LLM entity matching failed, creating new entity', {
          stage: 'entity_resolution',
          status: 'error',
          error: error.message,
          mention,
          entityType,
          signalId
        });
      }
    }

    // Step 4: Create new entity
    let canonicalName = mention;
    if (this.llmMatcher) {
      try {
        canonicalName = await this.llmMatcher.extractCanonicalForm(mention, signalText);
      } catch (error: any) {
        logger.warn('LLM canonical form extraction failed', {
          error: error.message,
          mention,
          signalId
        });
      }
    }

    const created = await this.registryService.createEntity({
      entityType,
      canonicalName
    });

    logger.info('New entity created', {
      stage: 'entity_resolution',
      status: 'success',
      method: 'new_entity',
      mention,
      entityType,
      canonicalName,
      createdEntityId: created.id,
      confidence: 1.0,
      elapsedMs: Date.now() - startTime,
      signalId
    });

    await this.logResolution({
      mention,
      entityType,
      signalId,
      resolutionResult: 'new_entity',
      resolvedToEntityId: created.id,
      confidence: 1.0
    });

    return { status: 'new_entity', entity_id: created.id, confidence: 1.0 };
  }

  /**
   * Log resolution within a transaction
   */
  private async logResolutionWithClient(
    client: any,
    params: {
      mention: string;
      entityType: string;
      signalId?: string | null;
      resolutionResult: string;
      resolvedToEntityId: string;
      confidence: number;
      matchDetails?: Record<string, unknown>;
      llmReasoning?: string | null;
      resolvedBy?: string;
    }
  ): Promise<void> {
    await client.query(
      `INSERT INTO entity_resolution_log
        (id, entity_mention, entity_type, signal_id, resolution_result, resolved_to_entity_id,
         confidence, match_details, llm_reasoning, resolved_by)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        params.mention,
        params.entityType,
        params.signalId || null,
        params.resolutionResult,
        params.resolvedToEntityId,
        params.confidence,
        params.matchDetails ? JSON.stringify(params.matchDetails) : null,
        params.llmReasoning || null,
        params.resolvedBy || 'system'
      ]
    );
  }
}
