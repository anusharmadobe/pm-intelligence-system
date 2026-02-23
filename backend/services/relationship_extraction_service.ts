import { EntityResolutionService } from './entity_resolution_service';
import { logger } from '../utils/logger';

export interface RelationshipExtractionInput {
  signalId: string;
  signalText: string;
  extraction: {
    entities: {
      customers: string[];
      features: string[];
      issues: string[];
      themes: string[];
      stakeholders?: string[];
    };
    relationships?: Array<{ from: string; to: string; type: string }>;
  };
  resolvedEntities?: Array<{ id: string; type: string; name: string }>;
}

export interface ResolvedRelationship {
  fromId: string;
  fromType: string;
  toId: string;
  toType: string;
  relationship: string;
}

export class RelationshipExtractionService {
  private resolver = new EntityResolutionService();

  async extractRelationships(input: RelationshipExtractionInput): Promise<ResolvedRelationship[]> {
    const { signalId, signalText, extraction, resolvedEntities = [] } = input;
    const startTime = Date.now();
    const output: ResolvedRelationship[] = [];
    const seen = new Set<string>();
    const resolutionCache = new Map<string, Promise<{ entity_id: string }>>();
    let skippedSelfRefs = 0;
    let skippedDuplicates = 0;
    let preResolvedCacheHits = 0;

    // Seed cache from already resolved entities from the prior stage.
    for (const resolved of resolvedEntities) {
      if (!resolved?.id || !resolved?.type || !resolved?.name) continue;
      const key = `${resolved.type}:${resolved.name}`.toLowerCase();
      if (!resolutionCache.has(key)) {
        resolutionCache.set(key, Promise.resolve({ entity_id: resolved.id }));
      }
    }

    logger.debug('Relationship extraction start', {
      stage: 'relationship_extraction',
      status: 'start',
      signalId,
      entityCounts: {
        customers: extraction.entities.customers?.length || 0,
        features: extraction.entities.features?.length || 0,
        issues: extraction.entities.issues?.length || 0,
        themes: extraction.entities.themes?.length || 0,
        stakeholders: extraction.entities.stakeholders?.length || 0
      },
      explicitRelationships: extraction.relationships?.length || 0
    });

    const resolveEntityCached = async (mention: string, entityType: string) => {
      const key = `${entityType}:${mention}`.toLowerCase();
      let pending = resolutionCache.get(key);
      if (!pending) {
        pending = this.resolver
          .resolveEntityMention({
            mention,
            entityType,
            signalId,
            signalText
          })
          .catch((error) => {
            // Avoid permanently caching failed lookups.
            resolutionCache.delete(key);
            throw error;
          });
        resolutionCache.set(key, pending);
      } else {
        preResolvedCacheHits++;
      }
      return pending;
    };

    const addRelationship = async (
      fromName: string,
      fromType: string,
      toName: string,
      toType: string,
      relationship: string
    ) => {
      if (!fromName || !toName) return;
      const fromResolved = await resolveEntityCached(fromName, fromType);
      const toResolved = await resolveEntityCached(toName, toType);
      if (fromResolved.entity_id === toResolved.entity_id) {
        skippedSelfRefs++;
        return;
      }
      const key = `${fromResolved.entity_id}:${relationship}:${toResolved.entity_id}`;
      if (seen.has(key)) {
        skippedDuplicates++;
        return;
      }
      seen.add(key);
      output.push({
        fromId: fromResolved.entity_id,
        fromType,
        toId: toResolved.entity_id,
        toType,
        relationship
      });

      logger.debug('Relationship added', {
        stage: 'relationship_extraction',
        status: 'relationship_added',
        signalId,
        fromName,
        fromType,
        fromId: fromResolved.entity_id,
        toName,
        toType,
        toId: toResolved.entity_id,
        relationship
      });
    };

    const nameTypeLookup = new Map<string, string>();
    const addLookup = (names: string[], type: string) => {
      for (const name of names || []) {
        if (!nameTypeLookup.has(name)) nameTypeLookup.set(name, type);
      }
    };
    addLookup(extraction.entities.customers || [], 'customer');
    addLookup(extraction.entities.features || [], 'feature');
    addLookup(extraction.entities.issues || [], 'issue');
    addLookup(extraction.entities.themes || [], 'theme');
    addLookup(extraction.entities.stakeholders || [], 'stakeholder');

    for (const rel of extraction.relationships || []) {
      const fromType = nameTypeLookup.get(rel.from);
      const toType = nameTypeLookup.get(rel.to);
      if (!fromType || !toType) continue;
      await addRelationship(rel.from, fromType, rel.to, toType, rel.type || 'RELATES_TO');
    }

    for (const customer of extraction.entities.customers || []) {
      for (const feature of extraction.entities.features || []) {
        await addRelationship(customer, 'customer', feature, 'feature', 'USES');
      }
      for (const issue of extraction.entities.issues || []) {
        await addRelationship(customer, 'customer', issue, 'issue', 'HAS_ISSUE');
      }
    }

    for (const issue of extraction.entities.issues || []) {
      for (const feature of extraction.entities.features || []) {
        await addRelationship(issue, 'issue', feature, 'feature', 'RELATES_TO');
      }
    }

    for (const stakeholder of extraction.entities.stakeholders || []) {
      for (const customer of extraction.entities.customers || []) {
        await addRelationship(stakeholder, 'stakeholder', customer, 'customer', 'ASSOCIATED_WITH');
      }
    }

    logger.info('Relationship extraction complete', {
      stage: 'relationship_extraction',
      status: 'success',
      signalId,
      totalRelationships: output.length,
      skippedSelfReferences: skippedSelfRefs,
      skippedDuplicates: skippedDuplicates,
      relationshipTypes: {
        explicit: extraction.relationships?.length || 0,
        inferred: output.length - (extraction.relationships?.length || 0)
      },
      uniqueEntityResolutions: resolutionCache.size,
      preResolvedCacheHits,
      elapsedMs: Date.now() - startTime
    });

    return output;
  }
}
