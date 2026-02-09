# Summary: Extension Issue & Updated Limits

## ✅ Completed: Updated All Limits to 1000 Messages

All channel ingestion scripts now fetch **1000 messages** by default:

- ✅ `scripts/ingest_channel_c04d195jvgs.ts` - **1000 messages**
- ✅ `scripts/ingest_and_test_c04d195jvgs.ts` - **1000 messages**
- ✅ `scripts/complete_test_c04d195jvgs.ts` - **1000 messages**
- ✅ `scripts/test_channel_c04d195jvgs_real.ts` - **1000 messages**
- ✅ `scripts/ingest_slack_mcp_channel.ts` - **1000 messages**
- ✅ `scripts/ingest_channel_c08t43uhk9d.ts` - **1000 messages**
- ✅ `backup/cursor_extension/cursor_extension/slack_mcp_commands.ts` - **1000 messages** (default)

## ❌ Issue: Extension Commands Not Appearing

### Why Commands Don't Show Up

The "PM Intelligence: Ingest Slack Channel (MCP)" command doesn't appear in Cursor's command palette because:

1. **Extension Not Installed**: The extension code is archived in `backup/cursor_extension/` and isn't installed/activated in Cursor IDE
2. **Cursor Extension System**: Cursor may require different installation steps than VS Code
3. **Not Built**: The TypeScript extension code needs to be compiled before it can be loaded

### Solution: Use Scripts Instead (Recommended)

**You don't need the extension!** All functionality is available via scripts:

```bash
# Ingest 1000 messages from channel C04D195JVGS
npm run ingest-channel-c04d195jvgs

# Detect opportunities
curl -X POST http://localhost:3000/api/opportunities/detect/incremental

# List opportunities
npm run list-opps-c04d195jvgs
```

### If You Want to Install Extension (Optional)

1. **Build the extension:**
   ```bash
   cd backup/cursor_extension/cursor_extension
   npm install
   npx tsc  # Compile TypeScript
   ```

2. **Install in Cursor:**
   - Cursor may auto-detect extensions in workspace
   - Or use Cursor's extension installation mechanism
   - Reload Cursor after installation

3. **Verify:**
   - Press `Cmd+Shift+P`
   - Type "PM Intelligence"
   - Commands should appear

**Note:** Cursor's extension system may work differently than VS Code. The scripts are the most reliable way to use the system.

## 🎯 Quick Start

```bash
# 1. Ingest messages (1000 messages)
npm run ingest-channel-c04d195jvgs

# 2. Check what was ingested
npm run check

# 3. Detect opportunities
curl -X POST http://localhost:3000/api/opportunities/detect/incremental

# 4. List opportunities from channel
npm run list-opps-c04d195jvgs
```

## 📊 What Changed

- **Before**: Scripts fetched 100 messages
- **After**: Scripts fetch **1000 messages**
- **Extension**: Commands not available (use scripts instead)

All scripts are ready to use and will fetch up to 1000 messages from Slack channels!
