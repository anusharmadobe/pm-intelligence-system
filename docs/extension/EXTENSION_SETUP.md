# Cursor Extension Setup Guide

## Why Commands Don't Appear

The PM Intelligence extension is archived in `backup/cursor_extension/`. Cursor extensions need to be:

1. **Built** (compiled from TypeScript)
2. **Installed** (loaded by Cursor IDE)
3. **Activated** (registered with Cursor)

## Quick Solution: Use Scripts Instead

Since the extension isn't installed, you can use the direct scripts instead:

### Option 1: Direct Script (Recommended)

```bash
# Ingest messages from channel C04D195JVGS (fetches 1000 messages)
npm run ingest-channel-c04d195jvgs
```

This script will:
- Try to use Slack MCP if available
- Fetch up to 1000 messages
- Ingest them as signals

### Option 2: Install Extension (Advanced)

To make the extension commands appear in Cursor:

1. **Build the extension:**
   ```bash
   cd backup/cursor_extension/cursor_extension
   npm install
   npm run compile  # or tsc if you have TypeScript installed globally
   ```

2. **Install in Cursor:**
   - Open Cursor IDE
   - Press `Cmd+Shift+P`
   - Type: "Extensions: Install from VSIX..." or "Developer: Install Extension from Location"
   - Select the `backup/cursor_extension/cursor_extension` folder
   - Reload Cursor

3. **Verify:**
   - Press `Cmd+Shift+P`
   - Type "PM Intelligence" - you should see all commands

**Note:** Cursor's extension system may differ from VS Code. The extension might need to be packaged differently or loaded via Cursor's specific extension mechanism.

## Alternative: Use Scripts Directly

All functionality is available via scripts:

```bash
# Ingest from channel (1000 messages)
npm run ingest-channel-c04d195jvgs

# Detect opportunities
curl -X POST http://localhost:3000/api/opportunities/detect/incremental

# List opportunities
npm run list-opps-c04d195jvgs

# Complete test
npm run ingest-and-test-c04d195jvgs
```

## Current Status

- ✅ All scripts updated to fetch 1000 messages
- ✅ Extension code exists but not installed
- ✅ Scripts work independently of extension
