import { EntityRegistryService } from '../../backend/services/entity_registry_service';
import { getDbPool } from '../../backend/db/connection';
import { logger } from '../../backend/utils/logger';

function parseArgs() {
  const args = process.argv.slice(2);
  const getArg = (name: string) => {
    const idx = args.indexOf(`--${name}`);
    if (idx !== -1 && args[idx + 1]) return args[idx + 1];
    return undefined;
  };
  return {
    name: getArg('name'),
    scope: getArg('scope')
  };
}

async function run() {
  const { name, scope } = parseArgs();
  if (!name || !scope) {
    throw new Error('Usage: --name "Stakeholder Name" --scope \'{"customers":["Acme"]}\'');
  }

  let scopeJson: Record<string, unknown>;
  try {
    scopeJson = JSON.parse(scope);
  } catch {
    throw new Error('scope must be valid JSON');
  }

  const pool = getDbPool();
  const existing = await pool.query(
    `SELECT id FROM entity_registry
     WHERE canonical_name ILIKE $1 AND entity_type = 'stakeholder'
     LIMIT 1`,
    [name]
  );

  if (existing.rows[0]) {
    await pool.query(
      `UPDATE entity_registry
       SET metadata = jsonb_set(COALESCE(metadata, '{}'::jsonb), '{access_scope}', $2::jsonb),
           updated_at = NOW()
       WHERE id = $1`,
      [existing.rows[0].id, JSON.stringify(scopeJson)]
    );
    logger.info('Updated stakeholder access scope', { name });
    return;
  }

  const registry = new EntityRegistryService();
  await registry.createEntity({
    entityType: 'stakeholder',
    canonicalName: name,
    metadata: { access_scope: scopeJson },
    createdBy: 'agent'
  });
  logger.info('Created stakeholder access scope', { name });
}

run().catch((error) => {
  logger.error('Stakeholder access agent failed', { error });
  process.exit(1);
});
