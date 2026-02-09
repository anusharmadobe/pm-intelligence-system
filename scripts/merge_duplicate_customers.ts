import { getDbPool } from '../backend/db/connection';
import { fuzzyCustomerMatch, resolveToCanonicalName } from '../backend/utils/text_processing';

type CustomerRow = { id: string; name: string };

type CustomerGroup = {
  canonicalName: string;
  members: CustomerRow[];
};

function findGroup(groups: CustomerGroup[], customer: CustomerRow): CustomerGroup | null {
  const resolved = resolveToCanonicalName(customer.name) || customer.name;
  for (const group of groups) {
    if (fuzzyCustomerMatch(group.canonicalName, resolved)) {
      return group;
    }
    if (group.members.some(member => fuzzyCustomerMatch(member.name, resolved))) {
      return group;
    }
  }
  return null;
}

function pickCanonicalMember(group: CustomerGroup): { canonicalName: string; canonical: CustomerRow } {
  const canonicalName = resolveToCanonicalName(group.canonicalName) || group.canonicalName;
  const canonical =
    group.members.find(member => member.name.toLowerCase() === canonicalName.toLowerCase()) ||
    group.members[0];
  return { canonicalName, canonical };
}

async function mergeDuplicateCustomers(): Promise<void> {
  const pool = getDbPool();
  const result = await pool.query<CustomerRow>('SELECT id, name FROM customers ORDER BY name');
  const nameIndex = new Map<string, CustomerRow>();
  result.rows.forEach(row => nameIndex.set(row.name.toLowerCase(), row));

  const groups: CustomerGroup[] = [];
  for (const row of result.rows) {
    const group = findGroup(groups, row);
    if (group) {
      group.members.push(row);
    } else {
      groups.push({
        canonicalName: resolveToCanonicalName(row.name) || row.name,
        members: [row]
      });
    }
  }

  let mergedGroups = 0;
  let mergedCustomers = 0;

  for (const group of groups) {
    if (group.members.length <= 1) continue;
    mergedGroups += 1;

    const { canonicalName, canonical: initialCanonical } = pickCanonicalMember(group);
    const canonicalRow = await pool.query<CustomerRow>(
      'SELECT id, name FROM customers WHERE LOWER(name) = LOWER($1) LIMIT 1',
      [canonicalName]
    );
    const canonical =
      canonicalRow.rows.length > 0 && canonicalRow.rows[0].id !== initialCanonical.id
        ? canonicalRow.rows[0]
        : initialCanonical;
    const duplicates = group.members.filter(member => member.id !== canonical.id);

    await pool.query('BEGIN');
    try {
      const conflictCheck = await pool.query<{ id: string }>(
        'SELECT id FROM customers WHERE LOWER(name) = LOWER($1) AND id <> $2 LIMIT 1',
        [canonicalName, canonical.id]
      );
      if (conflictCheck.rows.length === 0 && canonical.name !== canonicalName) {
        await pool.query('UPDATE customers SET name = $1 WHERE id = $2', [canonicalName, canonical.id]);
        nameIndex.set(canonicalName.toLowerCase(), { id: canonical.id, name: canonicalName });
      }

      for (const duplicate of duplicates) {
        await pool.query(
          `DELETE FROM signal_entities se
           USING signal_entities existing
           WHERE se.entity_type = 'customer'
             AND existing.entity_type = 'customer'
             AND se.signal_id = existing.signal_id
             AND se.entity_id = $1
             AND existing.entity_id = $2`,
          [duplicate.id, canonical.id]
        );

        await pool.query(
          `UPDATE signal_entities
           SET entity_id = $1
           WHERE entity_type = 'customer' AND entity_id = $2`,
          [canonical.id, duplicate.id]
        );

        await pool.query(
          `DELETE FROM customer_feature_usage cfu
           USING customer_feature_usage existing
           WHERE cfu.feature_id = existing.feature_id
             AND cfu.customer_id = $1
             AND existing.customer_id = $2`,
          [duplicate.id, canonical.id]
        );

        await pool.query(
          'UPDATE customer_feature_usage SET customer_id = $1 WHERE customer_id = $2',
          [canonical.id, duplicate.id]
        );

        await pool.query(
          `DELETE FROM customer_issue_reports cir
           USING customer_issue_reports existing
           WHERE cir.issue_id = existing.issue_id
             AND cir.evidence_signal_id = existing.evidence_signal_id
             AND cir.customer_id = $1
             AND existing.customer_id = $2`,
          [duplicate.id, canonical.id]
        );

        await pool.query(
          'UPDATE customer_issue_reports SET customer_id = $1 WHERE customer_id = $2',
          [canonical.id, duplicate.id]
        );

        await pool.query('UPDATE slack_users SET customer_id = $1 WHERE customer_id = $2', [
          canonical.id,
          duplicate.id
        ]);

        await pool.query('DELETE FROM customer_embeddings WHERE customer_id = $1', [duplicate.id]);
        await pool.query(
          "DELETE FROM embedding_queue WHERE entity_type = 'customer' AND entity_id = $1",
          [duplicate.id]
        );

        await pool.query('DELETE FROM customers WHERE id = $1', [duplicate.id]);
        mergedCustomers += 1;
      }

      await pool.query('COMMIT');
    } catch (error) {
      await pool.query('ROLLBACK');
      throw error;
    }
  }

  console.log(`Merged ${mergedCustomers} duplicate customers across ${mergedGroups} groups.`);
}

mergeDuplicateCustomers()
  .catch(error => {
    console.error('Failed to merge duplicate customers:', error);
    process.exitCode = 1;
  })
  .finally(() => {
    const pool = getDbPool();
    pool.end().catch(() => undefined);
  });
