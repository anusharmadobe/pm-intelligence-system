import { config } from '../config/env';
import { getDbPool } from '../db/connection';
import { logger } from '../utils/logger';
import { EntityMatchingService } from './entity_matching_service';
import { EntityRegistryService } from './entity_registry_service';
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
  private mentionEmbeddingCache = new Map<string, number[]>();

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
    const cached = this.mentionEmbeddingCache.get(normalizedMention);
    if (cached) {
      return cached;
    }
    try {
      const embedding = await this.embeddingProvider(normalizedMention);
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
      const response = await this.llmProvider(prompt);
      const sameEntityMatch = response.match(/"same_entity"\s*:\s*(true|false)/i);
      const confirmed = sameEntityMatch
        ? sameEntityMatch[1].toLowerCase() === 'true'
        : /^yes\b/i.test(response.trim());
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

  async resolveEntityMention(params: {
    mention: string;
    entityType: string;
    signalId?: string | null;
    signalText: string; // NEW: Added for LLM context
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
        const candidates = await this.registryService.search(mention, 10); // Increased from 5 to 10 for better LLM matching

        logger.debug('Entity resolution candidates found', {
          stage: 'entity_resolution',
          status: 'candidates_found',
          mention,
          entityType,
          candidateCount: candidates.length,
          candidates: candidates.map(c => ({ id: c.id, name: c.canonical_name, type: c.entity_type })),
          signalId
        });

        if (candidates.length > 0) {
          // Convert to LLM matcher format - fetch aliases for each candidate
          const llmCandidates: CanonicalEntity[] = await Promise.all(
            candidates.map(async (c) => {
              const { aliases } = await this.registryService.getWithAliases(c.id);
              return {
                id: c.id,
                canonical_name: c.canonical_name,
                entity_type: c.entity_type,
                aliases: aliases.map(a => a.alias)
              };
            })
          );

          logger.debug('LLM entity matching start', {
            stage: 'entity_resolution',
            status: 'llm_matching_start',
            mention,
            entityType,
            candidateCount: llmCandidates.length,
            totalAliasesLoaded: llmCandidates.reduce((sum, c) => sum + c.aliases.length, 0),
            signalId
          });

          // Use LLM to match
          const llmMatch = await this.llmMatcher.matchEntity(mention, llmCandidates, signalText);

          logger.info('LLM entity match result', {
            stage: 'entity_resolution',
            status: 'llm_match_complete',
            mention,
            entityType,
            matchedEntityId: llmMatch.matchedEntityId,
            matchedEntityName: llmMatch.matchedEntityId ?
              llmCandidates.find(c => c.id === llmMatch.matchedEntityId)?.canonical_name : null,
            confidence: llmMatch.confidence,
            reasoning: llmMatch.reasoning,
            suggestedAliases: llmMatch.suggestedAliases,
            candidatesEvaluated: llmCandidates.length,
            signalId
          });

          // High confidence: auto-merge
          if (llmMatch.matchedEntityId && llmMatch.confidence >= 0.85) {
            // Add mention as alias
            await this.registryService.addAlias(llmMatch.matchedEntityId, mention);

            logger.info('Entity auto-merged (high confidence)', {
              stage: 'entity_resolution',
              status: 'success',
              method: 'llm_auto_merge',
              mention,
              entityType,
              resolvedEntityId: llmMatch.matchedEntityId,
              resolvedEntityName: llmCandidates.find(c => c.id === llmMatch.matchedEntityId)?.canonical_name,
              confidence: llmMatch.confidence,
              confidenceThreshold: 0.85,
              aliasAdded: mention,
              reasoning: llmMatch.reasoning,
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
                reasoning: llmMatch.reasoning,
                suggested_aliases: llmMatch.suggestedAliases
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
            const matchedCandidate = candidates.find(c => c.id === llmMatch.matchedEntityId);

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

            logger.info('Entity flagged for human review (medium confidence)', {
              stage: 'entity_resolution',
              status: 'success',
              method: 'llm_human_review',
              mention,
              entityType,
              resolvedEntityId: llmMatch.matchedEntityId,
              resolvedEntityName: matchedCandidate?.canonical_name,
              confidence: llmMatch.confidence,
              confidenceRange: '0.65-0.85',
              reasoning: llmMatch.reasoning,
              feedbackStatus: 'pending',
              elapsedMs: Date.now() - startTime,
              signalId
            });

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

          // Low confidence: create new entity
          logger.info('LLM match confidence too low, creating new entity', {
            stage: 'entity_resolution',
            status: 'low_confidence',
            mention,
            entityType,
            matchedEntityId: llmMatch.matchedEntityId,
            confidence: llmMatch.confidence,
            confidenceThreshold: 0.65,
            reasoning: llmMatch.reasoning,
            signalId
          });
        } else {
          logger.info('No candidates found for entity, creating new entity', {
            stage: 'entity_resolution',
            status: 'no_candidates',
            mention,
            entityType,
            signalId
          });
        }
      } catch (error: any) {
        logger.error('LLM entity matching failed, falling back to new entity creation', {
          stage: 'entity_resolution',
          status: 'error',
          method: 'llm_match_failed',
          error: error.message,
          stack: error.stack,
          mention,
          entityType,
          signalId,
          nextAction: 'create_new_entity'
        });
        // Fall through to create new entity as a safe fallback
        // This ensures the ingestion pipeline doesn't fail completely
      }
    } else {
      logger.debug('LLM matcher not available, creating new entity', {
        stage: 'entity_resolution',
        status: 'llm_unavailable',
        mention,
        entityType,
        signalId
      });
    }

    // Step 4: Create new entity (use LLM to extract canonical form)
    let canonicalName = mention;
    let canonicalFormMethod = 'raw_mention';

    if (this.llmMatcher) {
      try {
        canonicalName = await this.llmMatcher.extractCanonicalForm(mention, signalText);
        canonicalFormMethod = 'llm_extracted';
        logger.debug('LLM extracted canonical form', {
          stage: 'entity_resolution',
          status: 'canonical_form_extracted',
          mention,
          canonicalName,
          method: canonicalFormMethod,
          signalId
        });
      } catch (error: any) {
        logger.warn('LLM canonical form extraction failed, using raw mention as fallback', {
          stage: 'entity_resolution',
          status: 'warning',
          error: error.message,
          stack: error.stack,
          mention,
          fallbackCanonicalName: mention,
          signalId
        });
        canonicalName = mention;
        canonicalFormMethod = 'fallback_raw_mention';
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
      canonicalFormMethod,
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
}
