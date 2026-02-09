# Slack MCP Integration Setup

## ✅ Status

Slack MCP integration code has been created and integrated into the Cursor extension!

## Database Admin Password

- **PostgreSQL admin user (`postgres`)**: Uses peer/trust authentication (no password required)
- **PM Intelligence user (`anusharm`)**: Password is `pm_intelligence`

## Slack MCP Integration

### What's Been Created

1. **Slack MCP Adapter** (`backend/integrations/slack_mcp_adapter.ts`)
   - Functions to ingest Slack channels via MCP
   - Functions to ingest Slack mentions via MCP
   - Batch ingestion for multiple channels

2. **Cursor Extension Commands** (`backup/cursor_extension/cursor_extension/slack_mcp_commands.ts`)
   - `PM Intelligence: Ingest Slack Channel (MCP)` - Ingest messages from a channel
   - `PM Intelligence: Ingest Slack Mentions (MCP)` - Ingest mentions
   - `PM Intelligence: List Slack Channels (MCP)` - List available channels

3. **Integration Points**
   - Commands registered in extension
   - Uses Cursor's built-in Slack MCP functions

### How to Use

Since Slack MCP is enabled in Cursor, you can now:

1. **Open Cursor IDE**
2. **Open Command Palette** (Cmd+Shift+P / Ctrl+Shift+P)
3. **Run these commands:**
   - `PM Intelligence: Ingest Slack Channel (MCP)`
   - `PM Intelligence: Ingest Slack Mentions (MCP)`
   - `PM Intelligence: List Slack Channels (MCP)`

### Implementation Notes

The integration is set up to use Cursor's MCP functions:
- `mcp_Slack_slack_list_channels` - List channels
- `mcp_Slack_slack_get_channel_history` - Get channel messages
- `mcp_Slack_slack_search_messages` - Search messages/mentions

These functions are automatically available when Slack MCP is enabled in Cursor.

### Testing the Integration

1. **List channels first:**
   ```
   Command: PM Intelligence: List Slack Channels (MCP)
   ```

2. **Ingest from a channel:**
   ```
   Command: PM Intelligence: Ingest Slack Channel (MCP)
   Enter channel name: support
   Enter limit: 50
   ```

3. **Check ingested signals:**
   ```
   Command: PM Intelligence: View Signals
   ```

4. **Detect opportunities:**
   ```
   Command: PM Intelligence: Detect Opportunities
   ```

### Next Steps

1. ✅ Slack MCP integration code created
2. ✅ Extension commands registered
3. ⏭️ Test the commands in Cursor IDE
4. ⏭️ Ingest some Slack messages
5. ⏭️ Create judgments from opportunities
6. ⏭️ Generate artifacts

## Troubleshooting

### "Slack MCP not available"
- Ensure Slack MCP is enabled in Cursor Settings
- Check Cursor → Settings → MCP → Slack is configured

### "Channel not found"
- Use channel name without # (e.g., "support" not "#support")
- Or use channel ID

### "No messages ingested"
- Check channel has recent messages
- Verify you have access to the channel
- Check database connection is working

## Summary

✅ **Database**: Set up with user `anusharm` / password `pm_intelligence`  
✅ **Slack MCP**: Integration code created and ready  
✅ **Extension**: Commands registered and available  

**Ready to use!** Try the Slack MCP commands in Cursor IDE.
