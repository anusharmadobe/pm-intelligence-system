# PM Intelligence V2 — Agent Coding Instructions

> **Purpose:** This file guides autonomous coding agents (Claude Code, Cursor Agent) building V2.
> **Read this FIRST before any coding.**

---

## Golden Rules

1. **V1 is SACRED.** Never modify files in `backend/api/server.ts` routes that already exist. Never drop or rename V1 database tables. V1 pipeline must keep working.
2. **Specs are truth.** When in doubt, read the spec file referenced in the BUILD_MANIFEST task. Do not invent new patterns — follow what's documented.
3. **PostgreSQL is the source of truth.** Neo4j is a derived mirror. Always write to PG first, then sync to Neo4j.
4. **Additive only.** Add new tables, new columns (nullable), new files, new services. Never drop, rename, or change types on existing columns.
5. **Test after each task.** Run `npm run build` (must pass), and run any task-specific validation command listed in BUILD_MANIFEST.md.
6. **If stuck for more than 3 attempts on the same error, skip the task and move to the next one.** Log what failed in a file called `BUILD_LOG.md` at the root.

---

## Project Conventions

### File Naming
- TypeScript services: `backend/services/{name}_service.ts` (snake_case)
- TypeScript adapters: `backend/ingestion/{source}_adapter.ts`
- MCP tools: `backend/mcp/tools/{tool_name}.ts`
- Python services: `python/{service_name}/main.py` (FastAPI)
- Database migrations: `backend/db/migrations/V2_{NNN}_{description}.sql`
- Tests: `backend/tests/{service_name}.test.ts` or `test/{category}/`

### Code Patterns
- Use Zod for all input validation (already a dependency)
- Use Winston for logging (already configured in `backend/utils/logger.ts`)
- Use the existing `backend/db/connection.ts` pool for PostgreSQL queries
- Use Express Router for new API routes (mount on existing app in server.ts)
- All new services are classes with constructor dependency injection
- All async functions must have try/catch with structured error logging
- Include `correlation_id` in all log entries and HTTP headers (`X-Correlation-ID`)

### Environment Variables
- V1 uses `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` — keep these working
- V2 adds a `DATABASE_URL` convenience variable (construct from the V1 vars if not provided)
- All V2-only variables are documented in `.env.example` under V2 sections
- Feature flags use `FF_` prefix: `FF_NEO4J_SYNC`, `FF_A2A_SERVER`, etc.

### Database
- V1 tables: `signals`, `signal_extractions`, `opportunities`, `judgments`, `artifacts`, `slack_channels`, `signal_embeddings`, `theme_hierarchy` — DO NOT MODIFY SCHEMAS
- V2 tables: `entity_registry`, `entity_aliases`, `entity_resolution_log`, `entity_merge_history`, `neo4j_sync_backlog`, `agent_registry`, `agent_activity_log`, `agent_version_history`, `feedback_log`, `system_metrics`, `alerts`, `prompt_versions`, `source_registry`, `audit_log`
- All V2 tables must be created via migration scripts in `backend/db/migrations/`

---

## DO NOT MODIFY (V1 Protected Files)

These files must not be significantly changed. You may add new imports or mount new routers, but do not rewrite logic:

```
backend/api/server.ts          — only ADD new route mounts, don't change existing routes
backend/db/connection.ts        — do not change the pool configuration
backend/services/llm_service.ts — do not change the provider abstraction
backend/services/embedding_service.ts — do not change
backend/services/embedding_provider.ts — do not change
backend/config/env.ts           — ADD new V2 vars, keep all V1 vars working
backend/utils/logger.ts         — do not change (extend if needed by creating a new file)
backend/validation/signal_validator.ts — do not change
package.json                    — ADD dependencies, do not remove existing ones
tsconfig.json                   — do not change
jest.config.js                  — extend if needed, do not remove existing config
```

---

## Infrastructure Dependencies

Before coding V2 features, ensure Docker services are running:

```bash
docker compose up -d          # Starts PostgreSQL (pgvector), Neo4j, Redis
docker compose ps             # Verify all 3 are healthy
```

Python services need a virtual environment:
```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

---

## Build Order

Follow the phases in `BUILD_MANIFEST.md` strictly. Each phase lists:
- **Spec reference** — which spec doc to read for this task
- **Files to create** — exact file paths
- **Acceptance criteria** — how to verify the task is done
- **Validation command** — what to run to check

Complete one phase before starting the next. Each phase builds on the previous.

---

## Error Handling

When you encounter errors:

1. **Build error (TypeScript):** Fix the type error. If it's in V1 code, do NOT modify V1 code — adjust your V2 code to match V1's types.
2. **Runtime error:** Check logs in terminal output. Add try/catch if missing.
3. **Database error:** Check that migrations ran. Check table exists with `\dt` in psql.
4. **Neo4j error:** Check that Neo4j container is healthy. Check Bolt connection on port 7687.
5. **Python error:** Check virtual environment is activated. Check Python version >= 3.10.

If a task fails 3 times, log the error in `BUILD_LOG.md` and move to the next task.

---

## Spec Reference Quick Map

| Topic | Spec File |
|-------|-----------|
| Overall architecture | `specs/v2/02_ARCHITECTURE.md` |
| Entity resolution | `specs/v2/03_ENTITY_RESOLUTION.md` |
| Neo4j schema | `specs/v2/04_KNOWLEDGE_GRAPH.md` |
| MCP tools (35 total) | `specs/v2/05_MCP_SERVER.md` |
| Ingestion adapters | `specs/v2/06_INGESTION_ADAPTERS.md` |
| Feedback loops | `specs/v2/07_FEEDBACK_LOOPS.md` |
| Data contracts & validation | `specs/v2/08_DATA_CONTRACTS.md` |
| Security | `specs/v2/09_SECURITY_GUARDRAILS.md` |
| Feature flags & env vars | `specs/v2/11_THIRD_PARTY_TECH.md` |
| Build phases | `specs/v2/14_BUILD_PLAN.md` |
| Component naming | `specs/v2/15_COMPONENT_REGISTRY.md` |
| Agent interactions | `specs/v2/16_AGENTIC_INTERACTIONS.md` |
