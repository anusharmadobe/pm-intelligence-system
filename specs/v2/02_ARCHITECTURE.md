# V2 Architecture — PM Intelligence Context Layer

> **Version:** 2.5 (Updated — Docker Compose spec, startup order, prerequisites, config validation)
> **Date:** 2026-02-09
> **Status:** Approved for Build

---

## 1. Architecture Overview

V2 is organized into **seven horizontal planes** (six data planes + one cross-cutting event plane), serving both human personas and autonomous/integration agents. See `01_MASTER_PRD.md` §4 for human personas and `16_AGENTIC_INTERACTIONS.md` for agent personas.

```
┌──────────────────────────────────────────────────────────────────────────┐
│                        CONSUMPTION PLANE                                  │
│                                                                          │
│  HUMAN INTERFACES:                                                       │
│  ChatGPT Actions │ Web UI (/ui) │ Claude Code/Cowork (MCP) │ Cursor      │
│  via agent_gateway_service + pm_intelligence_mcp_server (31 tools)        │
│                                                                          │
│  AGENT INTERFACES:                                                       │
│  A2A Server (/a2a) │ Agent Card (/.well-known/agent.json)               │
│  via a2a_server_service (A2A protocol, JSON-RPC 2.0, discoverable)       │
│                                                                          │
│  Agent Gateway (/api/agents/*) │ SSE Event Stream │ Webhook Delivery     │
│  via agent_gateway_service (API key auth, rate limited, audit logged)     │
│                                                                          │
│  Human Personas: PM, PM Leader, New PM, Stakeholder (indirect)           │
│  Agent Personas: Triage, Report Scheduler, JIRA Sync, Slack Alert Bot,   │
│                  Data Quality, Sprint Planning, CS, Competitive Intel,    │
│                  Workflow Automation, Executive Briefing                   │
├──────────────────────────────────────────────────────────────────────────┤
│                        INTELLIGENCE PLANE                                 │
│  query_engine_service │ insight_generator_service │ trend_analysis_service│
│  heatmap_service │ roadmap_scorer │ provenance_service                    │
│  report_generation_service                                                │
├──────────────────────────────────────────────────────────────────────────┤
│                        KNOWLEDGE PLANE                                    │
│  ┌──────────────────┐  ┌───────────────────┐  ┌───────────────────┐    │
│  │ Neo4j             │  │ pgvector           │  │ PostgreSQL        │    │
│  │ knowledge_graph   │  │ signal_embeddings  │  │ signals (SoT)     │    │
│  │ _service          │  │ theme_embeddings   │  │ opportunities     │    │
│  │                   │  │ document_chunks    │  │ judgments          │    │
│  │ Entities:         │  │                    │  │ artifacts          │    │
│  │ - customers       │  │                    │  │ extractions        │    │
│  │ - features        │  │                    │  │ entity_registry    │    │
│  │ - issues          │  │                    │  │ feedback_log       │    │
│  │ - themes          │  │                    │  │ agent_registry     │    │
│  │ - stakeholders    │  │                    │  │ agent_activity_log │    │
│  └──────────────────┘  └───────────────────┘  └───────────────────┘    │
├──────────────────────────────────────────────────────────────────────────┤
│                        ENTITY RESOLUTION PLANE                            │
│  entity_resolution_service │ entity_registry_service                      │
│  alias_management_service │ canonical_entity_service                      │
│  feedback_service (human corrections + agent proposals)                   │
├──────────────────────────────────────────────────────────────────────────┤
│                        EXTRACTION PLANE                                   │
│  llm_extraction_service (existing) │ relationship_extraction_service      │
│  graphrag_indexer_service │ document_chunking_service                     │
├──────────────────────────────────────────────────────────────────────────┤
│                        INGESTION PLANE                                    │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌───────────────┐ │
│  │ slack_adapter │ │ transcript   │ │ document     │ │ crawler_bot   │ │
│  │ (existing)   │ │ _adapter     │ │ _adapter     │ │ _adapter      │ │
│  └──────────────┘ └──────────────┘ └──────────────┘ └───────────────┘ │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐                   │
│  │ jira_mcp     │ │ wiki_mcp     │ │ webhook      │                   │
│  │ _adapter     │ │ _adapter     │ │ _receiver    │                   │
│  │ (TBD)        │ │ (TBD)        │ │ (existing)   │                   │
│  └──────────────┘ └──────────────┘ └──────────────┘                   │
│                                                                          │
│  source_registry_service │ normalizer_service │ deduplication_service    │
│  ingestion_scheduler_service                                             │
├──────────────────────────────────────────────────────────────────────────┤
│                    EVENT BUS (Cross-Cutting)                              │
│  Redis Streams — event_bus_service                                       │
│  Events: signal.*, entity.*, opportunity.*, pipeline.*, er.*, jira.*     │
│  Subscribers: Autonomous agents, Integration agents, internal services   │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Plane Descriptions

### 2.1 Ingestion Plane

**Responsibility:** Accept data from all sources, normalize to a common signal format, deduplicate, and pass to extraction.

**Components:**

| Component | Type | Status | Description |
|-----------|------|--------|-------------|
| `slack_adapter` | Adapter | Existing (V1) | Ingests Slack messages via MCP and direct API |
| `transcript_adapter` | Adapter | New | Accepts meeting transcripts via API (text paste, file upload) |
| `document_adapter` | Adapter | New | Parses PPT/Word/Excel/PDF via Unstructured.io |
| `crawler_bot_adapter` | Adapter | New | Receives scraped web content from external crawler bot |
| `jira_mcp_adapter` | Adapter | Stub (TBD) | Will ingest JIRA tickets via MCP when configured |
| `wiki_mcp_adapter` | Adapter | Stub (TBD) | Will ingest Confluence/wiki pages via MCP when configured |
| `webhook_receiver` | Adapter | Existing (V1) | Receives webhooks from Grafana, Splunk, Teams |
| `community_forum_adapter` | Adapter | Existing (V1) | Ingests community forum data |
| `source_registry_service` | Service | New | Central registry of all data sources, auth status, sync state |
| `normalizer_service` | Service | New | Converts adapter-specific formats to universal RawSignal |
| `deduplication_service` | Service | Existing (V1) | Embedding-based dedup across signals |
| `ingestion_scheduler_service` | Service | New | Schedules recurring ingestion jobs (BullMQ) |

**Data flow:**
```
Source → Adapter → normalizer_service → deduplication_service → Signal (PostgreSQL)
                                                                      ↓
                                                              Extraction Plane
```

### 2.2 Extraction Plane

**Responsibility:** Extract structured entities, relationships, and embeddings from raw signals.

**Components:**

| Component | Type | Status | Description |
|-----------|------|--------|-------------|
| `llm_extraction_service` | Service | Existing (V1) | Extracts customers, features, issues, themes from signals |
| `slack_llm_extractor` | Service | Existing (V1) | Slack-specific extraction logic |
| `relationship_extraction_service` | Service | New | Extracts relationships between entities (e.g., Customer USES Feature) |
| `graphrag_indexer_service` | Service | New | Microsoft GraphRAG integration for hierarchical community extraction |
| `document_chunking_service` | Service | New | Semantic chunking for documents (via Unstructured.io) |
| `embedding_service` | Service | Existing (V1) | Generates embeddings via Azure OpenAI |

**Data flow:**
```
Signal → llm_extraction_service → OUTPUT VALIDATION → signal_extractions (PostgreSQL)
                                        ↓
                              Entity Resolution Plane
                                        ↓
Signal → embedding_service → signal_embeddings (pgvector)
Signal → graphrag_indexer_service → communities + hierarchical summaries
```

**Output validation (applied to all LLM extraction results):**
- Zod schema validation (LV-1): reject non-conforming outputs
- Entity count limits (LV-2): max 20 per type, 10 for themes
- Relationship count limits (LV-3): max 50 per signal
- Hallucination guard (LV-4): entity names must appear in source content
- Confidence bounds (LV-5): clamped to [0.0, 1.0]
- Timeout guard (LV-6): 60 seconds per extraction call
- See `08_DATA_CONTRACTS.md` §6.1 for the complete rule table.

### 2.3 Entity Resolution Plane

**Responsibility:** Resolve extracted entity mentions to canonical entities. The MOST CRITICAL plane in V2.

**Components:**

| Component | Type | Status | Description |
|-----------|------|--------|-------------|
| `entity_resolution_service` | Service | Implemented | Core resolution engine (LLM-powered with embedding fallback) |
| `entity_registry_service` | Service | Implemented | CRUD for canonical entities |
| `alias_management_service` | Service | Implemented | Growing alias table management |
| `canonical_entity_service` | Service | Implemented | Merge/split/search canonical entities |
| `feedback_service` | Service | Implemented | Human correction queue and feedback processing |

**Data flow:**
```
signal_extractions → entity_resolution_service
                           ↓ (high confidence)
                     entity_registry → Neo4j graph update
                           ↓ (medium confidence)
                     feedback_service → human review → entity_registry
                           ↓ (low confidence)
                     treated as new entity → entity_registry
```

See [03_ENTITY_RESOLUTION.md](./03_ENTITY_RESOLUTION.md) for deep dive.

### 2.4 Knowledge Plane

**Responsibility:** Store and serve the unified knowledge representation.

**Three storage engines, one truth:**

| Engine | Role | Data |
|--------|------|------|
| **PostgreSQL** | Source of Truth | Signals, extractions, entity_registry, opportunities, judgments, artifacts, feedback_log, audit trail |
| **pgvector** (PostgreSQL extension) | Vector Search | Signal embeddings, document chunk embeddings, entity embeddings |
| **Neo4j** (Community Edition) | Graph Queries | Entity nodes, relationship edges, path traversals, community structure |

**Sync invariant:** Neo4j is ALWAYS derived from PostgreSQL. If they diverge, PostgreSQL wins. Nightly consistency check job validates sync integrity.

See [04_KNOWLEDGE_GRAPH.md](./04_KNOWLEDGE_GRAPH.md) for Neo4j schema and sync patterns.

### 2.5 Intelligence Plane

**Responsibility:** Answer complex questions by reasoning over the Knowledge Plane.

**Components:**

| Component | Type | Status | Description |
|-----------|------|--------|-------------|
| `query_engine_service` | Service | New | Agentic RAG: decomposes complex queries into sub-queries across Neo4j + pgvector |
| `insight_generator_service` | Service | New | Generates strategic insights from cross-source data |
| `trend_analysis_service` | Service | Existing (V1) | Enhanced with temporal reasoning and multi-source data |
| `heatmap_service` | Service | New | Generates heatmaps (issues by feature, customers by issue, etc.) |
| `roadmap_scorer` | Logic | Existing (V1) | RICE-like scoring for opportunity prioritization |
| `provenance_service` | Service | New | Traces any insight back to source signals |
| `opportunity_service` | Service | Existing (V1) | Enhanced with entity-resolution-aware clustering |
| `judgment_service` | Service | Existing (V1) | Human + LLM assisted reasoning |
| `artifact_service` | Service | Existing (V1) | PRD/RFC generation from judgments |
| `jira_issue_service` | Service | Existing (V1) | JIRA draft generation from opportunities |

**Query patterns:**

```
Simple query:   User → MCP tool → single service → response
Complex query:  User → MCP tool → query_engine_service
                  → decompose into sub-queries
                  → parallel execution (Neo4j + pgvector + PostgreSQL)
                  → synthesis via LLM
                  → response with provenance + confidence
```

### 2.6 Consumption Plane

**Responsibility:** Expose system capabilities to all consumers — human personas via ChatGPT Actions, Web UI, and MCP; external agents via A2A protocol; internal agents via Event Bus; and simple integrations via Agent Gateway REST API.

**Three-Protocol Model** (see `16_AGENTIC_INTERACTIONS.md` §10 for full rationale):

| Protocol | Standard | Used By | When |
|----------|----------|---------|------|
| **MCP** | Anthropic open standard | Human personas via Claude Code/Cowork | Conversational, human-in-the-loop |
| **ChatGPT Actions** | OpenAPI | Human personas via ChatGPT Enterprise | Tool calls via Agent Gateway |
| **A2A** | Google open standard (v0.2.1) | External/third-party agents | Discoverable, interoperable, async |
| **Internal Event Bus** | Custom (Redis Streams) | Co-located in-process agents | Low-latency, event-driven |
| **Agent Gateway REST** | Custom REST API | Simple integrations (n8n, Zapier, JIRA) | Fallback for systems that can't implement A2A |

**Components:**

| Component | Type | Status | Description |
|-----------|------|--------|-------------|
| `pm_intelligence_mcp_server` | MCP Server | New | Human interface: 31 MCP tools for Claude Code/Cowork |
| `a2a_server_service` | A2A Server | New | External agent interface: Agent Card + JSON-RPC 2.0 skills, A2A protocol compliant |
| `agent_gateway_service` | HTTP API | New | Simple agent interface: REST API with API key auth, rate limiting, event subscription |
| `event_bus_service` | Event Bus | New | Redis Streams-based event bus for agent subscriptions and system event propagation |
| REST API (existing) | HTTP API | Existing (V1) | Continues to serve existing endpoints |
| `pm_intelligence_ui` | Web UI | New | Role-based UI at `/ui` powered by Agent Gateway |
| `source_registry_service` | Via API | New | Manage connected sources |
| `report_generation_service` | Service | New | Generates shareable reports for PM Leader, stakeholder, and scheduled agent delivery |

**Three access channels, same underlying services:**

```
Human Personas     → ChatGPT Actions / UI / MCP ─→ Services → Knowledge Plane
External Agents    → A2A Server ──────────────→ Services → Knowledge Plane
Internal Agents    → Event Bus (subscribe) ───→ Services → Knowledge Plane
Simple Integrations → Agent Gateway REST ──────→ Services → Knowledge Plane

Agent Card at: /.well-known/agent.json (A2A discovery)
A2A endpoint at: /a2a (JSON-RPC 2.0)
Agent Gateway at: /api/agents/* (REST)
```

| Consumer Type | Interface | Protocol | Authentication | Output Format |
|---------------|-----------|----------|---------------|---------------|
| Human via ChatGPT / UI / Claude | Agent Gateway + MCP | HTTP + MCP | API key for Agent Gateway | Structured JSON → UI/ChatGPT/Claude formats |
| External AI Agent | A2A skills (8) | A2A (JSON-RPC 2.0) | API key in X-API-Key header | A2A Artifacts (structured JSON) |
| Simple Integration | Agent Gateway REST | HTTP | API key per agent | Strict JSON, guaranteed schema |
| Event Subscriber (Agent) | SSE stream or webhook | HTTP | API key + event permissions | SystemEvent JSON |

**Human persona routing:**

| Persona | Typical Interface Usage |
|---------|-------------------------|
| PM (Daily Driver) | ChatGPT Actions or UI for search, profiles, ingestion |
| PM Leader (Strategist) | UI for heatmaps/trends + ChatGPT for summaries |
| New PM (Ramp-Up) | UI entity browsing + knowledge summaries |

**Agent persona routing:**

| Agent | Typical Agent Gateway Usage |
|-------|---------------------------|
| Triage Agent | GET /api/agents/signals (read), POST /api/agents/issues/flag (write), SSE events |
| Report Scheduler | POST /api/agents/reports/generate (write) |
| JIRA Sync Agent | POST /api/agents/entities/link (write), webhook receiver for JIRA events |
| Slack Alert Bot | SSE subscription for critical events |
| Data Quality Agent | GET /api/agents/er-stats (read), POST /api/agents/entities/propose (write) |

See [05_MCP_SERVER.md](./05_MCP_SERVER.md) for MCP tools, [16_AGENTIC_INTERACTIONS.md](./16_AGENTIC_INTERACTIONS.md) §10 for A2A protocol design and protocol decision matrix.

### 2.7 Event Bus (Cross-Cutting)

**Responsibility:** Propagate system events to subscribed agents and internal services. Enables event-driven agent workflows.

**Technology:** Redis Streams (reuses existing Redis infrastructure from BullMQ).

**Components:**

| Component | Type | Status | Description |
|-----------|------|--------|-------------|
| `event_bus_service` | Service | New | Publishes events to Redis Streams, manages subscriptions, handles backpressure |
| Redis Streams | Infrastructure | Existing (Redis already deployed for BullMQ) | Persistent, ordered event log with consumer groups |

**Event categories:**

| Category | Events | Typical Subscribers |
|----------|--------|---------------------|
| Signal events | `signal.ingested`, `signal.batch_complete` | Triage Agent, Competitive Intel Agent |
| Entity events | `entity.created`, `entity.merged`, `entity.health_changed`, `entity.signal_spike` | Slack Alert Bot, CS Agent, Data Quality Agent |
| Opportunity events | `opportunity.created`, `opportunity.score_changed` | Workflow Automation Agent |
| Pipeline events | `pipeline.completed`, `pipeline.failed` | Data Quality Agent |
| ER events | `er.accuracy_changed`, `er.review_queue_high` | Data Quality Agent, Slack Alert Bot |
| External sync events | `jira.status_changed`, `jira.ticket_created` | CS Agent, Slack Alert Bot |
| Report events | `report.generated` | Report Scheduler Agent (confirmation) |
| Artifact events | `artifact.approved` | JIRA Sync Agent |

**Design constraints:**
- Events are fire-and-forget from the emitting service's perspective
- Consumer groups ensure each agent receives each event exactly once
- Event delivery is at-least-once (agents must be idempotent)
- Event storm protection: max 100 events/second per stream
- Events retained for 7 days in Redis Streams for replay

---

## 3. Data Flow — End to End

### 3.1 Signal Ingestion Flow

```
1. Source data arrives (Slack message / uploaded transcript / document / crawler output)
2. Adapter normalizes to RawSignal format
3. normalizer_service validates and enriches metadata
4. deduplication_service checks for duplicates (embedding similarity > 0.95)
5. Signal stored in PostgreSQL (immutable)
6. embedding_service generates vector embedding → pgvector
7. llm_extraction_service extracts entities and attributes → signal_extractions
8. relationship_extraction_service extracts entity relationships
9. entity_resolution_service resolves entities to canonical forms
   - High confidence: auto-merge, update entity_registry
   - Medium confidence: queue for human review in feedback_service
   - Low confidence: create as new entity
10. knowledge_graph_service syncs to Neo4j (entities + relationships)
11. opportunity_service runs incremental detection (if enough new signals)
```

### 3.2 Query Flow

```
1. User asks question via ChatGPT, UI, or Claude (natural language or form-based)
2. ChatGPT/Claude selects appropriate tool(s) based on user intent
3. MCP tool routes to service:
   - Simple lookup: direct service call (e.g., get_customer_profile → Neo4j)
   - Complex analysis: query_engine_service decomposes into sub-queries
   - Report generation: report_generation_service synthesizes multi-source data
4. Service executes against Knowledge Plane (Neo4j + pgvector + PostgreSQL)
5. Results enriched with provenance and confidence
6. Response returned to ChatGPT/UI/Claude → user

Persona-specific query patterns:
  PM:        "What's happening with Acme?" → get_customer_profile (targeted)
  PM Leader: "Show portfolio heatmap"      → get_heatmap (broad, aggregate)
  New PM:    "Give me the full picture"    → get_knowledge_summary (exploratory)
```

### 3.3 Feedback Flow

```
1. PM reviews entity resolution candidate via MCP tool
2. PM accepts/rejects/corrects
3. feedback_service records correction (immutable feedback_log)
4. If accepted: entity_registry updated, alias table updated, Neo4j synced
5. If rejected: entity kept separate, pattern logged for learning
6. Periodically: analyze correction patterns → improve extraction prompts
```

---

## 4. Technology Stack

### 4.1 Core (Existing)

| Technology | Version | Purpose |
|------------|---------|---------|
| TypeScript | 5.3+ | Primary language |
| Node.js | 18+ | Runtime |
| Express.js | 4.18+ | REST API |
| PostgreSQL | 12+ | Primary database |
| pgvector | 0.5+ | Vector similarity search |
| Azure OpenAI | GPT-4o, text-embedding-ada-002 | LLM + embeddings |
| @modelcontextprotocol/sdk | 1.25+ | MCP integration |

### 4.2 New (V2)

| Technology | Version | Purpose | Cost |
|------------|---------|---------|------|
| Neo4j Community Edition | 5.x | Knowledge graph | Free (AGPL) |
| Redis | 7+ | Job queue (BullMQ), caching | Free (BSD) |
| BullMQ | Latest | Job scheduling for ingestion | Free (MIT) |
| neo4j-driver (npm) | Latest | Node.js Neo4j driver | Free |

### 4.3 Optional / Future (V3+)

| Technology | Purpose | When |
|------------|---------|------|
| Argilla | Human feedback annotation UI | V2 late / V3 |
| WhyHow Knowledge Table | Schema-driven document extraction | V3 |

---

## 5. Deployment Architecture

### 5.1 Local Development (V2 Default)

```
┌──────────────────────────────────────────────┐
│ Docker Compose                                │
│                                               │
│  ┌──────────────┐  ┌──────────────────────┐ │
│  │ PostgreSQL   │  │ Neo4j CE             │ │
│  │ + pgvector   │  │ bolt://localhost:7687│ │
│  │ :5432        │  │ http://localhost:7474│ │
│  └──────────────┘  └──────────────────────┘ │
│                                               │
│  ┌──────────────┐                            │
│  │ Redis        │                            │
│  │ :6379        │                            │
│  └──────────────┘                            │
└──────────────────────────────────────────────┘

┌──────────────────────────────────────────────┐
│ Application (local processes)                 │
│                                               │
│  ┌──────────────────────────┐                │
│  │ TypeScript Main Process  │                │
│  │ - Express API (:3000)    │                │
│  │ - MCP Server (:3001)     │                │
│  │ - All V1+V2 services     │                │
│  │   * Entity resolution    │                │
│  │   * LLM extraction       │                │
│  │   * Knowledge graph sync │                │
│  └──────────────────────────┘                │
└──────────────────────────────────────────────┘
```

### 5.2 Docker Compose Specification

```yaml
# docker-compose.yml — PM Intelligence System V2 Infrastructure
version: '3.8'

services:
  postgres:
    image: pgvector/pgvector:pg15
    ports:
      - "5432:5432"
    environment:
      POSTGRES_DB: pm_intelligence
      POSTGRES_USER: ${POSTGRES_USER:-pm_intel}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U pm_intel -d pm_intelligence"]
      interval: 10s
      timeout: 5s
      retries: 5
    restart: unless-stopped

  neo4j:
    image: neo4j:5-community
    ports:
      - "7474:7474"   # HTTP browser
      - "7687:7687"   # Bolt protocol
    environment:
      NEO4J_AUTH: ${NEO4J_USER:-neo4j}/${NEO4J_PASSWORD}
      NEO4J_PLUGINS: '["apoc"]'
      NEO4J_server_memory_heap_max__size: 512m
    volumes:
      - neo4jdata:/data
    healthcheck:
      test: ["CMD", "neo4j", "status"]
      interval: 15s
      timeout: 10s
      retries: 5
    restart: unless-stopped

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    command: redis-server --maxmemory 256mb --maxmemory-policy allkeys-lru
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5
    restart: unless-stopped

volumes:
  pgdata:
  neo4jdata:
```

### 5.3 Startup Order & Dependencies

Services MUST start in this order. Each layer waits for the previous layer's health checks to pass.

```
Layer 1 — Infrastructure (Docker Compose):
  1. PostgreSQL + pgvector    ← health: pg_isready
  2. Neo4j CE                 ← health: neo4j status
  3. Redis                    ← health: redis-cli ping
  (all 3 can start in parallel; they have no interdependencies)

Layer 2 — TypeScript Application:
  4. Express API + MCP Server + A2A Server  ← waits for PostgreSQL, Neo4j, Redis
  5. BullMQ workers (in-process)            ← starts with main process
  6. Event Bus service                      ← starts with main process
  7. Entity Resolution service (in-process) ← LLM-powered, no external service needed
  8. LLM Extraction service (in-process)    ← Two-pass extraction with Azure OpenAI

Layer 3 — Agents (optional):
  9. In-process agents (Report Scheduler, Slack Alert Bot, Data Quality)
  10. Separate process agents (Triage Agent, JIRA Sync Agent)
```

**Startup validation**: The main process runs a startup health check sequence:

```typescript
async function validateStartup(): Promise<void> {
  // 1. PostgreSQL: run SELECT 1
  // 2. Neo4j: run RETURN 1 via Bolt
  // 3. Redis: run PING
  // 4. Run pending DB migrations
  // 5. Validate .env has all required variables (see §5.4)
  // 6. Validate LLM provider connection (Azure OpenAI)
  // If any fail: log error, retry 3x with 5s backoff, then exit(1)
}
```

### 5.4 Prerequisites Checklist

| Requirement | Version | Check Command | Notes |
|-------------|---------|--------------|-------|
| Node.js | 18+ | `node -v` | LTS recommended |
| npm/pnpm | Latest | `npm -v` | |
| Docker | Latest | `docker --version` | For PostgreSQL, Neo4j, Redis |
| Docker Compose | v2+ | `docker compose version` | |

### 5.5 Environment Configuration

All configuration via `.env` file (see existing `.env.example`). V2 additions documented in [11_THIRD_PARTY_TECH.md](./11_THIRD_PARTY_TECH.md).

---

## 6. Cross-Cutting Concerns

### 6.1 Logging

- Winston (existing) for TypeScript services
- Python `logging` module for Python microservices
- **Structured JSON logging** for all services — every log entry includes:
  - `timestamp` (ISO 8601, UTC normalized)
  - `level` (debug/info/warn/error)
  - `service` (which service emitted)
  - `correlation_id` (UUID propagated across service boundaries)
  - `signal_id` (when processing a specific signal)
  - `duration_ms` (for timed operations)
- **Correlation IDs**: Generated at ingestion or MCP request entry. All log entries and database writes include the correlation ID for request tracing.
- **Log aggregation**: All logs written to `data/logs/` with daily rotation. Structured JSON enables grep/jq analysis.
- **Sensitive data redaction**: Winston configured with custom format that redacts API keys, PII patterns, and auth tokens before writing.

### 6.2 Error Handling & Resilience

#### 6.2.1 Error Classification

All errors are classified into four categories with distinct handling:

| Category | Example | Retry? | Block Pipeline? | Human Alert? |
|----------|---------|--------|-----------------|--------------|
| **Transient** | Network timeout, rate limit, 503 | Yes (exponential backoff) | No — skip, retry later | No (unless persistent) |
| **Validation** | Malformed signal, schema violation | No | No — dead-letter queue | If recurring pattern |
| **Extraction** | LLM returned invalid JSON, hallucination | Yes (1 retry with reprompt) | No — mark as extraction_failed | If >20% failure rate |
| **Infrastructure** | PostgreSQL down, Neo4j unreachable | Yes (circuit breaker) | Yes — pause pipeline | Yes (immediate) |

#### 6.2.2 Retry Strategy

```
All retryable operations use exponential backoff with jitter:
  attempt 1: immediate
  attempt 2: wait 1s ± 500ms
  attempt 3: wait 4s ± 2s
  attempt 4: wait 16s ± 8s
  max attempts: 4 (configurable per operation)
  
LLM calls: max 2 attempts. Second attempt uses reprompt strategy
  (include the failed output and ask LLM to fix it).

Neo4j sync: max 3 attempts. After 3 failures, signal is queued
  in neo4j_sync_backlog table for next consistency check.
```

#### 6.2.3 Circuit Breaker Pattern

Each external dependency has a circuit breaker:

```
States: CLOSED (normal) → OPEN (failing) → HALF_OPEN (testing recovery)

Neo4j circuit breaker:
  OPEN after: 5 consecutive failures in 60 seconds
  HALF_OPEN after: 30 seconds in OPEN state
  CLOSED after: 3 consecutive successes in HALF_OPEN
  When OPEN: All graph queries return cached results or graceful degradation
             Sync operations queue to neo4j_sync_backlog
             Pipeline continues without Neo4j (PostgreSQL is SoT)

Azure OpenAI circuit breaker:
  OPEN after: 5 rate limit errors OR 3 consecutive 500s
  HALF_OPEN after: 60 seconds in OPEN state
  CLOSED after: 3 consecutive successes in HALF_OPEN
  When OPEN: Extraction queued for later processing
             Entity matching falls back to string+embedding only (no LLM)
             Pipeline continues with reduced quality (logged)
```

#### 6.2.4 Dead Letter Queue (DLQ)

Signals that fail processing after all retries go to a dead letter queue:

```sql
CREATE TABLE dead_letter_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  signal_id UUID REFERENCES signals(id),
  failure_stage VARCHAR(50),   -- 'extraction', 'entity_resolution', 'neo4j_sync', 'embedding'
  failure_reason TEXT,
  error_details JSONB,
  retry_count INTEGER DEFAULT 0,
  max_retries INTEGER DEFAULT 4,
  status VARCHAR(20) DEFAULT 'pending',  -- 'pending', 'retrying', 'resolved', 'abandoned'
  created_at TIMESTAMP DEFAULT NOW(),
  last_retry_at TIMESTAMP,
  resolved_at TIMESTAMP
);
```

DLQ processing: Cron job runs every 15 minutes, retries pending items with backoff. After `max_retries`, status set to 'abandoned' and alert triggered.

#### 6.2.5 Graceful Degradation

When components are unavailable, the system degrades gracefully:

| Component Down | Impact | Degradation | Recovery |
|----------------|--------|-------------|----------|
| Neo4j | No graph queries | Return PostgreSQL-only results; cache last known graph state | Auto-recover when Neo4j back; process sync backlog |
| Azure OpenAI | No LLM extraction/matching | Queue signals for later extraction; fall back to embedding-only entity matching; existing data still queryable | Process backlog when API recovers |
| Redis | No job scheduling | Run pipeline manually; lose caching (slower but functional) | Auto-recover |
| PostgreSQL | System unavailable | Complete failure; no degradation possible (SoT unavailable) | Manual intervention required |

#### 6.2.6 Idempotency

All operations are idempotent — safe to retry without side effects:

```
Signal ingestion: Idempotent via content_hash. Re-ingesting same content is a no-op.
Entity resolution: Idempotent via signal_id + entity_mention. Same mention for same signal always produces same result.
Neo4j sync: Idempotent via MERGE (upsert). Re-syncing same data is safe.
Embedding generation: Idempotent via signal_id. Re-embedding same signal overwrites with identical result.
Feedback processing: NOT idempotent (append-only). Use feedback_id to prevent duplicate processing.
```

### 6.3 Observability & Monitoring

#### 6.3.1 Service Level Objectives (SLOs)

| SLO | Target | Measurement | Alert Threshold |
|-----|--------|-------------|-----------------|
| Pipeline availability | 99.5% uptime | Successful pipeline runs / total scheduled | <99% over 24h |
| MCP tool response time | p95 < 5s | MCP tool call duration | p95 > 8s over 1h |
| Entity resolution accuracy | >85% (30d), >92% (90d) | Auto-merge accuracy vs human corrections | <80% over 7d |
| Neo4j sync latency | <30s after PostgreSQL write | Timestamp delta: PG write → Neo4j write | >60s average over 1h |
| Extraction success rate | >95% of signals | Successfully extracted / total signals | <90% over 24h |
| Knowledge graph consistency | <1% divergence | Nightly PG↔Neo4j count comparison | >2% divergence |

#### 6.3.2 Metrics Collection

Every service emits metrics (stored in `system_metrics` table for V2; Prometheus for V3):

```sql
CREATE TABLE system_metrics (
  id BIGSERIAL PRIMARY KEY,
  metric_name VARCHAR(100) NOT NULL,
  metric_value FLOAT NOT NULL,
  labels JSONB DEFAULT '{}',
  recorded_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_metrics_name_time ON system_metrics(metric_name, recorded_at);
```

Key metrics:
- `pipeline.signals_processed` (counter, labels: source, status)
- `pipeline.extraction_duration_ms` (histogram)
- `pipeline.extraction_errors` (counter, labels: error_type)
- `entity_resolution.total` (counter, labels: result_type)
- `entity_resolution.confidence` (histogram, labels: entity_type)
- `entity_resolution.duration_ms` (histogram)
- `neo4j.sync_duration_ms` (histogram)
- `neo4j.sync_errors` (counter)
- `neo4j.query_duration_ms` (histogram, labels: query_type)
- `mcp.tool_calls` (counter, labels: tool_name)
- `mcp.tool_duration_ms` (histogram, labels: tool_name)
- `mcp.tool_errors` (counter, labels: tool_name, error_code)
- `feedback.pending_count` (gauge)
- `feedback.resolution_rate` (gauge, per week)
- `dlq.pending_count` (gauge, labels: failure_stage)

#### 6.3.3 Health Check Endpoints

Every service exposes a health check:

```typescript
interface HealthCheckResponse {
  status: 'healthy' | 'degraded' | 'unhealthy';
  version: string;
  uptime_seconds: number;
  checks: {
    postgresql: { status: string; latency_ms: number };
    neo4j: { status: string; latency_ms: number; circuit_breaker: string };
    redis: { status: string; latency_ms: number };
    python_doc_parser: { status: string; latency_ms: number; circuit_breaker: string };
    azure_openai: { status: string; circuit_breaker: string };
  };
  pipeline: {
    last_run_at: string;
    last_run_status: string;
    signals_in_dlq: number;
    pending_feedback: number;
  };
}
```

#### 6.3.4 Distributed Tracing

Cross-service requests are traced via correlation IDs:

```
MCP tool call (Claude Code)
  → correlation_id generated
  → TypeScript service (logged with correlation_id)
    → Azure OpenAI call (correlation_id in metadata)
    → Neo4j query (correlation_id in query metadata)
    → PostgreSQL write (correlation_id stored in record)
  → MCP response (includes correlation_id in metadata)
```

All entries for a single request can be queried: `SELECT * FROM audit_log WHERE event_data->>'correlation_id' = 'uuid'`

#### 6.3.5 Alerting

Alerts triggered when SLO thresholds breached:

```
V2 alerting: Log-based (scan system_metrics table every 5 minutes)
  - Write alert entries to alerts table
  - Log at WARN/ERROR level (visible in log files)
  
V3 alerting: Prometheus + Alertmanager → Slack/email notifications
```

```sql
CREATE TABLE alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_name VARCHAR(100) NOT NULL,
  severity VARCHAR(20) NOT NULL,  -- 'warning', 'critical'
  message TEXT NOT NULL,
  metric_name VARCHAR(100),
  metric_value FLOAT,
  threshold FLOAT,
  status VARCHAR(20) DEFAULT 'open',  -- 'open', 'acknowledged', 'resolved'
  created_at TIMESTAMP DEFAULT NOW(),
  resolved_at TIMESTAMP
);
```

### 6.4 Data Quality Layer

#### 6.4.1 Signal Validation

Every incoming signal passes through validation before storage:

```typescript
interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
  normalized: RawSignal;   // Cleaned, timezone-normalized, enriched
}

const validationRules = [
  // Hard failures (signal rejected)
  { rule: 'content_not_empty', check: signal.content.trim().length > 0 },
  { rule: 'content_not_too_long', check: signal.content.length < 100_000 },
  { rule: 'valid_source', check: VALID_SOURCES.includes(signal.source) },
  { rule: 'valid_timestamp', check: isValidDate(signal.timestamp) },
  { rule: 'no_binary_content', check: !containsBinaryData(signal.content) },
  
  // Soft warnings (signal accepted but flagged)
  { rule: 'very_short_content', check: signal.content.length > 20, warn: true },
  { rule: 'future_timestamp', check: signal.timestamp <= new Date(), warn: true },
  { rule: 'missing_author', check: !!signal.author, warn: true },
  { rule: 'duplicate_content_hash', check: !await isDuplicate(signal), warn: true },
];
```

#### 6.4.2 Timezone Normalization

All timestamps stored in UTC. Conversion happens at ingestion:

```
Slack: Already UTC (Slack API returns Unix timestamps)
Meeting transcripts: User provides date; assume local timezone, convert to UTC
Documents: Use file modification date if no explicit date; store in UTC
Web scrapes: scraped_at from crawler is expected in ISO 8601 with timezone
JIRA/Wiki: Source system timezone (convert at ingestion)
```

Metadata preserves original timezone: `metadata.original_timezone = 'America/Los_Angeles'`

#### 6.4.3 Content Hash for Idempotency

```typescript
function computeContentHash(signal: RawSignal): string {
  // Hash = SHA-256 of normalized content + source + source_id
  // This ensures the same content from the same source is detected as duplicate
  // but same content from different sources is NOT (cross-source dedup uses embeddings)
  const normalized = signal.content.toLowerCase().trim().replace(/\s+/g, ' ');
  return sha256(`${normalized}|${signal.source}|${signal.source_id}`);
}
```

#### 6.4.4 Extraction Output Validation

LLM extraction outputs are validated against strict Zod schemas:

```typescript
const ExtractionOutputSchema = z.object({
  customers: z.array(z.object({
    name: z.string().min(1).max(200),
    confidence: z.number().min(0).max(1),
    context: z.string().max(500),
  })).max(20),  // Guard: no more than 20 customers per signal
  features: z.array(/* similar */).max(20),
  issues: z.array(/* similar */).max(20),
  themes: z.array(/* similar */).max(10),
  sentiment: z.enum(['positive', 'negative', 'neutral', 'mixed']).optional(),
});

// If validation fails: retry with reprompt (include error + ask LLM to fix)
// If retry fails: log to DLQ with extraction_validation_failed
```

**Hallucination guard:** After extraction, verify each extracted entity name appears (as substring or close match) in the original signal content. If an entity is extracted but cannot be traced to any part of the content, flag as `possible_hallucination` and reduce confidence by 50%.

### 6.5 Caching Strategy

#### 6.5.1 What Is Cached

| Data | Cache Location | TTL | Invalidation |
|------|---------------|-----|-------------|
| Entity registry (canonical entities + aliases) | In-memory (TypeScript Map) + Python service memory | 5 min refresh | On entity merge/split/create |
| Neo4j frequent queries (customer profile, feature health) | Redis | 10 min | On new signal processed for that entity |
| MCP tool responses (expensive queries like heatmaps) | Redis | 5 min | On pipeline run completion |
| Embedding vectors for deduplication | pgvector (already persisted) | N/A | Never (immutable) |
| LLM extraction results | PostgreSQL signal_extractions (already persisted) | N/A | Never (immutable) |

#### 6.5.2 Cache Invalidation

```
Event: New signal processed for Customer "Acme Corp"
  → Invalidate: Redis keys matching "customer_profile:acme*"
  → Invalidate: Redis keys matching "heatmap:*" (heatmaps may change)
  → Refresh: In-memory entity registry if new alias added

Event: Entity merge
  → Invalidate: ALL Redis cache (conservative; entity merge affects many queries)
  → Refresh: In-memory entity registry in all services

Event: Pipeline run completed
  → Invalidate: ALL Redis cache (bulk data change)
```

### 6.6 Operational Excellence

#### 6.6.1 Backup & Recovery

```
PostgreSQL: pg_dump daily at 2:00 AM UTC → data/backups/pg_YYYYMMDD.sql.gz
  Retention: 30 days rolling
  Recovery: pg_restore from latest backup; then replay signals from backup point

Neo4j: neo4j-admin dump daily at 2:30 AM UTC → data/backups/neo4j_YYYYMMDD.dump
  Retention: 7 days rolling (can rebuild from PostgreSQL)
  Recovery: neo4j-admin load; OR full resync from PostgreSQL (preferred)

Redis: No backup needed (ephemeral cache + job queue; jobs are retryable)

Uploaded files: Retained in data/uploads/ until post-processing cleanup (configurable)
```

#### 6.6.2 Disaster Recovery

| Scenario | Impact | Recovery Procedure | RTO |
|----------|--------|-------------------|-----|
| PostgreSQL corruption | CRITICAL — all data at risk | Restore from daily backup; reprocess signals since backup | 1-2 hours |
| Neo4j corruption | MEDIUM — graph queries unavailable | Full resync from PostgreSQL (automated) | 30 min |
| Redis crash | LOW — cache cold, jobs restart | Redis restarts; BullMQ replays pending jobs | 2 min |
| Azure OpenAI outage | MEDIUM — no new extraction | Queue signals; fall back to embedding-only matching; process when API recovers | API-dependent |
| Node.js process crash | MEDIUM — API unavailable | Auto-restart via process manager (PM2/systemd); resume from last checkpoint | 1-2 min |

#### 6.6.3 Capacity Planning

| Resource | Current (V2 launch) | 6 Months | 12 Months |
|----------|---------------------|----------|-----------|
| Signals | 5,000 | 25,000 | 60,000 |
| Canonical entities | 500 | 2,000 | 5,000 |
| Neo4j nodes + relationships | 10,000 | 50,000 | 120,000 |
| PostgreSQL size | 500 MB | 2 GB | 5 GB |
| Neo4j size | 200 MB | 1 GB | 2.5 GB |
| Daily LLM API calls | 200 | 500 | 1,000 |

All within single-machine capacity. Horizontal scaling not needed until >100K signals.

### 6.7 Testing Strategy

- **Unit tests:** Entity resolution logic, validation rules, normalization, LLM entity matching (highest priority)
- **Integration tests:** Full pipeline end-to-end (ingest → extract → resolve → graph → query)
- **Contract tests:** MCP tool interfaces (input/output schema validation)
- **Golden dataset benchmarks:** Entity resolution accuracy regression tests (>85% target, run weekly)
- **Load tests (V3):** Concurrent MCP requests, bulk ingestion throughput
- **Chaos tests (V3):** Kill Neo4j mid-sync, Azure OpenAI outage simulation, Redis failure
- **LLM tests:** Mock LLM responses for deterministic entity matching tests
