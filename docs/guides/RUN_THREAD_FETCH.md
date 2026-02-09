# Run Thread Fetch Script (Option 2)

## Quick Start

**IMPORTANT**: This script MUST be run in **Cursor IDE's integrated terminal** because it requires MCP tools that are only available in Cursor IDE context.

### Steps:

1. **Open Cursor IDE**
2. **Open the integrated terminal** (View → Terminal or `` Ctrl+` ``)
3. **Navigate to project directory**:
   ```bash
   cd /Users/anusharm/learn/PM_cursor_system
   ```

4. **Run the script**:
   ```bash
   npm run fetch-all-thread-replies
   ```

   Or directly:
   ```bash
   npx ts-node scripts/fetch_all_thread_replies_complete.ts
   ```

## What It Does

- Fetches thread replies for **all 2561 threads** from `data/intermediate/thread_timestamps.json`
- Uses MCP tool `mcp_Slack_slack_get_thread_replies` (requires Cursor IDE)
- Saves progress incrementally to `data/intermediate/thread_replies_progress.json`
- Can be interrupted and resumed - it will skip already fetched threads
- Merges fetched replies with engagement data
- Creates output files:
  - `data/raw/slack/C04D195JVGS/customer_engagement_C04D195JVGS_complete.json`
  - `data/raw/slack/C04D195JVGS/customer_engagement_C04D195JVGS_complete.csv`

## Progress Tracking

The script saves progress every 10 threads. You can monitor progress:

```bash
# Check how many threads have been fetched
cat data/intermediate/thread_replies_progress.json | jq '.fetched | length'

# Check failed threads
cat data/intermediate/thread_replies_progress.json | jq '.failed | length'

# See last fetched index
cat data/intermediate/thread_replies_progress.json | jq '.lastFetchedIndex'
```

## Expected Runtime

- **Total threads**: 2561
- **Estimated time**: Several hours (due to rate limiting delays)
- **Progress saves**: Every 10 threads
- **Delay between fetches**: 200ms

## If Interrupted

Simply run the script again - it will automatically resume from where it left off by checking the progress file.

## Output

The script will show:
- Real-time progress: `[X/2561] Fetching thread...`
- Replies fetched per thread
- Progress saves every 10 threads
- Final summary with statistics

## Troubleshooting

### "Slack MCP thread function not available"
- **Solution**: Make sure you're running in Cursor IDE's terminal, not a regular terminal
- Verify MCP allowlist is configured (see `MCP_ALLOWLIST_CONFIGURATION.md`)

### Script stops/fails
- Check the error message
- Failed threads are tracked in progress file
- Re-run the script to continue from where it stopped

### Want to see live progress
- The script outputs to console in real-time
- You can also tail the progress file: `watch -n 1 'cat data/intermediate/thread_replies_progress.json | jq .fetched | length'`

## Background Execution

If you want to run it in the background in Cursor IDE terminal:

```bash
npm run fetch-all-thread-replies > data/intermediate/thread_fetch.log 2>&1 &
```

Then monitor with:
```bash
tail -f data/intermediate/thread_fetch.log
```

## Current Status

- **Threads to process**: 2561
- **Progress file**: `data/intermediate/thread_replies_progress.json` (created when script starts)
- **Engagement data**: `data/raw/slack/C04D195JVGS/customer_engagement_C04D195JVGS.json` (exists)

---

**Ready to run!** Just execute `npm run fetch-all-thread-replies` in Cursor IDE's terminal.
