# Pre-Flight Validation Checklist

## Overview
This checklist must be completed before running the full community forum ingestion and final system validation.

## Prerequisites

- [ ] Docker Compose services running (PostgreSQL, Neo4j, Redis)
- [ ] Environment variables configured in `.env`
- [ ] Database migrations applied
- [ ] Node dependencies installed (`npm install`)

## Validation Steps

### 1. Entity Resolution Accuracy

**Goal:** Confirm LLM-powered entity resolution achieves >85% accuracy

**Steps:**
```bash
# Run entity resolution accuracy test
npm test -- entity_resolution_accuracy.test.ts

# Expected output: ✓ achieves >85% accuracy on golden dataset
```

**Success Criteria:**
- [ ] Test passes with >85% accuracy
- [ ] No timeout errors during LLM calls
- [ ] Entity resolution log shows reasonable confidence scores

**Troubleshooting:**
- If accuracy < 85%: Review LLM prompts in `llm_entity_matcher.ts`
- If timeouts: Check Azure OpenAI API key and rate limits
- If fails: Check `entity_resolution_log` table for patterns

---

### 2. Multi-Channel Slack Ingestion

**Goal:** Verify Slack batch ingestion works across multiple channels

**Steps:**
```bash
# 1. Configure Slack channels in .env
echo "SLACK_CHANNEL_IDS=C04D195JVGS,C08T43UHK9D,C123456789" >> .env
echo "SLACK_BOT_TOKEN=xoxb-your-token-here" >> .env

# 2. Run Slack ingestion (dry run first)
npm run ingest-slack -- --dry-run

# 3. If dry run succeeds, run actual ingestion
npm run ingest-slack

# 4. Check ingestion summary
cat output/slack_ingestion_summary.json

# 5. Verify signals in database
psql -d pm_intelligence -c "SELECT source, COUNT(*) FROM signals WHERE source = 'slack' GROUP BY source;"
```

**Success Criteria:**
- [ ] All configured channels ingested
- [ ] No API rate limit errors
- [ ] Thread replies included
- [ ] Signal count matches expected range
- [ ] Ingestion summary shows 0 failed messages

**Troubleshooting:**
- If rate limited: Reduce `SLACK_BATCH_SIZE` in .env
- If auth fails: Verify `SLACK_BOT_TOKEN` has correct scopes
- If missing threads: Ensure `SLACK_INCLUDE_THREADS=true`

---

### 3. System Health Check

**Goal:** Confirm all infrastructure services are operational

**Steps:**
```bash
# Run health check
npm run health-check

# Or use the validate_deployment script
./scripts/validate_deployment.sh
```

**Success Criteria:**
- [ ] PostgreSQL: ✅ healthy
- [ ] Neo4j: ✅ healthy
- [ ] Redis: ✅ healthy
- [ ] BullMQ: ✅ healthy
- [ ] No Python service checks (removed)

**Troubleshooting:**
- If PostgreSQL unhealthy: Check Docker Compose logs
- If Neo4j unhealthy: Verify NEO4J_URI and credentials
- If Redis unhealthy: Check REDIS_URL in .env

---

### 4. SLO Baseline Establishment

**Goal:** Establish baseline metrics for 6 critical SLOs

**Steps:**
```bash
# 1. Run SLO dashboard
npm run slo:dashboard

# 2. Review current metrics
# - Entity resolution accuracy: Should show >85%
# - Ingestion success rate: Should show >95%
# - MCP tool latency: Should show p95 <5s
# - Neo4j sync latency: Should show <30s
# - Extraction success rate: Should show >95%
# - Graph consistency: Should show <1% divergence

# 3. Record baseline in output/slo_baseline.json
npm run slo:dashboard -- --json > output/slo_baseline.json

# 4. Set up SLO breach monitoring
# Add to crontab (or equivalent):
# */5 * * * * cd /path/to/project && npm run slo:check
```

**Success Criteria:**
- [ ] All 6 SLOs reporting metrics
- [ ] No SLO breaches at baseline
- [ ] Baseline metrics saved to output/
- [ ] SLO check script scheduled (optional for dev)

**Troubleshooting:**
- If no metrics: Run some test operations to generate data
- If SLO breaches: Investigate root cause before proceeding

---

### 5. Test Entity Resolution on Sample Data

**Goal:** Validate entity resolution on real-world-like data

**Steps:**
```bash
# 1. Create test signals with entity mentions
psql -d pm_intelligence <<SQL
INSERT INTO signals (id, source, type, text, metadata, created_at)
VALUES 
  (gen_random_uuid(), 'test', 'message', 'Customer Acme Corp is experiencing login timeout issues with SSO feature', '{}', NOW()),
  (gen_random_uuid(), 'test', 'message', 'Acme Corporation reports authentication timeout during sign-in', '{}', NOW()),
  (gen_random_uuid(), 'test', 'message', 'SSO integration failing for major client', '{}', NOW());
SQL

# 2. Run entity resolution pipeline
npm run process-signals

# 3. Check entity resolution log
psql -d pm_intelligence -c "
  SELECT mention, resolved_to_entity_id, resolution_result, confidence
  FROM entity_resolution_log
  WHERE signal_id IN (SELECT id FROM signals WHERE source = 'test')
  ORDER BY created_at DESC;
"

# Expected: "Acme Corp" and "Acme Corporation" resolve to same entity
#           "SSO" and "sign-in" recognized as features
#           Confidence scores >0.85 for matches

# 4. Cleanup test data
psql -d pm_intelligence -c "DELETE FROM signals WHERE source = 'test';"
```

**Success Criteria:**
- [ ] Similar entity mentions resolve to same canonical entity
- [ ] Confidence scores >0.85 for correct matches
- [ ] New entities created when no match found
- [ ] Entity types correctly classified

---

### 6. Database Backup Test

**Goal:** Verify backup/restore process works

**Steps:**
```bash
# 1. Create backup
./scripts/backup_database.sh

# 2. Verify backup file created
ls -lh backups/*.sql.gz

# 3. Test restore to separate database (optional)
createdb pm_intelligence_test_restore
gunzip -c backups/pm_intelligence_backup_$(date +%Y%m%d).sql.gz | psql pm_intelligence_test_restore

# 4. Verify record counts match
psql -d pm_intelligence -c "SELECT COUNT(*) FROM signals;"
psql -d pm_intelligence_test_restore -c "SELECT COUNT(*) FROM signals;"

# 5. Cleanup test database
dropdb pm_intelligence_test_restore
```

**Success Criteria:**
- [ ] Backup completes without errors
- [ ] Backup file size reasonable
- [ ] Restore successful (if tested)
- [ ] Record counts match

---

## Pre-Flight Checklist Summary

Before proceeding to full forum ingestion, confirm:

- [ ] ✅ **Entity Resolution:** >85% accuracy on golden dataset
- [ ] ✅ **Multi-Channel Slack:** All channels ingest successfully
- [ ] ✅ **System Health:** All services green
- [ ] ✅ **SLO Baseline:** All 6 SLOs reporting, no breaches
- [ ] ✅ **Sample Entity Resolution:** Correctly resolves test entities
- [ ] ✅ **Backup Process:** Verified functional

## Sign-Off

**Date:** ________________

**Validator:** ________________

**Notes:**
________________________________________________________________________
________________________________________________________________________

**Ready for Final Validation:** [ ] YES  [ ] NO

---

## Next Steps

If all checks pass:
1. Proceed to Task 8.2: Full community forum data ingestion
2. Monitor SLO dashboard during ingestion
3. Review ingestion summary and data quality

If any checks fail:
1. Document failure in notes section
2. Troubleshoot using guides above
3. Re-run failed checks
4. Do not proceed to final validation until all checks pass
