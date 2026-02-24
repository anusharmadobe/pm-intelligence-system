# Deployment Runbook

**System**: PM Intelligence Platform
**Last Updated**: 2026-02-24
**Version**: 2.0 (Post Phase 1-3 Completion)

---

## Pre-Deployment Checklist

### Code & Build
- [ ] All tests passing (unit, integration, E2E)
- [ ] Code reviewed and approved
- [ ] Version number updated
- [ ] Changelog updated
- [ ] No debug code or console.logs
- [ ] Build artifacts generated successfully

### Database
- [ ] Database migrations reviewed
- [ ] Migrations tested on staging
- [ ] Rollback scripts prepared
- [ ] Database backup completed
- [ ] Migration execution plan documented

### Configuration
- [ ] Environment variables configured
- [ ] Secrets rotated (if needed)
- [ ] Feature flags reviewed
- [ ] Rate limits configured
- [ ] Monitoring thresholds set

### Security
- [ ] Security audit completed
- [ ] Vulnerability scan passed
- [ ] Dependencies updated
- [ ] Secrets not in code
- [ ] SSL certificates valid

### Infrastructure
- [ ] Resource capacity verified
- [ ] Load balancer configured
- [ ] CDN configured
- [ ] Backup systems ready
- [ ] Rollback plan documented

---

## Deployment Steps

### Phase 1: Preparation (30 minutes before)

#### 1. Notify Stakeholders
```bash
# Send deployment notification
- Engineering team
- Product team
- Customer success team
- Operations team

Template:
"Deployment starting at [TIME]
Expected duration: [DURATION]
Expected downtime: None (rolling deployment)
Monitoring: [DASHBOARD_URL]"
```

#### 2. Create Backup
```bash
# Database backup
pg_dump $DATABASE_URL > backup_$(date +%Y%m%d_%H%M%S).sql

# Verify backup
pg_restore --list backup_*.sql | head -20

# Upload to S3
aws s3 cp backup_*.sql s3://your-backups/$(date +%Y%m%d)/
```

#### 3. Enable Maintenance Mode (if needed)
```bash
# Set maintenance mode flag
redis-cli SET maintenance_mode true

# Display maintenance page
# (Configure load balancer to serve static page)
```

### Phase 2: Database Migration (15-30 minutes)

#### 1. Review Migration Files
```bash
cd backend/db/migrations
ls -la V3_*

# Migrations to run:
# V3_008 - Neo4j sync backlog, circuit breaker, indexes
# V3_009 - Cost tracking budget allocations, optimistic locking
# V3_010 - JIRA issue tracking, ON CONFLICT handling
# V3_011 - Neo4j dead letter queue
# V3_012 - Observability tables (performance, errors, tracing)
# V3_013 - User preferences, notifications, dashboards, reports
```

#### 2. Run Migrations
```bash
# Connect to database
psql $DATABASE_URL

# Start transaction for safety
BEGIN;

# Check current migration version
SELECT * FROM flyway_schema_history ORDER BY installed_rank DESC LIMIT 5;

# Run migrations (outside transaction for DDL)
COMMIT;

# Using Flyway
cd backend
npx flyway migrate

# Or manually (if Flyway not available)
psql $DATABASE_URL < db/migrations/V3_008_*.sql
psql $DATABASE_URL < db/migrations/V3_009_*.sql
psql $DATABASE_URL < db/migrations/V3_010_*.sql
psql $DATABASE_URL < db/migrations/V3_011_*.sql
psql $DATABASE_URL < db/migrations/V3_012_*.sql
psql $DATABASE_URL < db/migrations/V3_013_*.sql

# Verify migrations
SELECT version, description, installed_on FROM flyway_schema_history
ORDER BY installed_rank DESC LIMIT 10;
```

#### 3. Verify Tables Created
```bash
# Check new tables exist
psql $DATABASE_URL -c "\dt+"

# Expected new tables:
# - neo4j_sync_backlog
# - neo4j_sync_dead_letter
# - budget_allocations
# - performance_metrics
# - error_aggregation
# - error_occurrences
# - tracing_spans
# - saved_filters
# - notification_preferences
# - custom_dashboards
# - report_schedules
# - report_runs
# - user_activity_log
# - user_preferences
# - feedback_tickets

# Check indexes created
psql $DATABASE_URL -c "\di+" | grep -E "V3_008|V3_009|V3_010|V3_011|V3_012|V3_013"
```

#### 4. Initialize Materialized Views
```bash
# Refresh materialized views
psql $DATABASE_URL -c "REFRESH MATERIALIZED VIEW performance_metrics_hourly;"
psql $DATABASE_URL -c "REFRESH MATERIALIZED VIEW error_summary;"

# Verify views
psql $DATABASE_URL -c "SELECT COUNT(*) FROM performance_metrics_hourly;"
```

### Phase 3: Backend Deployment (20-30 minutes)

#### 1. Build Backend
```bash
cd backend

# Install dependencies
npm ci --production

# Build TypeScript
npm run build

# Verify build
ls -la dist/
```

#### 2. Update Environment Variables
```bash
# Add/update in production environment

# API Key Caching (Phase 2.1)
export API_KEY_CACHE_TTL_MS=300000
export API_KEY_CACHE_MAX_SIZE=1000

# Neo4j Backlog (Phase 2.1)
export NEO4J_BACKLOG_MAX_SIZE=10000
export NEO4J_BACKLOG_CLEANUP_DAYS=7
export NEO4J_BACKLOG_MAX_RETRIES=5

# Logging & Observability (Phase 2.3)
export LOG_LEVEL=info
export LOG_LEVEL_OPPORTUNITY=debug
export PERF_METRICS_ENABLED=true
export ERROR_AGGREGATION_ENABLED=true

# Verify env vars set
echo "API_KEY_CACHE_TTL_MS=$API_KEY_CACHE_TTL_MS"
echo "NEO4J_BACKLOG_MAX_SIZE=$NEO4J_BACKLOG_MAX_SIZE"
echo "LOG_LEVEL=$LOG_LEVEL"
```

#### 3. Deploy Backend (Rolling Deployment)
```bash
# If using PM2
pm2 deploy production

# If using Docker
docker-compose pull
docker-compose up -d --no-deps --build backend

# If using Kubernetes
kubectl set image deployment/backend backend=your-registry/backend:v2.0
kubectl rollout status deployment/backend

# Verify deployment
curl http://localhost:3000/health
# Should return: {"status":"ok","version":"2.0"}
```

#### 4. Verify Backend Services
```bash
# Check health endpoint
curl http://localhost:3000/api/health

# Check observability endpoint (with admin auth)
curl -H "Authorization: Bearer $ADMIN_KEY" \
  http://localhost:3000/api/admin/observability/health

# Check database connection
curl http://localhost:3000/api/signals?limit=1

# Check logs
tail -f logs/combined.log
# Look for: "Server started on port 3000"
```

### Phase 4: Frontend Deployment (15-20 minutes)

#### 1. Build Frontend
```bash
cd frontend/chat-ui

# Install dependencies
npm ci

# Build for production
npm run build

# Verify build
ls -la .next/
```

#### 2. Deploy Frontend
```bash
# If using Vercel
vercel --prod

# If using static hosting
aws s3 sync .next/static s3://your-bucket/static
# Update CDN invalidation

# If using Docker
docker-compose up -d --no-deps --build frontend

# If using Kubernetes
kubectl set image deployment/frontend frontend=your-registry/frontend:v2.0
kubectl rollout status deployment/frontend
```

#### 3. Verify Frontend
```bash
# Test homepage
curl https://your-domain.com

# Test API connection
# Open browser console and check for:
# - No errors
# - Theme loads correctly
# - Dark mode toggle works
# - API calls succeed
```

### Phase 5: Post-Deployment Verification (15-20 minutes)

#### 1. Smoke Tests
```bash
# Test critical paths

# 1. Health check
curl https://your-domain.com/api/health
# Expected: {"status":"ok"}

# 2. Authentication
curl -H "Authorization: Bearer $TEST_API_KEY" \
  https://your-domain.com/api/signals
# Expected: JSON array of signals

# 3. Create signal
curl -X POST https://your-domain.com/api/signals \
  -H "Authorization: Bearer $TEST_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"content":"Test signal","source":"test"}'
# Expected: 201 Created

# 4. Get opportunities
curl -H "Authorization: Bearer $TEST_API_KEY" \
  https://your-domain.com/api/opportunities
# Expected: JSON array

# 5. Export data
curl -H "Authorization: Bearer $TEST_API_KEY" \
  "https://your-domain.com/api/signals/export?format=csv"
# Expected: CSV download

# 6. Observability dashboard
curl -H "Authorization: Bearer $ADMIN_KEY" \
  https://your-domain.com/api/admin/observability/health
# Expected: System health JSON
```

#### 2. Monitor Key Metrics
```bash
# Check system health
curl -H "Authorization: Bearer $ADMIN_KEY" \
  https://your-domain.com/api/admin/observability/health

# Check performance metrics
curl -H "Authorization: Bearer $ADMIN_KEY" \
  "https://your-domain.com/api/admin/observability/performance/stats?hours=1"

# Check error rates
curl -H "Authorization: Bearer $ADMIN_KEY" \
  "https://your-domain.com/api/admin/observability/errors/stats?hours=1"

# Expected metrics:
# - Response time P95 < 2000ms
# - Error rate < 1%
# - System status: healthy
```

#### 3. Database Health
```bash
# Check connection pool
psql $DATABASE_URL -c "
SELECT count(*) as active_connections
FROM pg_stat_activity
WHERE state = 'active';"

# Check slow queries
psql $DATABASE_URL -c "
SELECT query, mean_exec_time
FROM pg_stat_statements
ORDER BY mean_exec_time DESC
LIMIT 10;"

# Check table sizes
psql $DATABASE_URL -c "
SELECT schemaname, tablename,
       pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename))
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC
LIMIT 10;"
```

#### 4. Frontend Verification
- [ ] Homepage loads
- [ ] Theme toggle works (light/dark/system)
- [ ] Browser compatibility banner shows for old browsers
- [ ] Offline banner shows when offline
- [ ] Loading states display correctly
- [ ] Error boundaries catch errors
- [ ] Form validation works
- [ ] Keyboard shortcuts work (Ctrl+K, Ctrl+S, etc.)
- [ ] Toast notifications appear
- [ ] Advanced search works
- [ ] Export works (CSV, JSON)
- [ ] Mobile responsive layout

### Phase 6: Cron Jobs Setup

#### 1. Set Up Materialized View Refresh
```bash
# Add to crontab
crontab -e

# Refresh observability views every hour
0 * * * * psql $DATABASE_URL -c "SELECT refresh_observability_views();"

# Verify cron job
crontab -l
```

#### 2. Set Up Backlog Cleanup
```bash
# Add to crontab (daily at 2 AM)
0 2 * * * curl -X POST -H "Authorization: Bearer $ADMIN_KEY" \
  http://localhost:3000/api/admin/neo4j/backlog/cleanup
```

#### 3. Set Up Scheduled Reports (if implemented)
```bash
# Add report processor to crontab
*/15 * * * * cd /app/backend && node dist/jobs/process-scheduled-reports.js
```

### Phase 7: Monitoring Setup

#### 1. Configure Alerts
```bash
# Set up alerts in monitoring system

# Critical alerts:
- Error rate > 5% for 5 minutes
- Response time P95 > 5000ms for 5 minutes
- Database connection failures
- Disk space < 10%
- Memory usage > 90%

# Warning alerts:
- Error rate > 2% for 10 minutes
- Response time P95 > 2000ms for 10 minutes
- Dead letter queue items > 100
- Unresolved error groups > 10
```

#### 2. Verify Prometheus Metrics
```bash
# Check Prometheus endpoint
curl -H "Authorization: Bearer $ADMIN_KEY" \
  http://localhost:3000/api/admin/observability/metrics/prometheus

# Expected metrics:
# pm_requests_total
# pm_request_duration_ms
# pm_errors_total
# pm_error_rate
# pm_system_health
```

#### 3. Set Up Dashboards
- [ ] Grafana dashboard configured
- [ ] System health dashboard
- [ ] Performance metrics dashboard
- [ ] Error tracking dashboard
- [ ] User activity dashboard

### Phase 8: Final Steps

#### 1. Disable Maintenance Mode
```bash
# Remove maintenance mode
redis-cli DEL maintenance_mode

# Verify site accessible
curl https://your-domain.com
```

#### 2. Send Deployment Complete Notification
```
Template:
"Deployment complete at [TIME]
Version: 2.0
Status: Success
Monitoring: [DASHBOARD_URL]
Any issues: [RUNBOOK_URL]"
```

#### 3. Monitor for 1 Hour
- [ ] Watch error logs
- [ ] Monitor performance metrics
- [ ] Check user reports/feedback
- [ ] Verify no degradation

#### 4. Document Deployment
- [ ] Update deployment log
- [ ] Note any issues encountered
- [ ] Document any manual fixes applied
- [ ] Update runbook if needed

---

## Rollback Procedure

### When to Rollback
- Critical bug affecting > 50% of users
- Data corruption detected
- Security vulnerability exposed
- Performance degradation > 50%
- Multiple critical errors

### Rollback Steps

#### 1. Immediate Actions
```bash
# 1. Enable maintenance mode
redis-cli SET maintenance_mode true

# 2. Stop current deployment
pm2 stop all
# or
kubectl rollout undo deployment/backend
kubectl rollout undo deployment/frontend
```

#### 2. Restore Database (if needed)
```bash
# Restore from backup
pg_restore --clean --if-exists -d $DATABASE_URL backup_*.sql

# Or rollback migrations
psql $DATABASE_URL < rollback_scripts/rollback_V3_013.sql
psql $DATABASE_URL < rollback_scripts/rollback_V3_012.sql
# ... continue as needed
```

#### 3. Deploy Previous Version
```bash
# Deploy previous backend version
pm2 deploy production revert 1

# Or with Docker
docker-compose up -d --no-deps backend:v1.0

# Or with Kubernetes
kubectl rollout undo deployment/backend
```

#### 4. Verify Rollback
```bash
# Check version
curl http://localhost:3000/health
# Should show previous version

# Run smoke tests
./scripts/smoke-tests.sh

# Monitor logs
tail -f logs/combined.log
```

#### 5. Disable Maintenance Mode
```bash
redis-cli DEL maintenance_mode
```

#### 6. Post-Rollback
- [ ] Notify stakeholders
- [ ] Create incident report
- [ ] Schedule post-mortem
- [ ] Fix issues in development
- [ ] Plan re-deployment

---

## Monitoring & Support

### Monitoring Dashboards
- System Health: https://monitoring.your-domain.com/health
- Performance: https://monitoring.your-domain.com/performance
- Errors: https://monitoring.your-domain.com/errors
- Logs: https://logs.your-domain.com

### On-Call Contacts
- Primary: [Name] - [Phone] - [Email]
- Secondary: [Name] - [Phone] - [Email]
- Manager: [Name] - [Phone] - [Email]

### Escalation Path
1. On-call engineer (15 minutes)
2. Engineering lead (30 minutes)
3. Engineering manager (1 hour)
4. CTO (critical only)

---

## Post-Deployment Tasks

### Day 1
- [ ] Monitor error rates
- [ ] Check performance metrics
- [ ] Review user feedback
- [ ] Verify cron jobs running
- [ ] Check backup success

### Week 1
- [ ] Review observability dashboards
- [ ] Analyze user adoption of new features
- [ ] Check for any edge case bugs
- [ ] Performance optimization if needed
- [ ] User feedback collection

### Month 1
- [ ] Comprehensive performance review
- [ ] Cost analysis
- [ ] User satisfaction survey
- [ ] Plan Phase 4 improvements
- [ ] Update documentation based on learnings

---

## Troubleshooting

### Common Issues

#### Database Connection Issues
```bash
# Check connection
psql $DATABASE_URL -c "SELECT 1"

# Check pool status
SELECT count(*) FROM pg_stat_activity;

# Restart connection pool
pm2 restart backend
```

#### High Error Rate
```bash
# Check error dashboard
curl -H "Authorization: Bearer $ADMIN_KEY" \
  http://localhost:3000/api/admin/observability/errors/stats

# Check error logs
tail -f logs/error.log

# Check dead letter queue
curl -H "Authorization: Bearer $ADMIN_KEY" \
  http://localhost:3000/api/admin/neo4j/dead-letter
```

#### Slow Performance
```bash
# Check performance metrics
curl -H "Authorization: Bearer $ADMIN_KEY" \
  "http://localhost:3000/api/admin/observability/performance/slow?hours=1"

# Check slow queries
psql $DATABASE_URL -c "
SELECT query, mean_exec_time
FROM pg_stat_statements
ORDER BY mean_exec_time DESC
LIMIT 20;"
```

---

**Sign-Off**

- [ ] Deployment completed successfully
- [ ] All verification tests passed
- [ ] Monitoring configured
- [ ] Team notified
- [ ] Documentation updated

**Deployed By**: _________________
**Date**: _________________
**Verified By**: _________________
**Date**: _________________
