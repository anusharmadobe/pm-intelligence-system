# V2 Component Registry — Exhaustive Catalog

> **Version:** 2.1 (Updated — A2A server, JTBD cross-references)
> **Date:** 2026-02-09
> **Status:** Living Document (update as components are built)

---

## 1. Purpose

This document catalogs EVERY component in the PM Intelligence System — both V1 (existing) and V2 (new). It serves as the authoritative naming reference during implementation.

---

## 2. Naming Conventions

| Pattern | Example | Applies To |
|---------|---------|------------|
| `{domain}_service.ts` | `entity_resolution_service.ts` | Business logic services |
| `{domain}_adapter.ts` | `transcript_adapter.ts` | Source-specific ingestion |
| `{domain}_helpers.ts` | `slack_entity_helpers.ts` | Utility functions |
| `{provider}_provider.ts` | `embedding_provider.ts` | External service abstraction |
| `{noun}_{action}.ts` | `run_full_llm_pipeline.ts` | Scripts |
| `/api/{resource}` | `/api/entities` | REST endpoints (collections) |
| `/api/{resource}/:id` | `/api/entities/:id` | REST endpoints (items) |
| `/api/{resource}/{action}` | `/api/entities/merge` | REST endpoints (actions) |
| `{entity_type}_table` | `entity_registry` | Database tables (snake_case) |

---

## 3. V1 Components (Existing)

### 3.1 Services (backend/services/)

| Service | File | Status | Purpose |
|---------|------|--------|---------|
| `artifact_service` | `artifact_service.ts` | Working | Creates PRDs/RFCs from judgments |
| `channel_registry_service` | `channel_registry_service.ts` | Working | Manages Slack channel registration and configuration |
| `cursor_llm_provider` | `cursor_llm_provider.ts` | Working | LLM access via Cursor's built-in LLM |
| `deduplication_service` | `deduplication_service.ts` | Working | Finds duplicate signals using embeddings |
| `embedding_provider` | `embedding_provider.ts` | Working | Creates embedding providers (OpenAI, Azure, Cohere, Cursor, Mock) |
| `embedding_service` | `embedding_service.ts` | Working | Manages signal embeddings and embedding queue |
| `hybrid_search_service` | `hybrid_search_service.ts` | Working | Combines vector and full-text search |
| `jira_issue_service` | `jira_issue_service.ts` | Working | Generates JIRA issues from opportunities/extractions |
| `judgment_service` | `judgment_service.ts` | Working | Creates judgments with LLM assistance (human-in-the-loop) |
| `llm_service` | `llm_service.ts` | Working | Core LLM provider abstraction and synthesis functions |
| `metrics_service` | `metrics_service.ts` | Working | Tracks adoption metrics |
| `opportunity_service` | `opportunity_service.ts` | Working | Detects and manages opportunities (clustered signals) |
| `slack_entity_helpers` | `slack_entity_helpers.ts` | Working | Utilities for Slack entity normalization |
| `slack_insight_service` | `slack_insight_service.ts` | Working | Generates strategic insights from Slack signals |
| `slack_llm_extraction_service` | `slack_llm_extraction_service.ts` | Working | Ingests LLM-extracted data from Slack signals |
| `slack_llm_extractor` | `slack_llm_extractor.ts` | Working | Extracts structured data from Slack signals using LLM |
| `slack_query_service` | `slack_query_service.ts` | Working | Queries feature usage and bottlenecks |
| `slack_structuring_service` | `slack_structuring_service.ts` | Working | Structures Slack signals into entities |
| `theme_classifier_service` | `theme_classifier_service.ts` | Working | Classifies signals into hierarchical themes |
| `trend_analysis_service` | `trend_analysis_service.ts` | Working | Analyzes trends for themes/features/customers/issues |

### 3.2 V1 Database Tables

| Table | Purpose |
|-------|---------|
| `signals` | Raw immutable signal data |
| `opportunities` | Clustered signal groups |
| `opportunity_signals` | Signal-to-opportunity mapping |
| `judgments` | Human+LLM reasoning results |
| `artifacts` | Generated PRDs/RFCs |
| `slack_messages` | Raw Slack message data |
| `customers` | Customer entities (V1 flat) |
| `slack_users` | Slack user data |
| `features` | Feature entities (V1 flat) |
| `issues` | Issue entities (V1 flat) |
| `themes` | Legacy flat themes |
| `signal_entities` | Signal-to-entity mapping |
| `customer_feature_usage` | Customer-feature relationships |
| `customer_issue_reports` | Customer-issue relationships |
| `signal_extractions` | LLM extraction results |
| `slack_channels` | Channel registry |
| `theme_hierarchy` | 4-level theme hierarchy |
| `signal_theme_hierarchy` | Signal-to-theme mapping |
| `signal_embeddings` | Vector embeddings |
| `theme_embeddings` | Theme vector embeddings |
| `customer_embeddings` | Customer vector embeddings |
| `embedding_queue` | Embedding processing queue |
| `jira_issue_templates` | Generated JIRA templates |

### 3.3 V1 API Endpoints (Existing)

**Signals:** `POST/GET /api/signals`, `GET /api/signals/:id/themes`, `POST /api/signals/:id/classify`, `GET /api/signals/:id/embedding`, `GET /api/signals/:id/similar-semantic`

**Opportunities:** `POST /api/opportunities/detect`, `POST /api/opportunities/detect/incremental`, `POST /api/opportunities/detect-semantic`, `POST /api/opportunities/merge`, `GET /api/opportunities`, `GET /api/opportunities/:id/signals`, `GET /api/opportunities/clusters`

**Judgments:** `POST /api/judgments`, `GET /api/judgments/:opportunityId`

**Artifacts:** `POST /api/artifacts`, `GET /api/artifacts/:judgmentId`

**Themes:** Full CRUD + hierarchy navigation

**Trends:** `GET /api/trends`, `/trends/summary`, `/trends/emerging`, `/trends/declining`, `/trends/stable`, `/trends/weekly/:type/:id`

**Roadmap:** `GET /api/roadmap/summary`, `/roadmap/priorities`, `/roadmap/quick-wins`, `/roadmap/strategic`, `/roadmap/emerging`, `/roadmap/high-confidence`

**Channels:** Full CRUD + auto-register

**Embeddings:** Stats, pending, queue, process

**Search:** `POST /api/search`, text, similar, theme, customer search

**JIRA:** Generate, templates, export, stats

**Webhooks:** Slack, Teams, Grafana, Splunk

---

## 4. V2 Components (New)

### 4.1 New Services (backend/services/)

| Service | File | Priority | Purpose |
|---------|------|----------|---------|
| `knowledge_graph_service` | `knowledge_graph_service.ts` | P0 (Week 1) | Neo4j CRUD, queries, sync from PostgreSQL |
| `entity_registry_service` | `entity_registry_service.ts` | P0 (Week 1) | CRUD for canonical entities |
| `alias_management_service` | `alias_management_service.ts` | P0 (Week 1) | Entity alias table management |
| `canonical_entity_service` | `canonical_entity_service.ts` | P0 (Week 2) | Merge, split, search operations |
| `entity_resolution_service` | `entity_resolution_service.ts` | P0 (Week 3) | TypeScript wrapper for Python ER service |
| `feedback_service` | `feedback_service.ts` | P0 (Week 4) | Human correction queue, feedback processing |
| `source_registry_service` | `source_registry_service.ts` | P1 (Week 6) | Central registry for all data sources |
| `normalizer_service` | `normalizer_service.ts` | P1 (Week 6) | Universal signal normalization |
| `provenance_service` | `provenance_service.ts` | P1 (Week 8) | Source chain tracking for insights |
| `relationship_extraction_service` | `relationship_extraction_service.ts` | P2 (Week 9) | Entity-entity relationship extraction |
| `graphrag_indexer_service` | `graphrag_indexer_service.ts` | P2 (Week 9) | Microsoft GraphRAG integration wrapper |
| `query_engine_service` | `query_engine_service.ts` | P2 (Week 10) | Agentic RAG query decomposition |
| `heatmap_service` | `heatmap_service.ts` | P2 (Week 11) | Heatmap data generation |
| `ingestion_scheduler_service` | `ingestion_scheduler_service.ts` | P2 (Week 11) | BullMQ scheduled ingestion jobs |
| `document_chunking_service` | `document_chunking_service.ts` | P1 (Week 5) | Semantic chunking for documents |
| `insight_generator_service` | `insight_generator_service.ts` | P2 (Week 10) | Cross-source strategic insight generation |
| `report_generation_service` | `report_generation_service.ts` | P2 (Week 10) | Shareable reports for PM Leader and scheduled delivery |
| `a2a_server_service` | `a2a_server_service.ts` | P2 (Week 13) | A2A protocol server: Agent Card, JSON-RPC 2.0, skill routing |
| `agent_gateway_service` | `agent_gateway_service.ts` | P2 (Week 13) | Agent REST API: auth, rate limiting, routing to services |
| `event_bus_service` | `event_bus_service.ts` | P2 (Week 13) | Redis Streams event bus: publish, subscribe, backpressure |

### 4.2 New Adapters (backend/adapters/)

| Adapter | File | Priority | Purpose |
|---------|------|----------|---------|
| `transcript_adapter` | `transcript_adapter.ts` | P1 (Week 5) | Meeting transcript ingestion (manual) |
| `document_adapter` | `document_adapter.ts` | P1 (Week 5) | Document ingestion via Unstructured.io |
| `crawler_bot_adapter` | `crawler_bot_adapter.ts` | P1 (Week 6) | Webhook receiver for external crawler |
| `jira_mcp_adapter` | `jira_mcp_adapter.ts` | TBD | JIRA MCP integration (stub for now) |
| `wiki_mcp_adapter` | `wiki_mcp_adapter.ts` | TBD | Wiki/Confluence MCP integration (stub) |

### 4.3 MCP Server (backend/mcp/)

| Component | File | Priority | Purpose |
|-----------|------|----------|---------|
| `pm_intelligence_mcp_server` | `server.ts` | P1 (Week 7) | MCP server main entry point |
| Tool handlers | `tools/*.ts` | P1 (Week 7-8) | Individual MCP tool implementations |

### 4.4 A2A Server & Agent Gateway (backend/agents/)

| Component | File | Priority | Purpose |
|-----------|------|----------|---------|
| `a2a_server_service` | `a2a_server.ts` | P2 (Week 13) | A2A protocol handler: Agent Card, JSON-RPC 2.0, skill routing, task lifecycle |
| `agent_card` | `agent_card.json` | P2 (Week 13) | Agent Card served at `/.well-known/agent.json` for A2A discovery |
| `agent_gateway_service` | `gateway.ts` | P2 (Week 13) | Express router: /api/agents/* with auth middleware (REST fallback) |
| `agent_registry_service` | `agent_registry_service.ts` | P2 (Week 13) | API key management, auth, activity logging |
| `event_bus_service` | `event_bus.ts` | P2 (Week 13) | Redis Streams event bus |
| `event_dispatcher` | `event_dispatcher.ts` | P2 (Week 13) | Webhook delivery from the event bus |

### 4.4.1 Web UI (frontend/)

| Component | File | Priority | Purpose |
|-----------|------|----------|---------|
| `pm_intelligence_ui` | `frontend/index.html` | P2 (Week 13) | Role-based UI at `/ui` |
| `pm_intelligence_ui_logic` | `frontend/app.js` | P2 (Week 13) | UI logic calling Agent Gateway |
| `pm_intelligence_ui_styles` | `frontend/styles.css` | P2 (Week 13) | UI styling |

### 4.5 Agent Processes (agents/)

| Agent | Directory | Deployment | Priority | Purpose |
|-------|-----------|-----------|----------|---------|
| Triage Agent | `agents/triage_agent/` | Separate process | P3 | Signal urgency classification, anomaly detection |
| Report Scheduler Agent | `agents/report_scheduler/` | In-process (BullMQ) | P2 (Week 13) | Cron-based report generation and delivery |
| JIRA Sync Agent | `agents/jira_sync_agent/` | Separate process | P3 | Bidirectional JIRA ticket sync |
| Slack Alert Bot | `agents/slack_alert_bot/` | In-process (BullMQ) | P2 (Week 13) | Event-driven Slack notifications |
| Data Quality Agent | `agents/data_quality_agent/` | In-process (BullMQ) | P2 (Week 13) | ER accuracy monitoring, orphan detection |
| Customer Success Agent | `agents/cs_agent/` | In-process (BullMQ) | P3 | Customer health monitoring and CS alerting |
| Competitive Intel Agent | `agents/competitive_intel/` | In-process (BullMQ) | P3 | Competitor mention extraction from web scrapes |
| Executive Briefing Agent | `agents/executive_briefing/` | In-process (BullMQ) | P3 | Scheduled executive summaries |
| Stakeholder Access Agent | `agents/stakeholder_access/` | In-process | P2 (Week 14) | Read-only scoped queries for stakeholders |

### 4.6 Python Microservices (python_services/)

| Service | Directory | Priority | Purpose |
|---------|-----------|----------|---------|
| Entity Resolution | `python_services/entity_resolution/` | P0 (Week 3) | pyJedAI-powered entity resolution |
| Document Parser | `python_services/document_parser/` | P1 (Week 5) | Unstructured.io document parsing |
| GraphRAG Indexer | `python_services/graphrag_indexer/` | P2 (Week 9) | Microsoft GraphRAG indexing |

### 4.7 New Database Tables

| Table | Priority | Purpose |
|-------|----------|---------|
| `entity_registry` | P0 (Week 1) | Canonical entity identities |
| `entity_aliases` | P0 (Week 1) | Entity name variants |
| `entity_resolution_log` | P0 (Week 3) | Resolution decision audit trail |
| `entity_merge_history` | P0 (Week 2) | Merge/split history |
| `feedback_log` | P0 (Week 4) | Human correction records + agent proposals |
| `dead_letter_queue` | P0 (Week 3) | Failed processing items for retry |
| `neo4j_sync_backlog` | P0 (Week 2) | Queued Neo4j sync operations during outage |
| `system_metrics` | P1 (Week 8) | SLO and performance metrics |
| `alerts` | P1 (Week 8) | System alerts when SLOs breached |
| `prompt_versions` | P2 (Week 12) | LLM prompt versioning |
| `source_registry` | P1 (Week 6) | Connected data sources |
| `audit_log` | P1 (Week 8) | System-wide audit events (human + agent actors) |
| `agent_registry` | P2 (Week 13) | Registered agents: API keys, permissions, rate limits, versioning, SLOs, cost budgets |
| `agent_version_history` | P2 (Week 13) | Agent version history: config snapshots, performance data, rollback support |
| `agent_activity_log` | P2 (Week 13) | Per-agent request/response audit trail with cost tracking (tokens, model, estimated cost) |

### 4.8 New API Endpoints

**Entities:**
```
POST   /api/entities
GET    /api/entities
GET    /api/entities/:id
PATCH  /api/entities/:id
POST   /api/entities/:id/aliases
POST   /api/entities/merge
POST   /api/entities/split
GET    /api/entities/:id/signals
GET    /api/entities/:id/related
GET    /api/entities/unresolved
GET    /api/entities/recent-aliases
```

**Feedback:**
```
GET    /api/feedback/pending
POST   /api/feedback/:id/accept
POST   /api/feedback/:id/reject
POST   /api/feedback/:id/defer
POST   /api/feedback/bulk-accept
POST   /api/feedback/create
GET    /api/feedback/stats
GET    /api/feedback/stats/trend
GET    /api/feedback/prompts
```

**Ingestion:**
```
POST   /api/ingest/transcript
POST   /api/ingest/document
POST   /api/ingest/crawled
POST   /api/ingest/crawled/batch
POST   /api/ingest/jira          (manual import, TBD for MCP)
POST   /api/ingest/wiki          (manual import, TBD for MCP)
```

**Sources:**
```
GET    /api/sources
POST   /api/sources
GET    /api/sources/:id
PATCH  /api/sources/:id
GET    /api/sources/:id/signals
POST   /api/sources/:id/sync
```

### 4.7 MCP Tools (31 total)

| Category | Tool | Service | Primary Persona |
|----------|------|---------|-----------------|
| Search | `search_signals` | `hybrid_search_service` | PM (Daily Driver) |
| Search | `get_customer_profile` | `knowledge_graph_service` | PM, New PM |
| Search | `get_feature_health` | `knowledge_graph_service` | PM |
| Search | `get_issue_impact` | `knowledge_graph_service` | PM |
| Search | `find_related_entities` | `knowledge_graph_service` | PM, New PM |
| Intelligence | `get_heatmap` | `heatmap_service` | PM, PM Leader |
| Intelligence | `get_trends` | `trend_analysis_service` | PM, PM Leader |
| Intelligence | `get_roadmap_priorities` | Existing roadmap endpoints | PM, PM Leader |
| Intelligence | `get_strategic_insights` | `insight_generator_service` | PM Leader |
| Opportunities | `list_opportunities` | `opportunity_service` | PM |
| Artifacts | `generate_artifact` | `artifact_service` | PM → Stakeholder |
| Reports | `generate_shareable_report` | `report_generation_service` | PM Leader → Stakeholder |
| Entities | `review_pending_entities` | `feedback_service` | PM |
| Entities | `confirm_entity_merge` | `feedback_service` | PM |
| Entities | `reject_entity_merge` | `feedback_service` | PM |
| Entities | `add_entity_alias` | `canonical_entity_service` | PM |
| Entities | `list_entities` | `canonical_entity_service` | PM, New PM |
| Entities | `split_entity` | `canonical_entity_service` | PM |
| Onboarding | `browse_knowledge_graph` | `knowledge_graph_service` | New PM |
| Onboarding | `get_knowledge_summary` | `knowledge_graph_service` + `trend_analysis_service` | New PM |
| Ingestion | `ingest_transcript` | `transcript_adapter` | PM, New PM (bulk) |
| Ingestion | `ingest_document` | `document_adapter` | PM, New PM (bulk) |
| Provenance | `get_provenance` | `provenance_service` | PM, PM Leader |
| Provenance | `get_entity_resolution_stats` | `feedback_service` | PM |
| Analysis | `what_if_analysis` | `knowledge_graph_service` + `query_engine_service` | PM, PM Leader |
| Analysis | `export_data` | Multiple services | PM |
| System | `get_system_health` | Multiple services | PM |
| System | `run_pipeline` | Pipeline orchestration | PM |
| System | `get_dlq_status` | Dead letter queue | PM |
| System | `retry_dlq_item` | Dead letter queue | PM |

---

## 5. Directory Structure (V2 Target)

```
PM_cursor_system/
├── .cursor/
│   └── mcp.json                        # MCP server configuration
├── .env                                 # Environment variables
├── .env.example                         # Template
├── backend/
│   ├── adapters/                        # NEW: Source-specific ingestion adapters
│   │   ├── transcript_adapter.ts
│   │   ├── document_adapter.ts
│   │   ├── crawler_bot_adapter.ts
│   │   ├── jira_mcp_adapter.ts          # TBD stub
│   │   └── wiki_mcp_adapter.ts          # TBD stub
│   ├── api/
│   │   └── index.ts                     # Express API (existing + new endpoints)
│   ├── db/
│   │   ├── migrate.ts                   # Database migrations
│   │   └── migrations/                  # V1 + V2 migration files
│   ├── mcp/                             # NEW: MCP server
│   │   ├── server.ts                    # MCP server entry point
│   │   └── tools/                       # Individual tool handlers
│   │       ├── search_tools.ts
│   │       ├── intelligence_tools.ts
│   │       ├── entity_tools.ts
│   │       ├── ingestion_tools.ts
│   │       ├── provenance_tools.ts
│   │       ├── onboarding_tools.ts      # NEW: browse_knowledge_graph, get_knowledge_summary
│   │       ├── report_tools.ts          # NEW: generate_shareable_report, generate_artifact
│   │       └── system_tools.ts
│   ├── services/                        # All business logic services
│   │   ├── (existing V1 services)
│   │   ├── knowledge_graph_service.ts   # NEW
│   │   ├── entity_registry_service.ts   # NEW
│   │   ├── alias_management_service.ts  # NEW
│   │   ├── canonical_entity_service.ts  # NEW
│   │   ├── entity_resolution_service.ts # NEW
│   │   ├── feedback_service.ts          # NEW
│   │   ├── source_registry_service.ts   # NEW
│   │   ├── normalizer_service.ts        # NEW
│   │   ├── provenance_service.ts        # NEW
│   │   ├── relationship_extraction_service.ts # NEW
│   │   ├── graphrag_indexer_service.ts  # NEW
│   │   ├── query_engine_service.ts      # NEW
│   │   ├── heatmap_service.ts           # NEW
│   │   ├── ingestion_scheduler_service.ts # NEW
│   │   ├── document_chunking_service.ts # NEW
│   │   ├── insight_generator_service.ts # NEW
│   │   ├── report_generation_service.ts # NEW (shareable reports)
│   │   ├── a2a_server_service.ts       # NEW (A2A protocol server)
│   │   ├── agent_gateway_service.ts   # NEW (agent REST API gateway)
│   │   └── event_bus_service.ts       # NEW (Redis Streams event bus)
│   ├── agents/                          # NEW: A2A Server + Agent Gateway
│   │   ├── gateway.ts                   # Express router: /api/agents/*
│   │   ├── auth_middleware.ts           # API key validation + rate limiting
│   │   ├── event_stream.ts             # SSE endpoint for agent subscriptions
│   │   └── webhook_delivery.ts          # Webhook event delivery with retry
│   └── tests/
├── agents/                              # NEW: Agent processes
│   ├── triage_agent/                    # Signal urgency classification
│   ├── report_scheduler/               # Cron-based report generation
│   ├── jira_sync_agent/                # Bidirectional JIRA sync
│   ├── slack_alert_bot/                # Event-driven Slack notifications
│   ├── data_quality_agent/             # ER monitoring + orphan detection
│   ├── cs_agent/                       # Customer health monitoring
│   ├── competitive_intel/              # Competitor mention extraction
│   └── executive_briefing/             # Scheduled executive summaries
├── python_services/                     # NEW: Python microservices
│   ├── entity_resolution/
│   │   ├── app.py
│   │   ├── resolver.py
│   │   ├── blocking.py
│   │   ├── matching.py
│   │   ├── llm_matcher.py
│   │   ├── requirements.txt
│   │   └── tests/
│   ├── document_parser/
│   │   ├── app.py
│   │   ├── parser.py
│   │   ├── chunker.py
│   │   ├── transcript_parser.py
│   │   ├── requirements.txt
│   │   └── Dockerfile
│   └── graphrag_indexer/
│       ├── app.py
│       ├── indexer.py
│       ├── requirements.txt
│       └── Dockerfile
├── data/
│   ├── raw/                             # Raw ingested data
│   ├── intermediate/                    # Processing state
│   └── uploads/                         # NEW: Uploaded files (temp)
├── docker-compose.yml                   # NEW: Neo4j + Redis + Python services
├── specs/
│   ├── (V1 specs)
│   └── v2/                              # NEW: V2 specifications
│       ├── 00_INDEX.md
│       ├── 01_MASTER_PRD.md
│       ├── ... (all 15 docs)
│       └── 15_COMPONENT_REGISTRY.md
├── scripts/
│   ├── (existing V1 scripts)
│   └── (V2 scripts as needed)
├── output/                              # Generated artifacts
├── exports/                             # Export data
├── docs/                                # Documentation
├── package.json
├── tsconfig.json
└── README.md
```

---

## 6. Entity Types & Concepts

### 6.1 Core Entity Types

| Type | Stored In | Description |
|------|-----------|-------------|
| `customer` | entity_registry + Neo4j | Company or account. Segments: enterprise, mid-market, smb |
| `feature` | entity_registry + Neo4j | Product capability. Areas: security, analytics, api, etc. |
| `issue` | entity_registry + Neo4j | Problem or bug. Categories: bug, performance, usability, security, feature_gap |
| `theme` | entity_registry + Neo4j + theme_hierarchy | Hierarchical topic. 4 levels: Domain → Category → Theme → Sub-theme |
| `stakeholder` | entity_registry + Neo4j | Person involved. Roles: engineering, product, sales, support |

### 6.2 Layer Concepts

| Concept | Layer | Description |
|---------|-------|-------------|
| `signal` | Signals | Raw immutable input from any source |
| `extraction` | Extraction | LLM-extracted structured data from a signal |
| `canonical_entity` | Resolution | Authoritative identity for an entity |
| `alias` | Resolution | Variant name mapped to a canonical entity |
| `opportunity` | Opportunities | Clustered signals suggesting product work |
| `judgment` | Judgments | Human+LLM reasoning about an opportunity |
| `artifact` | Artifacts | Generated document (PRD, RFC, JIRA) |
| `feedback` | Resolution | Human correction or confirmation |
| `provenance` | Intelligence | Source chain from insight to signals |

### 6.3 Signal Sources

| Source | Adapter | Status |
|--------|---------|--------|
| `slack` | `slack_adapter` (existing) | Working |
| `meeting_transcript` | `transcript_adapter` (new) | To Build |
| `document` | `document_adapter` (new) | To Build |
| `web_scrape` | `crawler_bot_adapter` (new) | To Build |
| `community_forum` | `community_forum_adapter` (existing) | Working |
| `jira` | `jira_mcp_adapter` (stub) | TBD |
| `wiki` | `wiki_mcp_adapter` (stub) | TBD |
| `grafana` | `webhook_receiver` (existing) | Stub |
| `splunk` | `webhook_receiver` (existing) | Stub |

### 6.4 Trend Directions

| Direction | Definition |
|-----------|------------|
| `emerging` | New theme/issue appearing for the first time |
| `growing` | Increasing signal volume week-over-week |
| `stable` | Consistent signal volume |
| `declining` | Decreasing signal volume week-over-week |

### 6.5 Channel Categories (V1, still valid)

| Category | Description |
|----------|-------------|
| `customer_engagement` | Direct customer communication |
| `support` | Customer support channels |
| `sales` | Sales team discussions |
| `engineering` | Engineering discussions |
| `general` | General/cross-functional |
