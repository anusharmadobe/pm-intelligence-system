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

    // Step 1: Exact alias match (fast path)
    const aliasMatch = await this.registryService.findByAlias(mention);
    if (aliasMatch) {
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

        if (candidates.length > 0) {
          // Convert to LLM matcher format
          const llmCandidates: CanonicalEntity[] = candidates.map(c => ({
            id: c.id,
            canonical_name: c.canonical_name,
            entity_type: c.entity_type,
            aliases: [] // TODO: Fetch aliases from entity_aliases table
          }));

          // Use LLM to match
          const llmMatch = await this.llmMatcher.matchEntity(mention, llmCandidates, signalText);

          logger.debug('LLM entity match result', {
            mention,
            matchedEntityId: llmMatch.matchedEntityId,
            confidence: llmMatch.confidence,
            reasoning: llmMatch.reasoning
          });

          // High confidence: auto-merge
          if (llmMatch.matchedEntityId && llmMatch.confidence >= 0.85) {
            // Add mention as alias
            await this.registryService.addAlias(llmMatch.matchedEntityId, mention);

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
            await pool.query(
              `INSERT INTO feedback_log
                (id, feedback_type, system_output, system_confidence, status, signals_affected, entities_affected)
               VALUES (gen_random_uuid(), 'entity_merge', $1, $2, 'pending', 1, 1)`,
              [
                JSON.stringify({
                  entity_a: mention,
                  entity_b: candidates.find(c => c.id === llmMatch.matchedEntityId)?.canonical_name || '',
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
        logger.error('LLM entity matching failed, falling back to embedding-based matching', {
          error: error.message,
          mention
        });
        // Fall through to embedding-based matching
      }
    }

    // Step 4: Fallback to embedding-based matching (if LLM failed or not available)
    const candidates = await this.registryService.search(mention, 5);
    if (candidates.length > 0) {
      const mentionEmbedding = await this.getMentionEmbedding(mention);
      let bestCandidate = null as typeof candidates[number] | null;
      let bestScore = 0;
      let bestDetails: Record<string, unknown> | undefined;

      for (const candidate of candidates) {
        const candidateEmbedding = await this.getOrCreateEntityEmbedding(
          candidate.id,
          candidate.canonical_name
        );
        const embeddingSimilarity =
          mentionEmbedding && candidateEmbedding ? cosineSimilarity(mentionEmbedding, candidateEmbedding) : null;
        const score = this.matchingService.score({
          nameA: mention,
          nameB: candidate.canonical_name,
          embeddingSimilarity,
          typeMatch: candidate.entity_type === entityType
        });
        if (score.composite_score > bestScore) {
          bestScore = score.composite_score;
          bestCandidate = candidate;
          bestDetails = score as unknown as Record<string, unknown>;
        }
      }

      // Apply thresholds (using config thresholds)
      if (bestCandidate && bestScore >= config.entityResolution.autoMergeThreshold) {
        await this.logResolution({
          mention,
          entityType,
          signalId,
          resolutionResult: 'auto_merged',
          resolvedToEntityId: bestCandidate.id,
          confidence: bestScore,
          matchDetails: { ...bestDetails, method: 'embedding' }
        });
        return {
          status: 'auto_merged',
          entity_id: bestCandidate.id,
          confidence: bestScore,
          match_details: { ...bestDetails, method: 'embedding' }
        };
      }

      if (bestCandidate && bestScore >= config.entityResolution.humanReviewThreshold) {
        const pool = getDbPool();
        await pool.query(
          `INSERT INTO feedback_log
            (id, feedback_type, system_output, system_confidence, status, signals_affected, entities_affected)
           VALUES (gen_random_uuid(), 'entity_merge', $1, $2, 'pending', 1, 1)`,
          [
            JSON.stringify({
              entity_a: mention,
              entity_b: bestCandidate.canonical_name,
              entity_type: entityType,
              candidate_entity_id: bestCandidate.id,
              match_details: { ...bestDetails, method: 'embedding' }
            }),
            bestScore
          ]
        );

        await this.logResolution({
          mention,
          entityType,
          signalId,
          resolutionResult: 'human_review',
          resolvedToEntityId: bestCandidate.id,
          confidence: bestScore,
          matchDetails: { ...bestDetails, method: 'embedding' }
        });

        return {
          status: 'human_review',
          entity_id: bestCandidate.id,
          confidence: bestScore,
          match_details: { ...bestDetails, method: 'embedding' }
        };
      }
    }

    // Step 5: Create new entity (use LLM to extract canonical form)
    let canonicalName = mention;
    if (this.llmMatcher) {
      try {
        canonicalName = await this.llmMatcher.extractCanonicalForm(mention, signalText);
        logger.debug('LLM extracted canonical form', { mention, canonicalName });
      } catch (error: any) {
        logger.warn('LLM canonical form extraction failed, using raw mention', {
          error: error.message,
          mention
        });
        canonicalName = mention;
      }
    }

    const created = await this.registryService.createEntity({
      entityType,
      canonicalName
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
