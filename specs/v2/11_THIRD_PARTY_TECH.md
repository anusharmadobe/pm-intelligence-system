# V2 Third-Party Technology Evaluation

> **Version:** 2.2 (Updated — feature flags, configuration catalog, startup validation)
> **Date:** 2026-02-09
> **Status:** Approved for Build

---

## 1. Technology Selection Criteria

Every technology choice was evaluated on:

1. **Reliability** — Does it work consistently in production?
2. **Quality** — Does it produce high-quality outputs?
3. **Trust** — Is it well-maintained, widely adopted?
4. **Cost** — Is it free/affordable for our use case?
5. **Integration** — Does it fit our TypeScript + Python stack?
6. **Maintenance** — Is the operational burden reasonable?

---

## 2. Complete Technology Matrix

### 2.1 Databases & Storage

| Technology | Version | License | Cost | Purpose | Decision |
|------------|---------|---------|------|---------|----------|
| **PostgreSQL** | 15+ | PostgreSQL License | Free | Source of truth: signals, entities, extractions, feedback | **KEEP** (existing) |
| **pgvector** | 0.5+ | PostgreSQL License | Free (extension) | Vector embeddings for semantic search | **KEEP** (existing) |
| **Neo4j Community Edition** | 5.x | AGPL-3.0 | **Free** | Knowledge graph: entity relationships, multi-hop queries | **ADD** |
| **Redis** | 7+ | BSD-3 | **Free** | Job queues (BullMQ), caching, rate limiting | **ADD** |

**Neo4j CE vs. Enterprise:**

| Feature | Community (Free) | Enterprise ($$$) |
|---------|-----------------|------------------|
| Core graph engine | Yes | Yes |
| Cypher queries | Yes | Yes |
| APOC procedures | Yes | Yes |
| Clustering/sharding | No | Yes |
| Role-based security | No | Yes |
| Online backup | No | Yes |
| Max database size | Unlimited | Unlimited |

**Verdict:** CE is sufficient for single-PM deployment. 100K+ nodes with excellent performance. Enterprise only needed for multi-PM clustering (V3).

**Neo4j Alternatives Considered:**

| Alternative | Why Not Chosen |
|-------------|---------------|
| ArangoDB | Multi-model but weaker Cypher, smaller ecosystem |
| Amazon Neptune | Cloud-only, expensive, vendor lock-in |
| Apache Age (PostgreSQL extension) | Immature, limited query capabilities compared to native Neo4j |
| NebulaGraph | Smaller community, less documentation |
| Memgraph | Good performance but smaller ecosystem than Neo4j |

### 2.2 LLM & AI Services

| Technology | Version | License | Cost | Purpose | Decision |
|------------|---------|---------|------|---------|----------|
| **Azure OpenAI (GPT-4o)** | Latest | Pay-per-use | ~$2.50/$10 per 1M tokens | Primary LLM for extraction, analysis, generation | **KEEP** (existing) |
| **Azure OpenAI (GPT-4o-mini)** | Latest | Pay-per-use | ~$0.15/$0.60 per 1M tokens | Fast/cheap extraction, classification | **ADD** (for 2-pass extraction) |
| **Azure OpenAI (text-embedding-ada-002)** | Latest | Pay-per-use | ~$0.10 per 1M tokens | Embedding generation | **KEEP** (existing) |

**Cost Optimization Strategy:**
- GPT-4o-mini for: Initial entity extraction (80% of volume), signal classification, noise filtering
- GPT-4o for: Ambiguous entity matching, relationship extraction, PRD generation, strategic insights
- Expected split: 80% mini, 20% full → ~60% cost reduction vs. all-GPT-4o

### 2.3 Python Libraries

| Technology | Version | License | Cost | Purpose | Decision |
|------------|---------|---------|------|---------|----------|
| **Microsoft GraphRAG** | Latest | MIT | **Free** | Entity/relationship extraction, community detection | **ADD** |
| **pyJedAI** | 0.2.8+ | Apache 2.0 | **Free** | Entity resolution engine | **ADD** |
| **Unstructured.io** | Latest | Apache 2.0 | **Free** (OSS) | Document parsing (PPT, Word, Excel, PDF) | **ADD** |
| **FastAPI** | Latest | MIT | **Free** | Python microservice framework | **ADD** |
| **uvicorn** | Latest | BSD-3 | **Free** | ASGI server for FastAPI | **ADD** |
| **sentence-transformers** | Latest | Apache 2.0 | **Free** | Local embeddings for entity resolution | **ADD** (optional, can use Azure) |
| **httpx** | Latest | BSD-3 | **Free** | Async HTTP client for Python services | **ADD** |

**Microsoft GraphRAG Details:**
- 30.7k GitHub stars, active development
- Extracts entities, relationships, claims from text
- Leiden-based hierarchical community detection
- Outputs Parquet files (loadable into Neo4j)
- Requires Python 3.10+, uses LLM for extraction (Azure OpenAI compatible)

**pyJedAI Details:**
- Academically backed (University of Athens)
- Supports 5 generations of entity resolution techniques
- Unsupervised methods (no training data needed)
- Integrates FAISS, sentence-transformers for embedding-based matching
- Incremental resolution support (key for our use case)

**Unstructured.io Details:**
- Most comprehensive open-source document parser
- Supports: PDF, DOCX, PPTX, XLSX, CSV, TXT, HTML, emails, images (OCR)
- Returns structured elements with metadata (page numbers, sections)
- Optional dependencies: `poppler` (PDF), `tesseract` (OCR), `libreoffice` (Office docs)

### 2.4 Node.js Libraries

| Technology | Version | License | Cost | Purpose | Decision |
|------------|---------|---------|------|---------|----------|
| **@modelcontextprotocol/sdk** | 1.25+ | MIT | **Free** | MCP server implementation | **KEEP** (existing) |
| **express** | 4.18+ | MIT | **Free** | REST API framework | **KEEP** (existing) |
| **neo4j-driver** | 5.x | Apache 2.0 | **Free** | Neo4j JavaScript driver | **ADD** |
| **bullmq** | Latest | MIT | **Free** | Redis-backed job queue | **ADD** |
| **ioredis** | Latest | MIT | **Free** | Redis client (required by BullMQ) | **ADD** |
| **multer** | Latest | MIT | **Free** | File upload handling (multipart/form-data) | **ADD** |
| **winston** | 3.19+ | MIT | **Free** | Structured logging | **KEEP** (existing) |
| **zod** | 4.3+ | MIT | **Free** | Schema validation | **KEEP** (existing) |
| **pg** | 8.11+ | MIT | **Free** | PostgreSQL client | **KEEP** (existing) |

### 2.5 Protocols & Standards

| Technology | Version | Standard Body | Cost | Purpose | Decision |
|------------|---------|---------------|------|---------|----------|
| **MCP** (Model Context Protocol) | Latest | Anthropic (open standard) | **Free** | Connect human-facing AI hosts (Claude Code/Cowork) to system tools | **KEEP** (existing) |
| **A2A** (Agent2Agent Protocol) | 0.2.1 | Google (open standard) | **Free** | Enable external AI agents to discover and interact with the system as peers | **ADD** |
| **JSON-RPC 2.0** | 2.0 | JSON-RPC WG | **Free** | Transport format for A2A agent communication | **ADD** (required by A2A) |

**MCP vs. A2A — Not Competing, Complementary:**

| Dimension | MCP | A2A |
|-----------|-----|-----|
| Purpose | Agent → Tools/Resources | Agent → Agent (peer) |
| Transport | stdio / HTTP+SSE | HTTP + JSON-RPC 2.0 |
| Discovery | Configuration-based (JSON config) | Agent Card at `/.well-known/agent.json` |
| Authentication | Localhost (V2), OAuth (V3) | API keys, OAuth, OpenID Connect |
| Interaction model | Request-response (tool calls) | Task lifecycle (submitted → working → completed) |
| Streaming | SSE | SSE |
| Push notifications | No | Yes (webhooks) |
| Who uses it in our system | Human personas via Claude Code/Cowork | External AI agents (Sprint Planner, third-party, etc.) |

**Why both:** MCP is the established standard for connecting AI assistants to tools (well-supported by Claude, Cursor, etc.). A2A is the emerging standard for agent-to-agent communication. Together, they give us a complete consumption surface: MCP for humans, A2A for agents. See `16_AGENTIC_INTERACTIONS.md` §10 for full rationale.

**A2A Alternatives Considered:**

| Alternative | Why Not Chosen |
|-------------|---------------|
| Custom REST API only | Works but proprietary — every integration requires custom code. No discovery, no interoperability |
| gRPC | Excellent performance but not an agent-specific protocol. No discovery, no task lifecycle |
| OpenAI Assistants API | Proprietary to OpenAI. Not a standard. Locks to OpenAI ecosystem |
| LangChain LCEL | Framework-specific, not a wire protocol. Requires LangChain on both sides |
| AutoGen | Microsoft framework for multi-agent conversations. Framework, not protocol. Heavy dependency |

### 2.6 Infrastructure

| Technology | Version | License | Cost | Purpose | Decision |
|------------|---------|---------|------|---------|----------|
| **Docker** | Latest | Apache 2.0 | **Free** | Container runtime for Neo4j, Redis | **ADD** |
| **Docker Compose** | Latest | Apache 2.0 | **Free** | Multi-container orchestration | **ADD** |

### 2.7 Optional / Future (V3)

| Technology | License | Cost | Purpose | When |
|------------|---------|------|---------|------|
| **Argilla** | Apache 2.0 | **Free** | Human annotation/feedback UI | V2 late / V3 |
| **WhyHow Knowledge Table** | MIT | **Free** | Schema-driven document extraction | V3 |
| **LangGraph** | MIT | **Free** | Agent workflow orchestration | V3 (if needed) |
| **Prometheus + Grafana** | Apache 2.0 | **Free** | Monitoring and observability | V3 |

---

## 3. Cost Summary

### 3.1 Infrastructure Cost (Monthly)

| Item | Self-Hosted | Managed Service |
|------|-------------|-----------------|
| PostgreSQL + pgvector | $0 (local) | $50-200 (managed) |
| Neo4j CE | $0 (Docker) | N/A (CE is self-hosted only) |
| Redis | $0 (Docker) | $15-50 (managed) |
| **Total Infrastructure** | **$0** | **$65-250** |

### 3.2 API Cost (Monthly, estimated for single PM)

| Service | Volume Estimate | Cost |
|---------|-----------------|------|
| GPT-4o-mini (extraction) | ~2M tokens/month | ~$1-3 |
| GPT-4o (complex tasks) | ~500K tokens/month | ~$6-15 |
| Embeddings (ada-002) | ~1M tokens/month | ~$0.10 |
| **Total API** | | **~$7-18** |

### 3.3 Total Monthly Cost

| Deployment | Monthly Cost |
|------------|-------------|
| Local (self-hosted everything) | **$7-18** (API costs only) |
| Managed databases + APIs | **$72-268** |

---

## 4. Dependency Tree

```
PM Intelligence System V2
├── TypeScript/Node.js (existing)
│   ├── express (existing)
│   ├── pg + pgvector (existing)
│   ├── @modelcontextprotocol/sdk (existing — MCP protocol)
│   ├── @slack/web-api (existing)
│   ├── winston, zod, uuid (existing)
│   ├── neo4j-driver (NEW)
│   ├── bullmq + ioredis (NEW)
│   ├── multer (NEW)
│   └── A2A server implementation (NEW — JSON-RPC 2.0 handler, no external SDK required)
│
├── Python 3.10+ (NEW)
│   ├── Document Parser Service
│   │   ├── unstructured[all-docs]
│   │   ├── fastapi + uvicorn
│   │   └── poppler, tesseract (system deps)
│   │
│   └── GraphRAG Indexer Service
│       ├── graphrag
│       ├── fastapi + uvicorn
│       └── openai (Azure OpenAI compatible)
│
├── Docker Containers (NEW)
│   ├── neo4j:5-community
│   ├── redis:7-alpine
│   └── (optionally) python service containers
│
├── Protocols
│   ├── MCP (Anthropic — human-facing AI assistant interface)
│   └── A2A v0.2.1 (Google — agent-to-agent interoperability)
│
└── External APIs (existing)
    ├── Azure OpenAI (GPT-4o, GPT-4o-mini, embeddings)
    └── Slack API (via MCP)
```

---

## 5. Environment Variables (.env additions)

```bash
# ============================================================================
# NEO4J CONFIGURATION (NEW)
# ============================================================================
NEO4J_URI=bolt://localhost:7687
NEO4J_USER=neo4j
NEO4J_PASSWORD=your_neo4j_password_here
NEO4J_DATABASE=neo4j

# ============================================================================
# REDIS CONFIGURATION (NEW)
# ============================================================================
REDIS_URL=redis://localhost:6379
REDIS_PASSWORD=

# ============================================================================
# ENTITY RESOLUTION (NEW)
# ============================================================================
ER_AUTO_MERGE_THRESHOLD=0.9
ER_HUMAN_REVIEW_THRESHOLD=0.6
ER_REJECT_THRESHOLD=0.3

# ============================================================================
# PYTHON SERVICES (NEW)
# ============================================================================
PYTHON_SERVICES_HOST=localhost
DOCUMENT_PARSER_PORT=5002
GRAPHRAG_INDEXER_PORT=5003

# ============================================================================
# MCP SERVER (NEW)
# ============================================================================
MCP_SERVER_PORT=3001
MCP_SERVER_NAME=pm-intelligence

# ============================================================================
# DOCUMENT INGESTION (NEW)
# ============================================================================
UPLOAD_DIR=./data/uploads
MAX_FILE_SIZE_MB=50
SUPPORTED_FORMATS=pdf,docx,pptx,xlsx,csv,txt,vtt,srt

# ============================================================================
# TWO-PASS LLM (NEW)
# ============================================================================
AZURE_OPENAI_FAST_DEPLOYMENT=gpt-4o-mini
LLM_FAST_TEMPERATURE=0.3
LLM_FAST_MAX_TOKENS=2048

# ============================================================================
# JIRA/WIKI MCP (TBD)
# ============================================================================
# JIRA_MCP_SERVER=
# WIKI_MCP_SERVER=
```

---

## 6. License Compliance Summary

| License | Technologies | Obligations |
|---------|-------------|-------------|
| **MIT** | GraphRAG, MCP SDK, Express, BullMQ, multer, neo4j-driver, Knowledge Table, FastAPI | Include license notice. No restrictions. |
| **Apache 2.0** | Unstructured.io, Argilla, sentence-transformers, Docker | Include license + NOTICE. Patent grant. |
| **AGPL-3.0** | Neo4j Community Edition | If you modify Neo4j source and distribute: must share changes. Using Neo4j as-is (unmodified) via the driver is fine. |
| **BSD-3** | Redis, uvicorn, httpx | Include license notice. No endorsement use. |
| **PostgreSQL License** | PostgreSQL, pgvector | Very permissive. Include copyright notice. |
| **Pay-per-use** | Azure OpenAI | Per Azure terms of service. |

**Key note on AGPL:** Neo4j CE is AGPL. We use it as an external database accessed via the Bolt protocol (neo4j-driver, which is Apache 2.0). We do NOT modify Neo4j source code. This is the standard usage pattern and does not trigger AGPL copyleft obligations for our application code.

---

## 7. Complete Environment Variable Catalog

All environment variables organized by subsystem, with required/optional status and defaults.

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| **PostgreSQL** ||||
| `DB_HOST` | No | `localhost` | PostgreSQL host |
| `DB_PORT` | No | `5432` | PostgreSQL port |
| `DB_NAME` | No | `pm_intelligence` | PostgreSQL database name |
| `DB_USER` | No | `postgres` | PostgreSQL username |
| `DB_PASSWORD` | No | (empty) | PostgreSQL password |
| `DATABASE_URL` | No | (computed) | Full PostgreSQL connection string (overrides DB_* if set) |
| **Neo4j** ||||
| `NEO4J_URI` | Yes | `bolt://localhost:7687` | Neo4j Bolt connection URI |
| `NEO4J_USER` | Yes | `neo4j` | Neo4j username |
| `NEO4J_PASSWORD` | Yes | — | Neo4j password |
| `NEO4J_DATABASE` | No | `neo4j` | Neo4j database name |
| **Redis** ||||
| `REDIS_URL` | Yes | `redis://localhost:6379` | Redis connection URL |
| `REDIS_PASSWORD` | No | (none) | Redis password (if AUTH enabled) |
| **Azure OpenAI** ||||
| `AZURE_OPENAI_KEY` | Yes | — | Azure OpenAI API key |
| `AZURE_OPENAI_ENDPOINT` | Yes | — | Azure OpenAI endpoint URL |
| `AZURE_OPENAI_DEPLOYMENT` | Yes | — | GPT-4o deployment name |
| `AZURE_OPENAI_FAST_DEPLOYMENT` | Yes | `gpt-4o-mini` | GPT-4o-mini deployment name (fast pass) |
| `AZURE_OPENAI_EMBEDDING_DEPLOYMENT` | Yes | — | Embedding model deployment name |
| `LLM_FAST_TEMPERATURE` | No | `0.3` | Temperature for fast-pass LLM |
| `LLM_FAST_MAX_TOKENS` | No | `2048` | Max tokens for fast-pass LLM |
| **Entity Resolution** ||||
| `ER_AUTO_MERGE_THRESHOLD` | No | `0.9` | Score above which entities auto-merge |
| `ER_HUMAN_REVIEW_THRESHOLD` | No | `0.6` | Score range requiring human review |
| `ER_REJECT_THRESHOLD` | No | `0.3` | Score below which entities are rejected |
| **Python Services** ||||
| `DOCUMENT_PARSER_URL` | No | (none) | Full URL for document parser service (enables document ingestion) |
| `GRAPHRAG_INDEXER_URL` | No | (none) | Full URL for GraphRAG indexer service (used when FF_GRAPHRAG_INDEXER=true) |
| **MCP Server** ||||
| `MCP_SERVER_PORT` | No | `3001` | MCP server port |
| `MCP_SERVER_NAME` | No | `pm-intelligence` | MCP server name identifier |
| **A2A Server** ||||
| `A2A_SERVER_ENABLED` | No | `true` | Enable/disable A2A server |
| `A2A_AGENT_CARD_URL` | No | `/.well-known/agent.json` | Agent Card discovery URL |
| **Agent Gateway** ||||
| `AGENT_GATEWAY_ENABLED` | No | `true` | Enable/disable Agent Gateway |
| `AGENT_RATE_LIMIT_RPM` | No | `60` | Default rate limit (requests per minute per agent) |
| `AGENT_MAX_MONTHLY_COST_USD` | No | `50` | Default agent monthly cost cap |
| **Document Ingestion** ||||
| `UPLOAD_DIR` | No | `./data/uploads` | Upload directory path |
| `MAX_FILE_SIZE_MB` | No | `50` | Maximum file size (MB) per upload |
| `MAX_BATCH_FILES` | No | `20` | Maximum files per batch upload |
| `SUPPORTED_FORMATS` | No | `pdf,docx,pptx,xlsx,csv,txt,vtt,srt` | Comma-separated allowed file extensions |
| **Slack** ||||
| `SLACK_BOT_TOKEN` | Yes | — | Slack bot OAuth token |
| `SLACK_CHANNEL_IDS` | Yes | — | Comma-separated channel IDs to monitor |
| **Feature Flags** ||||
| `FF_A2A_SERVER` | No | `false` | Enable A2A Server (Phase 4) |
| `FF_AGENT_GATEWAY` | No | `false` | Enable Agent Gateway (Phase 4) |
| `FF_EVENT_BUS` | No | `false` | Enable Event Bus (Phase 4) |
| `FF_STAKEHOLDER_ACCESS` | No | `false` | Enable Stakeholder Access Agent (Phase 4) |
| `FF_GRAPHRAG_INDEXER` | No | `false` | Enable GraphRAG indexer (Phase 3) |
| `FF_TWO_PASS_LLM` | No | `true` | Enable two-pass LLM extraction |
| `FF_NEO4J_SYNC` | No | `true` | Enable PostgreSQL → Neo4j sync |
| `FF_HALLUCINATION_GUARD` | No | `true` | Enable extraction hallucination check |
| `FF_ER_LLM_CONFIRMATION` | No | `false` | Enable optional LLM confirmation for borderline ER matches |
| **JIRA/Wiki (TBD)** ||||
| `JIRA_MCP_SERVER` | No | (TBD) | JIRA MCP server configuration |
| `WIKI_MCP_SERVER` | No | (TBD) | Wiki/Confluence MCP server configuration |

### 7.1 Feature Flags System

Feature flags use **environment variable-based** configuration (no external service needed for V2).

```typescript
// backend/config/feature_flags.ts
export const FeatureFlags = {
  a2aServer:          process.env.FF_A2A_SERVER === 'true',
  agentGateway:       process.env.FF_AGENT_GATEWAY === 'true',
  eventBus:           process.env.FF_EVENT_BUS === 'true',
  stakeholderAccess:  process.env.FF_STAKEHOLDER_ACCESS === 'true',
  graphragIndexer:    process.env.FF_GRAPHRAG_INDEXER === 'true',
  twoPassLlm:        process.env.FF_TWO_PASS_LLM !== 'false',  // default ON
  neo4jSync:          process.env.FF_NEO4J_SYNC !== 'false',     // default ON
  hallucinationGuard: process.env.FF_HALLUCINATION_GUARD !== 'false', // default ON
} as const;
```

**Usage pattern**: Services check the flag before initializing:

```typescript
// Startup
if (FeatureFlags.a2aServer) {
  app.use('/a2a', a2aRouter);
  logger.info('A2A Server enabled');
} else {
  logger.info('A2A Server disabled (FF_A2A_SERVER=false)');
}
```

**Why env-based, not a full feature flag service:**
- System is single-tenant (one PM team), not multi-tenant SaaS
- Flags toggle entire subsystems, not fine-grained UI features
- Restarts are acceptable for flag changes (local dev context)
- Avoids adding LaunchDarkly/Unleash dependency and cost
- V3 can adopt a feature flag service if multi-tenancy is added

### 7.2 Startup Configuration Validation

On boot, the main process validates that all required variables are present and well-formed:

```typescript
// backend/config/validate_env.ts
const REQUIRED = [
  'DB_HOST', 'DB_PORT', 'DB_NAME', 'DB_USER',
  'NEO4J_URI', 'NEO4J_USER', 'NEO4J_PASSWORD',
  'REDIS_URL',
  'AZURE_OPENAI_KEY', 'AZURE_OPENAI_ENDPOINT',
  'AZURE_OPENAI_DEPLOYMENT', 'AZURE_OPENAI_EMBEDDING_DEPLOYMENT',
  'SLACK_BOT_TOKEN', 'SLACK_CHANNEL_IDS',
];

const VALIDATIONS = {
  'NEO4J_URI':     (v: string) => v.startsWith('bolt://') || v.startsWith('neo4j://'),
  'REDIS_URL':     (v: string) => v.startsWith('redis://'),
  'DB_HOST':       (v: string) => v.length > 0,
  'MAX_FILE_SIZE_MB': (v: string) => Number(v) > 0 && Number(v) <= 200,
  'ER_AUTO_MERGE_THRESHOLD': (v: string) => Number(v) > 0 && Number(v) <= 1,
};

export function validateEnvironment(): void {
  const missing = REQUIRED.filter(k => !process.env[k]);
  if (missing.length > 0) {
    console.error(`FATAL: Missing required environment variables: ${missing.join(', ')}`);
    process.exit(1);
  }
  for (const [key, validator] of Object.entries(VALIDATIONS)) {
    if (process.env[key] && !validator(process.env[key]!)) {
      console.error(`FATAL: Invalid value for ${key}: "${process.env[key]}"`);
      process.exit(1);
    }
  }
}
```

### 7.3 Environment-Specific Differences

| Setting | Local Dev | Staging (future) | Production (future) |
|---------|-----------|-------------------|---------------------|
| Database | Docker PostgreSQL | Managed PostgreSQL | Managed PostgreSQL |
| Neo4j | Docker Neo4j CE | Docker Neo4j CE | Docker Neo4j CE |
| Redis | Docker Redis | Docker Redis | Managed Redis |
| LLM fast-pass | GPT-4o-mini | GPT-4o-mini | GPT-4o-mini |
| LLM complex | GPT-4o | GPT-4o | GPT-4o |
| Feature flags | All ON for testing | Selective | All ON |
| Rate limiting | Disabled | Enabled | Enabled |
| Backup | Manual | Daily automated | Daily + PITR |
| Log level | DEBUG | INFO | WARN |
| Uploaded file retention | 7 days | 24 hours | 24 hours |
