# PM Intelligence System - Deployment Runbook

> **Version:** 2.0
> **Last Updated:** 2026-02-16
> **Status:** Production Ready

---

## Table of Contents

1. [Prerequisites Checklist](#1-prerequisites-checklist)
2. [Environment Setup](#2-environment-setup)
3. [Database Initialization](#3-database-initialization)
4. [Service Startup](#4-service-startup)
5. [Configuration Management](#5-configuration-management)
6. [Monitoring Setup](#6-monitoring-setup)
7. [Backup Configuration](#7-backup-configuration)
8. [Troubleshooting Guide](#8-troubleshooting-guide)
9. [Rollback Procedures](#9-rollback-procedures)

---

## 1. Prerequisites Checklist

### System Requirements

| Requirement | Version | Check Command | Notes |
|-------------|---------|--------------|-------|
| Node.js | 18+ | `node -v` | LTS recommended |
| npm | Latest | `npm -v` | |
| Docker | Latest | `docker --version` | For PostgreSQL, Neo4j, Redis |
| Docker Compose | v2+ | `docker compose version` | |
| Git | 2.0+ | `git --version` | For repository management |

### Access Requirements

- [ ] Azure OpenAI API key (for LLM and embeddings)
- [ ] Slack Bot Token (xoxb-...) with channels:history scope
- [ ] Database credentials (PostgreSQL, Neo4j)
- [ ] Redis password
- [ ] Sufficient disk space (minimum 10GB free)

### Network Requirements

- [ ] Outbound HTTPS access to Azure OpenAI (openai.azure.com)
- [ ] Outbound HTTPS access to Slack API (slack.com)
- [ ] Inbound access to ports 3000 (API), 3001 (MCP)
- [ ] Internal access to ports 5432 (PostgreSQL), 7687 (Neo4j), 6379 (Redis)

---

## 2. Environment Setup

### 2.1 Clone Repository

```bash
git clone <repository-url>
cd PM_cursor_system
```

### 2.2 Create Environment File

```bash
cp .env.example .env
```

### 2.3 Configure Required Variables

Edit `.env` and set the following **REQUIRED** variables:

```bash
# Database
DB_HOST=localhost
DB_PORT=5432
DB_NAME=pm_intelligence
DB_USER=postgres
DB_PASSWORD=<your-secure-password>

# Azure OpenAI (REQUIRED)
AZURE_OPENAI_ENDPOINT=https://your-resource.openai.azure.com
AZURE_OPENAI_KEY=<your-azure-openai-key>
AZURE_OPENAI_CHAT_DEPLOYMENT=gpt-4o
AZURE_OPENAI_EMBEDDINGS_DEPLOYMENT=text-embedding-ada-002

# Slack (REQUIRED for Slack ingestion)
SLACK_BOT_TOKEN=xoxb-<your-bot-token>
SLACK_CHANNEL_IDS=C04D195JVGS,C08T43UHK9D

# Neo4j
NEO4J_URI=bolt://localhost:7687
NEO4J_USER=neo4j
NEO4J_PASSWORD=<your-neo4j-password>

# Redis
REDIS_URL=redis://localhost:6379
REDIS_PASSWORD=<your-redis-password>
```

### 2.4 Validate Environment

Run the validation script to check for missing required variables:

```bash
npm run check
```

**Expected output:**
```
✅ All required environment variables are set
✅ Azure OpenAI connection successful
✅ Slack bot token valid
```

---

## 3. Database Initialization

### 3.1 Start Infrastructure Services

```bash
docker compose up -d
```

This starts:
- PostgreSQL (port 5432)
- Neo4j (ports 7474, 7687)
- Redis (port 6379)

### 3.2 Verify Services are Running

```bash
docker compose ps
```

**Expected output:**
```
NAME                  STATUS
pm_intel_postgres     Up (healthy)
pm_intel_neo4j        Up (healthy)
pm_intel_redis        Up
```

### 3.3 Run Database Migrations

```bash
npm run migrate
```

This creates all required tables, indexes, and pgvector extension.

**Expected output:**
```
✅ Running migration: 001_initial_schema.sql
✅ Running migration: 002_entity_resolution.sql
✅ Running migration: 003_neo4j_sync.sql
...
✅ All migrations completed successfully
```

### 3.4 Seed Initial Data (Optional)

```bash
npm run seed-themes
```

Loads predefined theme hierarchy for classification.

---

## 4. Service Startup

### 4.1 Install Dependencies

```bash
npm install
```

### 4.2 Build TypeScript

```bash
npm run build
```

### 4.3 Start Main Application

**Development mode:**
```bash
npm run dev
```

**Production mode:**
```bash
npm start
```

### 4.4 Verify Application Health

```bash
curl http://localhost:3000/health
```

**Expected output (all services healthy):**
```json
{
  "postgresql": "healthy",
  "redis": "healthy",
  "neo4j": "healthy",
  "ingestion_queue": { "waiting": 0, "failed": 0 },
  "entity_resolution_queue": 0,
  "neo4j_backlog_pending": 0,
  "last_pipeline_run": "2024-01-15T10:00:00Z"
}
```

### 4.5 Common Startup Issues

| Issue | Cause | Solution |
|-------|-------|----------|
| `Cannot connect to PostgreSQL` | Docker not running or wrong password | Check `docker compose ps`, verify DB_PASSWORD |
| `Neo4j authentication failed` | Wrong Neo4j password | Update NEO4J_PASSWORD in .env |
| `Azure OpenAI 401 Unauthorized` | Invalid API key | Verify AZURE_OPENAI_KEY |
| `Port 3000 already in use` | Another service using port | Change PORT in .env or stop conflicting service |

---

## 5. Configuration Management

### 5.1 Slack Channel Configuration

To add new Slack channels for ingestion:

1. Get channel ID from Slack (right-click channel → View channel details → Copy ID)
2. Add to SLACK_CHANNEL_IDS in .env (comma-separated):
   ```bash
   SLACK_CHANNEL_IDS=C04D195JVGS,C08T43UHK9D,C123456789
   ```
3. Restart the application (if running)

### 5.2 Rate Limiting Configuration

For high-volume environments, adjust rate limits:

```bash
# Disable ONLY in local development
DISABLE_RATE_LIMITING=false

# Dynamic rate controller
RATE_CTRL_MIN_CONCURRENCY=1
RATE_CTRL_MAX_CONCURRENCY=20
RATE_CTRL_INITIAL_CONCURRENCY=3
```

### 5.3 Feature Flags

Enable/disable features via environment variables:

```bash
# Phase 1-2 features (STABLE)
FF_NEO4J_SYNC=true
FF_TWO_PASS_LLM=true
FF_HALLUCINATION_GUARD=true

# Phase 3-4 features (EXPERIMENTAL)
FF_GRAPHRAG_INDEXER=false
FF_A2A_SERVER=false
FF_AGENT_GATEWAY=false
```

---

## 6. Monitoring Setup

### 6.1 SLO Dashboard

View real-time SLO status:

```bash
npm run slo:dashboard
```

**Output:**
```
╔══════════════════════════════════════════════════════════════════════╗
║                      SLO MONITORING DASHBOARD                        ║
╚══════════════════════════════════════════════════════════════════════╝

OVERALL HEALTH:
  ✅ Healthy:  6/6
  ⚠️  Warning:  0/6
  ❌ Critical: 0/6

SLO STATUS:
────────────────────────────────────────────────────────────────────────────
SLO Name                                   Target          Current         Status
────────────────────────────────────────────────────────────────────────────
ENTITY RESOLUTION ACCURACY 30D             >85%            92.34%          ✅ healthy
INGESTION UPTIME 24H                       >99%            99.8%           ✅ healthy
MCP TOOL P95 LATENCY 1H                    <5000ms         3245ms          ✅ healthy
NEO4J SYNC LATENCY 1H                      <30000ms        12500ms         ✅ healthy
EXTRACTION SUCCESS RATE 24H                >95%            97.2%           ✅ healthy
GRAPH CONSISTENCY                          <1%             0.3%            ✅ healthy
────────────────────────────────────────────────────────────────────────────
```

### 6.2 Automated SLO Checks

Set up cron job to run SLO checks every 5 minutes:

```bash
crontab -e
```

Add:
```bash
*/5 * * * * cd /path/to/PM_cursor_system && npm run slo:check >> logs/slo_check.log 2>&1
```

### 6.3 Log Monitoring

Logs are written to:
- Application logs: `data/logs/application-YYYY-MM-DD.log`
- SLO check logs: `logs/slo_check.log`
- Ingestion logs: `logs/ingestion.log`

**Tail logs in real-time:**
```bash
tail -f data/logs/application-*.log
```

**Search logs:**
```bash
grep "ERROR" data/logs/application-*.log
jq 'select(.level=="error")' data/logs/application-*.log
```

---

## 7. Backup Configuration

### 7.1 PostgreSQL Backups

**Manual backup:**
```bash
./scripts/backup_database.sh
```

Creates backup at `data/backups/pg_YYYYMMDD_HHMMSS.sql.gz`

**Automated daily backups:**
```bash
crontab -e
```

Add:
```bash
0 2 * * * cd /path/to/PM_cursor_system && ./scripts/backup_database.sh >> logs/backup.log 2>&1
```

**Retention:** 30 days rolling (configure in backup script)

### 7.2 Neo4j Backups

Neo4j data can be fully reconstructed from PostgreSQL. To back up Neo4j:

```bash
docker exec pm_intel_neo4j neo4j-admin dump --database=neo4j --to=/data/backups/neo4j_backup.dump
```

### 7.3 Configuration Backups

Back up `.env` file securely:

```bash
cp .env .env.backup.$(date +%Y%m%d)
```

**⚠️ Never commit `.env` to version control!**

---

## 8. Troubleshooting Guide

### 8.1 Database Connection Issues

**Symptom:** `Cannot connect to PostgreSQL`

**Diagnosis:**
```bash
docker compose ps  # Check if postgres container is running
docker compose logs postgres  # Check logs
psql -h localhost -U postgres -d pm_intelligence  # Test connection
```

**Solutions:**
- Restart PostgreSQL: `docker compose restart postgres`
- Check credentials in .env
- Verify port 5432 is not blocked by firewall

### 8.2 Neo4j Sync Lag

**Symptom:** neo4j_backlog_pending > 100

**Diagnosis:**
```bash
npm run slo:dashboard  # Check Neo4j sync latency
curl http://localhost:3000/health | jq '.neo4j_backlog_pending'
```

**Solutions:**
- Check Neo4j is healthy: `docker compose logs neo4j`
- Manually trigger sync: (feature to be added)
- Increase Neo4j memory: Edit docker-compose.yml, restart

### 8.3 LLM API Failures

**Symptom:** Extraction failures, entity resolution falling back to string matching

**Diagnosis:**
```bash
grep "LLM" data/logs/application-*.log | grep "ERROR"
```

**Solutions:**
- Verify Azure OpenAI key: Check AZURE_OPENAI_KEY in .env
- Check rate limits: Azure OpenAI dashboard
- Test connection: `curl -H "api-key: $AZURE_OPENAI_KEY" $AZURE_OPENAI_ENDPOINT/openai/deployments`

### 8.4 High Memory Usage

**Symptom:** System slowing down, OOM errors

**Diagnosis:**
```bash
docker stats  # Check container memory usage
top  # Check node process memory
```

**Solutions:**
- Increase Docker memory limits in docker-compose.yml
- Restart services: `docker compose restart`
- Check for memory leaks in logs

### 8.5 Ingestion Stuck

**Symptom:** Ingestion queue growing, messages not processing

**Diagnosis:**
```bash
npm run slo:dashboard  # Check ingestion uptime
curl http://localhost:3000/health | jq '.ingestion_queue'
```

**Solutions:**
- Check Redis: `docker compose logs redis`
- Restart application
- Clear failed jobs: (manual database cleanup)

---

## 9. Rollback Procedures

### 9.1 Application Rollback

**To previous version:**

```bash
# Stop current version
pm2 stop pm-intelligence  # or Ctrl+C if running in terminal

# Checkout previous version
git log --oneline  # Find commit hash
git checkout <previous-commit-hash>

# Reinstall dependencies
npm install

# Start application
npm start
```

### 9.2 Database Rollback

**Restore from backup:**

```bash
# Stop application
pm2 stop pm-intelligence

# Restore PostgreSQL
gunzip < data/backups/pg_20240115_020000.sql.gz | psql -U postgres -d pm_intelligence

# Restart application
npm start

# Verify health
curl http://localhost:3000/health
```

### 9.3 Configuration Rollback

**Revert environment changes:**

```bash
# Restore previous .env
cp .env.backup.20240115 .env

# Restart application
pm2 restart pm-intelligence
```

### 9.4 Neo4j Rollback

If Neo4j data is corrupted, trigger full resync from PostgreSQL:

```bash
# Clear Neo4j database
docker exec pm_intel_neo4j cypher-shell -u neo4j -p <password> "MATCH (n) DETACH DELETE n"

# Trigger resync (feature to be added)
# For now, restart application and it will sync gradually
npm restart
```

---

## Emergency Contacts

| Role | Contact | Availability |
|------|---------|--------------|
| System Admin | admin@company.com | 24/7 |
| Database Admin | dba@company.com | Business hours |
| Azure Support | Azure Portal | 24/7 |

---

## Post-Deployment Checklist

After deployment, verify:

- [ ] All services healthy (`npm run slo:dashboard`)
- [ ] Entity resolution accuracy >85%
- [ ] MCP tools responding within SLOs
- [ ] Slack ingestion working (test with sample channel)
- [ ] Backups configured and tested
- [ ] SLO monitoring running (cron job)
- [ ] Logs rotating correctly
- [ ] Documentation updated

---

## Additional Resources

- [Architecture Documentation](./02_ARCHITECTURE.md)
- [API Reference](./API_REFERENCE.md)
- [User Guide](./USER_GUIDE.md)
- [Troubleshooting FAQ](./FAQ.md)
- [GitHub Issues](https://github.com/your-org/pm-intelligence/issues)
