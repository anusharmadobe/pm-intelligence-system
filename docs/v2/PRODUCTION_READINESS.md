# Production Readiness Checklist

## Overview
This checklist verifies the PM Intelligence System is ready for production deployment.

**Last Updated:** 2026-02-16  
**Version:** 2.0  
**Validator:** ________________

---

## Category 1: Data Quality ✓

### 1.1 Signal Ingestion
- [ ] Forum data fully ingested (threads + replies + answers)
- [ ] Slack data ingested from all configured channels  
- [ ] Signal count matches expected range
- [ ] No duplicate signals (idempotency working)
- [ ] Signal metadata complete and valid

**Validation Command:**
```bash
psql -d pm_intelligence -c "
  SELECT source, type, COUNT(*) as count 
  FROM signals 
  GROUP BY source, type 
  ORDER BY count DESC;
"
```

### 1.2 Entity Resolution
- [ ] Entity resolution accuracy >85% (tested on golden dataset)
- [ ] Similar entities correctly merged
- [ ] Entity aliases auto-detected
- [ ] No excessive orphaned entities (<50 with no mentions in 90 days)
- [ ] Entity types correctly classified

**Validation Command:**
```bash
npm test -- entity_resolution_accuracy.test.ts
npm run agent:data-quality
```

### 1.3 Graph Consistency
- [ ] PostgreSQL entity count matches Neo4j node count
- [ ] All entities synced to Neo4j
- [ ] Relationships correctly established
- [ ] No sync backlog >100 items
- [ ] Graph queries return expected results

**Validation Command:**
```bash
psql -d pm_intelligence -c "SELECT COUNT(*) FROM entity_registry;"
# Compare with Neo4j: MATCH (n:Entity) RETURN count(n)
psql -d pm_intelligence -c "SELECT status, COUNT(*) FROM neo4j_sync_backlog GROUP BY status;"
```

---

## Category 2: Performance ⚡

### 2.1 Response Times
- [ ] MCP tool response time p95 <5s
- [ ] Entity resolution <2s per entity (p95)
- [ ] Neo4j sync latency <30s
- [ ] Database queries optimized (no full table scans)

**Validation Command:**
```bash
# Run sample MCP queries and measure latency
# Check system_metrics table for recorded latencies
psql -d pm_intelligence -c "
  SELECT metric_name, 
         PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY metric_value) as p95
  FROM system_metrics
  WHERE metric_name IN ('mcp_tool_latency_ms', 'entity_resolution_latency_ms')
  GROUP BY metric_name;
"
```

### 2.2 Throughput
- [ ] Ingestion throughput >50 signals/minute
- [ ] System handles concurrent MCP tool calls
- [ ] No database connection pool exhaustion
- [ ] No memory leaks during long runs

**Validation Command:**
```bash
# Monitor during ingestion
watch -n 5 'docker stats --no-stream'
```

### 2.3 Resource Usage
- [ ] Database size reasonable (<10GB for test data)
- [ ] Neo4j memory usage stable
- [ ] Redis memory <1GB
- [ ] CPU usage <50% at rest

**Validation Command:**
```bash
docker stats --no-stream
psql -d pm_intelligence -c "SELECT pg_size_pretty(pg_database_size('pm_intelligence'));"
```

---

## Category 3: SLO Compliance 📊

### 3.1 Entity Resolution SLO
- [ ] Target: >85% accuracy
- [ ] Current: _____%
- [ ] No breaches in last 7 days

### 3.2 Ingestion Uptime SLO
- [ ] Target: >99% successful runs
- [ ] Current: _____%
- [ ] No breaches in last 7 days

### 3.3 MCP Tool Latency SLO
- [ ] Target: p95 <5s
- [ ] Current: ____s
- [ ] No breaches in last 7 days

### 3.4 Neo4j Sync Latency SLO
- [ ] Target: <30s
- [ ] Current: ____s
- [ ] No breaches in last 7 days

### 3.5 Extraction Success Rate SLO
- [ ] Target: >95%
- [ ] Current: _____%
- [ ] No breaches in last 7 days

### 3.6 Graph Consistency SLO
- [ ] Target: <1% divergence
- [ ] Current: _____%
- [ ] No breaches in last 7 days

**Validation Command:**
```bash
npm run slo:dashboard
npm run slo:check
```

---

## Category 4: Error Handling 🛡️

### 4.1 Error Recovery
- [ ] Dead letter queue empty or replayed
- [ ] Failed signals queued for retry
- [ ] Circuit breakers functional
- [ ] Graceful degradation working (system continues with reduced quality)

**Validation Command:**
```bash
psql -d pm_intelligence -c "SELECT COUNT(*) FROM failed_signal_attempts WHERE created_at >= NOW() - INTERVAL '24 hours';"
```

### 4.2 Error Logging
- [ ] All errors logged with correlation IDs
- [ ] Structured error classes used consistently
- [ ] No silent error swallowing
- [ ] Error logs searchable and actionable

**Validation Command:**
```bash
grep -i error logs/app.log | tail -20
```

### 4.3 Rate Limiting
- [ ] LLM API rate limits respected
- [ ] Exponential backoff on failures
- [ ] No 429 errors in last 24 hours

**Validation Command:**
```bash
grep "429\|rate limit" logs/app.log
```

---

## Category 5: Documentation 📚

### 5.1 Deployment Documentation
- [ ] Deployment runbook complete ([DEPLOYMENT_RUNBOOK.md](DEPLOYMENT_RUNBOOK.md))
- [ ] Environment variables documented (.env.example)
- [ ] Database schema documented
- [ ] API reference updated

### 5.2 Operational Documentation
- [ ] Pre-flight checklist created ([PREFLIGHT_CHECKLIST.md](PREFLIGHT_CHECKLIST.md))
- [ ] Final testing guide created ([FINAL_TESTING_GUIDE.md](FINAL_TESTING_GUIDE.md))
- [ ] Troubleshooting guide complete
- [ ] SLO monitoring documented

### 5.3 User Documentation
- [ ] MCP tools documented (usage examples)
- [ ] PM workflow guide created
- [ ] FAQ updated
- [ ] Architecture diagrams current

---

## Category 6: Production Readiness 🚀

### 6.1 Backups
- [ ] Database backup process tested
- [ ] Backup retention policy configured (30 days)
- [ ] Restore process validated
- [ ] Backup monitoring configured

**Validation Command:**
```bash
./scripts/backup_database.sh
ls -lh backups/
```

### 6.2 Monitoring
- [ ] SLO dashboard operational
- [ ] SLO breach detection scheduled (cron)
- [ ] Health check endpoint working
- [ ] Metrics collection active

**Validation Command:**
```bash
npm run slo:dashboard
curl http://localhost:3000/health
```

### 6.3 Alerting
- [ ] Critical alerts configured (SLO breaches)
- [ ] Alert routing tested
- [ ] On-call rotation defined
- [ ] Runbook links in alerts

**Notes:** _______________

### 6.4 Security
- [ ] API keys secured (not in git)
- [ ] Database credentials rotated
- [ ] Access control configured
- [ ] Audit logging enabled

**Validation Command:**
```bash
git log --all -- .env | head -1 # Should be empty
grep -r "xoxb-\|sk-" . --exclude-dir=node_modules --exclude-dir=.git # Should find none
```

### 6.5 Scalability
- [ ] Connection pooling configured
- [ ] Rate limiting in place
- [ ] Horizontal scaling considered
- [ ] Load testing performed (optional)

**Notes:** _______________

---

## Category 7: Testing ✅

### 7.1 Unit Tests
- [ ] Test coverage >75%
- [ ] All critical services tested
- [ ] Mocks properly isolate dependencies

**Validation Command:**
```bash
npm run test:coverage
```

### 7.2 Integration Tests
- [ ] End-to-end Slack ingestion tested
- [ ] End-to-end forum ingestion tested
- [ ] MCP tool integration tested
- [ ] Neo4j sync validated

**Validation Command:**
```bash
npm test -- integration
```

### 7.3 Error Scenario Tests
- [ ] Circuit breaker tested (Neo4j down)
- [ ] Graceful degradation tested (LLM unavailable)
- [ ] Retry logic validated
- [ ] Dead letter queue tested

**Notes:** _______________

---

## Category 8: Compliance & Governance 📋

### 8.1 Data Privacy
- [ ] Customer data handling documented
- [ ] PII scrubbing considered
- [ ] Data retention policy defined
- [ ] GDPR compliance reviewed (if applicable)

**Notes:** _______________

### 8.2 Audit Trail
- [ ] Entity merge history tracked
- [ ] Feedback loop logged
- [ ] Configuration changes audited
- [ ] Data lineage traceable

**Validation Command:**
```bash
psql -d pm_intelligence -c "SELECT COUNT(*) FROM audit_log;"
```

---

## Final Sign-Off

### Pre-Production Checklist
All categories above must be ✅ checked before production deployment.

**Summary:**
- [ ] Data Quality: All checks pass
- [ ] Performance: Meets targets
- [ ] SLO Compliance: All SLOs within range
- [ ] Error Handling: Robust and tested
- [ ] Documentation: Complete and current
- [ ] Production Readiness: Infrastructure ready
- [ ] Testing: Coverage adequate
- [ ] Compliance: Requirements met

### Deployment Decision

**System Ready for Production:** [ ] YES  [ ] NO

**Deployment Date:** ________________

**Approved By:** ________________

**Signature:** ________________

**Notes/Caveats:**
________________________________________________________________________
________________________________________________________________________
________________________________________________________________________

---

## Post-Deployment Tasks

After production deployment:

1. **Week 1 Monitoring:**
   - Monitor SLO dashboard daily
   - Review error logs
   - Validate data quality
   - Collect user feedback

2. **Week 2-4 Optimization:**
   - Fine-tune entity resolution prompts
   - Adjust RICE scoring weights
   - Optimize slow queries
   - Address user feedback

3. **Month 2+ Enhancements:**
   - Consider deferred refactorings (opportunity_service, server.ts)
   - Evaluate dependency injection adoption
   - Re-assess GraphRAG need based on usage data
   - Plan Phase 2 features

---

## Contact & Support

**System Owner:** ________________  
**Technical Lead:** ________________  
**On-Call Contact:** ________________  

**Documentation:** [docs/v2/](.)  
**Issue Tracker:** [GitHub Issues](https://github.com/your-org/pm-intelligence/issues)  
**Runbook:** [DEPLOYMENT_RUNBOOK.md](DEPLOYMENT_RUNBOOK.md)
