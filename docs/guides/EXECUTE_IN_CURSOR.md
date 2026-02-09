# Execute Complete Test in Cursor IDE

## ⚠️ Important Note

The complete test requires Cursor IDE's MCP and LLM APIs, which are only available when running scripts **within Cursor IDE's extension context**.

## 🚀 Steps to Execute in Cursor IDE

### Option 1: Use Cursor Extension Commands (Recommended)

1. **Ingest Messages from Channel C04D195JVGS**
   - Press `Cmd+Shift+P` (Mac) or `Ctrl+Shift+P` (Windows/Linux)
   - Run: **"PM Intelligence: Ingest Slack Channel (MCP)"**
   - Enter channel ID: `C04D195JVGS`
   - Enter limit: `100` (or desired number)

2. **Detect Opportunities**
   - Press `Cmd+Shift+P`
   - Run: **"PM Intelligence: Detect Opportunities"**
   - Or use API: `curl -X POST http://localhost:3000/api/opportunities/detect/incremental`

3. **View Opportunities**
   - Press `Cmd+Shift+P`
   - Run: **"PM Intelligence: View Opportunities"**
   - Or run: `npm run list-opps-c04d195jvgs`

4. **Create Judgment (with REAL LLM)**
   - Press `Cmd+Shift+P`
   - Run: **"PM Intelligence: Create Judgment"**
   - Select an opportunity
   - Enter your user ID
   - Review the LLM-generated judgment

5. **Create Artifact (with REAL LLM)**
   - Press `Cmd+Shift+P`
   - Run: **"PM Intelligence: Create Artifact"**
   - Select opportunity and judgment
   - Choose PRD or RFC
   - Review the LLM-generated artifact

### Option 2: Run Script in Cursor IDE Terminal

If you're in Cursor IDE's integrated terminal, the script might have access to MCP:

```bash
npm run test-complete-c04d195jvgs
```

This script will:
- Try to use real Slack MCP to fetch messages
- Try to use real Cursor LLM for judgments/artifacts
- Fall back gracefully if not available

### Option 3: Manual API Calls

If MCP is not available, you can manually ingest signals via API:

```bash
# Start API server
npm start

# In another terminal, ingest signals (if you have message data)
curl -X POST http://localhost:3000/api/signals \
  -H "Content-Type: application/json" \
  -d '{
    "source": "slack",
    "id": "message_ts",
    "type": "message",
    "text": "Message content here",
    "metadata": {
      "channel_id": "C04D195JVGS"
    }
  }'

# Detect opportunities
curl -X POST http://localhost:3000/api/opportunities/detect/incremental

# List opportunities
npm run list-opps-c04d195jvgs
```

---

## 📊 Current Status Check

Run this to check current status:

```bash
npm run list-opps-c04d195jvgs
```

Or:

```bash
npm run test-complete-c04d195jvgs
```

---

## ✅ Expected Output

After completing all steps, you should see:

```
📊 Opportunities from Channel C04D195JVGS
================================================================================

1. [Opportunity Title]
   Description: [Description]
   Status: new
   Total Signals: X
   Signals from Channel: Y
   Created: [Date]
   ID: [UUID]

2. [Another Opportunity]
   ...
```

---

## 🔧 Troubleshooting

### "Slack MCP not available"
- Ensure you're in Cursor IDE (not VS Code)
- Enable Slack MCP in Cursor Settings → MCP → Slack
- Use Cursor extension commands instead

### "No signals found"
- Run the ingestion step first
- Check channel ID is correct: C04D195JVGS
- Verify Slack MCP is connected

### "No opportunities detected"
- Ensure you have at least 2 signals
- Signals need similarity >= 0.15 to cluster
- Try running opportunity detection again

### "LLM API not available"
- Judgment/artifact creation requires Cursor IDE
- Use Cursor extension commands for LLM features
- Ensure you're running in Cursor IDE environment

---

## 🎯 Quick Reference

```bash
# Check status
npm run check

# List opportunities from channel
npm run list-opps-c04d195jvgs

# Test complete workflow
npm run test-complete-c04d195jvgs

# Health check
curl http://localhost:3000/health
```
