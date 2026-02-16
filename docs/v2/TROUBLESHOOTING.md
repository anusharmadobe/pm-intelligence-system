# PM Intelligence System V2 — Troubleshooting Guide

> **Last Updated:** 2026-02-11

---

## Quick Health Check

Before diving into specific issues, run a full health check:

```
Ask ChatGPT Enterprise, the UI (`/ui`), or Claude: "What's the system status?"
```

Or via API:
```bash
curl http://localhost:3000/api/health
```

This tells you which services are healthy, degraded, or down.

---

## Common Issues

### 1. Interfaces Not Responding (ChatGPT Actions / UI / MCP)

**Symptoms:** ChatGPT Actions or the UI times out, or Claude can't connect to MCP tools.

**Diagnosis:**
```bash
# Is the main process running?
ps aux | grep "node.*dist"

# Are Docker services running?
docker compose ps

# Check Agent Gateway health
curl http://localhost:3000/api/agents/v1/health

# Verify feature flags
grep "FF_AGENT_GATEWAY" .env
grep "FF_A2A_SERVER" .env

# Check MCP server specifically (optional)
curl http://localhost:3001/health  # (if HTTP-based MCP)
```

**Solutions:**

| Cause | Fix |
|-------|-----|
| Main process not running | `npm run dev` or `npm start` |
| Docker services down | `docker compose up -d` |
| Port conflict on 3000 or 3001 | Check `lsof -i :3000` and kill conflicting process |
| MCP not configured in Claude (optional) | Check `.cursor/mcp.json` configuration |
| MCP requests return 401 | Ensure `MCP_API_KEY` matches the client header |
| Agent registration returns 401 | Ensure `AGENT_REGISTRATION_SECRET` matches `X-Registration-Secret` |
| Environment validation failed | Check startup logs for `FATAL: Missing required environment variables` |
| Agent Gateway disabled | Set `FF_AGENT_GATEWAY=true` and restart |
| A2A Server disabled | Set `FF_A2A_SERVER=true` and restart |
| ChatGPT Action can't reach spec | Ensure `http://<host>:3000/openapi/agent_gateway.json` is reachable |
| Scheduled ingestion not running | Set `START_INGESTION_SCHEDULER=true` and restart |

---

### 2. Database Connection Failures

**Symptoms:** Errors mentioning PostgreSQL connection refused, ECONNREFUSED on port 5432.

**Diagnosis:**
```bash
# Is PostgreSQL running?
docker compose ps postgres

# Can you connect directly?
psql $DATABASE_URL -c "SELECT 1"

# Check PostgreSQL logs
docker compose logs postgres
```

**Solutions:**

| Cause | Fix |
|-------|-----|
| PostgreSQL container not started | `docker compose up -d postgres` |
| Wrong DATABASE_URL in .env | Verify `DATABASE_URL` matches Docker Compose config |
| Database doesn't exist | `docker compose exec postgres createdb -U pm_intel pm_intelligence` |
| Migrations not run | `npm run migrate` |
| Connection pool exhausted | Restart the application (connections leak in rare cases) |

---

### 3. Neo4j Connection Failures

**Symptoms:** Errors mentioning Neo4j, Bolt protocol, connection refused on port 7687.

**Diagnosis:**
```bash
# Is Neo4j running?
docker compose ps neo4j

# Can you reach the HTTP browser?
curl http://localhost:7474

# Check Neo4j logs
docker compose logs neo4j
```

**Solutions:**

| Cause | Fix |
|-------|-----|
| Neo4j container not started | `docker compose up -d neo4j` |
| Wrong NEO4J_PASSWORD | Must match the password set in Docker Compose / first boot |
| Neo4j still starting up | Wait 30-60 seconds — Neo4j takes longer to start than PostgreSQL |
| Out of memory | Increase `NEO4J_server_memory_heap_max__size` in Docker Compose |

**Note:** The system degrades gracefully when Neo4j is down — PostgreSQL-based queries still work, but graph traversal queries are unavailable.

---

### 4. Python Service Failures

**Symptoms:** Document parsing or GraphRAG indexer returns errors or times out.

**Diagnosis:**
```bash
# Check if services are running
curl http://localhost:5002/health  # Document Parser
curl http://localhost:5003/health  # GraphRAG Indexer

# Check Python process
ps aux | grep uvicorn
```

**Solutions:**

| Cause | Fix |
|-------|-----|
| Python service not started | `python -m uvicorn python.document_parser.main:app --port 5002` / `python -m uvicorn python.graphrag_indexer.main:app --port 5003` |
| Missing Python dependencies | `source .venv/bin/activate && pip install -r requirements.txt` |
| Wrong Python version | Must be 3.10+. Check with `python3 --version` |
| poppler not installed (doc parser) | macOS: `brew install poppler`. Linux: `apt install poppler-utils` |
| 401 Unauthorized from Python services | Ensure `PYTHON_SERVICE_KEY` matches `X-Internal-Key` |
| Service crash | Check the terminal where the service is running for stack traces |

**Circuit breaker:** If a Python service fails repeatedly, the TypeScript app activates a circuit breaker and stops calling it for 60 seconds. After the cooldown, it retries. Check logs for "circuit breaker" messages.

---

### 5. Entity Resolution Quality Issues

**Symptoms:** Entities being incorrectly merged or not merged when they should be.

**Investigation:**
```
Ask ChatGPT Enterprise, the UI, or Claude: "What are the entity resolution stats?"
Ask ChatGPT Enterprise, the UI, or Claude: "Show me entity reviews"
```

**Common causes and fixes:**

| Problem | Cause | Fix |
|---------|-------|-----|
| Too many false merges | Auto-merge threshold too low | Increase `ER_AUTO_MERGE_THRESHOLD` (default 0.9) |
| Too many missed merges | Auto-merge threshold too high | Decrease `ER_AUTO_MERGE_THRESHOLD` |
| Abbreviation not matched | Missing alias | Add alias: "Add alias 'SSO' for 'Single Sign-On'" |
| Different entities merged | Context not considered | Split the entity and provide notes explaining the difference |
| Accuracy declining | Model drift or new data patterns | Review and correct more merges; retrain thresholds |

**Pro tip:** The first 2 weeks require more entity review effort. After that, the system learns from your feedback and the review queue shrinks significantly.

---

### 6. Ingestion Failures

**Symptoms:** Uploaded documents don't appear in the knowledge graph, or you get errors during upload.

**Investigation:**
```
Ask ChatGPT Enterprise, the UI, or Claude: "Are there any failed processing items?"  (checks DLQ)
```

**Common causes:**

| Error | Cause | Fix |
|-------|-------|-----|
| "File exceeds maximum size of 50MB" | File too large | Split the file or increase `MAX_FILE_SIZE_MB` |
| "Unsupported file type" | Format not in allowlist | Convert to a supported format (pdf, docx, pptx, xlsx, csv, txt) |
| "File content does not match declared type" | File renamed with wrong extension | Ensure the file extension matches the actual content |
| "File contains executable content" | Macros detected in Office file | Save the file without macros |
| "Document truncated" | Document exceeds page/row limit (500 pages, 100K rows) | Split into smaller files |
| DLQ item: "LLM extraction failed" | Azure OpenAI rate limit or timeout | Retry: "Retry the failed DLQ item" |
| `fetch failed` during forum ingestion | transient Azure/network transport failure | Increase retries/timeouts (`AZURE_RETRY_*`, `AZURE_REQUEST_TIMEOUT_MS`) and rerun replay |

**Replay failed forum signals:**
```bash
# Re-run only failed signals still missing extraction
npx ts-node --transpile-only scripts/ingest_community_forums_v2.ts --replay-failures

# Use a bounded retry window first
npx ts-node --transpile-only scripts/ingest_community_forums_v2.ts --replay-failures --replay-limit=200
```

**Inspect failed ledger:**
```sql
SELECT status, COUNT(*) FROM failed_signal_attempts GROUP BY status;
SELECT * FROM failed_signal_attempts WHERE status = 'pending' ORDER BY failed_at DESC LIMIT 20;
```

---

### 7. Slow Query Performance

**Symptoms:** ChatGPT Actions, UI, or MCP responses take >5 seconds.

**Investigation:**
```
Ask ChatGPT Enterprise, the UI, or Claude: "What's the system health?"
```

Check `duration_ms` in application logs (`data/logs/`).

**Common causes:**

| Cause | Fix |
|-------|-----|
| Neo4j missing indexes | Run Neo4j index creation scripts (check `specs/v2/04_KNOWLEDGE_GRAPH.md`) |
| Large result sets | Add `limit` to your queries ("Show me the top 10...") |
| Azure OpenAI latency | Check OpenAI status page; reduce LLM calls in the query path |
| PostgreSQL table bloat | Run `VACUUM ANALYZE` on large tables |
| Too many concurrent queries | Queue is backing up — check BullMQ queue depth |

---

### 8. Agent Gateway / A2A Issues

**Symptoms:** External agents can't connect, get 401/403/429 errors.

**Diagnosis:**
```bash
# Check Agent Card is served
curl http://localhost:3000/.well-known/agent.json

# Check if feature flags are enabled
grep FF_A2A_SERVER .env
grep FF_AGENT_GATEWAY .env

# Test with a known API key
curl -H "X-API-Key: $AGENT_API_KEY" \
  http://localhost:3000/api/agents/v1/health
```

**Solutions:**

| Error | Cause | Fix |
|-------|-------|-----|
| 401 Unauthorized | Invalid or missing API key | Verify the API key; rotate if lost |
| 403 Forbidden | Agent lacks permission | Check `agent_registry.permissions` for this agent |
| 429 Too Many Requests | Rate limit exceeded | Wait for reset; increase `rate_limit_per_minute` if needed |
| 503 Service Unavailable | Agent circuit breaker open | Agent had too many errors; wait for cooldown or fix underlying issue |
| Connection refused | Feature flag disabled | Set `FF_A2A_SERVER=true` and `FF_AGENT_GATEWAY=true` in .env |

### 9. ChatGPT Enterprise Actions Issues

**Symptoms:** ChatGPT says the Action is unavailable or returns 401/403.

**Checks:**
1. Verify API key:
   ```bash
   curl -X POST http://localhost:3000/api/agents/v1/auth/register \
     -H "Content-Type: application/json" \
     -d '{ "agent_name": "chatgpt-enterprise", "agent_class": "orchestrator", "permissions": { "read": true } }'
   ```
2. Confirm ChatGPT Action header uses `X-API-Key`
3. Ensure the base URL in ChatGPT is reachable from the internet (no localhost)

### 10. UI Not Loading

**Symptoms:** `/ui` returns 404 or blank page.

**Checks:**
1. Verify static UI mount: `http://localhost:3000/ui`
2. Confirm `frontend/` assets exist
3. Restart `npm run dev`

---

### 9. Redis / Event Bus Issues

**Symptoms:** Agents not receiving events, BullMQ jobs stuck.

**Diagnosis:**
```bash
# Is Redis running?
docker compose ps redis
redis-cli ping

# Check BullMQ queue depth
redis-cli LLEN bull:extraction:wait
redis-cli LLEN bull:cleanup:wait
```

**Solutions:**

| Cause | Fix |
|-------|-----|
| Redis not running | `docker compose up -d redis` |
| Redis out of memory | Check `maxmemory` setting; increase if needed |
| BullMQ workers crashed | Restart the main process (workers are in-process) |
| Event bus disabled | Set `FF_EVENT_BUS=true` in .env |

---

### 10. Data Inconsistency (PostgreSQL vs Neo4j)

**Symptoms:** Graph queries return different results than direct queries. Entity counts don't match.

**Investigation:**
```
Ask ChatGPT Enterprise, the UI, or Claude: "What's the system health?"
# Look for PG↔Neo4j divergence metric
```

**Solutions:**

1. Check the sync backlog: `SELECT COUNT(*) FROM neo4j_sync_backlog WHERE status = 'pending'`
2. If backlog is large: the sync worker may be backed up. Restart the process.
3. If backlog is empty but data differs: run the nightly consistency check manually.
4. As a last resort: re-sync from PostgreSQL to Neo4j using the backfill script.

**Remember:** PostgreSQL is always the source of truth. Neo4j is a derived view.

---

## Escalation Path

If you can't resolve an issue:

1. **Check logs:** `data/logs/` — search for the `correlation_id` from the failed request
2. **Check DLQ:** Ask ChatGPT Enterprise, the UI, or Claude "What's in the dead letter queue?"
3. **Check GitHub issues:** Your team may have documented known issues
4. **Restart services:** Sometimes a clean restart resolves transient issues
5. **Contact the developer** with: the error message, correlation ID, and steps to reproduce

---

## Log Locations

| Log | Location | Format |
|-----|----------|--------|
| Application logs | `data/logs/app-YYYY-MM-DD.log` | JSON (structured) |
| PostgreSQL logs | `docker compose logs postgres` | Plain text |
| Neo4j logs | `docker compose logs neo4j` | Plain text |
| Redis logs | `docker compose logs redis` | Plain text |
| Python service logs | Terminal where service is running | Plain text |

**Tip:** Use `jq` to parse structured logs:
```bash
cat data/logs/app-2026-02-09.log | jq 'select(.level == "error")'
cat data/logs/app-2026-02-09.log | jq 'select(.correlation_id == "abc-123")'
```
