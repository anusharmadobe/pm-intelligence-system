import * as dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(process.cwd(), '.env') });

async function main() {
  const { getDbPool, closeDbPool } = await import('../backend/db/connection');
  const pool = getDbPool();

  const testSignals = await pool.query(
    `SELECT id FROM signals
     WHERE (metadata->>'channel') = $1
        OR content ILIKE $2
        OR content ILIKE $3`,
    ['anusharm-test-channel', '%test message%', '%test signal%']
  );
  const signalIds = testSignals.rows.map((row: any) => row.id);

  if (signalIds.length === 0) {
    console.log('No test signals found.');
    await closeDbPool();
    return;
  }

  await pool.query('BEGIN');

  const oppIdsRes = await pool.query(
    'SELECT DISTINCT opportunity_id FROM opportunity_signals WHERE signal_id = ANY($1)',
    [signalIds]
  );
  const oppIds = oppIdsRes.rows.map((row: any) => row.opportunity_id);

  await pool.query('DELETE FROM opportunity_signals WHERE signal_id = ANY($1)', [signalIds]);
  await pool.query('DELETE FROM signals WHERE id = ANY($1)', [signalIds]);

  if (oppIds.length > 0) {
    // Remove empty opportunities and related judgments/artifacts
    await pool.query(
      `DELETE FROM artifacts WHERE judgment_id IN (
         SELECT id FROM judgments WHERE opportunity_id = ANY($1)
       )`,
      [oppIds]
    );
    await pool.query('DELETE FROM judgments WHERE opportunity_id = ANY($1)', [oppIds]);
    await pool.query(
      `DELETE FROM opportunities
       WHERE id = ANY($1)
         AND NOT EXISTS (
           SELECT 1 FROM opportunity_signals os WHERE os.opportunity_id = opportunities.id
         )`,
      [oppIds]
    );
  }

  await pool.query('COMMIT');

  console.log('Deleted test signals:', signalIds.length);
  console.log('Affected opportunities:', oppIds.length);

  await closeDbPool();
}

main().catch(async (error) => {
  console.error('Cleanup failed:', error);
  try {
    const { closeDbPool } = await import('../backend/db/connection');
    await closeDbPool();
  } catch {
    // ignore
  }
  process.exit(1);
});
