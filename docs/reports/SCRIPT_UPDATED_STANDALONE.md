# Script Updated: Now Runs Standalone! ✅

## What Changed

The `fetch_all_thread_replies_complete.ts` script has been updated to run **standalone** without requiring Cursor IDE's MCP tools.

## How It Works Now

The script tries **3 methods** in order:

1. **Cursor IDE MCP** (if available)
   - Checks for `global.mcp_Slack_slack_get_thread_replies`
   - Works if running in Cursor IDE terminal

2. **MCP Server** (if configured)
   - Connects via MCP SDK to an external MCP server
   - Configure via `MCP_SLACK_COMMAND` environment variable

3. **Slack Web API** (standalone - **NEW!**)
   - Uses `@slack/web-api` package
   - Requires `SLACK_BOT_TOKEN` environment variable
   - Works in any terminal, no Cursor IDE needed!

## Quick Start: Standalone Mode

### Step 1: Get Slack Token

1. Go to https://api.slack.com/apps
2. Create a new app or use existing
3. Go to "OAuth & Permissions"
4. Add bot scopes:
   - `channels:history`
   - `groups:history`
   - `im:history`
   - `mpim:history`
5. Install to workspace
6. Copy the "Bot User OAuth Token" (starts with `xoxb-`)

### Step 2: Add to .env

Add to `.env` file:

```bash
SLACK_BOT_TOKEN=xoxb-your-token-here
```

### Step 3: Run!

```bash
npm run fetch-all-thread-replies
```

That's it! The script will now work in **any terminal**, not just Cursor IDE.

## What Was Installed

- ✅ `@slack/web-api` - Slack Web API SDK
- ✅ `@modelcontextprotocol/sdk` - MCP SDK (for MCP server support)
- ✅ `zod` - Required by MCP SDK

## Benefits

- ✅ **Standalone**: No Cursor IDE required
- ✅ **Flexible**: Tries MCP first, falls back to Web API
- ✅ **Same functionality**: Fetches all 512 threads and merges with engagement data
- ✅ **Progress tracking**: Still saves progress every 10 threads
- ✅ **Resumable**: Can still resume if interrupted

## Error Messages

If you see:
- **"Slack token not found"** → Add `SLACK_BOT_TOKEN` to `.env`
- **"Slack Web API SDK not available"** → Run `npm install @slack/web-api`
- **"Failed to fetch thread replies"** → Check token permissions and channel access

## Files Updated

- ✅ `scripts/fetch_all_thread_replies_complete.ts` - Updated with standalone support
- ✅ `SLACK_SETUP.md` - Detailed setup instructions
- ✅ `package.json` - Added dependencies

## Testing

Try running it now:

```bash
npm run fetch-all-thread-replies
```

If you have `SLACK_BOT_TOKEN` set, it will work! If not, you'll get a helpful error message with setup instructions.

---

**The script is now ready to run standalone!** 🎉
