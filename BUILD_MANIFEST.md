# PM Intelligence V2 — Build Manifest

> **Purpose:** Ordered task list for autonomous coding agents. Complete tasks sequentially.
> **Estimated total build time:** 12-16 hours of autonomous coding.
> **Before starting:** Read `AGENTS.md` for conventions and rules.

---

## Phase 0: Bootstrap (30 min)

These tasks set up infrastructure. They are already partially done — verify and fill gaps.

### Task 0.1: Docker Compose
- **Files:** `docker-compose.yml` (already created at root)
- **Spec:** `specs/v2/02_ARCHITECTURE.md` §5.2
- **Do:** Verify `docker-compose.yml` exists with PostgreSQL (pgvector), Neo4j CE, Redis. Run `docker compose up -d` and verify all 3 are healthy.
- **Validation:** `docker compose ps` shows 3 services healthy

### Task 0.2: Python Environment
- **Files:** `requirements.txt`, `python/entity_resolution/`, `python/document_parser/`, `python/graphrag_indexer/`
- **Spec:** `specs/v2/11_THIRD_PARTY_TECH.md` §2
- **Do:** Create `requirements.txt` at root. Create directory structure for 3 Python microservices. Create minimal `main.py` with FastAPI health endpoint for each.
- **Validation:** `curl http://localhost:5001/health` returns 200 for each service

### Task 0.3: V2 Environment Variables
- **Files:** `.env.example` (append V2 section), `backend/config/env.ts` (add V2 vars)
- **Spec:** `specs/v2/11_THIRD_PARTY_TECH.md` §7
- **Do:** Add all V2 environment variables to `.env.example`. Update `backend/config/env.ts` to load V2 vars with defaults. Add `DATABASE_URL` construction from V1 vars. Add feature flags (`FF_*`).
- **Validation:** `npm run build` passes

### Task 0.4: V2 Database Migrations
- **Files:** `backend/db/migrations/V2_001_entity_registry.sql` through `V2_010_audit_log.sql`
- **Spec:** `specs/v2/15_COMPONENT_REGISTRY.md` §5 (all table schemas)
- **Do:** Create SQL migration files for ALL V2 tables: `entity_registry`, `entity_aliases`, `entity_resolution_log`, `entity_merge_history`, `neo4j_sync_backlog`, `feedback_log`, `agent_registry`, `agent_activity_log`, `agent_version_history`, `system_metrics`, `alerts`, `prompt_versions`, `source_registry`, `audit_log`. Include indexes and constraints from specs.
- **Validation:** Run migrations; `\dt` in psql shows all V2 tables

### Task 0.5: Neo4j Schema Setup
- **Files:** `backend/neo4j/schema.ts`
- **Spec:** `specs/v2/04_KNOWLEDGE_GRAPH.md` §1-2
- **Do:** Create Neo4j client connection. Write a schema initialization script that creates constraints, indexes, and node labels. Run on startup if Neo4j is available.
- **Validation:** Neo4j browser at localhost:7474 shows constraints created

---

## Phase 1: Entity Resolution Foundation (3-4 hours)

### Task 1.1: Entity Registry Service
- **Files:** `backend/services/entity_registry_service.ts`
- **Spec:** `specs/v2/03_ENTITY_RESOLUTION.md` §1-3
- **Do:** CRUD for `entity_registry` and `entity_aliases`. Methods: `createEntity`, `findByName`, `findByAlias`, `search`, `deactivate`, `getWithAliases`. All queries parameterized (no SQL injection).
- **Validation:** `npm run build` passes; write a test that creates and retrieves an entity

### Task 1.2: Entity Resolution Scoring (TypeScript side)
- **Files:** `backend/services/entity_matching_service.ts`
- **Spec:** `specs/v2/03_ENTITY_RESOLUTION.md` §4-5
- **Do:** Implement multi-signal scoring: string similarity (Levenshtein, Jaro-Winkler), embedding cosine similarity, type match. Combine into a composite score. Apply thresholds from env vars (`ER_AUTO_MERGE_THRESHOLD`, `ER_HUMAN_REVIEW_THRESHOLD`, `ER_REJECT_THRESHOLD`). 
- **Validation:** Unit test with known entity pairs produces expected scores

### Task 1.3: Python Entity Resolution Service
- **Files:** `python/entity_resolution/main.py`, `python/entity_resolution/matcher.py`, `python/entity_resolution/requirements.txt`
- **Spec:** `specs/v2/03_ENTITY_RESOLUTION.md` §6-7
- **Do:** FastAPI service on port 5001. Endpoints: `POST /match` (takes two entity names, returns similarity score), `POST /batch_match` (takes a list of entity pairs), `GET /health`. Use pyJedAI for blocking and matching. Fall back to basic string similarity if pyJedAI fails.
- **Validation:** `curl -X POST http://localhost:5001/match -d '{"name_a":"Acme Corp","name_b":"Acme Corporation"}'` returns a score > 0.8

### Task 1.4: Entity Resolution Orchestrator
- **Files:** `backend/services/entity_resolution_service.ts`
- **Spec:** `specs/v2/03_ENTITY_RESOLUTION.md` §8
- **Do:** Orchestrates the full ER pipeline: (1) receive extracted entity mentions, (2) check for exact match in entity_registry, (3) if no exact match, call TypeScript matcher + Python matcher, (4) combine scores, (5) auto-merge if above threshold, (6) queue for human review if in medium range, (7) create new entity if below threshold. Log all decisions in `entity_resolution_log`.
- **Validation:** Run a test: ingest "Acme Corp" then "Acme Corporation" → should auto-merge or queue for review

### Task 1.5: Feedback Service
- **Files:** `backend/services/feedback_service.ts`
- **Spec:** `specs/v2/07_FEEDBACK_LOOPS.md` §1-3
- **Do:** CRUD for `feedback_log`. Methods: `getPendingReviews`, `confirmMerge`, `rejectMerge`, `addAlias`, `splitEntity`, `recordFeedback`. Each merge/reject updates entity_registry and entity_aliases. Log in audit_log.
- **Validation:** Create a pending review, confirm it, verify entity_registry updated

### Task 1.6: Neo4j Sync Service
- **Files:** `backend/services/neo4j_sync_service.ts`, `backend/neo4j/client.ts`
- **Spec:** `specs/v2/04_KNOWLEDGE_GRAPH.md` §3
- **Do:** Neo4j Bolt driver connection (from `neo4j-driver` npm package). Sync entity changes from PG to Neo4j: when entity_registry changes, add to `neo4j_sync_backlog`, background worker processes backlog and runs Cypher MERGE statements. Methods: `syncEntity`, `syncRelationship`, `processBacklog`, `runConsistencyCheck`.
- **Validation:** Create an entity in PG → verify it appears in Neo4j within 10 seconds

---

## Phase 2: Extraction & Ingestion (3-4 hours)

### Task 2.1: Two-Pass LLM Extraction Service
- **Files:** `backend/services/llm_extraction_service.ts`
- **Spec:** `specs/v2/02_ARCHITECTURE.md` Extraction Plane, `specs/v2/08_DATA_CONTRACTS.md` §6.1
- **Do:** Two-pass extraction: (1) GPT-4o-mini first pass for entity extraction (customers, features, issues, themes, relationships, sentiment, urgency), (2) if >3 entities or ambiguous, route to GPT-4o for second pass. Use existing `llm_service.ts` provider. Validate output against Zod schema. Hallucination guard: extracted entity names must appear in source content.
- **Validation:** Extract entities from a sample Slack message; verify output matches expected schema

### Task 2.2: Normalizer Service
- **Files:** `backend/ingestion/normalizer_service.ts`
- **Spec:** `specs/v2/06_INGESTION_ADAPTERS.md` §3
- **Do:** Normalize all ingested content: UTF-8 validation, null byte stripping, control char removal, timestamp normalization to UTC, content hashing for dedup, content length validation. Sanitize HTML for web scrapes.
- **Validation:** Pass a string with null bytes and non-UTF-8 chars → verify clean output

### Task 2.3: Transcript Adapter
- **Files:** `backend/ingestion/transcript_adapter.ts`
- **Spec:** `specs/v2/06_INGESTION_ADAPTERS.md` §2.2
- **Do:** Parse meeting transcripts from plain text, VTT, or SRT format. Split into segments by speaker turn. Extract metadata (meeting type, date, participants if available). Pass through normalizer. Validate file size and format per `08_DATA_CONTRACTS.md` §5.1.
- **Validation:** Parse a sample VTT file → verify segments are extracted

### Task 2.4: Document Adapter
- **Files:** `backend/ingestion/document_adapter.ts`
- **Spec:** `specs/v2/06_INGESTION_ADAPTERS.md` §2.3
- **Do:** Accept PDF, DOCX, PPTX, XLSX, CSV files. Call Python document_parser service for parsing. Validate file size, MIME type (magic bytes), no macros, page limits. Pass parsed text through normalizer.
- **Validation:** Upload a sample PDF → verify text extracted

### Task 2.5: Python Document Parser Service
- **Files:** `python/document_parser/main.py`, `python/document_parser/parsers.py`, `python/document_parser/requirements.txt`
- **Spec:** `specs/v2/06_INGESTION_ADAPTERS.md` §2.3
- **Do:** FastAPI on port 5002. Endpoint: `POST /parse` accepts a file, returns parsed text segments. Use Unstructured.io for PDF/DOCX/PPTX parsing. Use openpyxl for XLSX. Return structured segments with page/slide/row metadata.
- **Validation:** `curl -X POST -F 'file=@sample.pdf' http://localhost:5002/parse` returns text

### Task 2.6: Web Scrape Adapter
- **Files:** `backend/ingestion/web_scrape_adapter.ts`
- **Spec:** `specs/v2/06_INGESTION_ADAPTERS.md` §2.4
- **Do:** Accept JSON input from external crawler bot. Validate URL, content length, strip script/style tags, sanitize HTML. Pass through normalizer.
- **Validation:** Process a sample web scrape JSON → verify clean content extracted

### Task 2.7: Full Ingestion Pipeline
- **Files:** `backend/services/ingestion_pipeline_service.ts`
- **Spec:** `specs/v2/02_ARCHITECTURE.md` Ingestion → Extraction → ER → KG flow
- **Do:** Orchestrate the full pipeline: (1) adapter normalizes input → raw signal, (2) store in `signals` table, (3) run LLM extraction, (4) store extractions, (5) run entity resolution on each extracted entity, (6) sync to Neo4j, (7) generate embeddings. Use BullMQ for async job processing.
- **Validation:** Ingest a sample transcript → verify entities appear in entity_registry and Neo4j

---

## Phase 3: MCP Server & Intelligence (3-4 hours)

### Task 3.1: MCP Server Foundation
- **Files:** `backend/mcp/server.ts`, `backend/mcp/tool_registry.ts`
- **Spec:** `specs/v2/05_MCP_SERVER.md` §2
- **Do:** Create MCP server using `@modelcontextprotocol/sdk`. Register tool schemas and handlers. Handle tool discovery, invocation, and error responses. Mount alongside Express on port 3001 (or stdio mode).
- **Validation:** MCP server starts and lists available tools

### Task 3.2: Search & Query Tools (5 tools)
- **Files:** `backend/mcp/tools/search_signals.ts`, `get_customer_profile.ts`, `get_feature_health.ts`, `get_issue_impact.ts`, `find_related_entities.ts`
- **Spec:** `specs/v2/05_MCP_SERVER.md` §3 (Search & Query section)
- **Do:** Implement each tool. They query PostgreSQL and Neo4j, format responses as structured text. Use existing `hybrid_search_service.ts` for search_signals. Create `intelligence_service.ts` for customer profiles, feature health, issue impact.
- **Validation:** Call each tool with sample params → verify structured response

### Task 3.3: Intelligence Tools (4 tools)
- **Files:** `backend/mcp/tools/get_heatmap.ts`, `get_trends.ts`, `get_roadmap_priorities.ts`, `get_strategic_insights.ts`
- **Spec:** `specs/v2/05_MCP_SERVER.md` §3 (Intelligence section)
- **Do:** Heatmap aggregates issues×customers from Neo4j. Trends queries signal volumes over time windows. Roadmap priorities combines severity, frequency, customer segment weighting. Strategic insights uses LLM to synthesize patterns.
- **Validation:** Call get_heatmap → verify matrix output

### Task 3.4: Entity Management Tools (6 tools)
- **Files:** `backend/mcp/tools/review_pending_entities.ts`, `confirm_entity_merge.ts`, `reject_entity_merge.ts`, `add_entity_alias.ts`, `list_entities.ts`, `split_entity.ts`
- **Spec:** `specs/v2/05_MCP_SERVER.md` §3 (Entity Management section)
- **Do:** Thin wrappers around `feedback_service.ts` and `entity_registry_service.ts`. Format responses for conversational display.
- **Validation:** Call review_pending_entities → see formatted list

### Task 3.5: Ingestion Tools (2 tools)
- **Files:** `backend/mcp/tools/ingest_transcript.ts`, `ingest_document.ts`
- **Spec:** `specs/v2/05_MCP_SERVER.md` §3 (Ingestion section)
- **Do:** Accept content/files, validate, pass to ingestion pipeline. Return extraction summary.
- **Validation:** Call ingest_transcript with sample text → verify pipeline processes it

### Task 3.6: Report & Artifact Tools (3 tools)
- **Files:** `backend/mcp/tools/generate_artifact.ts`, `list_opportunities.ts`, `generate_shareable_report.ts`
- **Spec:** `specs/v2/05_MCP_SERVER.md` §3
- **Do:** generate_artifact creates PRDs/JIRA issues from entity data. list_opportunities queries existing opportunities. generate_shareable_report creates self-contained markdown reports with data from the knowledge graph.
- **Validation:** Generate a report → verify it contains entity data and provenance

### Task 3.7: Remaining MCP Tools (13 tools)
- **Files:** Various in `backend/mcp/tools/`
- **Spec:** `specs/v2/05_MCP_SERVER.md` §3
- **Do:** Implement: `browse_knowledge_graph`, `get_knowledge_summary`, `get_provenance`, `get_entity_resolution_stats`, `what_if_analysis`, `export_data`, `get_system_health`, `run_pipeline`, `get_dlq_status`, `retry_dlq_item`, `review_agent_outputs`, `rollback_agent`, `list_registered_agents`, `deactivate_agent`, `configure_stakeholder_access`.
- **Validation:** All 35 tools registered and callable

---

## Phase 4: Agent Infrastructure (2-3 hours)

### Task 4.1: Agent Registry & Gateway
- **Files:** `backend/agents/gateway.ts`, `backend/agents/agent_registry_service.ts`
- **Spec:** `specs/v2/16_AGENTIC_INTERACTIONS.md` §5
- **Do:** Express router at `/api/agents/v1/`. API key auth middleware. Rate limiting per agent. Agent registration, key generation, key rotation. Mount on existing Express app in server.ts.
- **Validation:** Register an agent → get API key → call `/api/agents/v1/health` with key

### Task 4.2: A2A Server
- **Files:** `backend/agents/a2a_server.ts`, `backend/agents/agent_card.json`
- **Spec:** `specs/v2/16_AGENTIC_INTERACTIONS.md` §10
- **Do:** JSON-RPC 2.0 handler at `/a2a`. Agent Card served at `/.well-known/agent.json`. 8 skills mapped to service layer. Task lifecycle: submitted → working → completed.
- **Validation:** `curl http://localhost:3000/.well-known/agent.json` returns valid Agent Card

### Task 4.3: Event Bus
- **Files:** `backend/agents/event_bus.ts`
- **Spec:** `specs/v2/16_AGENTIC_INTERACTIONS.md` §5.3
- **Do:** Redis Streams-based event publishing and subscription. Event types: signal.ingested, entity.created, entity.merged, issue.escalated, report.generated. SSE endpoint for agents: `GET /api/agents/v1/events/stream`.
- **Validation:** Publish an event → verify SSE client receives it

### Task 4.4: Cleanup & Archival Jobs
- **Files:** `backend/jobs/cleanup_jobs.ts`
- **Spec:** `specs/v2/09_SECURITY_GUARDRAILS.md` §4.2.3
- **Do:** BullMQ scheduled jobs: cleanup_uploaded_files (every 6h), cleanup_raw_metrics (daily), archive_old_signals (weekly). Register in job queue.
- **Validation:** Job runs without error; uploaded file older than retention is deleted

---

## Phase 5: Integration & Polish (1-2 hours)

### Task 5.1: V1 Entity Backfill Script
- **Files:** `scripts/backfill_v1_entities.ts`
- **Spec:** `specs/v2/14_BUILD_PLAN.md` §5
- **Do:** Read all unique entity names from V1 `signal_extractions`. Deduplicate. Create entries in `entity_registry`. Create aliases from variants. Sync to Neo4j.
- **Validation:** Run script → entity_registry has > 0 entries matching V1 data

### Task 5.2: System Health Aggregation
- **Files:** `backend/services/health_service.ts`
- **Spec:** `specs/v2/02_ARCHITECTURE.md` §6.3
- **Do:** Aggregate health status from all services (PostgreSQL, Neo4j, Redis, Python services). Report SLO metrics. Expose via `get_system_health` MCP tool and `/api/health` endpoint.
- **Validation:** `curl http://localhost:3000/api/health` returns all-service status

### Task 5.3: MCP Server Configuration
- **Files:** `.cursor/mcp.json` (update if needed)
- **Spec:** `specs/v2/05_MCP_SERVER.md` §2
- **Do:** Ensure MCP server configuration is correct for Claude Code / Cursor integration. Test that Claude can discover and call tools.
- **Validation:** Claude Code can list PM Intelligence tools

### Task 5.4: Update README
- **Files:** `README.md`
- **Do:** Update the project README with V2 setup instructions, architecture overview, and links to docs and specs.
- **Validation:** README accurately describes how to set up and run V2

---

## Validation Checkpoints

After completing each phase, run these checks:

### After Phase 0:
```bash
docker compose ps                    # 3 services healthy
npm run build                        # TypeScript compiles
curl http://localhost:5001/health     # Python ER service up
psql $DATABASE_URL -c '\dt'          # V2 tables exist
```

### After Phase 1:
```bash
npm run build
npm test                             # Existing V1 tests still pass
# Manually: create entity, verify in PG and Neo4j
```

### After Phase 2:
```bash
npm run build
# Manually: ingest a transcript, verify entities extracted and in graph
```

### After Phase 3:
```bash
npm run build
# Manually: call MCP tools via Claude or test script
```

### After Phase 4:
```bash
npm run build
curl http://localhost:3000/.well-known/agent.json    # Agent Card served
curl http://localhost:3000/api/agents/v1/health       # Gateway responds
```

---

## Dependencies to Install

### Node.js (add to package.json):
```
neo4j-driver           — Neo4j Bolt driver
ioredis                — Redis client (for BullMQ + event bus)
bullmq                 — Job queue
multer                 — File upload handling
file-type              — MIME type detection (magic bytes)
@types/multer          — TypeScript types for multer
```

### Python (in requirements.txt):
```
fastapi                — Web framework for microservices
uvicorn                — ASGI server
pyjedai                — Entity resolution library
unstructured           — Document parsing
openpyxl               — Excel parsing
python-multipart       — File upload handling for FastAPI
httpx                  — HTTP client
sentence-transformers  — Embedding models (optional, for local embeddings)
```
