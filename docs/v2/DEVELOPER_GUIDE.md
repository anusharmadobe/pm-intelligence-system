# PM Intelligence System V2 — Developer Guide

> **For:** Engineers building, maintaining, or extending the system
> **Version:** 1.0
> **Last Updated:** 2026-02-09

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Local Development Setup](#2-local-development-setup)
3. [Project Structure](#3-project-structure)
4. [Development Workflow](#4-development-workflow)
5. [Adding a New MCP Tool](#5-adding-a-new-mcp-tool)
6. [Adding a New Ingestion Adapter](#6-adding-a-new-ingestion-adapter)
7. [Adding a New Agent](#7-adding-a-new-agent)
8. [Working with the Knowledge Graph](#8-working-with-the-knowledge-graph)
9. [Testing](#9-testing)
10. [Debugging](#10-debugging)
11. [Code Standards & Conventions](#11-code-standards--conventions)
12. [Feature Flags](#12-feature-flags)
13. [Database Migrations](#13-database-migrations)
14. [Deployment](#14-deployment)

---

## 1. Architecture Overview

PM Intelligence is a 7-plane system that ingests heterogeneous data, resolves entities, builds a knowledge graph, and exposes PM intelligence via three protocols.

```
CONSUMPTION PLANE
  ├─ MCP Server (Claude Code / Cowork)     — 35 tools, human-facing
  ├─ A2A Server (external AI agents)       — 8 skills, agent-to-agent
  └─ Agent Gateway (REST, simple agents)   — JSON API, API key auth

INTELLIGENCE PLANE
  └─ Query engine, heatmaps, trends, artifacts, reports

KNOWLEDGE PLANE
  ├─ Neo4j (graph queries, relationships)
  └─ PostgreSQL + pgvector (source of truth, embeddings)

ENTITY RESOLUTION PLANE
  └─ pyJedAI + LLM matching + human feedback (Python microservice)

EXTRACTION PLANE
  └─ Two-pass LLM extraction (GPT-4o-mini → GPT-4o)

INGESTION PLANE
  ├─ Slack adapter (automatic)
  ├─ Transcript adapter (manual upload)
  ├─ Document adapter (PDF, PPTX, DOCX, XLSX)
  └─ Web scrape adapter (crawler bot output)

EVENT BUS (Redis Streams)
  └─ Async event delivery to internal agents
```

**Full architecture spec:** `specs/v2/02_ARCHITECTURE.md`

---

## 2. Local Development Setup

### 2.1 Prerequisites

| Tool | Version | Check |
|------|---------|-------|
| Node.js | 18+ | `node -v` |
| Python | 3.10+ | `python3 --version` |
| Docker + Docker Compose | Latest | `docker compose version` |
| poppler | Latest | `pdftoppm -v` (for PDF parsing) |
| tesseract | Latest | `tesseract --version` (optional, for OCR) |

### 2.2 First-Time Setup

```bash
# 1. Clone and install
git clone <repo-url>
cd PM_cursor_system
npm install

# 2. Set up Python virtual environment
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# 3. Configure environment
cp .env.example .env
# Edit .env — fill in required values (see §2.3)

# 4. Start infrastructure
docker compose up -d

# 5. Wait for health checks (typically 15-30 seconds)
docker compose ps  # All should show "healthy"

# 6. Run database migrations
npm run db:migrate

# 7. Start the application
npm run dev
```

### 2.3 Required Environment Variables

At minimum, you need:

```bash
# Database
DATABASE_URL=postgresql://pm_intel:your_password@localhost:5432/pm_intelligence

# Neo4j
NEO4J_URI=bolt://localhost:7687
NEO4J_USER=neo4j
NEO4J_PASSWORD=your_neo4j_password

# Redis
REDIS_URL=redis://localhost:6379

# Azure OpenAI (existing keys)
AZURE_OPENAI_API_KEY=your_key
AZURE_OPENAI_ENDPOINT=https://your-instance.openai.azure.com
AZURE_OPENAI_DEPLOYMENT=gpt-4o
AZURE_OPENAI_FAST_DEPLOYMENT=gpt-4o-mini
AZURE_OPENAI_EMBEDDING_DEPLOYMENT=your_embedding_deployment

# Slack
SLACK_BOT_TOKEN=xoxb-your-token
SLACK_CHANNEL_IDS=C04D195JVGS
```

**Full env catalog:** `specs/v2/11_THIRD_PARTY_TECH.md` §7

### 2.4 Startup Validation

On boot, the system validates:
1. All required env vars are present
2. PostgreSQL is reachable (runs `SELECT 1`)
3. Neo4j is reachable (runs `RETURN 1`)
4. Redis is reachable (runs `PING`)
5. Python ER service is healthy (GET `/health` on `:5001`)
6. Pending DB migrations are applied

If any check fails, the process logs the error and exits with code 1.

### 2.5 Ports

| Service | Port | Protocol |
|---------|------|----------|
| Express API | 3000 | HTTP |
| MCP Server | 3001 | MCP (stdio or HTTP) |
| A2A Server | 3000 | HTTP (`/a2a` path) |
| Agent Gateway | 3000 | HTTP (`/api/agents/v1/` path) |
| Entity Resolution (Python) | 5001 | HTTP |
| Document Parser (Python) | 5002 | HTTP |
| GraphRAG Indexer (Python) | 5003 | HTTP |
| PostgreSQL | 5432 | PostgreSQL |
| Neo4j (HTTP) | 7474 | HTTP |
| Neo4j (Bolt) | 7687 | Bolt |
| Redis | 6379 | Redis |

---

## 3. Project Structure

```
PM_cursor_system/
├── backend/
│   ├── config/           # Environment validation, feature flags
│   ├── database/         # PostgreSQL client, migrations, queries
│   ├── extraction/       # LLM extraction pipeline (two-pass)
│   ├── ingestion/        # Source adapters (Slack, transcript, document, web)
│   ├── mcp/              # MCP server and tool definitions
│   ├── agents/           # A2A server, Agent Gateway, event bus
│   ├── services/         # Business logic services
│   │   ├── entity_resolution_service.ts
│   │   ├── knowledge_graph_service.ts
│   │   ├── intelligence_service.ts
│   │   ├── feedback_service.ts
│   │   └── ...
│   ├── neo4j/            # Neo4j client, Cypher queries, sync
│   ├── queues/           # BullMQ job definitions
│   └── utils/            # Shared utilities, logging, correlation IDs
├── python/
│   ├── entity_resolution/ # pyJedAI service (FastAPI)
│   ├── document_parser/   # Unstructured.io service (FastAPI)
│   └── graphrag_indexer/  # Microsoft GraphRAG service (FastAPI)
├── data/
│   ├── uploads/           # Temporary file uploads (24h retention)
│   ├── logs/              # Application logs (JSON, daily rotation)
│   └── archive/           # Archived data (JSONL.gz)
├── scripts/               # Build, migration, and utility scripts
├── specs/
│   ├── v2/               # V2 specification documents (16 docs)
│   └── ...               # V1 specifications
├── docs/
│   └── v2/               # User, developer, and launch documentation
├── test/
│   ├── unit/             # Unit tests
│   ├── integration/      # Integration tests
│   ├── fixtures/         # Test data and golden datasets
│   └── e2e/              # End-to-end tests
├── docker-compose.yml
├── .env.example
├── package.json
├── tsconfig.json
└── jest.config.js
```

**Component registry:** `specs/v2/15_COMPONENT_REGISTRY.md` for the exhaustive list of every service, table, and tool.

---

## 4. Development Workflow

### 4.1 Running in Development

```bash
# Start infrastructure (if not running)
docker compose up -d

# Start TypeScript app (hot reload)
npm run dev

# Start Python services (in separate terminals)
cd python/entity_resolution && uvicorn main:app --reload --port 5001
cd python/document_parser && uvicorn main:app --reload --port 5002
cd python/graphrag_indexer && uvicorn main:app --reload --port 5003
```

### 4.2 Running Tests

```bash
# Unit tests
npm test

# Unit tests with coverage
npm run test:coverage

# Integration tests (requires Docker services)
npm run test:integration

# Python tests
cd python/entity_resolution && pytest
cd python/document_parser && pytest

# Entity resolution benchmark (golden dataset)
npm run test:benchmark:er
```

### 4.3 Linting

```bash
npm run lint         # ESLint for TypeScript
npm run lint:fix     # Auto-fix
```

### 4.4 Database Operations

```bash
npm run db:migrate        # Run pending migrations
npm run db:migrate:status # Check migration status
npm run db:seed           # Seed test data (dev only)
```

---

## 5. Adding a New MCP Tool

MCP tools are the primary interface for human users via Claude Code/Cowork.

### Step 1: Define the Tool Schema

Add the tool definition in `backend/mcp/tools/`:

```typescript
// backend/mcp/tools/my_new_tool.ts
import { z } from 'zod';

export const myNewToolSchema = {
  name: 'my_new_tool',
  description: 'Clear description of what this tool does and when to use it',
  inputSchema: z.object({
    entity_name: z.string().describe('The entity to look up'),
    limit: z.number().optional().default(10).describe('Max results to return'),
  }),
};
```

### Step 2: Implement the Handler

```typescript
export async function handleMyNewTool(params: z.infer<typeof myNewToolSchema.inputSchema>) {
  // 1. Validate inputs (Zod does this automatically)
  // 2. Call service layer
  const result = await intelligenceService.myNewQuery(params.entity_name, params.limit);
  // 3. Return structured response
  return {
    content: [{ type: 'text', text: formatResponse(result) }],
  };
}
```

### Step 3: Register the Tool

Add it to the MCP server tool registry in `backend/mcp/server.ts`.

### Step 4: Test

```typescript
// test/unit/mcp/my_new_tool.test.ts
describe('my_new_tool', () => {
  it('should return results for a valid entity', async () => { ... });
  it('should handle empty results gracefully', async () => { ... });
  it('should reject invalid input', async () => { ... });
});
```

### Step 5: Update Docs

Add the tool to `specs/v2/05_MCP_SERVER.md` and update the tool count.

**Full MCP tool design spec:** `specs/v2/05_MCP_SERVER.md`

---

## 6. Adding a New Ingestion Adapter

### Step 1: Create the Adapter

```typescript
// backend/ingestion/adapters/my_source_adapter.ts
import { AdapterOutput, NormalizerService } from '../normalizer';

export class MySourceAdapter {
  constructor(private normalizer: NormalizerService) {}

  async ingest(input: MySourceInput): Promise<AdapterOutput[]> {
    // 1. Source-specific validation (see 08_DATA_CONTRACTS.md §5)
    this.validate(input);
    // 2. Parse into segments
    const segments = this.parse(input);
    // 3. Normalize each segment
    return segments.map(seg => this.normalizer.normalize({
      source: 'my_source',
      content: seg.text,
      metadata: { ... },
      timestamp: seg.date,
    }));
  }
}
```

### Step 2: Add Validation Rules

Define input validation rules in `specs/v2/08_DATA_CONTRACTS.md` §5 and implement them in the adapter.

### Step 3: Register the Source

Add an entry in the `source_registry` table and update `specs/v2/06_INGESTION_ADAPTERS.md`.

**Full ingestion spec:** `specs/v2/06_INGESTION_ADAPTERS.md`

---

## 7. Adding a New Agent

External agents interact via the Agent Gateway REST API or A2A protocol.

### Step 1: Register the Agent

```sql
INSERT INTO agent_registry (
  agent_name, agent_type, description,
  permissions, rate_limit_per_minute, max_monthly_cost_usd
) VALUES (
  'my_new_agent', 'autonomous',
  'Does something useful with the knowledge graph',
  '["read", "events"]', 60, 20.00
);
```

The registration returns an API key (shown once).

### Step 2: Use the Agent Gateway API

```bash
# Read entities
curl -H "Authorization: Bearer $API_KEY" \
  http://localhost:3000/api/agents/v1/entities?type=customer

# Subscribe to events (SSE)
curl -H "Authorization: Bearer $API_KEY" \
  http://localhost:3000/api/agents/v1/events/stream
```

### Step 3: Or Implement A2A

For sophisticated agents, use the A2A protocol. Fetch the Agent Card at `/.well-known/agent.json` and send JSON-RPC 2.0 requests to `/a2a`.

**Full agent interaction spec:** `specs/v2/16_AGENTIC_INTERACTIONS.md`
**API reference:** `docs/v2/API_REFERENCE.md`

---

## 8. Working with the Knowledge Graph

### Neo4j Cypher Examples

```cypher
-- Find all issues affecting a customer
MATCH (c:Customer {name: 'Acme Corp'})-[:HAS_ISSUE]->(i:Issue)
RETURN i.name, i.severity, i.signal_count
ORDER BY i.signal_count DESC

-- Find customers affected by an issue
MATCH (i:Issue {name: 'Auth Timeout'})<-[:HAS_ISSUE]-(c:Customer)
RETURN c.name, c.segment, c.health_score

-- Multi-hop: Customer → Issue → Feature
MATCH (c:Customer)-[:HAS_ISSUE]->(i:Issue)-[:RELATES_TO]->(f:Feature)
WHERE c.name = 'Acme Corp'
RETURN DISTINCT f.name, count(i) as issue_count
```

### PostgreSQL ↔ Neo4j Sync

PostgreSQL is the **source of truth**. Neo4j is a synchronized graph mirror used for relationship queries. The `neo4j_sync_service` handles the sync:

1. Entity changes in PostgreSQL trigger sync backlog entries
2. Background worker processes backlog and updates Neo4j
3. Nightly consistency check detects divergence and repairs

**Never write directly to Neo4j.** Always go through the service layer which writes to PostgreSQL first.

**Knowledge graph spec:** `specs/v2/04_KNOWLEDGE_GRAPH.md`

---

## 9. Testing

### 9.1 Test Pyramid

- **Unit tests (70%):** Validation rules, normalization, entity matching, scoring, Zod schemas
- **Integration tests (25%):** Service boundaries (TS→Python HTTP, TS→Neo4j, MCP tools, Agent Gateway)
- **E2E tests (5%):** Full pipeline — ingest → extract → resolve → graph → query

### 9.2 Golden Dataset

The entity resolution golden dataset (`test/fixtures/golden_entities/`) contains:
- Known entity pairs with expected merge/reject decisions
- Ground truth for accuracy benchmarking
- Must never regress below 85% accuracy across code changes

```bash
# Run ER benchmark
npm run test:benchmark:er
```

### 9.3 Test Data

- `test/fixtures/signals/` — 50-100 sample signals from 5 sources
- `test/fixtures/documents/` — Sample PDFs, PPTX, XLSX for document parsing
- `test/fixtures/golden_entities/` — Known entity pairs for ER benchmarks

**Full testing strategy:** `specs/v2/14_BUILD_PLAN.md` §6

---

## 10. Debugging

### 10.1 Structured Logging

All logs are JSON with these fields:
```json
{
  "timestamp": "2026-02-09T14:30:00.000Z",
  "level": "info",
  "service": "entity_resolution_service",
  "correlation_id": "abc-123-def",
  "signal_id": "sig_456",
  "duration_ms": 142,
  "message": "Entity resolved: Acme Corp → Acme Corporation"
}
```

**Correlation IDs** are generated at ingestion/MCP request entry and propagated via `X-Correlation-ID` header to all downstream services.

### 10.2 Common Debug Workflows

**"Why was this entity matched incorrectly?"**
```bash
# Find the resolution log for the entity
# In PostgreSQL:
SELECT * FROM entity_resolution_log 
WHERE entity_a_id = '<id>' OR entity_b_id = '<id>'
ORDER BY created_at DESC;
```

**"Why is this signal missing from the graph?"**
```bash
# Check DLQ via MCP tool: get_dlq_status
# Or check the pipeline status:
SELECT * FROM signals WHERE id = '<signal_id>';
SELECT * FROM signal_extractions WHERE signal_id = '<signal_id>';
```

**"Why is Neo4j out of sync?"**
```bash
# Check the sync backlog:
SELECT * FROM neo4j_sync_backlog WHERE status = 'pending' ORDER BY created_at;
# Force a sync:
npm run neo4j:sync
```

### 10.3 Health Checks

```bash
# System health via MCP
# Ask Claude: "What's the system health?"

# Direct API check
curl http://localhost:3000/api/health

# Individual service checks
curl http://localhost:5001/health  # Entity Resolution
curl http://localhost:5002/health  # Document Parser
curl http://localhost:5003/health  # GraphRAG Indexer
```

### 10.4 Dead Letter Queue (DLQ)

Failed pipeline items go to the DLQ. Check and retry:

```bash
# Via MCP: get_dlq_status, retry_dlq_item
# Via API:
curl http://localhost:3000/api/dlq/status
curl -X POST http://localhost:3000/api/dlq/retry/<item_id>
```

---

## 11. Code Standards & Conventions

### Naming

- **Services:** `{name}_service.ts` (e.g., `entity_resolution_service.ts`)
- **Adapters:** `{source}_adapter.ts` (e.g., `slack_adapter.ts`)
- **MCP tools:** `snake_case` names (e.g., `get_customer_profile`)
- **Database tables:** `snake_case` (e.g., `entity_registry`)
- **TypeScript:** `camelCase` for variables/functions, `PascalCase` for types/interfaces

### Code Organization

- Business logic lives in `backend/services/`
- MCP tools are thin wrappers that call services
- Adapters handle source-specific parsing; normalizer handles common logic
- Never call the database directly from MCP tool handlers

### Error Handling

All errors are classified into 4 categories:
1. **Transient** — retry with exponential backoff
2. **Validation** — reject immediately, return clear error
3. **Extraction** — retry once with reprompt, then DLQ
4. **Infrastructure** — circuit breaker, alert

### Logging

- Use structured JSON logging (Winston for TS, `logging` for Python)
- Always include `correlation_id` in log context
- Redact PII and API keys before logging
- Log levels: `debug` (dev), `info` (production), `warn` (degraded), `error` (failure)

### Commit Messages

Follow conventional commits:
```
feat: add bulk entity export MCP tool
fix: entity resolution false positive on abbreviations
docs: update API reference with new endpoints
refactor: extract normalizer validation into shared module
test: add golden dataset entries for company name variants
```

---

## 12. Feature Flags

Feature flags control phased rollout of V2 subsystems. All flags are environment variables prefixed with `FF_`.

| Flag | Default | Controls |
|------|---------|----------|
| `FF_A2A_SERVER` | `false` | A2A protocol server |
| `FF_AGENT_GATEWAY` | `false` | Agent Gateway REST API |
| `FF_EVENT_BUS` | `false` | Redis Streams event bus |
| `FF_STAKEHOLDER_ACCESS` | `false` | Stakeholder Access Agent |
| `FF_GRAPHRAG_INDEXER` | `false` | GraphRAG indexer service |
| `FF_TWO_PASS_LLM` | `true` | Two-pass LLM extraction |
| `FF_NEO4J_SYNC` | `true` | PostgreSQL → Neo4j sync |
| `FF_HALLUCINATION_GUARD` | `true` | Extraction hallucination check |

**To toggle:** change the value in `.env` and restart the process.

**Full flag documentation:** `specs/v2/11_THIRD_PARTY_TECH.md` §7.1

---

## 13. Database Migrations

### Rules

All schema changes are **additive** in V2:
- Add new tables, nullable columns, indexes, constraints on new columns
- **Never** drop tables/columns, rename columns, change types, or add NOT NULL to existing columns with NULL data

### Creating a Migration

```bash
npm run db:migrate:create -- --name add_agent_version_history
# Edit the generated file in backend/database/migrations/
npm run db:migrate
```

### Rollback

```bash
npm run db:migrate:rollback  # Rolls back the last migration
```

**Schema migration rules:** `specs/v2/05_MCP_SERVER.md` §10.6

---

## 14. Deployment

### Docker Compose (Local / Dev)

```bash
# Start all infrastructure
docker compose up -d

# Check health
docker compose ps

# View logs
docker compose logs -f neo4j

# Stop
docker compose down

# Full reset (destroys data)
docker compose down -v
```

### Startup Order

Infrastructure → Python services → TypeScript app → Agents

The TypeScript app validates that all dependencies are healthy before accepting requests. See `specs/v2/02_ARCHITECTURE.md` §5.3 for the full startup sequence.

---

## Further Reading

| Topic | Document |
|-------|----------|
| Full architecture | `specs/v2/02_ARCHITECTURE.md` |
| Entity resolution deep-dive | `specs/v2/03_ENTITY_RESOLUTION.md` |
| Knowledge graph schema | `specs/v2/04_KNOWLEDGE_GRAPH.md` |
| MCP tool definitions | `specs/v2/05_MCP_SERVER.md` |
| Data contracts | `specs/v2/08_DATA_CONTRACTS.md` |
| Security model | `specs/v2/09_SECURITY_GUARDRAILS.md` |
| All components | `specs/v2/15_COMPONENT_REGISTRY.md` |
| Build plan | `specs/v2/14_BUILD_PLAN.md` |
