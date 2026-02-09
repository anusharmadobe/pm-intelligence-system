# PM Intelligence System V2 — Specification Index

> **Version:** 2.7 (Updated — deployment guide, migration plan, testing strategy, API versioning, feature flags, data lifecycle, glossary)
> **Last Updated:** 2026-02-09
> **Status:** Design Phase
> **Predecessor:** specs/master_prd.md (V1 — Slack-only system)

---

## Document Map

| # | Document | Purpose | Status |
|---|----------|---------|--------|
| 01 | [Master PRD](./01_MASTER_PRD.md) | Product vision, goals, human + agent personas, **JTBD for all personas**, stakeholder self-service, success metrics | v2.5 |
| 02 | [Architecture](./02_ARCHITECTURE.md) | 7-plane architecture, **three-protocol model** (MCP + A2A + Event Bus), **Docker Compose, startup order, prerequisites** | v2.5 |
| 03 | [Entity Resolution](./03_ENTITY_RESOLUTION.md) | Deep-dive on entity resolution — the core differentiator | v2.1 |
| 04 | [Knowledge Graph](./04_KNOWLEDGE_GRAPH.md) | Neo4j schema, sync patterns, Cypher queries | v2.1 |
| 05 | [MCP Server, A2A Server & Agent Gateway](./05_MCP_SERVER.md) | **35 MCP tools** + 8 A2A skills + Agent Gateway REST, **API versioning & deprecation policy** | v2.6 |
| 06 | [Ingestion Adapters](./06_INGESTION_ADAPTERS.md) | All source adapters + **per-adapter validation rules**, sanitization, encoding | v2.1 |
| 07 | [Feedback Loops](./07_FEEDBACK_LOOPS.md) | Persona-aware feedback, batch review, **agent output feedback loop**, authority hierarchy | v2.3 |
| 08 | [Data Contracts](./08_DATA_CONTRACTS.md) | Immutable rules, **comprehensive input/output validation** (files, text, Slack, web, MCP, agents, KG, events), agent contracts | v2.5 |
| 09 | [Security & Guardrails](./09_SECURITY_GUARDRAILS.md) | Security model, A2A + REST auth, **data retention, archival, cleanup jobs**, RBAC | v2.5 |
| 10 | [UX & Interaction Design](./10_UX_DESIGN.md) | **13 interaction patterns**, agent output review, agent health dashboard, **stakeholder self-service** | v2.3 |
| 11 | [Third-Party Technology](./11_THIRD_PARTY_TECH.md) | All tech + protocols, **env catalog, feature flags, config validation**, license | v2.2 |
| 12 | [Open Source Evaluation](./12_OPEN_SOURCE_EVAL.md) | Evaluated OSS projects: what to reuse, what to skip | v2.0 |
| 13 | [OpenAI Frontier Analysis](./13_FRONTIER_ANALYSIS.md) | Frontier design study, applicable patterns, what to avoid | v2.0 |
| 14 | [Build Plan](./14_BUILD_PLAN.md) | 14-week plan, **V1→V2 migration plan, testing strategy**, A2A + agent lifecycle | v2.3 |
| 15 | [Component Registry](./15_COMPONENT_REGISTRY.md) | Exhaustive catalog: MCP tools, A2A server, agent gateway, **agent version history**, agents | v2.2 |
| **16** | **[Agentic Interactions](./16_AGENTIC_INTERACTIONS.md)** | **Agent taxonomy, JTBD, A2A protocol, agent SLOs, cost tracking, versioning, discovery, all gaps resolved** | **v2.5** |

---

## Protocol Strategy

The system uses three complementary open protocols:

| Protocol | Standard | Purpose |
|----------|----------|---------|
| **MCP** (Model Context Protocol) | Anthropic | Connect human-facing AI hosts (Claude Code/Cowork) to system tools |
| **A2A** (Agent2Agent Protocol) | Google | Enable external AI agents to discover and interact with the system as peers |
| **Internal Event Bus** (Redis Streams) | Custom | Low-latency event-driven communication for co-located internal agents |

MCP and A2A are **complementary, not competing**: MCP connects agents to tools (agent → system), A2A connects agents to agents (agent ↔ agent). See `16_AGENTIC_INTERACTIONS.md` §10 for the full protocol strategy.

---

## How to Use These Docs

1. **Start with 01_MASTER_PRD.md** for the "what" and "why" (includes human + agent personas and JTBD)
2. **Read 02_ARCHITECTURE.md** for the "how" at systems level (7-plane architecture, three-protocol model, Docker Compose, startup order)
3. **Deep-dive into 03-07** for specific subsystem designs
4. **Read 16_AGENTIC_INTERACTIONS.md** for agent design, JTBD framework, A2A protocol, and event bus
5. **Reference 08-09** for contracts, constraints, security, and data lifecycle (retention, archival, cleanup)
6. **Use 14_BUILD_PLAN.md** to plan sprints (4 phases, migration plan, testing strategy)
7. **Reference 11_THIRD_PARTY_TECH.md** for env catalog, feature flags, and configuration
8. **Use 15_COMPONENT_REGISTRY.md** as naming reference during implementation
9. **Consult the Glossary** (below) for canonical definitions of system terminology

## Glossary & Terminology

### Acronyms

| Acronym | Full Name | First Defined In |
|---------|-----------|------------------|
| A2A | Agent-to-Agent (Protocol) | 16_AGENTIC_INTERACTIONS.md §10 |
| APOC | Awesome Procedures on Cypher | 04_KNOWLEDGE_GRAPH.md |
| DLQ | Dead Letter Queue | 02_ARCHITECTURE.md §6.2.4 |
| ER | Entity Resolution | 03_ENTITY_RESOLUTION.md |
| HITL | Human-in-the-Loop | 07_FEEDBACK_LOOPS.md |
| JTBD | Jobs to Be Done | 01_MASTER_PRD.md §4 |
| KG | Knowledge Graph | 04_KNOWLEDGE_GRAPH.md |
| MCP | Model Context Protocol | 05_MCP_SERVER.md |
| PII | Personally Identifiable Information | 09_SECURITY_GUARDRAILS.md §4.1 |
| PITR | Point-in-Time Recovery | 02_ARCHITECTURE.md §6.6 |
| RAG | Retrieval Augmented Generation | 02_ARCHITECTURE.md |
| RBAC | Role-Based Access Control | 09_SECURITY_GUARDRAILS.md §7.5 |
| SLO | Service Level Objective | 02_ARCHITECTURE.md §6.3 |
| SSE | Server-Sent Events | 16_AGENTIC_INTERACTIONS.md §5.3 |

### Core Terms

| Term | Definition |
|------|-----------|
| **Canonical Entity** | The authoritative, deduplicated representation of a real-world entity (customer, feature, issue, theme). Stored in `entity_registry` with a unique ID. All aliases and variants resolve to the canonical entity. |
| **Alias** | An alternative name for a canonical entity (e.g., "MSFT" → "Microsoft"). Stored in `entity_aliases`. Aliases are append-only — never deleted. |
| **Signal** | A raw input from any source (Slack message, transcript chunk, document section, web scrape). The atomic unit of ingestion. Immutable once stored. |
| **Extraction** | Structured data (entities, relationships, sentiment, urgency) extracted from a signal by the LLM pipeline. Stored in `signal_extractions`. |
| **Entity Resolution** | The process of determining whether two entity mentions refer to the same real-world entity. Uses algorithmic matching (pyJedAI), embedding similarity, and LLM-assisted judgment. |
| **Provenance Chain** | The traceable path from an insight (e.g., "Acme Corp reported 8 auth issues") back to the original source signals. Enables trust in AI-generated outputs. |
| **Knowledge Graph** | The Neo4j-hosted graph of canonical entities and their relationships. Mirrors PostgreSQL as the source of truth. Used for graph traversal queries. |
| **Plane** | An architectural layer in the 7-plane architecture (Consumption, Intelligence, Knowledge, Entity Resolution, Extraction, Ingestion, Event Bus). Each plane has distinct responsibilities. |
| **Agent Card** | A JSON document served at `/.well-known/agent.json` that describes an A2A agent's capabilities, authentication requirements, and available skills. Used for agent discovery. |
| **Agent Gateway** | The REST API layer (`/api/agents/v1/...`) for programmatic agent interaction. Provides API key auth, rate limiting, and idempotent writes. |
| **Event Bus** | Redis Streams-based asynchronous messaging system for internal agents. Agents subscribe to event types and receive real-time notifications. |
| **Feedback Loop** | A mechanism where human PMs review and correct system outputs (entity merges, classifications, agent decisions). Corrections improve future accuracy. |
| **Golden Dataset** | A curated, human-verified set of entity pairs with known-correct merge/reject decisions. Used for entity resolution accuracy benchmarking and regression testing. |
| **Two-Pass LLM** | The extraction strategy: GPT-4o-mini handles simple signals (first pass), GPT-4o handles complex/ambiguous signals (second pass). Balances cost and quality. |
| **Feature Flag** | Environment variable (`FF_*`) that enables or disables a subsystem at startup. Used for phased rollout of V2 capabilities. |
| **Soft Delete** | Deactivating an entity by setting `is_active = false` rather than deleting the row. Preserves audit trail and allows reactivation. |
| **Circuit Breaker** | A resilience pattern that temporarily stops requests to a failing service after repeated errors, allowing it time to recover. |

---

## End-User & Developer Documentation

In addition to the technical specifications above, user-facing documentation is available in `docs/v2/`:

| Document | Audience | Purpose |
|----------|----------|---------|
| [User Guide](../../docs/v2/USER_GUIDE.md) | PMs, PM Leaders, New PMs, Stakeholders | Complete end-user guide with workflows, examples, tips |
| [Developer Guide](../../docs/v2/DEVELOPER_GUIDE.md) | Engineers | Setup, architecture overview, contribution, debugging |
| [API Reference](../../docs/v2/API_REFERENCE.md) | Agent developers, integrators | Agent Gateway REST + A2A protocol reference |
| [FAQ](../../docs/v2/FAQ.md) | All personas | Common questions and answers |
| [Troubleshooting](../../docs/v2/TROUBLESHOOTING.md) | PMs, developers | Issue diagnosis and resolution |
| [Announcement](../../docs/v2/launch/ANNOUNCEMENT.md) | All | Launch announcement (blog-post style) |
| [Release Notes](../../docs/v2/launch/RELEASE_NOTES.md) | All | V2 feature summary and migration notes |
| [Landing Page](../../docs/v2/launch/LANDING_PAGE.md) | Marketing | Product marketing page content |

---

## Relationship to V1 Specs

V1 specs in `specs/` remain authoritative for the existing system. V2 specs **extend** V1 — they do not replace it. The V1 data contracts (signals are immutable, LLM output never stored as signals, etc.) remain in force.

```
V1 (specs/)                    V2 (specs/v2/)
├── master_prd.md              ├── 01_MASTER_PRD.md (extends V1 vision + JTBD)
├── layer_prds.md              ├── 02_ARCHITECTURE.md (adds new planes + A2A)
├── data_contracts.md          ├── 08_DATA_CONTRACTS.md (extends V1 contracts)
├── system_map.json            ├── 15_COMPONENT_REGISTRY.md (superset)
├── digital_twin_design.md     │   (V2 builds toward Digital Twin)
├── security_model.md          ├── 09_SECURITY_GUARDRAILS.md (extends)
├── sql_schema.sql             ├── 04_KNOWLEDGE_GRAPH.md (adds Neo4j)
├── llm_prompts.md             │   (referenced by 03, 07)
├── failure_scenarios.md       │   (referenced by 09)
├── cursor_execution.md        ├── 05_MCP_SERVER.md (evolves cursor exec + A2A)
└── non_goals.md               │   (referenced by 01)
```
