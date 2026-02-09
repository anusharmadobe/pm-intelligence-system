# V2 Build Plan — 90-Day Phased Rollout

> **Version:** 2.3 (Updated — migration plan, testing strategy, deployment validation)
> **Date:** 2026-02-09
> **Status:** Approved for Build

---

## 1. Principles

- **Ship incremental value.** Each phase delivers usable capability, not just infrastructure.
- **Entity resolution first.** It's the hardest problem and everything depends on it.
- **Test with real data.** Use actual Slack signals from V1 to validate V2 quality.
- **Existing system keeps running.** V1 pipeline continues while V2 is built alongside.
- **Budget buffer time.** Each phase includes a buffer week for integration testing and debugging.
- **Validate before progressing.** Each phase has explicit validation gates. Don't start next phase until gates pass.
- **Integration testing is not free.** TypeScript↔Python↔Neo4j integration has hidden complexity. Allocate dedicated time.

---

## 2. Phase 1: Knowledge Foundation (Weeks 1-4)

### Goal
Stand up the knowledge graph, entity registry, and resolution engine. Validate on existing Slack signals.

---

### Week 1: Neo4j + Entity Registry

**Deliverables:**
- [ ] Docker Compose file with Neo4j CE + Redis
- [ ] `knowledge_graph_service.ts` — Neo4j connection, constraint creation, CRUD operations
- [ ] Neo4j node schema: Customer, Feature, Issue, Theme, Signal, Opportunity (Cypher DDL)
- [ ] `entity_registry_service.ts` — CRUD for canonical entities
- [ ] `alias_management_service.ts` — Alias table management
- [ ] PostgreSQL migrations: `entity_registry`, `entity_aliases`, `entity_resolution_log`, `entity_merge_history` tables
- [ ] Neo4j health check endpoint
- [ ] npm packages added: `neo4j-driver`, `bullmq`, `ioredis`

**Validation:**
- Neo4j running and reachable from TypeScript service
- Can create/read/update entities in entity_registry
- Can create/read aliases in entity_aliases
- PostgreSQL → Neo4j basic sync working (manual test)

---

### Week 2: Canonical Entity Service + Initial Sync

**Deliverables:**
- [ ] `canonical_entity_service.ts` — Merge, split, search operations on entities
- [ ] Entity search with fuzzy matching (alias lookup + string similarity)
- [ ] API endpoints: `POST/GET/PATCH /api/entities`, `POST /api/entities/merge`, `POST /api/entities/split`
- [ ] `knowledge_graph_service.syncSignalToGraph()` — Sync signal extractions to Neo4j
- [ ] Backfill script: load existing V1 `signal_extractions` entities into `entity_registry` + Neo4j
- [ ] Basic graph queries: customer profile, feature health, issue impact (Cypher)

**Validation:**
- Existing V1 entities visible in Neo4j Browser (http://localhost:7474)
- Can query "which customers mention feature X?" via Cypher
- Merge/split operations work correctly

---

### Week 3: Entity Resolution Engine (pyJedAI)

**Deliverables:**
- [ ] Python microservice: `python_services/entity_resolution/`
- [ ] `requirements.txt`: pyjedai, fastapi, uvicorn, sentence-transformers, httpx
- [ ] `app.py` — FastAPI app with `/resolve`, `/resolve-batch`, `/health`
- [ ] `resolver.py` — Core resolution logic using pyJedAI blocking + matching
- [ ] `blocking.py` — Custom blocking strategies per entity type
- [ ] `matching.py` — Multi-signal matching (string + embedding + LLM)
- [ ] `llm_matcher.py` — Azure OpenAI-powered matching for ambiguous pairs
- [ ] `entity_resolution_service.ts` — TypeScript wrapper calling Python service
- [ ] Integration: extraction pipeline → entity resolution → entity registry update → Neo4j sync

**Validation:**
- Python service runs and responds to health check
- Given two entity mentions, returns resolution result with confidence
- Integration test: ingest 50 V1 signals, verify entities resolved and in Neo4j
- Accuracy benchmark: run on golden dataset (create 20 known entity pairs)

---

### Week 4: Resolution Tuning + Feedback Mechanism

**Deliverables:**
- [ ] `feedback_service.ts` — Core feedback service with pending queue
- [ ] PostgreSQL migration: `feedback_log` table
- [ ] API endpoints: `GET /api/feedback/pending`, `POST /api/feedback/:id/accept`, `POST /api/feedback/:id/reject`
- [ ] Threshold tuning: adjust ER_AUTO_MERGE_THRESHOLD, ER_HUMAN_REVIEW_THRESHOLD on real data
- [ ] Entity resolution accuracy tracking view/query
- [ ] Golden dataset: 50+ known entity pairs for regression testing
- [ ] Backfill: resolve ALL existing V1 entities through new pipeline

**Validation:**
- Feedback queue shows pending entity reviews
- Accept/reject updates entity registry and Neo4j correctly
- Accuracy metrics: baseline established (target >85% auto-resolution)
- All V1 entities resolved and present in knowledge graph

---

### Week 5: Phase 1 Buffer & Integration Testing

**Purpose:** Integration testing, bug fixing, and stabilization. This week is CRITICAL.

**Deliverables:**
- [ ] Integration test: Ingest 200 V1 signals through full V2 pipeline (extract → resolve → Neo4j)
- [ ] Verify entity resolution accuracy on golden dataset (target >85%)
- [ ] Fix all integration bugs discovered during testing
- [ ] Performance benchmarks: resolution throughput, Neo4j query latency
- [ ] Python↔TypeScript HTTP contract tests (validate request/response schemas)
- [ ] **Gate 1 validation** — all Phase 1 criteria must pass
- [ ] Document operational procedures: how to start/stop all services, check health

**Phase 1 Milestone:** Knowledge Graph populated with existing data. Entity resolution producing measurable accuracy. Feedback mechanism operational. All integration tests passing.

---

## 3. Phase 2: Multi-Source Ingestion + MCP (Weeks 6-10)

### Goal
Enable multi-source signal ingestion and expose system via MCP tools for Claude Code/Cowork.

---

### Week 5: Manual Ingestion Adapters

**Deliverables:**
- [ ] Python microservice: `python_services/document_parser/`
- [ ] `requirements.txt`: unstructured[all-docs], fastapi, uvicorn
- [ ] `app.py` — FastAPI with `/parse`, `/parse-transcript`, `/health`
- [ ] `transcript_adapter.ts` — Meeting transcript ingestion (text paste + file upload)
- [ ] `document_adapter.ts` — Document ingestion (PPT/Word/Excel/PDF via Unstructured.io)
- [ ] API endpoints: `POST /api/ingest/transcript`, `POST /api/ingest/document`
- [ ] File upload handling with multer (multipart/form-data)
- [ ] npm package added: `multer`
- [ ] Transcript noise filtering (LLM-based segment classification)

**Validation:**
- Upload a meeting transcript → signals created → entities extracted → in Neo4j
- Upload a PowerPoint → parsed → chunks created as signals → entities extracted
- Noise filtering removes filler/social segments from transcripts

---

### Week 6: Crawler Bot + Source Registry

**Deliverables:**
- [ ] `crawler_bot_adapter.ts` — Webhook receiver for external crawler bot
- [ ] API endpoints: `POST /api/ingest/crawled`, `POST /api/ingest/crawled/batch`
- [ ] `source_registry_service.ts` — Central registry for all data sources
- [ ] PostgreSQL migration: `source_registry` table
- [ ] API endpoints: `GET/POST/PATCH /api/sources`, `GET /api/sources/:id/signals`
- [ ] `jira_mcp_adapter.ts` — TBD stub with manual JSON import fallback
- [ ] `wiki_mcp_adapter.ts` — TBD stub with manual JSON import fallback
- [ ] API endpoints: `POST /api/ingest/jira`, `POST /api/ingest/wiki` (manual import)
- [ ] `normalizer_service.ts` — Universal signal normalization

**Validation:**
- POST crawled content → signal created → entities extracted
- Source registry shows all connected sources with sync status
- JIRA/Wiki manual import endpoints accept and process JSON

---

### Week 7: MCP Server (Core Tools)

**Deliverables:**
- [ ] `backend/mcp/server.ts` — pm_intelligence_mcp_server implementation
- [ ] MCP tools implemented (12 core tools):
  - Search: `search_signals`, `get_customer_profile`, `get_feature_health`, `get_issue_impact`, `find_related_entities`
  - Intelligence: `get_heatmap`, `get_trends`, `get_roadmap_priorities`
  - Entity: `review_pending_entities`, `confirm_entity_merge`, `reject_entity_merge`, `add_entity_alias`
- [ ] `.cursor/mcp.json` updated for MCP server
- [ ] Error handling with fuzzy matching suggestions
- [ ] Consistent response format with metadata

**Validation:**
- MCP server starts and registers tools
- Claude Code can invoke tools via conversation
- "Which customers are affected by auth timeout?" returns accurate answer from Neo4j
- Entity review workflow works end-to-end via MCP

---

### Week 8: Provenance + Confidence + Ingestion MCP Tools

**Deliverables:**
- [ ] `provenance_service.ts` — Source chain tracking from insight to signals
- [ ] `get_provenance` MCP tool — trace any claim to source signals
- [ ] Confidence scoring framework — calibrated scores on all intelligence responses
- [ ] `get_entity_resolution_stats` MCP tool — accuracy metrics
- [ ] `ingest_transcript`, `ingest_document` MCP tools — ingest via Claude Code
- [ ] `list_entities`, `list_opportunities` MCP tools
- [ ] `get_system_health` MCP tool
- [ ] `run_pipeline` MCP tool

**Validation:**
- "How did you get the number 47?" → returns full provenance chain
- Confidence scores appear in query responses
- PM can ingest a transcript directly from Claude Code conversation
- System health check shows all services and their status

---

### Week 10: Phase 2 Buffer & Integration Testing

**Purpose:** End-to-end validation of multi-source ingestion and MCP tools.

**Deliverables:**
- [ ] End-to-end test: Ingest 1 transcript + 1 document + 1 crawled page → verify all in Neo4j
- [ ] MCP tool integration test: all 12 core tools invocable from Claude Code
- [ ] Fix all bugs discovered during testing
- [ ] **Gate 2 validation** — all Phase 2 criteria must pass
- [ ] Performance test: MCP tool response time benchmarks
- [ ] User acceptance test: PM uses Claude Code for real queries and provides feedback

**Phase 2 Milestone:** PM can ingest transcripts and documents via Claude Code. Full MCP tool suite operational. Provenance and confidence scoring working.

---

## 4. Phase 3: Intelligence + Polish (Weeks 11-14)

### Goal
Add advanced intelligence (GraphRAG, agentic queries), polish the system, and establish operational excellence.

---

### Week 9: GraphRAG Integration

**Deliverables:**
- [ ] Python microservice: `python_services/graphrag_indexer/`
- [ ] `graphrag_indexer_service.ts` — TypeScript wrapper
- [ ] `relationship_extraction_service.ts` — Extract entity-entity relationships
- [ ] GraphRAG indexing on signal batches → entities + relationships + communities
- [ ] Community detection results mapped to opportunities/themes
- [ ] Integrate GraphRAG entities into entity resolution pipeline

**Validation:**
- GraphRAG extracts richer relationships than basic LLM extraction
- Community detection finds meaningful signal clusters
- New relationships visible in Neo4j graph

---

### Week 10: Agentic Query Engine + Persona-Driven Tools

**Deliverables:**
- [ ] `query_engine_service.ts` — Multi-step query decomposition and synthesis
- [ ] Complex query support: "Why are enterprise customers churning?"
  → Decompose → Parallel retrieval (Neo4j + pgvector + PostgreSQL) → Synthesize
- [ ] `get_strategic_insights` MCP tool with multi-source synthesis
- [ ] `generate_artifact` MCP tool (PRD, JIRA, RFC) with provenance and audience-awareness
- [ ] `generate_shareable_report` MCP tool (6 report types, audience-specific formatting)
- [ ] `report_generation_service.ts` — Report generation with data freshness indicators
- [ ] `browse_knowledge_graph` MCP tool — open-ended graph exploration for New PM onboarding
- [ ] `get_knowledge_summary` MCP tool — product area landscape summary
- [ ] `backend/mcp/tools/onboarding_tools.ts` — New PM exploration tools
- [ ] `backend/mcp/tools/report_tools.ts` — Report and artifact generation tools

**Validation:**
- Complex multi-hop queries return synthesized answers
- PRD drafts include customer evidence, provenance section, and audience-appropriate language
- Shareable reports are self-contained and include data freshness + methodology
- `browse_knowledge_graph` returns paginated entity exploration with aliases
- `get_knowledge_summary` returns a comprehensive product area overview

---

### Week 11: Enhanced Analytics + Temporal Reasoning

**Deliverables:**
- [ ] `heatmap_service.ts` — Full heatmap generation (issues×customers, issues×features, etc.)
- [ ] Temporal reasoning: "trend over last 3 months", "what changed since Q4?"
- [ ] Enhanced trend analysis with multi-source signals
- [ ] Competitive intelligence queries (from crawled web data)
- [ ] `ingestion_scheduler_service.ts` — BullMQ scheduled jobs for recurring ingestion

**Validation:**
- Heatmaps return accurate, structured data via MCP
- Temporal queries correctly compare time windows
- Scheduled jobs run reliably

---

### Week 12: Polish, Documentation, Operational Excellence

**Deliverables:**
- [ ] Feedback-driven prompt improvement cycle (first iteration)
- [ ] `prompt_versions` table and management
- [ ] `audit_log` table with `actor_persona` field for persona tracking
- [ ] Nightly Neo4j consistency check job
- [ ] New PM onboarding flow tested end-to-end (§2.10 from UX doc)
- [ ] Batch entity review session tested end-to-end (§2.7 from UX doc)
- [ ] Shareable report generation tested with all 6 report types
- [ ] Artifact templates validated for all audience types (engineering, leadership, CS/sales)
- [ ] Error recovery procedures documented
- [ ] Updated README.md with V2 setup instructions
- [ ] Docker Compose file for full stack (PostgreSQL + pgvector + Neo4j + Redis)
- [ ] All 31 MCP tools documented with examples and persona mapping
- [ ] Performance benchmarks: query latency, pipeline throughput, resolution accuracy
- [ ] Regression test suite for entity resolution (golden dataset)

**Validation:**
- Full pipeline runs end-to-end: ingest → extract → resolve → graph → query → answer
- Entity resolution accuracy >90% on golden dataset
- All 31 MCP tools respond in <5 seconds (p95)
- Prompt improvement cycle produces measurable accuracy gain
- New PM can get product area landscape summary via `get_knowledge_summary`
- PM Leader can generate shareable customer health report
- Generated PRDs include provenance section with signal counts and source types
- System recoverable from any single component failure

**Phase 3 Milestone:** Production-ready V2 with advanced intelligence, persona-driven tools, operational monitoring, and documented procedures.

---

## 4.5 Phase 4: Agent Enablement (Weeks 13-14)

### Goal
Enable external agents to interact with the system via the Agent Gateway and Event Bus. Deploy initial set of agents.

---

### Week 13: A2A Server + Agent Gateway + Event Bus

**Deliverables:**
- [ ] `backend/agents/a2a_server.ts` — A2A protocol handler (JSON-RPC 2.0 over HTTP)
- [ ] `backend/agents/agent_card.json` — Agent Card served at `/.well-known/agent.json`
- [ ] A2A skill routing: 8 skills mapped to existing service layer methods
- [ ] A2A task lifecycle management (submitted → working → completed/failed)
- [ ] A2A streaming support via SSE for long-running tasks (signal ingestion, report generation)
- [ ] `backend/agents/gateway.ts` — Agent Gateway Express router (/api/agents/*) — REST fallback
- [ ] `backend/agents/auth_middleware.ts` — API key authentication and rate limiting (shared by A2A + REST)
- [ ] `backend/services/event_bus_service.ts` — Redis Streams event bus with publish/subscribe
- [ ] `backend/agents/event_stream.ts` — SSE endpoint for agent event subscriptions
- [ ] `backend/agents/webhook_delivery.ts` — Webhook delivery with retry and DLQ
- [ ] `agent_registry` and `agent_activity_log` database tables created
- [ ] Agent registration endpoint: POST /api/agents/auth/register
- [ ] Agent read endpoints: GET /api/agents/entities, /signals, /heatmap, /trends, /opportunities, /health
- [ ] Agent write endpoints: POST /api/agents/ingest, /issues/flag, /entities/propose, /reports/generate
- [ ] Event emission from core services: signal.*, entity.*, opportunity.*, pipeline.*, er.*
- [ ] Idempotency key enforcement on all write endpoints

**Validation:**
- Agent Card discoverable at `/.well-known/agent.json`
- External agent can send A2A `message/send` request and receive task response
- A2A skills correctly route to service layer (e.g., query-heatmap → heatmap_service)
- Agent can register and receive API key
- Agent can query entities and signals via Agent Gateway REST (fallback)
- Agent can ingest a signal via A2A or Agent Gateway (goes through full pipeline)
- Agent can subscribe to SSE events and receive signal.batch_complete
- A2A push notifications delivered via webhook for async tasks
- Rate limiting blocks agent exceeding 60 requests/minute
- Unauthorized agent (bad API key) gets 401
- Agent activity logged in agent_activity_log

---

### Week 14: Initial Agent Deployment + Integration Testing

**Deliverables:**
- [ ] `agents/report_scheduler/` — Report Scheduler Agent (cron → report → Slack delivery)
- [ ] `agents/slack_alert_bot/` — Slack Alert Bot (event subscription → Slack message)
- [ ] `agents/data_quality_agent/` — Data Quality Agent (scheduled ER monitoring + orphan detection)
- [ ] Agent health monitoring endpoint: GET /api/agents/health/agents
- [ ] End-to-end test: signal ingested → event emitted → Slack Alert Bot posts to channel
- [ ] End-to-end test: Report Scheduler generates weekly digest on cron
- [ ] End-to-end test: Data Quality Agent detects orphaned entities and proposes cleanup
- [ ] All agent actions visible in audit_log with agent identity
- [ ] `agent_version_history` table created with config snapshot storage
- [ ] Agent SLO monitoring job (daily check, auto-pause on 7-day breach)
- [ ] Agent cost tracking: `tokens_input`, `tokens_output`, `estimated_cost_usd` in activity log
- [ ] Monthly cost view (`agent_monthly_cost`) and budget enforcement
- [ ] `review_agent_outputs` MCP tool for PM to review/correct agent outputs
- [ ] `rollback_agent` MCP tool for rolling back agent to previous version
- [ ] `list_registered_agents` MCP tool with SLO + cost dashboard data
- [ ] `deactivate_agent` MCP tool for manual agent pause
- [ ] `configure_stakeholder_access` MCP tool for PM to set stakeholder scopes
- [ ] Stakeholder Access Agent: read-only scoped queries for stakeholders
- [ ] Agent output feedback types added to feedback_log schema
- [ ] `agent_accuracy_30d` view for per-agent accuracy tracking
- [ ] Documentation: agent registration guide, API reference, event catalog, SLO targets

**Validation:**
- Report Scheduler delivers weekly digest to configured Slack channel
- Slack Alert Bot posts alert within 5 minutes of critical signal ingestion
- Data Quality Agent detects accuracy drop and creates feedback_log proposal
- All agent actions visible in audit trail
- Agent health endpoint shows status, SLOs, and cost for all registered agents
- PM can review agent outputs via `review_agent_outputs` MCP tool
- PM can roll back an agent via `rollback_agent` MCP tool
- SLO auto-pause triggers when breach count reaches 7 days
- Cost auto-pause triggers when monthly budget exceeded
- Stakeholder Access Agent serves read-only queries scoped to configured product areas
- JIRA Sync Agent, Triage Agent, CS Agent, Competitive Intel Agent documented as P3 (future sprints)

**Phase 4 Milestone:** A2A Server + Agent Gateway operational. Agent Card discoverable. Event bus delivering events. Agent lifecycle management (versioning, SLOs, cost) operational. Agent output feedback loop functional. Stakeholder self-service via Stakeholder Access Agent. Three+ initial agents deployed and functioning.

---

## 5. V1 → V2 Data Migration Plan

### 5.1 Migration Strategy: Additive, Non-Destructive

V2 is built alongside V1, sharing the same PostgreSQL database. V1 remains operational throughout. V2 adds new tables, new services, and new columns — it never modifies or deletes V1 data.

```
Migration Phases:

Phase A (Week 1-2): Schema Setup
  1. Create V2 tables: entity_registry, entity_aliases, entity_resolution_log,
     entity_merge_history, neo4j_sync_backlog, agent_registry, agent_activity_log,
     agent_version_history, feedback_log, system_metrics, alerts, prompt_versions,
     source_registry, audit_log
  2. Create Neo4j schema: constraints, indexes, node labels
  3. Validate: All tables exist, constraints active, indexes built

Phase B (Week 2): Entity Backfill
  1. Extract unique entity names from V1 signal_extractions table
  2. Deduplicate using pyJedAI (initial entity resolution run)
  3. Create canonical entities in entity_registry
  4. Create aliases from variants
  5. Sync to Neo4j as initial node population
  6. Validate: entity_registry count matches expected range

Phase C (Week 4): Full Reprocessing
  1. Reprocess ALL existing V1 signals through V2 extraction pipeline
  2. Run entity resolution on all extractions
  3. Build Neo4j relationships from resolved entities
  4. Generate embeddings for existing signals (if missing)
  5. Validate: Neo4j graph is consistent with PostgreSQL

Phase D (Week 6+): Incremental
  1. New signals automatically flow through V2 pipeline
  2. V1 pipeline continues for backward compatibility
  3. Both V1 and V2 views of data are available
```

### 5.2 Migration Scripts

| Script | Phase | Purpose | Estimated Time (10K signals) |
|--------|-------|---------|------------------------------|
| `migrate_schema.sql` | A | Create all V2 tables and constraints | <1 minute |
| `backfill_entities.ts` | B | Extract unique entities from V1 extractions → entity_registry | 5-10 minutes |
| `initial_er_run.py` | B | Run pyJedAI on backfilled entities for deduplication | 10-30 minutes |
| `neo4j_initial_sync.ts` | B | Populate Neo4j from entity_registry | 2-5 minutes |
| `reprocess_signals.ts` | C | Re-run V2 extraction on all V1 signals | 2-6 hours (LLM-bound) |
| `build_relationships.ts` | C | Build Neo4j relationships from resolved entities | 10-30 minutes |
| `validate_migration.ts` | All | Run consistency checks (counts, orphans, schema) | 1-2 minutes |

### 5.3 Rollback Procedure

If migration fails or produces unacceptable data quality:

```
Rollback Level 1 (Safe — V2 data only):
  1. DROP all V2-only tables (entity_registry, neo4j_sync_backlog, etc.)
  2. neo4j-admin database drop pm_intelligence (clear Neo4j)
  3. V1 system continues unaffected
  4. Re-run migration from Phase A

Rollback Level 2 (Schema rollback):
  1. Restore PostgreSQL from latest backup (pre-migration)
  2. Re-create V2 schema from scratch
  3. Re-run migration

Rollback NOT needed for:
  - V1 tables (untouched by migration)
  - V1 signals (immutable, never modified)
  - V1 API endpoints (unchanged)
```

### 5.4 Post-Migration Validation Checklist

| Check | Query/Method | Expected |
|-------|-------------|----------|
| V1 signal count unchanged | `SELECT COUNT(*) FROM signals` | Same as pre-migration |
| Entity registry populated | `SELECT COUNT(*) FROM entity_registry` | > 0 (expected: 200-500 for typical V1) |
| Neo4j node count matches PG | Compare `MATCH (n) RETURN count(n)` vs PG entity count | Within 5% |
| No orphan entities in Neo4j | `MATCH (n) WHERE NOT (n)--() RETURN count(n)` | < 10% of total |
| V1 API still works | Run V1 test suite | All pass |
| Entity resolution accuracy | Run against golden dataset (if exists) | > 80% (initial run) |
| Feedback service operational | Create/resolve a test feedback item | Success |
| MCP server connects to Neo4j | Run `get_system_health` tool | All services healthy |

---

## 6. Testing Strategy

### 6.1 Test Pyramid

```
                    ┌───────────┐
                    │  E2E (5%) │  Full pipeline: ingest → query answer
                    ├───────────┤
                 ┌──┤Integration│  Service boundaries: TS↔Python, TS↔Neo4j,
                 │  │   (25%)   │  MCP tools, Agent Gateway, A2A
                 │  ├───────────┤
              ┌──┤  │   Unit    │  Individual functions: validation, normalization,
              │  │  │   (70%)   │  entity matching, schema checks, scoring
              │  │  └───────────┘
```

### 6.2 Test Categories and Targets

| Category | What | Coverage Target | Tooling |
|----------|------|----------------|---------|
| **Unit tests** | Validation rules (§5 of 08_DATA_CONTRACTS.md), normalizer logic, entity matching, scoring algorithms, Zod schemas | >80% line coverage | Jest (TS), pytest (Python) |
| **Integration tests** | TypeScript → Python HTTP calls, TypeScript → Neo4j Cypher, TypeScript → PostgreSQL queries, MCP tool end-to-end, Agent Gateway endpoints, A2A JSON-RPC | All service boundaries covered | Jest + supertest (TS), pytest + httpx (Python) |
| **Contract tests** | MCP tool input/output schemas, Agent Gateway request/response schemas, A2A message format, event bus event schemas | All public interfaces | Zod schema tests, JSON Schema validation |
| **Golden dataset tests** | Entity resolution accuracy regression — a curated set of known entity pairs with expected merge/reject decisions | >85% accuracy maintained across code changes | Custom benchmark script |
| **E2E tests** | Full pipeline: signal ingestion → extraction → ER → graph sync → MCP query returns correct answer | 5 core scenarios covered | Custom test harness |
| **Security tests** | Injection attempts (Cypher, prompt, SQL), auth bypass, rate limit enforcement | All threat model vectors (see 09_SECURITY_GUARDRAILS.md) | Manual + automated scripts |

### 6.3 Test Data Management

| Dataset | Purpose | Size | Refresh |
|---------|---------|------|---------|
| `test/fixtures/signals/` | Sample signals for unit/integration tests | 50-100 signals, 5 sources | Static, versioned |
| `test/fixtures/golden_entities/` | Known entity pairs for ER accuracy benchmarks | 50+ pairs with expected decisions | Updated as ER improves |
| `test/fixtures/documents/` | Sample PDFs, PPTX, XLSX for document parsing tests | 10-15 files of various types | Static |
| V1 production data (anonymized) | Realistic test data for E2E and performance tests | Full V1 dataset | Snapshot, never auto-refreshed |

### 6.4 CI/CD Integration (When Ready)

```
On every commit:
  1. Lint (ESLint + Pyright)
  2. Unit tests (Jest + pytest) — must pass 100%
  3. Integration tests (requires Docker: PG, Neo4j, Redis) — must pass 100%

On PR merge:
  4. Contract tests — must pass 100%
  5. Golden dataset benchmark — accuracy must not regress below SLO
  6. E2E tests (full pipeline) — must pass

Weekly (scheduled):
  7. Security scan (dependency audit: npm audit, pip-audit)
  8. Performance benchmark (pipeline throughput, MCP response times)
```

### 6.5 Load Testing (V3 Scope, Documented for Planning)

| Scenario | Target | Method |
|----------|--------|--------|
| Concurrent MCP queries | 10 simultaneous, all <5s p95 | k6 or Artillery |
| Batch signal ingestion | 100 signals in <10 minutes | Custom batch script |
| Agent Gateway under load | 60 requests/minute sustained for 30 minutes | k6 |
| Event bus throughput | 100 events/second for 5 minutes | Redis Streams load generator |

---

## 7. Dependencies & Blockers

| Dependency | Blocks | Risk | Mitigation |
|------------|--------|------|------------|
| Neo4j Docker image pulls | Week 1 setup | Low | Pre-pull images |
| pyJedAI Python 3.10+ | Week 3 entity resolution | Low | Ensure Python 3.10+ installed |
| Unstructured.io system deps (poppler, tesseract) | Week 5 document parsing | Medium | Docker container with pre-installed deps |
| GraphRAG Python setup | Week 9 | Medium | Test setup early (Week 7) |
| Azure OpenAI API availability | All weeks | Low | Existing setup works |
| Real signal data for testing | All weeks | Low | V1 has existing Slack data |
| JIRA MCP configuration | Ongoing | Medium | Stub with manual import fallback |
| Wiki MCP configuration | Ongoing | Medium | Stub with manual import fallback |

---

## 8. Resource Requirements

### 6.1 Development

| Role | Effort | Notes |
|------|--------|-------|
| TypeScript developer | ~60% of total | Services, API, MCP server |
| Python developer | ~30% of total | Entity resolution, document parsing, GraphRAG |
| DevOps/Docker | ~10% of total | Docker Compose, deployment, monitoring |

### 6.2 Infrastructure (Local Dev)

| Resource | Requirement |
|----------|-------------|
| RAM | 8GB minimum (PostgreSQL + Neo4j + Redis + Python services) |
| Disk | 10GB for databases + document uploads |
| CPU | 4 cores recommended |
| Python | 3.10+ |
| Node.js | 18+ |
| Docker | Latest |

### 6.3 API Budget

| Phase | Estimated Monthly LLM Cost |
|-------|---------------------------|
| Phase 1 | ~$5-10 (entity resolution LLM matching) |
| Phase 2 | ~$10-20 (adding document/transcript extraction) |
| Phase 3 | ~$15-30 (GraphRAG indexing + agentic queries) |
| Steady state | ~$15-25/month |

---

## 9. Risk Mitigations & Contingency

| Risk | Likelihood | Impact | Mitigation | Contingency |
|------|------------|--------|------------|-------------|
| pyJedAI learning curve takes longer | Medium | Delays Week 3-4 | Allocate reading time in Week 2 buffer | Fall back to custom string+embedding matching; add pyJedAI in Phase 2 |
| Unstructured.io system deps fail on macOS | Medium | Delays Week 5 | Test installation in Week 3 proactively | Docker container with pre-installed deps |
| Neo4j performance worse than expected | Low | Degrades graph queries | Benchmark early (Week 1); add indexes aggressively | Fall back to PostgreSQL-only with complex JOINs |
| V1 system breaks during V2 build | Low | Disrupts daily PM workflow | V1 and V2 share DB but V2 is additive (no destructive changes) | V1 can run independently; V2 additions are optional |
| Azure OpenAI rate limits during batch processing | Medium | Slows pipeline | Implement rate limiting in extraction service | Use GPT-4o-mini for all extraction; queue for later |
| MCP protocol changes between versions | Low | Requires MCP server update | Pin @modelcontextprotocol/sdk version | MCP is versioned; update when ready |
| Integration testing takes longer than expected | High | Delays each phase | Buffer weeks allocated; start integration tests early | Cut scope: reduce MCP tools to 12 core; defer advanced analytics |
| Agent Gateway adds complexity beyond budget | Medium | Delays Phase 4 | Agent Gateway reuses existing Express setup + Redis | Defer agents to post-V2; Agent Gateway is additive, not blocking |
| Event bus backpressure not sufficient | Low | Agent storms overwhelm system | Redis Streams has built-in backpressure + rate limiting | Disable event bus temporarily; agents fall back to polling |
| Slack API rate limits during alert delivery | Medium | Alerts delayed | Batch alerts, respect Slack rate limits | Queue alerts, deliver on next available slot |

---

## 10. Phase Validation Gates

**Gate 1 (End of Phase 1, Week 5):**
- [ ] Neo4j running with schema and constraints created
- [ ] Entity registry populated with >200 entities from V1 data
- [ ] Entity resolution accuracy >85% on golden dataset (20+ pairs)
- [ ] Feedback service operational with pending/accept/reject flow
- [ ] V1 pipeline still functioning correctly (regression check)

**Gate 2 (End of Phase 2, Week 9):**
- [ ] Can ingest a meeting transcript and see entities in Neo4j within 2 minutes
- [ ] Can upload a PowerPoint and see extracted entities within 3 minutes
- [ ] MCP server registered and Claude Code can invoke at least 10 tools
- [ ] "Which customers are affected by Issue X?" returns correct answer via MCP
- [ ] Provenance chain works for at least 1 query type

**Gate 3 (End of Phase 3, Week 12):**
- [ ] Entity resolution accuracy >90% on expanded golden dataset (50+ pairs)
- [ ] All 35 MCP tools operational with <5s p95 response time
- [ ] Full pipeline end-to-end: ingest → extract → resolve → graph → query in <2 min
- [ ] DLQ is empty or has <5 items
- [ ] Nightly consistency check passes (PG↔Neo4j divergence <1%)
- [ ] New PM onboarding flow tested: `browse_knowledge_graph` + `get_knowledge_summary` working
- [ ] PM Leader workflow tested: `generate_shareable_report` produces self-contained reports
- [ ] Artifact generation tested: PRDs include provenance, JIRA issues include customer evidence
- [ ] Batch entity review session resolves 20+ items in <15 minutes

**Gate 4 (End of Phase 4, Week 14):**
- [ ] Agent Gateway operational with API key authentication
- [ ] A2A Server serving Agent Card at `/.well-known/agent.json`
- [ ] Event bus delivering events to subscribed agents within 5 seconds
- [ ] Report Scheduler Agent delivers weekly digest on schedule
- [ ] Slack Alert Bot posts alerts within 5 minutes of critical signal
- [ ] Data Quality Agent monitors ER accuracy and proposes cleanup
- [ ] All agent actions logged in audit trail with agent identity
- [ ] Agent rate limiting enforced (verified with load test)
- [ ] Idempotent writes verified (duplicate ingest returns original response)
- [ ] V1→V2 migration validation checklist passes (§5.4)
- [ ] Unit test coverage >80%, all integration tests pass
- [ ] Golden dataset regression benchmark passes (>85% accuracy)

---

## 11. Success Criteria (End of 14 Weeks)

| Criteria | Target | Measurement |
|----------|--------|-------------|
| Sources ingested | 4+ types (Slack, transcripts, documents, web) | Source registry count |
| Entity resolution accuracy | >90% | Golden dataset benchmark |
| MCP tools operational | 31 tools | Tool count + integration tests |
| Query response time | <5s (p95) | MCP tool timing |
| Agent Gateway response time | <3s (p95) | Agent Gateway timing |
| Knowledge graph entities | 500+ canonical entities | Neo4j node count |
| Provenance coverage | >95% of insights have source chains | Audit |
| Feedback queue turnover | <10 items pending at any time | Feedback service stats |
| Registered agents | 3+ operational | Agent registry count |
| Event bus event delivery | <5s latency (p95) | Event bus metrics |
| Scheduled report delivery | >99% on-time | Report Scheduler logs |
| Critical alert latency | <5 minutes | Slack Alert Bot metrics |
| Pipeline end-to-end | Ingest → query answer in <2 min | Pipeline timing |
| DLQ abandoned items | 0 | DLQ status check |
| Artifact quality | PRDs include provenance in 100% of cases | Artifact audit |
| Shareable reports | All 6 report types generate valid output | Report generation test |
| Onboarding flow | New PM gets product area overview in <10s | `get_knowledge_summary` timing |
| System uptime (post-launch) | >99.5% over first 2 weeks | Health check monitoring |
| V1 regression | 0 broken V1 features | V1 test suite pass |
