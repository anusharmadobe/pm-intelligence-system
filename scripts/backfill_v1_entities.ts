import { getDbPool } from '../backend/db/connection';
import { EntityRegistryService } from '../backend/services/entity_registry_service';
import { FeedbackService } from '../backend/services/feedback_service';
import { Neo4jSyncService } from '../backend/services/neo4j_sync_service';
import { logger } from '../backend/utils/logger';

type Extraction = {
  entities?: {
    customers?: string[];
    features?: string[];
    issues?: string[];
    themes?: string[];
    stakeholders?: string[];
  };
};

const ENTITY_FIELDS: Array<{
  key: keyof NonNullable<Extraction['entities']>;
  type: string;
}> = [
  { key: 'customers', type: 'customer' },
  { key: 'features', type: 'feature' },
  { key: 'issues', type: 'issue' },
  { key: 'themes', type: 'theme' },
  { key: 'stakeholders', type: 'stakeholder' }
];

function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function main() {
  const pool = getDbPool();
  const registryService = new EntityRegistryService();
  const feedbackService = new FeedbackService();
  const neo4jService = new Neo4jSyncService();

  const result = await pool.query('SELECT signal_id, extraction FROM signal_extractions');

  const entityMap = new Map<string, { type: string; canonicalName: string; variants: Set<string> }>();

  for (const row of result.rows) {
    const extraction: Extraction =
      typeof row.extraction === 'string' ? JSON.parse(row.extraction) : row.extraction;
    if (!extraction?.entities) continue;

    for (const field of ENTITY_FIELDS) {
      const values = extraction.entities?.[field.key] || [];
      for (const rawName of values) {
        const name = (rawName || '').trim();
        if (name.length < 2) continue;
        const normalized = normalizeName(name);
        if (!normalized) continue;
        const key = `${field.type}:${normalized}`;
        const entry = entityMap.get(key);
        if (!entry) {
          entityMap.set(key, { type: field.type, canonicalName: name, variants: new Set([name]) });
        } else {
          entry.variants.add(name);
        }
      }
    }
  }

  let created = 0;
  let existing = 0;
  let aliasesAdded = 0;
  let processed = 0;

  for (const entry of entityMap.values()) {
    processed += 1;
    let entity =
      (await registryService.findByAlias(entry.canonicalName)) ||
      (await registryService.findByName(entry.canonicalName));

    if (!entity) {
      entity = await registryService.createEntity({
        entityType: entry.type,
        canonicalName: entry.canonicalName,
        createdBy: 'system'
      });
      created += 1;
    } else {
      existing += 1;
    }

    for (const variant of entry.variants) {
      if (variant !== entity.canonical_name) {
        await feedbackService.addAlias(entity.id, variant, 'backfill');
        aliasesAdded += 1;
      }
    }

    await neo4jService.syncEntity({
      id: entity.id,
      entity_type: entry.type,
      canonical_name: entity.canonical_name
    });

    if (processed % 200 === 0) {
      logger.info('Backfill progress', { processed, created, existing, aliasesAdded });
    }
  }

  logger.info('Backfill complete', { total: processed, created, existing, aliasesAdded });
}

main().catch((error) => {
  logger.error('Backfill failed', { error });
  process.exit(1);
});
