import { promises as fs } from 'fs';
import path from 'path';
import { getDbPool } from '../../backend/db/connection';
import { logger } from '../../backend/utils/logger';

async function run() {
  const pool = getDbPool();

  const aliasConflicts = await pool.query(
    `SELECT alias_normalized, COUNT(DISTINCT canonical_entity_id)::int AS entity_count
     FROM entity_aliases
     WHERE is_active = true
     GROUP BY alias_normalized
     HAVING COUNT(DISTINCT canonical_entity_id) > 1`
  );

  const orphanEntities = await pool.query(
    `SELECT er.id, er.canonical_name, er.entity_type
     FROM entity_registry er
     LEFT JOIN entity_resolution_log erl ON erl.resolved_to_entity_id = er.id
     WHERE er.is_active = true
     GROUP BY er.id
     HAVING MAX(erl.created_at) IS NULL
        OR MAX(erl.created_at) < NOW() - INTERVAL '30 days'`
  );

  const report = {
    generated_at: new Date().toISOString(),
    alias_conflicts: aliasConflicts.rows,
    orphan_entities: orphanEntities.rows
  };

  const outputDir = path.join(process.cwd(), 'exports');
  await fs.mkdir(outputDir, { recursive: true });
  const filePath = path.join(outputDir, `data_quality_report_${Date.now()}.json`);
  await fs.writeFile(filePath, JSON.stringify(report, null, 2), 'utf8');
  logger.info('Data quality report written', { filePath });
}

run().catch((error) => {
  logger.error('Data quality agent failed', { error });
  process.exit(1);
});
