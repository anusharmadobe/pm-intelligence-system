# PM Intelligence V2 — Release Notes

> **Release Date:** 2026-02-09
> **Version:** 2.0.0
> **Previous Version:** 1.x (Slack-only pipeline)

---

## Highlights

PM Intelligence V2 is a ground-up evolution from a Slack-only signal processing pipeline into a **multi-source knowledge graph** with entity resolution, natural language querying via MCP, and an AI agent ecosystem.

---

## New Features

### Multi-Source Data Ingestion

- **Meeting transcript ingestion** — manual upload via paste, `.vtt`, `.srt`, or `.txt` files
- **Document ingestion** — PDF, PowerPoint (.pptx), Word (.docx), Excel (.xlsx), CSV support via Unstructured.io
- **Web scrape ingestion** — JSON output from external crawler bots
- **Per-adapter validation** — file size limits (50MB), MIME type verification, macro detection, encoding validation
- **Normalizer service** — unified processing pipeline for all sources (UTF-8 validation, HTML sanitization, content hashing for deduplication)

### Knowledge Graph (Neo4j)

- **Neo4j Community Edition** integration for entity-relationship graph
- **Node types:** Customer, Feature, Issue, Theme, Person, ProductArea, CompetitiveIntel
- **Relationship types:** HAS_ISSUE, USES_FEATURE, RELATES_TO, MENTIONS, PART_OF, COMPETES_WITH
- **PostgreSQL → Neo4j sync** with backlog-based eventual consistency
- **Nightly consistency check** detecting and repairing PG↔Neo4j divergence
- **Cypher query patterns** for multi-hop traversal, heatmaps, and provenance chains

### Entity Resolution Engine

- **pyJedAI-based** algorithmic matching (blocking, string similarity, embedding distance)
- **LLM-assisted matching** for ambiguous cases (GPT-4o with structured prompts)
- **Three-tier scoring:** auto-merge (>90%), human review (60-90%), auto-reject (<30%)
- **Human feedback loops** — every PM merge/reject decision improves future accuracy
- **Entity alias tracking** — append-only alias system for abbreviations, informal names, external IDs
- **Split entity** capability for incorrectly merged entities
- **Batch entity review** for efficient PM workflow
- **Golden dataset benchmarking** for accuracy regression testing

### MCP Server (35 Tools)

- **Search & Query (5):** search_signals, get_customer_profile, get_feature_health, get_issue_impact, find_related_entities
- **Intelligence (4):** get_heatmap, get_trends, get_roadmap_priorities, get_strategic_insights
- **Opportunities & Artifacts (2):** list_opportunities, generate_artifact
- **Reports (1):** generate_shareable_report
- **Entity Management (6):** review_pending_entities, confirm_entity_merge, reject_entity_merge, add_entity_alias, list_entities, split_entity
- **Onboarding (2):** browse_knowledge_graph, get_knowledge_summary
- **Ingestion (2):** ingest_transcript, ingest_document
- **Provenance & Stats (2):** get_provenance, get_entity_resolution_stats
- **Analysis (2):** what_if_analysis, export_data
- **System (4):** get_system_health, run_pipeline, get_dlq_status, retry_dlq_item
- **Agent Management (5):** review_agent_outputs, rollback_agent, list_registered_agents, deactivate_agent, configure_stakeholder_access

### Two-Pass LLM Extraction

- **First pass (GPT-4o-mini):** Fast, cost-effective extraction for straightforward signals
- **Second pass (GPT-4o):** High-quality extraction for complex, ambiguous, or multi-entity signals
- **Extraction output validation** (Zod schema enforcement, entity count limits, relationship limits)
- **Hallucination guard** — extracted entities must appear in source content (substring or >0.85 fuzzy match)

### AI Agent Ecosystem

- **Agent Gateway REST API** — `/api/agents/v1/` with API key auth, rate limiting, idempotent writes
- **A2A Protocol Server** — Agent Card at `/.well-known/agent.json`, 8 A2A skills via JSON-RPC 2.0
- **Event Bus (Redis Streams)** — real-time event delivery to subscribed agents
- **Built-in agents:** Triage Agent, Report Scheduler, JIRA Sync, Slack Alert Bot, Data Quality, Sprint Planning, Stakeholder Access
- **Agent lifecycle management** — versioned registration, deployment, rollback, per-agent SLOs, cost tracking
- **Agent output feedback** — PMs review and correct agent outputs to improve accuracy

### Feedback System

- **Persona-aware feedback** with authority hierarchy (PM Leader > PM > New PM)
- **Feedback types:** entity_merge, entity_split, entity_rename, classification_correction, extraction_correction, prompt_feedback, agent_output_correction, agent_output_approval, agent_proposal_review
- **Batch review sessions** for efficient processing
- **Feedback impact tracking** — see how your corrections improve system accuracy

### Comprehensive Validation

- **Input validation:** ~40 rules covering files, text, Slack, web scrapes, MCP parameters, agent inputs, entities, feedback
- **Output validation:** ~40 rules covering LLM extractions, reports, Slack alerts, JIRA tickets, knowledge graph writes, event bus
- **4-layer validation:** Transport → API Route → Service → Storage (input); Service → API Response → External Integration (output)

### Security & Guardrails

- **Prompt injection defense** (input sanitization, output validation)
- **Cypher injection prevention** (parameterized queries only)
- **File upload security** (MIME validation, macro detection, executable content blocking)
- **Agent authentication** (API key with bcrypt hash, per-agent permissions)
- **Agent rate limiting** (per-agent read/write limits, circuit breakers)
- **Agent write guardrails** (propose-only for destructive operations)
- **Audit trail** (every action logged with actor persona, agent identity, correlation ID)

### Observability

- **6 SLOs** with alert thresholds
- **Structured JSON logging** with correlation IDs across all services
- **Health check endpoints** for all services
- **Dead Letter Queue (DLQ)** with failure tracking and retry capability
- **Per-agent SLO monitoring** with auto-pause on breach

---

## Architecture Changes from V1

| Area | V1 | V2 |
|------|----|----|
| Data sources | Slack only | Slack + transcripts + documents + web scrapes |
| Storage | PostgreSQL + pgvector | PostgreSQL + pgvector + Neo4j + Redis |
| Entity handling | Flat extraction | Knowledge graph with entity resolution |
| Interface | Custom scripts, VS Code extension | MCP Server (35 tools) + A2A + Agent Gateway |
| Pipeline | Linear (ingest → embed → cluster → score) | 7-plane architecture with event bus |
| Feedback | None | Human-in-the-loop with persona hierarchy |
| Agents | None | 7 built-in agents, extensible via API |
| Security | Basic | Multi-protocol auth, rate limiting, audit trail |

---

## Infrastructure Requirements

| Component | Technology | Version |
|-----------|-----------|---------|
| Runtime (TypeScript) | Node.js | 18+ |
| Runtime (Python) | Python | 3.10+ |
| Database | PostgreSQL + pgvector | 15+ |
| Graph Database | Neo4j Community Edition | 5.x |
| Cache / Queue / Event Bus | Redis | 7.x |
| LLM | Azure OpenAI (GPT-4o, GPT-4o-mini) | Latest |
| Containers | Docker + Docker Compose | Latest |

---

## Migration from V1

V2 is **additive** — it extends V1 without breaking it. V1 pipeline continues to function. V2 adds new tables, services, and capabilities. See `specs/v2/14_BUILD_PLAN.md` §5 for the detailed migration plan.

---

## Known Limitations

- **Single PM deployment only** — multi-tenant support planned for V3
- **No custom UI** — all interaction via Claude Code/Cowork MCP tools
- **Manual ingestion for non-Slack sources** — transcripts, documents, and emails require manual upload
- **JIRA/Wiki connectors TBD** — awaiting MCP configuration
- **PII stored as-is** — acceptable for single-PM local deployment; V3 adds masking
- **Load testing deferred** — V2 targets are based on estimates; V3 adds formal load testing

---

## Documentation

| Document | Purpose |
|----------|---------|
| [User Guide](../USER_GUIDE.md) | End-user guide for all personas |
| [Developer Guide](../DEVELOPER_GUIDE.md) | Setup, architecture, contribution |
| [API Reference](../API_REFERENCE.md) | Agent Gateway REST + A2A protocol |
| [FAQ](../FAQ.md) | Common questions and answers |
| [Troubleshooting](../TROUBLESHOOTING.md) | Issue diagnosis and resolution |
| [Specification Index](../../specs/v2/00_INDEX.md) | Full technical specifications (16 documents) |
