# Final Instructions - Testing Channel C04D195JVGS

## ✅ What Has Been Completed

All code, tests, documentation, and scripts are complete and ready:

1. ✅ **Validation Infrastructure**
   - Mock LLM provider for testing
   - Full workflow test script
   - Channel-specific workflow test

2. ✅ **Production Hardening**
   - Enhanced health checks (`/health`, `/ready`, `/live`)
   - Comprehensive error handling
   - Structured logging (Winston)

3. ✅ **Documentation**
   - User Guide (`USER_GUIDE.md`)
   - API Documentation (`API_DOCUMENTATION.md`)

4. ✅ **Channel Scripts**
   - Ingestion script for channel C04D195JVGS
   - Opportunity listing script
   - Workflow test script

---

## 🚀 Steps to Complete Testing

### Step 1: Verify Database Connection

```bash
npm run check
```

Should show:
```
✅ Database connection: OK
✅ Table 'signals': EXISTS
✅ Table 'opportunities': EXISTS
✅ Table 'judgments': EXISTS
✅ Table 'artifacts': EXISTS
```

### Step 2: Start API Server (if not running)

```bash
npm start
```

Or in development mode:
```bash
npm run dev
```

### Step 3: Test Full Workflow (Optional - validates all layers)

```bash
npm run test-workflow
```

This tests:
- Signal ingestion
- Opportunity detection
- Judgment creation (with mock LLM)
- Artifact generation (with mock LLM)
- Data integrity

### Step 4: Ingest Messages from Channel C04D195JVGS

**Option A: Using Cursor Extension (Recommended)**
1. Open Cursor IDE
2. Press `Cmd+Shift+P` (Mac) or `Ctrl+Shift+P` (Windows/Linux)
3. Run: "PM Intelligence: Ingest Slack Channel (MCP)"
4. Select channel or enter channel ID: `C04D195JVGS`

**Option B: Using Script (Requires Cursor IDE with Slack MCP)**
```bash
npm run ingest-channel-c04d195jvgs
```

**Option C: Manual API Call** (if you have message data)
```bash
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
```

### Step 5: Detect Opportunities

```bash
# Incremental detection (recommended - faster)
curl -X POST http://localhost:3000/api/opportunities/detect/incremental

# Or full detection (re-clusters all signals)
curl -X POST http://localhost:3000/api/opportunities/detect
```

Expected response:
```json
{
  "newOpportunities": [...],
  "updatedOpportunities": [...],
  "signalsProcessed": 10
}
```

### Step 6: List Opportunities from Channel

```bash
npm run list-opps-c04d195jvgs
```

This will display:
- All opportunities containing signals from channel C04D195JVGS
- Opportunity titles and descriptions
- Signal counts
- Creation dates

### Step 7: Test End-to-End Workflow with Real Data

```bash
npm run test-channel-workflow
```

This will:
- Retrieve signals from channel
- Detect opportunities
- Display opportunities found
- Optionally test judgment/artifact creation (if `TEST_WITH_LLM=true`)

---

## 🔍 Troubleshooting

### Issue: "Slack MCP functions not available"

**Solution:**
1. Ensure you're running in Cursor IDE (not VS Code)
2. Enable Slack MCP in Cursor Settings
3. Verify Slack MCP is connected
4. Try the Cursor extension command instead

### Issue: "No opportunities detected"

**Possible Causes:**
1. Not enough signals (need at least 2 related signals)
2. Signals not similar enough (similarity threshold: 0.15)
3. Need to run opportunity detection first

**Solutions:**
1. Ingest more messages
2. Check signal content similarity
3. Run: `curl -X POST http://localhost:3000/api/opportunities/detect/incremental`

### Issue: Database connection errors

**Solution:**
```bash
# Check PostgreSQL is running
pg_isready

# Verify connection
npm run check

# Check .env file has correct credentials
cat .env
```

### Issue: Rate limiting

**Solution:**
- Check response headers for `X-RateLimit-Remaining`
- Wait for rate limit to reset (see `X-RateLimit-Reset` header)
- Use incremental detection instead of full detection

---

## 📊 Expected Results

After completing all steps, you should see:

1. **Signals Ingested**: Number of messages ingested from channel
2. **Opportunities Detected**: Clusters of related signals
3. **Opportunity Details**: Titles, descriptions, signal counts

Example output from `list-opps-c04d195jvgs`:
```
📊 Opportunities from Channel C04D195JVGS
==========================================

Found 15 signals from channel C04D195JVGS

Found 3 opportunities containing signals from this channel

Opportunities:

================================================================================

1. Customer NFCU - IC Editor - adoption (5 signals)
   Description: Cluster of 5 related signals. Customers: NFCU. Topics: IC Editor, Customer Meeting.
   Status: new
   Total Signals: 5
   Signals from Channel: 5
   Created: 2025-01-XX...
   ID: uuid-here

2. IRS - Automated Forms Conversion - Core Components (4 signals)
   Description: Cluster of 4 related signals. Customers: IRS. Topics: Automated Forms Conversion, Core Components.
   Status: new
   Total Signals: 4
   Signals from Channel: 4
   Created: 2025-01-XX...
   ID: uuid-here

...
```

---

## 🎯 Quick Reference

### All Available Commands

```bash
# Testing
npm run test-workflow              # Test full workflow
npm run test-channel-workflow      # Test with channel data
npm run test-improvements          # Test all improvements

# Ingestion
npm run ingest-channel-c04d195jvgs # Ingest from channel

# Analysis
npm run list-opps-c04d195jvgs      # List opportunities from channel

# API
curl http://localhost:3000/health  # Health check
curl http://localhost:3000/api/signals  # Get signals
curl http://localhost:3000/api/opportunities  # Get opportunities
```

---

## ✅ Completion Checklist

- [ ] Database connection verified (`npm run check`)
- [ ] API server started (`npm start`)
- [ ] Full workflow tested (`npm run test-workflow`)
- [ ] Messages ingested from channel C04D195JVGS
- [ ] Opportunities detected (`/api/opportunities/detect/incremental`)
- [ ] Opportunities listed (`npm run list-opps-c04d195jvgs`)
- [ ] End-to-end workflow tested (`npm run test-channel-workflow`)

---

## 📝 Notes

- All code compiles successfully ✅
- All scripts are ready to run ✅
- Documentation is complete ✅
- System is production-ready pending manual testing ✅

**Next Action**: Run the steps above to complete testing and view opportunities from channel C04D195JVGS.
