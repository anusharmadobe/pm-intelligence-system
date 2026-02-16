# 🚀 System Ready for End-to-End Testing

**Date:** 2026-02-16  
**Status:** ✅ READY FOR TESTING

---

## 📊 Current System Status

### Database Status: CLEAN ✓
- **Signals:** 0
- **Signal Extractions:** 0  
- **Entity Registry:** 0
- **Entity Resolution Log:** 0
- **Opportunities:** 0
- **Neo4j Sync Backlog:** 0 pending

### Data Sources: VERIFIED ✓

**Community Forum Data:**
- Location: `data/raw/community_forums/aem_forms_full_dump.json`
- Size: 11 MB
- Thread Count: **3,028 threads**
- Status: ✅ Ready for ingestion

**Slack Data:**
- Location: `data/raw/slack/C04D195JVGS/customer_engagement_C04D195JVGS_complete.json`
- Size: 6.9 MB
- Channel Objects: **6 channels**
- Status: ✅ Ready for ingestion

---

## 🛠️ Available Scripts

### System Management
```bash
# Check current system status
./scripts/check_system_status.sh

# Reset system to clean state (if needed)
./scripts/reset_system.sh

# Validate deployment health
./scripts/validate_deployment.sh

# Create database backup
./scripts/backup_database.sh
```

### Data Ingestion
```bash
# Ingest Slack messages
npm run ingest-slack

# Ingest community forum data
npm run ingest-forums -- --skip-boilerplate --resume
```

### Monitoring & Validation
```bash
# View SLO dashboard
npm run slo:dashboard

# Check for SLO breaches
npm run slo:check

# Run data quality checks
npm run agent:data-quality

# Generate weekly digest
npm run agent:report-scheduler
```

### Testing
```bash
# Run entity resolution accuracy test
npm test -- entity_resolution_accuracy.test.ts

# Run all tests with coverage
npm run test:coverage
```

---

## 📋 Testing Procedure

### Phase 1: Pre-Flight Validation (30-60 minutes)

Follow: [docs/v2/PREFLIGHT_CHECKLIST.md](docs/v2/PREFLIGHT_CHECKLIST.md)

**Checklist:**
- [ ] Run entity resolution accuracy test (>85% target)
- [ ] Test Slack ingestion with sample channels
- [ ] Verify system health checks pass
- [ ] Establish SLO baseline metrics
- [ ] Test entity resolution on sample data
- [ ] Verify backup/restore procedures

**Commands:**
```bash
# 1. Entity resolution test
npm test -- entity_resolution_accuracy.test.ts

# 2. System health
./scripts/validate_deployment.sh

# 3. SLO baseline
npm run slo:dashboard -- --json > output/slo_baseline.json
```

---

### Phase 2: Full Data Ingestion (2-4 hours)

Follow: [docs/v2/FINAL_TESTING_GUIDE.md](docs/v2/FINAL_TESTING_GUIDE.md) - Task 8.2

**Steps:**

1. **Start monitoring** (in separate terminals):
```bash
# Terminal 1: SLO dashboard
npm run slo:dashboard -- --watch

# Terminal 2: Ingestion logs
tail -f logs/ingestion.log

# Terminal 3: Database metrics
watch -n 30 'psql -d pm_intelligence -c "
  SELECT
    (SELECT COUNT(*) FROM signals) AS signals,
    (SELECT COUNT(*) FROM signal_extractions) AS extractions,
    (SELECT COUNT(*) FROM entity_registry) AS entities,
    (SELECT COUNT(*) FROM opportunities) AS opportunities;
"'
```

2. **Ingest community forum data:**
```bash
npm run ingest-forums -- --skip-boilerplate --resume
```

**Expected Results:**
- Duration: 2-4 hours (depending on system)
- Signals created: ~6,000-8,000
- Entities resolved: ~500-1,000
- Extraction success rate: >95%
- Entity resolution accuracy: >85%

3. **Verify ingestion:**
```bash
# Check summary
cat output/forum_ingestion_summary.json

# Check system status
./scripts/check_system_status.sh

# Run data quality checks
npm run agent:data-quality
```

---

### Phase 3: PM Output Validation (1-2 hours)

Follow: [docs/v2/FINAL_TESTING_GUIDE.md](docs/v2/FINAL_TESTING_GUIDE.md) - Task 8.3

**Test Queries via MCP Tools:**

1. "Which customers are most active in the forums?"
2. "What are the most discussed issues in the last 30 days?"
3. "Show me trends for authentication issues in the last 90 days"
4. "List all opportunities detected, sorted by RICE score"
5. "Show me the top 5 opportunities with customer evidence"

**Generate Outputs:**

```bash
# Weekly digest
npm run agent:report-scheduler
cat output/weekly_digest_$(date +%Y-%m-%d).md

# Use MCP tools to:
# - Generate PRD for top opportunity
# - Create JIRA issue
# - Validate provenance chains
```

**Success Criteria:**
- [ ] All queries return meaningful results
- [ ] Weekly digest generated with real data
- [ ] PRD includes data-backed problem statements
- [ ] JIRA issue includes customer evidence
- [ ] Provenance chains complete (>95%)

---

### Phase 4: Final Sign-Off

Follow: [docs/v2/PRODUCTION_READINESS.md](docs/v2/PRODUCTION_READINESS.md)

**Final Validation Checklist:**
- [ ] Data quality checks pass
- [ ] Performance targets met (p95 <5s for MCP tools)
- [ ] All 6 SLOs within target ranges
- [ ] Error handling tested
- [ ] Documentation complete
- [ ] Backups verified
- [ ] System ready for production

---

## 📚 Documentation Reference

| Document | Purpose |
|----------|---------|
| [PREFLIGHT_CHECKLIST.md](docs/v2/PREFLIGHT_CHECKLIST.md) | Pre-flight validation steps |
| [FINAL_TESTING_GUIDE.md](docs/v2/FINAL_TESTING_GUIDE.md) | Complete testing procedure |
| [PRODUCTION_READINESS.md](docs/v2/PRODUCTION_READINESS.md) | Production deployment checklist |
| [DATA_SOURCES.md](docs/v2/DATA_SOURCES.md) | Data source reference |
| [DEPLOYMENT_RUNBOOK.md](docs/v2/DEPLOYMENT_RUNBOOK.md) | Deployment procedures |
| [GRAPHRAG_EVALUATION.md](docs/v2/GRAPHRAG_EVALUATION.md) | GraphRAG decision rationale |

---

## 🎯 Expected Timeline

| Phase | Duration | Activities |
|-------|----------|------------|
| Pre-Flight | 30-60 min | Entity resolution test, health checks, SLO baseline |
| Ingestion | 2-4 hours | Forum data ingestion, monitoring, validation |
| PM Outputs | 1-2 hours | MCP queries, digest generation, PRD/JIRA creation |
| Final Sign-Off | 30 min | Checklist completion, documentation review |
| **Total** | **4-7 hours** | Complete end-to-end validation |

---

## 🔧 Troubleshooting

### If ingestion fails:
1. Check logs: `tail -f logs/ingestion.log`
2. Review failed signals: `SELECT * FROM failed_signal_attempts ORDER BY created_at DESC LIMIT 10;`
3. Check LLM API availability
4. Verify database connections

### If entity resolution accuracy < 85%:
1. Review golden dataset: `backend/tests/fixtures/golden_dataset_entities.json`
2. Check LLM prompts in `backend/services/llm_entity_matcher.ts`
3. Examine entity resolution log: `SELECT * FROM entity_resolution_log WHERE confidence < 0.85;`

### If SLO breaches occur:
1. Run: `npm run slo:check`
2. Review breach details
3. Check [TROUBLESHOOTING.md](docs/v2/TROUBLESHOOTING.md)

### If system reset needed:
```bash
./scripts/reset_system.sh
```

---

## ✅ System is Ready!

Everything is prepared for end-to-end testing. When you're ready to begin:

**Start with Phase 1:**
```bash
# Open the pre-flight checklist
open docs/v2/PREFLIGHT_CHECKLIST.md

# Or follow it in the terminal
cat docs/v2/PREFLIGHT_CHECKLIST.md
```

**Good luck with testing! 🚀**
