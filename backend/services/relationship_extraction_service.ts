import { EntityResolutionService } from './entity_resolution_service';

export interface RelationshipExtractionInput {
  signalId: string;
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
    const { signalId, extraction } = input;
    const output: ResolvedRelationship[] = [];
    const seen = new Set<string>();

    const addRelationship = async (
      fromName: string,
      fromType: string,
      toName: string,
      toType: string,
      relationship: string
    ) => {
      if (!fromName || !toName) return;
      const fromResolved = await this.resolver.resolveEntityMention({
        mention: fromName,
        entityType: fromType,
        signalId
      });
      const toResolved = await this.resolver.resolveEntityMention({
        mention: toName,
        entityType: toType,
        signalId
      });
      if (fromResolved.entity_id === toResolved.entity_id) return;
      const key = `${fromResolved.entity_id}:${relationship}:${toResolved.entity_id}`;
      if (seen.has(key)) return;
      seen.add(key);
      output.push({
        fromId: fromResolved.entity_id,
        fromType,
        toId: toResolved.entity_id,
        toType,
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

    return output;
  }
}
