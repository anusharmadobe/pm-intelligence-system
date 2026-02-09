# Slack Setup for Standalone Thread Fetching

## Overview

The `fetch_all_thread_replies_complete.ts` script can now run standalone using Slack Web API. It will automatically try multiple methods:

1. **Cursor IDE MCP** (if running in Cursor IDE terminal)
2. **MCP Server** (if configured via environment variables)
3. **Slack Web API** (standalone mode - requires token)

## Quick Setup: Slack Web API (Recommended for Standalone)

### Step 1: Get a Slack Token

1. Go to https://api.slack.com/apps
2. Click "Create New App" → "From scratch"
3. Name it (e.g., "Thread Fetcher") and select your workspace
4. Go to "OAuth & Permissions" in the sidebar
5. Scroll to "Scopes" → "Bot Token Scopes" and add:
   - `channels:history` - View messages in public channels
   - `groups:history` - View messages in private channels
   - `im:history` - View messages in DMs
   - `mpim:history` - View messages in group DMs
6. Scroll up and click "Install to Workspace"
7. Copy the "Bot User OAuth Token" (starts with `xoxb-`)

### Step 2: Add Token to .env

Add to `/Users/anusharm/learn/PM_cursor_system/.env`:

```bash
SLACK_BOT_TOKEN=xoxb-your-token-here
```

Or use `SLACK_TOKEN` (same thing).

### Step 3: Run the Script

```bash
npm run fetch-all-thread-replies
```

## Alternative: MCP Server Setup

If you want to use an MCP server instead:

1. Set environment variables:
   ```bash
   MCP_SLACK_COMMAND=path/to/mcp/slack/server
   MCP_SLACK_ARGS='["--arg1", "value1"]'
   ```

2. The script will try to connect to the MCP server via stdio

## How It Works

The script tries methods in this order:

1. **Cursor IDE MCP** - Checks if `global.mcp_Slack_slack_get_thread_replies` exists
2. **MCP Server** - Connects via MCP SDK if `MCP_SLACK_COMMAND` is set
3. **Slack Web API** - Uses `@slack/web-api` with your token

## Troubleshooting

### "Slack token not found"
- Add `SLACK_BOT_TOKEN` to your `.env` file
- Get token from https://api.slack.com/apps

### "Failed to fetch thread replies"
- Check your token has the required scopes
- Verify you have access to channel `C04D195JVGS`
- Check token hasn't expired

### "MCP connection failed"
- This is normal if you're using Slack Web API
- The script will automatically fall back to Web API

## Required Slack Permissions

- `channels:history` - Read public channel messages
- `groups:history` - Read private channel messages  
- `im:history` - Read direct messages
- `mpim:history` - Read group direct messages

## Security Note

Never commit your Slack token to git! It's in `.env` which should be in `.gitignore`.
