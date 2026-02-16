# Final Testing Guide - Community Forum Ingestion & PM Output Validation

## Overview
This guide covers the final end-to-end validation of the PM Intelligence System using real community forum data.

---

## Task 8.2: Full Community Forum Data Ingestion

### Objective
Ingest complete AEM Forms community forum dataset and validate data quality.

### Prerequisites
- [ ] Pre-flight checklist completed (see [PREFLIGHT_CHECKLIST.md](PREFLIGHT_CHECKLIST.md))
- [ ] Forum data file exists: `data/raw/community_forums/aem_forms_full_dump.json`
- [ ] System monitoring active (`npm run slo:dashboard` in separate terminal)

### Step 1: Inspect Forum Data

```bash
# Check data file size and record count
ls -lh data/raw/community_forums/aem_forms_full_dump.json
jq length data/raw/community_forums/aem_forms_full_dump.json

# View sample records
jq '.[0:3]' data/raw/community_forums/aem_forms_full_dump.json
```

**Expected:**
- File size: Reasonable for forum export
- Record count: Number of forum threads
- Structure: Array of thread objects with replies, answers

### Step 2: Start Monitoring

```bash
# Terminal 1: Start SLO dashboard
npm run slo:dashboard -- --watch

# Terminal 2: Tail ingestion logs
tail -f logs/ingestion.log

# Terminal 3: Monitor database size
watch -n 30 'psql -d pm_intelligence -c "
  SELECT
    (SELECT COUNT(*) FROM signals) AS signals,
    (SELECT COUNT(*) FROM signal_extractions) AS extractions,
    (SELECT COUNT(*) FROM entity_registry) AS entities,
    (SELECT COUNT(*) FROM opportunities) AS opportunities;
"'
```

### Step 3: Run Forum Ingestion

```bash
# Start ingestion with boilerplate filtering and checkpointing
npm run ingest-forums -- --skip-boilerplate --resume

# Options:
#   --skip-boilerplate: Filter out template/boilerplate text
#   --resume: Resume from last checkpoint if interrupted
#   --dry-run: Preview without storing (optional first)
```

**Monitor for:**
- Ingestion rate (signals/minute)
- Entity resolution latency
- Extraction success rate
- Any error patterns in logs

### Step 4: Wait for Completion

**Expected Duration:** Varies based on data size

Monitor for completion signal:
```
✅ Forum ingestion complete: <stats>
```

### Step 5: Validate Ingestion Results

```bash
# 1. Check ingestion summary
cat output/forum_ingestion_summary.json

# Expected fields:
# {
#   "total_threads": <number>,
#   "total_signals": <number>,
#   "signals_created": <number>,
#   "signals_skipped": <number>,
#   "extraction_success_rate": <percentage>,
#   "entity_resolution_accuracy": <percentage>,
#   "duration_minutes": <number>
# }

# 2. Verify signal counts in database
psql -d pm_intelligence <<SQL
SELECT
  source,
  type,
  COUNT(*) as count,
  MIN(created_at) as first_signal,
  MAX(created_at) as last_signal
FROM signals
GROUP BY source, type
ORDER BY count DESC;
SQL

# 3. Check entity resolution results
psql -d pm_intelligence <<SQL
SELECT
  resolution_result,
  COUNT(*) as count,
  AVG(confidence) as avg_confidence
FROM entity_resolution_log
GROUP BY resolution_result
ORDER BY count DESC;
SQL

# 4. Verify Neo4j sync status
psql -d pm_intelligence <<SQL
SELECT
  status,
  COUNT(*) as count
FROM neo4j_sync_backlog
GROUP BY status;
SQL
```

### Step 6: Data Quality Checks

```bash
# Run data quality agent
npm run agent:data-quality

# Check for issues:
# - Low confidence entity merges
# - Orphaned entities
# - Duplicate entity names
# - Unextracted signals
# - Failed extractions

# Review output for any HIGH severity issues
```

### Success Criteria

- [ ] All forum threads ingested (match expected count)
- [ ] Signal count reasonable (threads + replies + answers)
- [ ] Entity resolution accuracy >85%
- [ ] Extraction success rate >95%
- [ ] Neo4j sync backlog empty or <100 pending
- [ ] No HIGH severity data quality issues
- [ ] SLOs maintained during ingestion (no breaches)

### Troubleshooting

**Issue: High extraction failure rate**
- Check LLM API availability and rate limits
- Review failed signal examples in `failed_signal_attempts` table
- Verify extraction prompt quality

**Issue: Low entity resolution accuracy**
- Review `entity_resolution_log` for low confidence matches
- Check if similar entities not being merged
- Validate LLM matching prompts

**Issue: Slow ingestion**
- Check database connection pool size
- Verify LLM API response times
- Consider increasing batch size

**Issue: Neo4j sync backlog growing**
- Check Neo4j connectivity
- Review `neo4j_sync_backlog` for error patterns
- Increase sync worker concurrency if needed

---

## Task 8.3: PM Output Generation & Validation

### Objective
Validate PM-facing outputs (weekly digest, PRD drafts, JIRA issues) with real data.

### Step 1: Test MCP Tool Queries

Test core MCP tools with natural language queries:

```bash
# Use Claude Code, Cursor, or direct MCP client

# Query 1: Customer activity
"Which customers are most active in the forums?"

# Expected: List of customers with signal counts, ordered by activity

# Query 2: Top issues
"What are the most discussed issues in the last 30 days?"

# Expected: Issues ranked by mention count, with trend direction

# Query 3: Temporal trends
"Show me trends for authentication issues in the last 90 days"

# Expected: Trend data with week-over-week changes

# Query 4: Opportunities
"List all opportunities detected, sorted by RICE score"

# Expected: Opportunities with RICE scores, signal counts

# Query 5: Opportunity details
"Show me the top 5 opportunities with customer evidence"

# Expected: Opportunities with linked customers, issues, signal excerpts
```

**Success Criteria:**
- [ ] All queries return meaningful results
- [ ] No errors or timeout
- [ ] Results include provenance (links back to signals)
- [ ] Confidence scores included where applicable

### Step 2: Generate Weekly Digest

```bash
# Run report scheduler agent
npm run agent:report-scheduler

# Check output
cat output/weekly_digest_$(date +%Y-%m-%d).md
```

**Expected Content:**
1. **Executive Summary**
   - Total signals ingested
   - Top themes/issues
   - Customer activity highlights

2. **Customer Insights**
   - Most active customers
   - Top customer pain points
   - New customer issues

3. **Issue Trends**
   - Emerging issues
   - Declining issues
   - Stable high-volume issues

4. **Opportunities**
   - Top 5 opportunities by RICE score
   - Quick wins
   - Strategic initiatives

5. **System Health**
   - Ingestion stats
   - Entity resolution accuracy
   - Data quality notes

**Success Criteria:**
- [ ] Digest generated successfully
- [ ] All sections populated with real data
- [ ] Customer names correct (properly resolved)
- [ ] Issue themes make semantic sense
- [ ] Opportunities have clear problem statements
- [ ] No template placeholders or dummy data

### Step 3: Generate PRD Draft

```bash
# Use MCP tool: generate_prd
# Select top opportunity from digest

# Query: "Generate a PRD for the top opportunity"

# Tool should return:
# - Problem Statement (data-backed)
# - User Stories
# - Success Metrics
# - Provenance (links to signals/customers)
```

**Expected PRD Sections:**
1. **Problem Statement**
   - Clear description of customer pain
   - Data: X customers mentioned, Y signals over Z days

2. **User Impact**
   - Specific customer examples
   - Severity/frequency data

3. **Proposed Solution**
   - High-level approach
   - Alternative considerations

4. **Success Metrics**
   - How to measure if solved

5. **Supporting Evidence**
   - Links to signals
   - Customer quotes
   - Trend data

**Success Criteria:**
- [ ] PRD generated for top opportunity
- [ ] Problem statement data-backed (not generic)
- [ ] Customer evidence included
- [ ] Provenance chain complete (can trace to signals)
- [ ] Success metrics reasonable

### Step 4: Generate JIRA Issue

```bash
# Use MCP tool: generate_jira_issue
# For top opportunity

# Query: "Create a JIRA issue for opportunity X"
```

**Expected JIRA Issue Fields:**
- **Summary:** Clear, concise title
- **Description:** Problem statement with data
- **Customer Evidence:** List of affected customers
- **Signal Links:** References to original signals
- **Priority:** Based on RICE score
- **Labels:** Auto-tagged with themes

**Success Criteria:**
- [ ] JIRA issue created (or JSON generated)
- [ ] Title concise and descriptive
- [ ] Description includes customer evidence
- [ ] Priority aligns with RICE score
- [ ] Links/provenance included

### Step 5: Validate Provenance Chains

Test provenance tracing:

```bash
# Use provenance service
# Trace from insight → opportunity → signal → source

# Example query:
psql -d pm_intelligence <<SQL
SELECT
  o.id as opportunity_id,
  o.title,
  array_length(o.signal_ids, 1) as signal_count,
  (
    SELECT COUNT(DISTINCT s.source)
    FROM signals s
    WHERE s.id = ANY(o.signal_ids)
  ) as unique_sources
FROM opportunities o
ORDER BY o.rice_score DESC NULLS LAST
LIMIT 5;
SQL

# For each opportunity, verify:
# 1. Can trace back to signals
# 2. Signals have entity resolutions
# 3. Entity resolutions have provenance
```

**Success Criteria:**
- [ ] All opportunities link to signals
- [ ] All signals have extractions
- [ ] All entity mentions have resolution logs
- [ ] Provenance completeness >95%

### Step 6: User Acceptance Simulation

Simulate PM workflow:

1. **Morning Routine:**
   - Read weekly digest
   - Identify top 3 priorities

2. **Deep Dive:**
   - Use MCP to query specific issues
   - Validate customer evidence
   - Check trend direction

3. **Action:**
   - Generate PRD for top opportunity
   - Create JIRA issue
   - Share digest with team

**Success Criteria:**
- [ ] Digest provides actionable insights
- [ ] Deep dive queries answer follow-up questions
- [ ] PRD/JIRA generation reduces manual work
- [ ] Confidence in data accuracy

---

## Final Validation Checklist

### Data Quality
- [ ] Signal ingestion complete (all forum threads)
- [ ] Entity resolution accuracy >85%
- [ ] Extraction success rate >95%
- [ ] Neo4j graph in sync
- [ ] No orphaned entities

### Performance
- [ ] MCP tool response time p95 <5s
- [ ] Entity resolution <2s per entity (p95)
- [ ] Neo4j sync latency <30s
- [ ] Ingestion throughput >50 signals/minute

### SLO Compliance
- [ ] All 6 SLOs within target ranges
- [ ] No SLO breaches during ingestion
- [ ] System uptime >99%

### Error Handling
- [ ] Dead letter queue empty (or replayed)
- [ ] Circuit breakers functional
- [ ] Graceful degradation works

### Documentation
- [ ] Deployment runbook tested end-to-end
- [ ] All scripts documented
- [ ] MCP tools documented
- [ ] Architecture docs updated

### Production Readiness
- [ ] Backups configured
- [ ] Monitoring operational
- [ ] Alerting configured
- [ ] Health checks pass

---

## Sign-Off

**Date:** ________________

**Final Validator:** ________________

**Production Ready:** [ ] YES  [ ] NO

**Notes:**
________________________________________________________________________
________________________________________________________________________
________________________________________________________________________

---

## Next Steps

If validation passes:
- System ready for production deployment
- Schedule launch with stakeholders
- Set up production monitoring
- Plan user onboarding

If validation fails:
- Document failures in notes
- Prioritize fixes
- Re-run validation after fixes
- Do not deploy to production
