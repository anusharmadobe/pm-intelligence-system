# Next Steps: PM Intelligence System Workflow

## ✅ Completed
- **Data Ingestion**: 852 signals ingested (277 engagements + 567 replies)
- **Rate Limiting Fixed**: Increased to 5000 requests/minute with bulk bypass

---

## 🎯 Recommended Next Steps

### 1. **Detect Opportunities from Signals** ⭐ START HERE

The system clusters related signals into opportunities (potential product improvements, customer needs, etc.).

**Option A: Incremental Detection (Recommended - Faster)**
```bash
curl -X POST http://localhost:3000/api/opportunities/detect/incremental
```
- Only processes new/unlinked signals
- Faster and more efficient
- Updates existing opportunities with new signals

**Option B: Full Detection (Re-cluster All Signals)**
```bash
curl -X POST http://localhost:3000/api/opportunities/detect
```
- Re-clusters all signals from scratch
- Use when you want to completely refresh opportunity detection
- Slower but ensures all signals are re-analyzed

**Expected Output:**
```json
{
  "newOpportunities": [...],
  "updatedOpportunities": [...],
  "signalsProcessed": 852
}
```

---

### 2. **Review Detected Opportunities**

List all opportunities:
```bash
curl http://localhost:3000/api/opportunities
```

Filter by status:
```bash
curl "http://localhost:3000/api/opportunities?status=new&limit=20"
```

**Opportunity Fields:**
- `id`: Unique identifier
- `title`: Auto-generated title (e.g., "NFCU - IC Editor - adoption (5 signals)")
- `description`: Summary of clustered signals
- `status`: `new`, `in_progress`, `resolved`, `archived`
- `signal_count`: Number of signals in this opportunity
- `created_at`: When opportunity was created

---

### 3. **Create Judgments for Important Opportunities** 🧠

Judgments provide human-in-the-loop analysis with LLM assistance to:
- Summarize the opportunity
- Identify assumptions
- List missing evidence
- Assess confidence level

**Using Cursor Extension (Recommended):**
1. Open Cursor IDE
2. Use command: `PM Intelligence: Create Judgment`
3. Select an opportunity ID
4. Review and refine the LLM-generated judgment

**Via API (Limited):**
```bash
curl -X POST http://localhost:3000/api/judgments \
  -H "Content-Type: application/json" \
  -d '{
    "opportunity_id": "opportunity-uuid",
    "summary": "Manual judgment summary"
  }'
```

**View Judgments:**
```bash
curl http://localhost:3000/api/judgments/{opportunity_id}
```

---

### 4. **Generate Artifacts** 📄

Create artifacts (PRDs, feature specs, etc.) from opportunities:

```bash
curl -X POST http://localhost:3000/api/artifacts \
  -H "Content-Type: application/json" \
  -d '{
    "opportunity_id": "opportunity-uuid",
    "type": "prd",
    "content": "Artifact content here"
  }'
```

---

### 5. **Track Metrics & Analytics** 📊

Get adoption metrics:
```bash
curl http://localhost:3000/api/metrics
```

**Metrics Include:**
- Total signals, opportunities, judgments, artifacts
- Signals by source (Slack, Teams, etc.)
- Opportunities by status
- Judgments by confidence level
- Quality scores distribution

---

### 6. **Query and Filter Signals** 🔍

Explore your ingested data:

**By Customer:**
```bash
curl "http://localhost:3000/api/signals?customer=NFCU&limit=50"
```

**By Topic:**
```bash
curl "http://localhost:3000/api/signals?topic=Forms&limit=50"
```

**By Date Range:**
```bash
curl "http://localhost:3000/api/signals?startDate=2025-01-01&endDate=2025-01-31"
```

**By Quality Score:**
```bash
curl "http://localhost:3000/api/signals?minQualityScore=60&limit=50"
```

---

## 🚀 Quick Start Script

Create a script to run the full workflow:

```bash
#!/bin/bash
# Run opportunity detection and show results

echo "🔍 Detecting opportunities..."
curl -X POST http://localhost:3000/api/opportunities/detect/incremental | jq '.'

echo ""
echo "📊 Current Opportunities:"
curl http://localhost:3000/api/opportunities | jq '.opportunities | length'

echo ""
echo "📈 Metrics:"
curl http://localhost:3000/api/metrics | jq '.'
```

---

## 📋 Typical Workflow

1. **Ingest Data** ✅ (Done)
   - Signals from Slack, Teams, etc.

2. **Detect Opportunities** ⬅️ **YOU ARE HERE**
   - Cluster related signals
   - Identify patterns and themes

3. **Review & Prioritize**
   - Review opportunity titles and descriptions
   - Filter by customer, topic, signal count
   - Prioritize high-impact opportunities

4. **Create Judgments**
   - Use Cursor extension for LLM-assisted analysis
   - Document assumptions and evidence gaps
   - Set confidence levels

5. **Generate Artifacts**
   - Create PRDs, specs, or documentation
   - Link artifacts to opportunities

6. **Track Progress**
   - Monitor metrics over time
   - Update opportunity statuses
   - Track signal quality scores

---

## 🛠️ Useful Commands

**Check System Health:**
```bash
curl http://localhost:3000/health
```

**Get Signal Count:**
```bash
curl "http://localhost:3000/api/signals?limit=1" | jq '.pagination.total'
```

**Get Opportunity Count:**
```bash
curl http://localhost:3000/api/opportunities | jq '.opportunities | length'
```

**Merge Related Opportunities:**
```bash
curl -X POST http://localhost:3000/api/opportunities/merge
```

---

## 📚 Additional Resources

- **API Documentation**: See `API.md` or `API_DOCUMENTATION.md`
- **User Guide**: See `USER_GUIDE.md`
- **Cursor Extension**: Use `PM Intelligence: Create Judgment` command

---

## 🎯 Immediate Next Action

Run opportunity detection to start clustering your 852 signals:

```bash
curl -X POST http://localhost:3000/api/opportunities/detect/incremental
```

This will identify patterns, customer needs, and potential product opportunities from your Slack engagement data!
