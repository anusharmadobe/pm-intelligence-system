#!/usr/bin/env ts-node
import 'dotenv/config';

import { closeDbPool } from '../backend/db/connection';
import { getSignalsWithoutEmbeddings, queueSignalForEmbedding } from '../backend/services/embedding_service';

async function main() {
  const limitArg = process.argv.find((arg) => arg.startsWith('--limit='));
  const limit = limitArg ? Number.parseInt(limitArg.split('=')[1], 10) : 500;
  const priorityArg = process.argv.find((arg) => arg.startsWith('--priority='));
  const priority = priorityArg ? Number.parseInt(priorityArg.split('=')[1], 10) : 4;

  if (!Number.isFinite(limit) || limit <= 0) {
    throw new Error(`Invalid --limit value: ${limitArg}`);
  }
  if (!Number.isFinite(priority) || priority <= 0) {
    throw new Error(`Invalid --priority value: ${priorityArg}`);
  }

  const signals = await getSignalsWithoutEmbeddings(limit);
  for (const signal of signals) {
    await queueSignalForEmbedding(signal.id, priority);
  }

  console.log(`Queued ${signals.length} signal(s) missing embeddings with priority ${priority}.`);
}

main()
  .catch((error) => {
    console.error('Failed to requeue missing embeddings:', error);
    process.exit(1);
  })
  .finally(async () => {
    await closeDbPool();
  });
