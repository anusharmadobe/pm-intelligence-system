# Slack MCP Standalone Setup

## Overview

The script now uses **Slack MCP only** (no Web API). It connects to the same Slack MCP server that Cursor uses.

## How It Works

1. **First**: Tries to use Cursor IDE's injected MCP functions (if running in Cursor terminal)
2. **Then**: Connects to Slack MCP server using the same configuration Cursor uses:
   - Command: `npx`
   - Args: `["-y", "@modelcontextprotocol/server-slack"]`
   - Uses environment variables for credentials

## Required Setup

### Step 1: Get Slack Bot Token

1. Go to https://api.slack.com/apps
2. Create a new app or use existing
3. Go to "OAuth & Permissions"
4. Add bot scopes:
   - `channels:history` - View messages in public channels
   - `channels:read` - View channel information
   - `users:read` - View users
   - `users.profile:read` - View user profiles
5. Install to workspace
6. Copy the "Bot User OAuth Token" (starts with `xoxb-`)

### Step 2: Get Slack Team ID (Optional but Recommended)

1. In Slack, click on your workspace name
2. Go to "Settings & administration" → "Workspace settings"
3. The Team ID is shown at the bottom (starts with `T`)

### Step 3: Add to .env

Add to `.env` file:

```bash
SLACK_BOT_TOKEN=xoxb-your-token-here
SLACK_TEAM_ID=T12345678  # Optional but recommended
```

### Step 4: Run

```bash
npm run fetch-all-thread-replies
```

## How It Connects

The script connects to the Slack MCP server using:

```javascript
npx -y @modelcontextprotocol/server-slack
```

This is the **same MCP server** that Cursor uses, so you get:
- ✅ Same authentication
- ✅ Same API
- ✅ Same rate limits
- ✅ Same functionality

## Environment Variables

- `SLACK_BOT_TOKEN` (required) - Your Slack bot token
- `SLACK_TEAM_ID` (optional) - Your workspace team ID

## Troubleshooting

### "Slack bot token not found"
- Add `SLACK_BOT_TOKEN` to your `.env` file
- Get token from https://api.slack.com/apps

### "Failed to connect to Slack MCP server"
- Check your internet connection (needs to download MCP server)
- Verify `SLACK_BOT_TOKEN` is correct
- Make sure Node.js and npm are installed
- Check token hasn't expired

### "MCP tool call failed"
- Verify token has required scopes
- Check you have access to channel `C04D195JVGS`
- Try running in Cursor IDE terminal first to test

## Benefits

- ✅ Uses same MCP server as Cursor
- ✅ No Web API fallback (pure MCP)
- ✅ Consistent behavior
- ✅ Works standalone (no Cursor IDE required)

---

**The script now uses Slack MCP exclusively!** 🎉
