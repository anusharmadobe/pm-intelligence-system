# Fetch and Ingest All Thread Replies

## Overview

This script fetches all thread replies from Slack channel `C04D195JVGS` and ingests them into the PM Intelligence System database.

## Prerequisites

1. **API Server Running**: The PM Intelligence API server must be running on `http://localhost:3000`
2. **MCP Tools Available**: Script must be run in Cursor IDE where Slack MCP tools are available
3. **Thread Timestamps File**: `data/intermediate/thread_timestamps.json` must exist with thread data

## Quick Start

### 1. Start the API Server

```bash
cd /Users/anusharm/learn/PM_cursor_system
npm start
```

The API server will start on `http://localhost:3000`

### 2. Run the Script

**Important**: This script MUST be run in Cursor IDE's terminal or via Cursor's script execution, as it requires MCP tools.

```bash
npm run fetch-and-ingest-threads
```

Or directly:

```bash
ts-node scripts/fetch_and_ingest_all_threads.ts
```

## What the Script Does

### Phase 1: Fetch Thread Replies
- Reads `data/intermediate/thread_timestamps.json` (contains ~2561 threads)
- For each thread, fetches all replies using `mcp_Slack_slack_get_thread_replies`
- Stores replies in progress file for resumption
- Saves progress every 10 threads

### Phase 2: Ingest Replies into Database
- For each fetched thread, ingests all replies via API (`POST /api/signals`)
- Skips empty messages and bot messages
- Handles duplicate errors gracefully
- Saves progress every 50 threads

## Progress Tracking

The script maintains progress in: `data/intermediate/thread_ingestion_progress.json`

This allows resuming if interrupted:
- Already fetched threads are skipped
- Already ingested threads are skipped
- Failed threads are tracked for retry

## Output

The script provides:
- Real-time progress updates
- Summary statistics
- Error reporting
- Progress file for resumption

## Expected Results

- **Total Threads**: ~2561
- **Estimated Replies**: Varies (depends on thread activity)
- **Processing Time**: Several hours (due to rate limiting and API delays)

## Rate Limiting

The script includes delays to avoid rate limiting:
- 200ms delay between thread fetches
- 50ms delay between API ingestion calls
- Batch saves every 10-50 threads

## Troubleshooting

### "Slack MCP thread function not available"
- Ensure you're running in Cursor IDE
- Check that Slack MCP is enabled in Cursor settings
- Verify MCP allowlist configuration

### "API server not running"
- Start the API server: `npm start`
- Check it's running: `curl http://localhost:3000/health`

### "Connection refused" or API errors
- Verify API server is running
- Check database connection
- Review API server logs

### Script interrupted
- Progress is saved automatically
- Simply re-run the script - it will resume from where it left off

## Files Created

- `data/intermediate/thread_ingestion_progress.json` - Progress tracking file
- Console output with detailed progress

## Monitoring Progress

You can check progress by reading the progress file:

```bash
cat data/intermediate/thread_ingestion_progress.json | jq '.fetched | length'
cat data/intermediate/thread_ingestion_progress.json | jq '.ingested | length'
cat data/intermediate/thread_ingestion_progress.json | jq '.totalRepliesIngested'
```

## Next Steps After Completion

1. Verify ingestion: Check database for ingested signals
2. Run opportunity detection: `POST /api/opportunities/detect/incremental`
3. Analyze results: Review opportunities and insights
