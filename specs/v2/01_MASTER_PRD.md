# V2 Master PRD — PM Intelligence Context Layer

> **Version:** 2.5 (Updated — stakeholder self-service, agent management stories, SLO/cost metrics)
> **Author:** System Architect
> **Date:** 2026-02-09
> **Status:** Approved for Build
> **Predecessor:** specs/master_prd.md (V1)

---

## 1. Executive Summary

The PM Intelligence System V2 evolves from a Slack-only signal processing pipeline into a **persistent, continuously-updated Knowledge Graph** that ingests heterogeneous data sources, performs high-quality entity resolution, and exposes PM intelligence as MCP tools consumable by Claude Code, Claude Cowork, Cursor, or any MCP-compatible host.

**One-line vision:** A PM's entire product context — customers, features, issues, themes, decisions, competitive intel — unified in a queryable knowledge graph that any AI agent can leverage to do real work.

---

## 2. Problem Statement

### 2.1 What PMs Face Today

- **Scattered context:** Product signals live across Slack, meeting transcripts, Jira tickets, Confluence pages, emails, presentations, web pages, and dashboards
- **Manual synthesis:** PMs spend 2-4 hours/day just gathering and synthesizing information before they can make decisions
- **Entity fragmentation:** The same customer/feature/issue is referenced differently across sources — "auth timeout", "login bug", "PROD-1234" are the same issue but no system connects them
- **No persistent memory:** When a PM context-switches between products or takes PTO, institutional knowledge is lost
- **Insight latency:** Trends and patterns emerge weeks after they should because no one is continuously watching all channels

### 2.2 What V1 Solved

V1 successfully built:
- Slack signal ingestion with thread handling
- LLM entity extraction (customers, features, issues, themes)
- Hybrid clustering (text + semantic embeddings via pgvector)
- Opportunity detection with roadmap scoring
- JIRA issue generation from opportunities
- 4-level theme hierarchy with trend analysis
- Full pipeline orchestration (ingest → embed → cluster → score → generate)

### 2.3 What V2 Adds

V2 extends V1 with:
1. **Multi-source ingestion** — Meeting transcripts, documents (PPT/Word/Excel/PDF), external crawler output, JIRA/Wiki (via MCP, TBD)
2. **Knowledge Graph** — Neo4j-based entity-relationship graph enabling multi-hop queries
3. **Entity Resolution Engine** — The core differentiator. High-quality, continuously-improving entity matching with human feedback loops
4. **MCP Server** — Expose all intelligence as MCP tools for Claude Code/Cowork
5. **Feedback Loops** — PM corrections flow back to improve extraction and resolution quality
6. **Provenance Tracking** — Every insight traces back to source signals

---

## 3. Goals & Non-Goals

### 3.1 Goals

| # | Goal | Measurable Target |
|---|------|-------------------|
| G1 | Unify PM context across all sources into a single queryable knowledge graph | 4+ source types ingested; all entities resolved to canonical forms |
| G2 | Achieve high-quality entity resolution that improves over time | >85% auto-resolution accuracy within 30 days; >92% within 90 days |
| G3 | Enable PMs to query their entire product context via Claude Code/Cowork | 12+ MCP tools exposed; <5s response time for common queries |
| G4 | Reduce PM synthesis time by 50%+ | Measure time-to-first-insight before/after |
| G5 | Build trust through provenance and confidence scoring | Every insight has a source chain and calibrated confidence score |
| G6 | Continuously improve through human feedback | PM corrections reduce ambiguous entity reviews by 50% within 60 days |

### 3.2 Non-Goals (Explicitly Out of Scope)

| # | Non-Goal | Reason |
|---|----------|--------|
| NG1 | Building a custom UI/dashboard | MCP + Claude Code/Cowork is our interaction surface. Revisit in V3. |
| NG2 | General-purpose agent platform (a la OpenAI Frontier) | We build a PM-specific knowledge system, not an agent runtime. |
| NG3 | Real-time streaming ingestion | Batch/on-demand ingestion is sufficient for V2. |
| NG4 | Multi-PM/multi-tenant support | Single-PM deployment for V2. Multi-tenant in V3. |
| NG5 | Automated email/calendar connectors | Manual PDF upload for emails. No calendar integration. |
| NG6 | Web scraping infrastructure | External crawler bot handles this; we only receive its output. |
| NG7 | Building our own LLM or fine-tuning models | Use Azure OpenAI APIs via existing .env keys. |
| NG8 | Teams/Zoom/Google Meet connectors | Manual transcript upload covers meeting content. |

---

## 4. Users & Personas

### 4.1 Primary Persona: Product Manager (PM) — "The Daily Driver"

**Profile:** Individual contributor PM responsible for one or more product areas. Uses the system daily to stay on top of customer signals, prioritize work, and generate artifacts.

**Interface:** Claude Code or Claude Cowork (MCP tools)

**Key needs:**
- Quickly answer customer impact questions ("Which customers are affected by auth timeout?")
- Track emerging issues and trends across all sources
- Generate PRDs, JIRA issues, and roadmap summaries
- Ingest meeting transcripts, documents, and emails into the knowledge graph
- Provide entity resolution feedback to improve system accuracy over time

**Pain points being solved:**
- 2-4 hours/day spent manually gathering and synthesizing information
- Same customer/feature/issue referenced differently across sources with no unification
- Context lost when switching between products or after PTO

**Primary interaction patterns:** Morning Briefing, Customer Deep-Dive, Entity Management, Ingestion, Artifact Generation

**Jobs to Be Done (JTBD):**

| Job ID | When... | I want to... | So I can... |
|--------|---------|-------------|-------------|
| H-PM-1 | I start my day | get a synthesized briefing of overnight signals | prioritize my morning work without reading 50 Slack messages |
| H-PM-2 | a customer escalation arrives | instantly pull up that customer's full context | respond with intelligence rather than scrambling |
| H-PM-3 | I need to write a PRD | generate a data-backed first draft with customer evidence | spend time on strategy, not data gathering |
| H-PM-4 | the system proposes entity merges | review them efficiently in batches with context | maintain data quality without it becoming a chore |
| H-PM-5 | I leave for PTO or switch products | know the knowledge graph retains my context | resume without losing institutional memory |
| H-PM-6 | I need to create JIRA issues for engineering | generate issues pre-populated with customer evidence and priority justification | reduce back-and-forth with engineering on "why is this important?" |
| H-PM-7 | leadership asks for a roadmap update | generate a prioritized roadmap backed by signal data | present data-driven priorities instead of gut-feel rankings |
| H-PM-8 | I discover the system miscategorized a signal | correct the extraction and know the system learns from it | trust that the system improves over time from my feedback |

---

### 4.2 Secondary Persona: PM Leader / VP Product — "The Strategist"

**Profile:** Manages a team of PMs. Responsible for portfolio-level decisions: roadmap prioritization, resource allocation, strategic direction. Queries the system weekly or for specific strategic analyses, not daily operations.

**Interface:** Claude Code or Claude Cowork (same MCP tools, different query patterns)

**Key needs:**
- Aggregate views: heatmaps of issues across ALL product areas, not just one
- Trend analysis over longer time horizons ("How did customer sentiment shift over Q4?")
- Resource allocation signals ("Which product area has the highest customer pain?")
- Strategic insights synthesized across multiple PMs' product areas (V3: multi-PM)
- Executive-ready summaries and reports that can be shared in leadership meetings

**Pain points being solved:**
- No unified view across the product portfolio
- Relies on individual PMs to surface issues — misses cross-cutting patterns
- Strategic planning uses stale data because aggregation is manual and infrequent

**Primary interaction patterns:** Heatmap Query, Trend Analysis, Strategic Insights, Shareable Report Generation

**Jobs to Be Done (JTBD):**

| Job ID | When... | I want to... | So I can... |
|--------|---------|-------------|-------------|
| H-PL-1 | I prepare for a leadership meeting | generate an executive customer health report with trends | present data-driven insights instead of anecdotes |
| H-PL-2 | I need to allocate resources across products | see cross-portfolio pain distribution by severity and customer segment | direct engineering effort to highest customer impact |
| H-PL-3 | a new PM joins my team | point them at the knowledge graph for onboarding | reduce my personal onboarding overhead from weeks to days |
| H-PL-4 | quarterly planning begins | see aggregated trends and opportunities across all product areas | make resource allocation decisions grounded in longitudinal data |
| H-PL-5 | an executive asks "how are our customers doing?" | generate a shareable customer health report on demand | respond within minutes, not hours of manual synthesis |
| H-PL-6 | I need to justify a strategic initiative to the board | get a cross-cutting opportunity analysis with revenue and customer impact | build a compelling, evidence-backed business case |

---

### 4.3 Tertiary Persona: New PM / Onboarding PM — "The Ramp-Up"

**Profile:** A PM who just joined the team or is taking over a product area. Has zero institutional context. The knowledge graph's biggest value proposition is making this person productive in days instead of weeks.

**Interface:** Claude Code or Claude Cowork (same tools, but heavier use of exploration and "teach me" patterns)

**Key needs:**
- Rapid context absorption: "Tell me everything about my product area"
- Understand the customer landscape: who are the top customers, what do they use, what are they struggling with
- Learn the issue/feature vocabulary the team uses (entity registry as a glossary)
- Understand historical decisions and their rationale (judgment/artifact history)
- Identify the current priorities and why they were prioritized

**Pain points being solved:**
- Onboarding takes 4-8 weeks because context is scattered across Slack history, old documents, and tribal knowledge
- No way to quickly understand the "shape" of a product area: which features matter, which customers are vocal, which issues are chronic
- Previous PM's knowledge walks out the door when they leave

**Primary interaction patterns:** Knowledge Graph Exploration, Customer 360 Deep-Dive, Entity Browsing, Historical Decision Review

**System impact:** This persona drives the need for `browse_knowledge_graph` and `get_knowledge_summary` MCP tools that provide open-ended exploration, not just targeted queries.

**Jobs to Be Done (JTBD):**

| Job ID | When... | I want to... | So I can... |
|--------|---------|-------------|-------------|
| H-NP-1 | I take over a product area | get the full landscape — customers, features, issues, trends, priorities — in one conversation | be productive in days, not the usual 4-8 weeks |
| H-NP-2 | I encounter unfamiliar entity vocabulary | browse the entity glossary with canonical names, aliases, and descriptions | understand what terms the team uses and avoid confusion in meetings |
| H-NP-3 | I need to understand why something was prioritized | see the provenance chain from roadmap item to signals | build trust in existing priorities instead of re-litigating them |
| H-NP-4 | I want to know "who are my key customers?" | get a ranked customer list with health scores, signal volume, and key contacts | know who to pay attention to and who to meet first |
| H-NP-5 | I attend my first sprint planning meeting | understand the top issues, their severity, and which customers are affected | contribute meaningfully instead of sitting silently |

---

### 4.4 Stakeholder Persona: Cross-Functional Stakeholder — "The Consumer"

**Profile:** Engineering Manager, Designer, Sales Lead, Customer Success Manager, or Executive who receives outputs from the system. Stakeholders primarily consume artifacts and reports produced by the PM, but also have a **limited direct interaction path** via a read-only Stakeholder Portal or Stakeholder Access Agent for self-service queries.

**Interface (Dual):**
- **Primary (passive):** Receives documents, JIRA issues, reports, Slack messages produced by the PM via the system
- **Secondary (active, V2):** Stakeholder Access Agent — a lightweight read-only interface that allows stakeholders to query customer impact, issue status, and roadmap data without needing PM involvement. Exposed via A2A or simple web interface.

**Key needs:**
- PRDs that are well-structured, clear, and actionable (not LLM-slop)
- JIRA issues with proper context, acceptance criteria, and priority justification
- Roadmap summaries that explain the "why" behind prioritization with data backing
- Customer impact summaries for sales/CS teams
- Meeting-ready reports and summaries
- **Self-service answers to common questions** without waiting for PM: "What's the status of feature X?", "Which customers are affected by issue Y?", "What's on the roadmap for Q3?"

**Pain points being solved:**
- PRDs arrive without data backing or customer evidence
- JIRA tickets lack context, requiring back-and-forth with the PM
- Roadmap discussions are opinion-driven because synthesized customer data doesn't exist
- **Stakeholders block on PM for simple factual questions** ("Which customers use SSO?") that the knowledge graph already knows
- **Sales/CS teams lack customer context** when preparing for customer meetings

**System impact:** This persona drives requirements for **artifact template quality**, **shareable report generation**, and a **stakeholder self-service layer**. Every generated artifact must be polished enough that the PM can share it directly. Additionally, the Stakeholder Access Agent provides read-only, scoped access to the knowledge graph for common stakeholder queries.

**Stakeholder Access Agent:**

| Aspect | Design |
|--------|--------|
| Interface | A2A Agent + optional lightweight web UI (V3) |
| Authentication | Separate API key per stakeholder team (scoped to their product area) |
| Permissions | Read-only: customer profiles, issue status, roadmap items, heatmaps |
| Cannot do | Ingest signals, modify entities, generate artifacts, access raw signals |
| Rate limit | 30 requests/minute (lower than agent default) |
| Audit | All queries logged with stakeholder identity |
| Trust level | Low (read-only, scoped, no entity mutations) |

**Jobs to Be Done (JTBD):**

| Job ID | When... | I want to... | So I can... |
|--------|---------|-------------|-------------|
| H-SH-1 | I receive a PRD from the PM | see customer evidence and signal provenance, not just opinions | trust the priority justification and plan my team's work accordingly |
| H-SH-2 | I need to plan my team's sprint | understand customer impact of each backlog item with data | make informed trade-off decisions instead of guessing |
| H-SH-3 | a customer asks "when will this be fixed?" | get the current status of the issue from a single source of truth | give the customer a confident, accurate answer |
| H-SH-4 | I'm preparing a sales pitch for a prospect | get a summary of how similar customers use our product and what they value | tailor my pitch with real evidence from existing customers |
| H-SH-5 | I receive a roadmap summary from the PM | see clear "why" explanations backed by customer data for each priority | understand and support the prioritization in cross-functional discussions |

---

### 4.5 Agent Personas

In addition to human personas, the system supports **autonomous and integration agents** that interact programmatically. See `16_AGENTIC_INTERACTIONS.md` for full agent design and JTBD framework.

#### 4.5.1 Autonomous Agents (AI-Powered)

| Agent | Purpose | Interface | Trust Level |
|-------|---------|-----------|-------------|
| **Triage Agent** | Classifies signal urgency, detects anomalies, flags P0 issues for immediate human attention | REST API + Event Subscription | Medium (bounded autonomy) |
| **Report Scheduler Agent** | Generates and delivers reports (weekly digest, monthly health) on a cron schedule | REST API | Medium |
| **Customer Success Agent** | Monitors customer health changes, generates proactive CS briefs when health declines | REST API + Event Subscription | Medium |
| **Data Quality Agent** | Monitors ER accuracy, detects orphaned entities, triggers reconciliation | REST API + Event Subscription | Medium |
| **Competitive Intelligence Agent** | Extracts competitor mentions from web scrape signals, flags competitive overlaps | REST API | Medium |
| **Sprint Planning Agent** | Provides engineering teams with prioritized opportunities and customer impact data | REST API (read-only) | Medium |
| **Executive Briefing Agent** | Generates executive-ready briefings on a weekly/monthly schedule | REST API | Medium |

#### 4.5.2 Integration Agents (Deterministic)

| Agent | Purpose | Interface | Trust Level |
|-------|---------|-----------|-------------|
| **JIRA Sync Agent** | Creates JIRA tickets from approved artifacts, syncs status changes back to knowledge graph | REST API + JIRA Webhooks | Medium (deterministic) |
| **Slack Alert Bot** | Translates system events (P0 signals, health declines, review queue alerts) into Slack messages | REST API + Event Subscription | Medium |
| **Workflow Automation Agent** | Bridges external platforms (n8n, Zapier, Make) to the system for signal ingestion and event-triggered workflows | REST API | Medium |

#### 4.5.3 Stakeholder Access Agent

| Agent | Purpose | Interface | Trust Level |
|-------|---------|-----------|-------------|
| **Stakeholder Access Agent** | Provides read-only query access to stakeholders (Eng Managers, Sales, CS, Executives) for customer profiles, issue status, roadmaps, and pre-generated reports without PM involvement | A2A + REST API (read-only) | Low (read-only, scoped per product area) |

This agent bridges the gap between "stakeholders only consume artifacts" and "stakeholders need self-service answers." It is PM-configured: the PM sets the access scope (product areas, entity types) per stakeholder team. All queries are logged and visible to the PM. The agent **cannot** ingest signals, modify entities, or access raw signal content.

#### 4.5.4 Key Design Principle: Agents Propose, Humans Decide

Autonomous agents **cannot directly modify the knowledge graph's entity structure** (no merges, splits, or deletions). They can only **propose** changes that queue for human review. This preserves PM authority over data quality while allowing agents to handle volume and velocity.

---

### 4.6 Unified Persona Impact Matrix (Humans + Agents)

| Capability | PM | PM Leader | New PM | Stakeholder | Triage Agent | Report Sched. | JIRA Sync | Slack Alert | Data Quality | Sprint Plan. |
|------------|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|
| Signal ingestion | Primary | Occasional | Learning | - | Classify | - | - | - | - | - |
| Entity resolution feedback | Primary | Occasional | Learning | - | Propose only | - | - | - | Propose only | - |
| Customer deep-dives | Daily | Weekly | Heavy | - | - | - | - | - | - | Read |
| Heatmaps & analytics | Weekly | Primary | Learning | Receives | - | Generates | - | - | - | Read |
| Trend analysis | Weekly | Primary | Context | Receives | Anomaly detect | Generates | - | - | Monitor | Read |
| PRD/RFC generation | Regular | Reviews | Learning | Consumer | - | - | - | - | - | - |
| JIRA issue creation | Regular | Reviews | Learning | Consumer | - | - | Creates & syncs | - | - | - |
| Report generation | Occasional | Primary | - | Consumer | - | Primary | - | - | - | - |
| Knowledge graph exploration | Occasional | Occasional | Heavy | - | - | - | - | - | Scan | Read |
| Event subscription | - | - | - | - | Subscribe | Subscribe | Subscribe | Subscribe | Subscribe | - |
| Proactive alerting | - | - | - | - | Flags P0s | Delivers reports | Status updates | Delivers alerts | Quality alerts | - |
| System health monitoring | Weekly | Monthly | - | - | - | - | - | - | Continuous | - |

---

## 5. Core User Stories

### 5.1 Ingestion Stories

| ID | Story | Acceptance Criteria |
|----|-------|---------------------|
| US-I1 | As a PM, I can paste a meeting transcript and have it processed into signals | Transcript parsed, entities extracted, knowledge graph updated, signals searchable |
| US-I2 | As a PM, I can upload a PPT/Word/Excel/PDF and have it ingested | Unstructured.io parses file, chunks created as signals, entities extracted |
| US-I3 | As a PM, my Slack channels are continuously ingested (existing V1) | Existing pipeline continues working with V2 entity resolution applied |
| US-I4 | As a PM, my external crawler bot can push scraped web pages into the system | Webhook endpoint receives content, normalizes to signals |
| US-I5 | As a PM, I can configure JIRA/Wiki MCP sources when available | TBD adapters accept MCP configuration and ingest |

### 5.2 Query Stories

| ID | Story | Acceptance Criteria |
|----|-------|---------------------|
| US-Q1 | As a PM, I can ask "Which customers are using Feature X?" via Claude Code | MCP tool returns customer list with usage evidence from knowledge graph |
| US-Q2 | As a PM, I can ask "How many customers face Issue Y?" | Graph query returns count, list, severity breakdown, with provenance |
| US-Q3 | As a PM, I can get a heatmap of top issues by feature area | Structured heatmap data returned, aggregated from knowledge graph |
| US-Q4 | As a PM, I can trace any insight back to source signals | Provenance chain: insight → opportunities → signals → raw source |
| US-Q5 | As a PM, I can see confidence scores for any claim | Confidence methodology explained: how many signals, what sources, resolution confidence |

### 5.3 Entity Resolution Stories

| ID | Story | Acceptance Criteria |
|----|-------|---------------------|
| US-E1 | As a PM, I can review ambiguous entity matches via Claude Code | Pending review queue returned via MCP, with context and confidence |
| US-E2 | As a PM, I can confirm or reject entity merges | Accept/reject updates entity registry, alias table, and knowledge graph |
| US-E3 | As a PM, I can add manual aliases to entities | "Auth" should also match "Authentication" — manually add alias |
| US-E4 | As a PM, I can split a wrongly merged entity | Undo merge, create separate entities, re-link signals |
| US-E5 | The system improves entity resolution accuracy from my corrections | Correction patterns reduce human review queue over time |

### 5.4 Intelligence Stories

| ID | Story | Acceptance Criteria |
|----|-------|---------------------|
| US-IN1 | As a PM, I can get prioritized opportunities with scoring breakdown | Roadmap scoring (impact, confidence, effort, strategic, urgency) |
| US-IN2 | As a PM, I can generate a PRD draft from an opportunity | Artifact service produces PRD with context from knowledge graph |
| US-IN3 | As a PM, I can generate JIRA issue drafts from opportunities | Existing V1 capability, enhanced with entity resolution context |
| US-IN4 | As a PM, I can see emerging and declining trends | Trend analysis with temporal reasoning |
| US-IN5 | As a PM, I can get strategic insights across all sources | Cross-source synthesis, not just Slack-only |

### 5.5 PM Leader / VP Product Stories

| ID | Story | Acceptance Criteria |
|----|-------|---------------------|
| US-L1 | As a PM Leader, I can get a portfolio-level heatmap across all product areas | Heatmap aggregates issues/features across the entire entity registry, not filtered to a single product |
| US-L2 | As a PM Leader, I can ask for a cross-cutting trend report over Q4 | Trend analysis supports extended time ranges (90+ days) and returns direction, magnitude, and affected customers |
| US-L3 | As a PM Leader, I can generate a shareable executive summary | System produces a formatted summary (Markdown or structured text) suitable for pasting into a leadership email or slide deck |
| US-L4 | As a PM Leader, I can identify resource allocation signals | System highlights product areas with highest customer pain, longest unresolved issues, and largest opportunity gaps |
| US-L5 | As a PM Leader, I can compare customer sentiment across product areas | Side-by-side sentiment comparison with evidence counts per area |

### 5.6 New PM / Onboarding Stories

| ID | Story | Acceptance Criteria |
|----|-------|---------------------|
| US-O1 | As a New PM, I can ask "Give me a full context dump on my product area" | System returns a structured summary: top customers, active issues, key features, recent trends, open opportunities, and entity glossary for the product area |
| US-O2 | As a New PM, I can browse the knowledge graph like a wiki | `browse_knowledge_graph` MCP tool lets me explore entities, relationships, and linked signals without knowing specific names |
| US-O3 | As a New PM, I can see why a priority was set the way it was | Provenance chain includes prior opportunity scoring, signals contributing to the score, and any manual overrides |
| US-O4 | As a New PM, I can learn the team's vocabulary for entities | Entity registry acts as a glossary: canonical names, aliases, descriptions, and example signals |
| US-O5 | As a New PM, I can understand what decisions were made and why | Historical artifact provenance: PRDs, JIRA issues, and roadmap items link back to the opportunities and signals that justified them |

### 5.7 Artifact & Stakeholder Output Stories

| ID | Story | Acceptance Criteria |
|----|-------|---------------------|
| US-A1 | As a PM, generated PRDs include data-backed "Problem Statement" sections | PRD template auto-populates customer count, signal count, severity, and source provenance |
| US-A2 | As a PM, generated JIRA issues include customer evidence and priority justification | JIRA template includes affected customers, signal count, severity distribution, and suggested priority |
| US-A3 | As a PM, I can generate a customer impact report for the CS/Sales team | Structured report: customer health, open issues, feature adoption, trend direction — formatted for non-PM consumption |
| US-A4 | As a PM, I can generate a meeting-ready roadmap summary | Summary includes prioritized items with scoring, customer impact, and strategic alignment — suitable for leadership presentation |
| US-A5 | As a PM, all generated artifacts cite their sources with verifiable provenance | Every claim in a generated artifact links back to specific signals via the provenance chain |

### 5.7.1 Stakeholder Direct Interaction Stories

| ID | Story | Acceptance Criteria |
|----|-------|---------------------|
| US-SH1 | As an Engineering Manager, I can query "Which customers are affected by issue X?" without asking the PM | Stakeholder Access Agent returns customer list with impact data; read-only, no entity mutations |
| US-SH2 | As a Sales Lead, I can query "What does customer X use and value?" before a customer meeting | Returns customer profile summary: features used, health score, recent signals — scoped to stakeholder's product area |
| US-SH3 | As a CS Manager, I can query the current status of an issue a customer asked about | Returns issue status including JIRA ticket status (if synced), severity, and estimated resolution |
| US-SH4 | As an Executive, I can view a pre-generated dashboard summary without any tool setup | Stakeholder Access Agent serves the most recent weekly digest / executive summary via a simple URL or Slack bot |
| US-SH5 | As any stakeholder, my queries are logged and visible to the PM in the audit trail | All stakeholder queries logged with stakeholder identity, action, and timestamp — PM can see what stakeholders are asking about |
| US-SH6 | As a PM, I can control which data stakeholders in my product area can access | PM configures stakeholder access scope per team (product area, entity types, data freshness) |

### 5.8 Agent Interaction Stories

| ID | Story | Acceptance Criteria |
|----|-------|---------------------|
| US-AG1 | As the Triage Agent, I can classify new signals by urgency and flag P0 issues | Agent receives `signal.batch_complete` events, classifies urgency, creates feedback_log entries for critical items |
| US-AG2 | As the Report Scheduler Agent, I can generate and deliver weekly digests on a cron schedule | Reports generated via Agent Gateway API, delivered to configured Slack channels at scheduled times |
| US-AG3 | As the JIRA Sync Agent, I can create JIRA tickets from approved artifacts and sync status back | Outbound: approved artifact → JIRA ticket created. Inbound: JIRA status change → knowledge graph updated |
| US-AG4 | As the Slack Alert Bot, I can push critical system events as Slack messages | Event subscription triggers formatted Slack messages for P0 signals, health declines, and review queue alerts |
| US-AG5 | As the Data Quality Agent, I can monitor ER accuracy and propose orphaned entity cleanup | Periodic ER stat checks against SLO, orphaned entity scan, proposals created as feedback_log entries |
| US-AG6 | As the Sprint Planning Agent, I can read prioritized opportunities with customer impact | Read-only access to opportunities, heatmaps, and provenance for sprint planning context |
| US-AG7 | As the Customer Success Agent, I can generate customer briefs when health scores decline | Event subscription on `entity.health_changed`, auto-generates customer impact brief for CS team |
| US-AG8 | As any agent, I can register, authenticate with API keys, and be rate-limited | Agent Gateway provides registration, API key auth, per-agent rate limiting, and activity logging |
| US-AG9 | As a Workflow Automation Agent (n8n/Zapier), I can push external signals into the system | POST to Agent Gateway ingestion endpoint with idempotency key, normalized to RawSignal format |
| US-AG10 | As the PM, I can see all agent activity in the audit trail | Agent actions logged with agent identity, action type, and timestamp — visible via system health tools |
| US-AG11 | As the PM, I can review and correct agent outputs (triage urgency, report content) | `review_agent_outputs` MCP tool shows pending agent outputs grouped by agent; PM can accept/correct/reject |
| US-AG12 | As the PM, I can roll back an agent to a previous version when quality degrades | `rollback_agent` MCP tool restores previous agent config; SLO breach counter resets; version history preserved |
| US-AG13 | As the PM, I can see per-agent SLO health and monthly cost | Agent health endpoint returns accuracy, latency, uptime SLOs + monthly cost vs. budget |
| US-AG14 | As the Stakeholder Access Agent, I can serve read-only queries from stakeholders | Stakeholder can query customer profiles, issue status, roadmap items — scoped to their configured product area |
| US-AG15 | As the PM, I can configure stakeholder access scope per team | PM sets which product areas, entity types, and data freshness each stakeholder team can access |

---

## 6. Success Metrics

### 6.1 Quality Metrics

| Metric | Target (30 day) | Target (90 day) |
|--------|-----------------|-----------------|
| Entity resolution auto-merge accuracy | >85% | >92% |
| False positive rate (wrong merges) | <5% | <2% |
| False negative rate (missed merges) | <15% | <8% |
| PM feedback queue size (pending reviews) | <50/week | <15/week |
| Provenance completeness (insights with full source chain) | >90% | >98% |

### 6.2 Productivity Metrics

| Metric | Before V2 | Target After V2 |
|--------|-----------|-----------------|
| Time to answer "who's affected by Issue X?" | 30-60 min manual | <30 sec via MCP |
| Time to synthesize weekly trends | 2-4 hours | 10 min review |
| Time to create PRD draft | 8-12 hours | 2-3 hours (review + refine) |
| Context switch recovery time | 30-60 min | <5 min (persistent knowledge graph) |

### 6.3 System Health Metrics

| Metric | Target |
|--------|--------|
| Ingestion pipeline uptime | >99% |
| MCP tool response time (p95) | <5 seconds |
| Agent Gateway response time (p95) | <3 seconds |
| Knowledge graph sync latency | <30 seconds after signal processing |
| Entity resolution throughput | >100 entities/minute |
| Storage growth rate | <500MB/month (single PM) |

### 6.4 Agentic Interaction Metrics

| Metric | Target |
|--------|--------|
| Critical signal alert latency (signal ingested → PM notified via Slack) | <5 minutes |
| Scheduled report delivery reliability | >99% on-time delivery |
| JIRA sync latency (artifact approved → JIRA ticket created) | <2 minutes |
| Agent uptime (registered agents healthy) | >95% |
| Agent-proposed entity changes accepted by humans | >70% (indicates good proposal quality) |
| Event bus delivery latency (event emitted → agent received) | <5 seconds |
| Agent output accuracy (PM feedback on agent outputs) | Per-agent SLO targets (see `16_AGENTIC_INTERACTIONS.md` §5.4.1) |
| Agent monthly cost within budget | 100% of agents within their `max_monthly_cost_usd` |
| Agent SLO breach auto-pause rate | <5% of agent-months result in auto-pause |
| Stakeholder self-service query success rate | >90% of stakeholder queries answered without PM involvement |
| Agent version rollbacks per month | <2 (indicates good deployment quality) |

---

## 7. Data Contracts (V2 Extensions)

See [08_DATA_CONTRACTS.md](./08_DATA_CONTRACTS.md) for full contracts. Key V2 additions:

1. **All V1 contracts remain in force** (signals immutable, no LLM output as signals, etc.)
2. **Canonical entities are the authoritative identity** — all references use canonical entity IDs
3. **Entity aliases are append-only** — aliases are never deleted, only deactivated
4. **Knowledge graph is a derived view** — PostgreSQL remains source of truth
5. **Every insight must have a provenance chain** — no orphaned insights
6. **Feedback corrections are immutable audit events** — corrections logged, never silently applied

---

## 8. Architectural Overview

See [02_ARCHITECTURE.md](./02_ARCHITECTURE.md) for full architecture. Summary:

```
Consumption Plane  →  Claude Code / Cowork via MCP Server
Intelligence Plane →  Query Engine, Insight Generator, Trend Analysis, Heatmaps
Knowledge Plane    →  Neo4j (graph) + pgvector (embeddings) + PostgreSQL (structured)
Resolution Plane   →  Entity Resolution, Alias Management, Canonical Registry, Feedback
Extraction Plane   →  LLM Extraction, Relationship Extraction, GraphRAG, Document Chunking
Ingestion Plane    →  Source Adapters, Normalizer, Deduplication, Scheduler
```

---

## 9. Risks & Mitigations

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| Entity resolution quality is poor | High — everything downstream fails | Medium | Three-tier approach (algorithmic + LLM + human). Cluster repair mechanism. Golden dataset benchmarks. |
| Neo4j adds operational complexity | Medium | Medium | Use Neo4j CE Docker. PostgreSQL as SoT. Sync backlog for outages. Full resync as recovery. |
| Python/TypeScript polyglot friction | Medium | Medium | Clear HTTP API boundaries. Contract tests. Circuit breakers for isolation. |
| LLM extraction costs escalate | Medium | Medium | Two-pass extraction (mini first, full for ambiguous). Caching. Budget alerts. |
| MCP protocol changes/limitations | Low | Low | Thin MCP layer. Core logic in services, not MCP handlers. Pin SDK version. |
| Meeting transcripts are noisy | Medium | High | LLM segment classification. Relevance filtering (>0.3). Noise patterns learned from feedback. |
| Single-PM scope limits validation | Medium | Medium | Design for multi-PM from day 1, implement for single-PM. |
| Pipeline failures cascade silently | High | Medium | Dead letter queue. Circuit breakers. SLO monitoring. Graceful degradation at every plane. |
| Entity resolution order-dependency | Medium | Medium | Transitive closure constraints. Cluster repair mechanism (periodic validation). |
| Integration testing takes longer than expected | Medium | High | Buffer weeks in each phase. Phase validation gates. |

---

## 10. Production Quality Enhancements

V2 specifications include production-grade engineering beyond typical MVPs:

| Capability | Description | Documented In |
|------------|-------------|---------------|
| **Error Classification & Retry** | 4-tier error classification, exponential backoff, bounded retries | 02_ARCHITECTURE 6.2 |
| **Circuit Breakers** | Per-dependency circuit breakers (Neo4j, Python, Azure OpenAI) with fallback chains | 02_ARCHITECTURE 6.2.3 |
| **Dead Letter Queue** | Failed signals retained for retry/investigation, never silently dropped | 02_ARCHITECTURE 6.2.4 |
| **Graceful Degradation** | System continues with reduced quality when components fail | 02_ARCHITECTURE 6.2.5 |
| **Idempotency** | All operations safe to retry without side effects | 02_ARCHITECTURE 6.2.6, 08_DATA_CONTRACTS #29 |
| **SLO Monitoring** | 6 SLOs with alert thresholds and measurement methodology | 02_ARCHITECTURE 6.3.1 |
| **Distributed Tracing** | Correlation IDs across TypeScript → Python → Neo4j → Azure OpenAI | 02_ARCHITECTURE 6.3.4 |
| **Data Quality Layer** | Signal validation, timezone normalization, hallucination detection | 02_ARCHITECTURE 6.4 |
| **Caching Strategy** | Redis + in-memory caching with TTLs and invalidation rules | 02_ARCHITECTURE 6.5 |
| **Backup & DR** | Daily PostgreSQL/Neo4j backups, documented recovery procedures | 02_ARCHITECTURE 6.6 |
| **Entity Resolution Edge Cases** | Multi-match disambiguation, LLM fallback, cluster repair, split recovery | 03_ENTITY_RESOLUTION 9.x |
| **Feedback Conflict Resolution** | Contradictory feedback handling, staleness auto-resolution, priority scoring | 07_FEEDBACK_LOOPS 7.x |
| **Cypher Injection Prevention** | Parameterized queries, label allowlist, input sanitization | 09_SECURITY_GUARDRAILS 3.2 |
| **Entity Name Prompt Injection** | XML delimiters, injection pattern detection, schema validation | 09_SECURITY_GUARDRAILS 3.3 |
| **Ambiguity Handling** | Entity disambiguation, progressive disclosure, empty result guidance | 10_UX_DESIGN 5.x |
| **Phase Validation Gates** | Explicit pass/fail criteria before progressing to next phase | 14_BUILD_PLAN 8 |

---

## 10. Relationship to Digital Twin Vision

V2 is **Phase 1 of the Digital Twin** (see `specs/digital_twin_design.md`):

```
Digital Twin Vision:
  Phase 1 (V2): Knowledge Graph + Context Engine + Action Capabilities  ← WE ARE HERE
  Phase 2 (V3): Behavioral Model + Learning Engine + Multi-PM
  Phase 3 (V4): Full Autonomy + Predictive Capabilities
```

V2 builds the persistent knowledge foundation that the Digital Twin requires. Without high-quality entity resolution and a unified knowledge graph, the Digital Twin cannot reason about the PM's world.
