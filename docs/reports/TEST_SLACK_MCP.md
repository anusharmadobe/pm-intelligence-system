# Testing Slack MCP Integration

## ✅ Logging Added

Winston logging has been integrated throughout the application:
- ✅ Signal ingestion logging
- ✅ LLM call logging  
- ✅ API request/response logging
- ✅ Error logging
- ✅ Database operation logging

Logs are written to:
- Console (colored output)
- `logs/combined.log` (all logs)
- `logs/error.log` (errors only)

## 🧪 Testing Slack MCP - anusharm-test-channel

### Step 1: Verify System is Ready

```bash
# Check setup
npm run check

# Should show:
# ✅ Database connection: OK
# ✅ All tables exist
```

### Step 2: Test in Cursor IDE

1. **Open Cursor IDE** (with Slack MCP enabled)

2. **Run the command:**
   - Press `Cmd+Shift+P` (Mac) or `Ctrl+Shift+P` (Windows/Linux)
   - Type: `PM Intelligence: Ingest Slack Channel (MCP)`
   - Press Enter

3. **Enter channel name:**
   - When prompted, enter: `anusharm-test-channel`
   - (Don't include the # symbol)

4. **Enter message limit:**
   - Enter: `50` (or desired number)
   - Press Enter

5. **Watch the progress:**
   - You should see a progress notification
   - The extension will:
     - List Slack channels
     - Find `anusharm-test-channel`
     - Fetch messages from the channel
     - Ingest each message as a signal

### Step 3: Verify Signals Were Ingested

1. **View signals:**
   - Command: `PM Intelligence: View Signals`
   - You should see messages from `anusharm-test-channel`

2. **Check logs:**
   ```bash
   tail -f logs/combined.log | grep -i slack
   ```

3. **Check via API:**
   ```bash
   curl http://localhost:3000/api/signals?source=slack
   ```

### Step 4: Detect Opportunities

After ingesting signals:

1. **Detect opportunities:**
   - Command: `PM Intelligence: Detect Opportunities`
   - This will cluster related signals

2. **View opportunities:**
   - Command: `PM Intelligence: View Opportunities`

## 🔍 Troubleshooting

### "Slack MCP functions not available"

**Solution:**
- Ensure Slack MCP is enabled in Cursor Settings
- Check Cursor → Settings → MCP → Slack is configured
- Restart Cursor IDE

### "Channel not found"

**Solution:**
- Use channel name without # (e.g., `anusharm-test-channel` not `#anusharm-test-channel`)
- Or use channel ID
- List channels first: `PM Intelligence: List Slack Channels (MCP)`

### "Could not fetch channel history"

**Solution:**
- Check Slack MCP permissions
- Ensure you have access to the channel
- Check Slack workspace permissions

### No messages ingested

**Possible reasons:**
- Channel has no recent messages
- All messages are from bots (skipped)
- Database connection issue

**Check:**
```bash
# Check logs
tail logs/combined.log

# Check database
npm run check
```

## 📊 Expected Log Output

When running the Slack MCP ingestion, you should see logs like:

```
[info] Starting Slack channel ingestion {"channelName":"anusharm-test-channel","limit":50}
[info] Slack MCP functions accessed {"hasListChannels":true,"hasGetHistory":true}
[info] Retrieved Slack channels {"channelCount":X}
[info] Found target channel {"channelName":"anusharm-test-channel","channelId":"C..."}
[info] Retrieved channel messages {"channelName":"anusharm-test-channel","messageCount":X}
[info] Ingesting signal {"source":"slack","type":"message"}
[info] Signal ingested successfully {"signalId":"...","source":"slack"}
[info] Slack channel ingestion complete {"channelName":"anusharm-test-channel","ingestedCount":X}
```

## ✅ Success Criteria

After running the command, you should see:

1. ✅ Progress notification completes
2. ✅ Success message: "Ingested X signals from #anusharm-test-channel"
3. ✅ Signals visible when viewing signals
4. ✅ Logs show successful ingestion
5. ✅ No errors in logs

## 🚀 Next Steps After Testing

Once Slack MCP is working:

1. **Ingest more channels** - Try other channels
2. **Detect opportunities** - Cluster signals into opportunities
3. **Create judgments** - Use LLM to analyze opportunities
4. **Generate artifacts** - Create PRDs/RFCs from judgments

## 📝 Notes

- Logs are stored in `logs/` directory
- Check `logs/error.log` for any errors
- Check `logs/combined.log` for all activity
- Log level can be set via `LOG_LEVEL` environment variable (debug, info, warn, error)
