import * as dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(process.cwd(), '.env') });

async function parseMetadata(metadata: any): Promise<Record<string, any>> {
  if (!metadata) return {};
  if (typeof metadata === 'object' && !Array.isArray(metadata)) return metadata as Record<string, any>;
  if (typeof metadata === 'string') {
    try {
      return JSON.parse(metadata) as Record<string, any>;
    } catch {
      return {};
    }
  }
  return {};
}

async function main() {
  const { getDbPool, closeDbPool } = await import('../backend/db/connection');
  const { extractCustomerNames } = await import('../backend/utils/text_processing');
  const pool = getDbPool();

  const rows = (await pool.query('SELECT id, source, source_ref, content, metadata FROM signals')).rows;
  let updated = 0;

  for (const row of rows) {
    const metadata = await parseMetadata(row.metadata);
    const customers = extractCustomerNames(row.content || '', metadata);
    const threadTs = metadata.thread_ts;
    const messageTs = metadata.timestamp || metadata.ts;

    let finalCustomers = customers;
    if (threadTs && messageTs && threadTs !== messageTs) {
      const parent = await pool.query(
        'SELECT metadata FROM signals WHERE source = $1 AND source_ref = $2 LIMIT 1',
        [row.source, String(threadTs)]
      );
      if (parent.rows.length > 0) {
        const parentMeta = await parseMetadata(parent.rows[0].metadata);
        if (Array.isArray(parentMeta?.customers) && parentMeta.customers.length > 0) {
          finalCustomers = parentMeta.customers;
        } else {
          finalCustomers = [];
        }
      } else {
        finalCustomers = [];
      }
    }

    const nextMeta: Record<string, any> = { ...(metadata || {}) };
    if (finalCustomers.length > 0) {
      nextMeta.customers = finalCustomers;
    } else {
      delete nextMeta.customers;
    }

    await pool.query('UPDATE signals SET metadata = $1 WHERE id = $2', [
      JSON.stringify(nextMeta),
      row.id
    ]);
    updated += 1;
  }

  console.log('Updated signals:', updated);
  await closeDbPool();
}

main().catch(async (error) => {
  console.error('Recompute failed:', error);
  try {
    const { closeDbPool } = await import('../backend/db/connection');
    await closeDbPool();
  } catch {
    // ignore
  }
  process.exit(1);
});
