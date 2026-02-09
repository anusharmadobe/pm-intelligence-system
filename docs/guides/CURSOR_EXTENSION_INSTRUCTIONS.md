# Instructions to Complete Test in Cursor IDE

## 🎯 Goal
Complete end-to-end test for channel C04D195JVGS using REAL Cursor MCP and LLM APIs.

## ⚠️ Important
MCP and LLM APIs are only available through Cursor IDE extension commands, not terminal scripts.

## 📋 Step-by-Step Instructions

### Step 1: Ingest Messages from Channel C04D195JVGS

1. **Open Cursor IDE**
2. **Press `Cmd+Shift+P`** (Mac) or `Ctrl+Shift+P` (Windows/Linux)
3. **Type and select**: `PM Intelligence: Ingest Slack Channel (MCP)`
4. **When prompted for channel name/ID**, enter: `C04D195JVGS`
5. **When prompted for limit**, enter: `100` (or desired number)
6. **Wait for completion** - you should see: "✅ Ingested X signals from #channel-name"

### Step 2: Detect Opportunities

**Option A: Via Cursor Extension**
1. Press `Cmd+Shift+P`
2. Run: `PM Intelligence: Detect Opportunities`
3. This uses incremental detection automatically

**Option B: Via API** (if API server is running)
```bash
curl -X POST http://localhost:3000/api/opportunities/detect/incremental
```

### Step 3: View Opportunities from Channel

**Option A: Via Script**
```bash
npm run list-opps-c04d195jvgs
```

**Option B: Via Cursor Extension**
1. Press `Cmd+Shift+P`
2. Run: `PM Intelligence: View Opportunities`
3. Look for opportunities containing signals from channel C04D195JVGS

### Step 4: Create Judgment with REAL LLM

1. **Press `Cmd+Shift+P`**
2. **Run**: `PM Intelligence: Create Judgment`
3. **Select an opportunity** from the list (preferably one with signals from C04D195JVGS)
4. **Enter your user ID** when prompted (e.g., `user@example.com`)
5. **Wait for LLM processing** - Cursor's LLM will generate:
   - Summary
   - Assumptions
   - Missing evidence
   - Confidence level
6. **Review the judgment** - you should see it was created successfully

### Step 5: Generate Artifact with REAL LLM

1. **Press `Cmd+Shift+P`**
2. **Run**: `PM Intelligence: Create Artifact`
3. **Select the opportunity** you created a judgment for
4. **Select the judgment** you just created
5. **Choose artifact type**: `PRD` or `RFC`
6. **Enter your user ID** when prompted
7. **Wait for LLM processing** - Cursor's LLM will generate the artifact
8. **Review the artifact** - you should see a complete PRD or RFC

### Step 6: List All Opportunities from Channel

Run this command to see all opportunities:
```bash
npm run list-opps-c04d195jvgs
```

---

## 🔍 Verification

After completing all steps, verify:

1. **Signals ingested**: Check with `npm run check` or view signals via extension
2. **Opportunities detected**: Should see opportunities in the list
3. **Judgment created**: Should see judgment linked to opportunity
4. **Artifact created**: Should see PRD/RFC linked to judgment

---

## 📊 Expected Output

After completing all steps, running `npm run list-opps-c04d195jvgs` should show:

```
📊 Opportunities from Channel C04D195JVGS
==========================================

Found X signals from channel C04D195JVGS

Found Y opportunities containing signals from this channel

Opportunities:

================================================================================

1. [Opportunity Title Based on Signals]
   Description: Cluster of N related signals. Customers: [...]. Topics: [...]
   Status: new
   Total Signals: N
   Signals from Channel: M
   Created: [Date]
   ID: [UUID]

2. [Another Opportunity]
   ...
```

---

## 🐛 Troubleshooting

### "Slack MCP functions not available"
- Ensure you're in Cursor IDE (not VS Code)
- Enable Slack MCP in Cursor Settings → MCP → Slack
- Verify Slack MCP is connected and working

### "No opportunities detected"
- Ensure you have at least 2 signals
- Signals need similarity >= 0.15 to cluster
- Try running opportunity detection again
- Check signal content for similarity

### "LLM API not available"
- Judgment/artifact creation requires Cursor IDE
- Ensure you're using Cursor extension commands
- Check Cursor version supports LLM API

---

## ✅ Quick Checklist

- [ ] Ingested messages from channel C04D195JVGS (via extension)
- [ ] Detected opportunities (via extension or API)
- [ ] Viewed opportunities list
- [ ] Created judgment with REAL LLM (via extension)
- [ ] Generated artifact with REAL LLM (via extension)
- [ ] Listed opportunities from channel (via script)

---

## 🎯 All Commands Reference

```bash
# Check system status
npm run check

# List opportunities from channel
npm run list-opps-c04d195jvgs

# Test complete workflow (tries MCP/LLM if available)
npm run ingest-and-test-c04d195jvgs

# Health check
curl http://localhost:3000/health

# Detect opportunities
curl -X POST http://localhost:3000/api/opportunities/detect/incremental
```

**Cursor Extension Commands:**
- `PM Intelligence: Ingest Slack Channel (MCP)`
- `PM Intelligence: Detect Opportunities`
- `PM Intelligence: View Opportunities`
- `PM Intelligence: Create Judgment` (uses REAL LLM)
- `PM Intelligence: Create Artifact` (uses REAL LLM)
