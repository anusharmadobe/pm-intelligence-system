## Community Forum Ingestion (V2)

Run the V2 ingestion pipeline against community forum dumps with deduping, checkpoints, and replay.

### Basic usage

```
npx ts-node scripts/ingest_community_forums_v2.ts
```

### Common flags

- `--limit=<n>`: Limit number of threads ingested
- `--batch-size=<n>`: Number of signals per batch (default: 50)
- `--delay-ms=<n>`: Sleep between batches (default: 0)
- `--skip-short`: Skip short content based on `--min-length`
- `--min-length=<n>`: Minimum content length (default: 50)
- `--skip-boilerplate`: Skip boilerplate messages (thanks, translate, etc.)
- `--resume`: Resume from the last cursor checkpoint
- `--reset`: Reset cursor checkpoint before ingesting
- `--replay-failures`: Replay failed signals from `failed_signal_attempts`
- `--replay-limit=<n>`: Limit number of replayed failures

### Examples

```
# Ingest 100 threads with dedup + boilerplate filtering
npx ts-node scripts/ingest_community_forums_v2.ts --limit=100 --skip-boilerplate

# Resume a previously interrupted run
npx ts-node scripts/ingest_community_forums_v2.ts --resume

# Replay only the first 50 failed signals
npx ts-node scripts/ingest_community_forums_v2.ts --replay-failures --replay-limit=50
```
