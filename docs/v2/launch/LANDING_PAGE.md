# PM Intelligence — Landing Page Content

> **Note:** This document contains the copy and structure for a marketing landing page.
> It is written as content blocks that can be adapted to any web framework or static site generator.

---

## Hero Section

### Headline

**Your entire product context. One conversation away.**

### Subheadline

PM Intelligence unifies customer signals from Slack, meetings, documents, and the web into a knowledge graph you query with natural language. Stop synthesizing. Start deciding.

### CTA

[Get Started] &nbsp; [See How It Works]

---

## The Problem

### Every PM knows this feeling.

Customer feedback is in Slack. Meeting notes are in a Google Doc. Competitive intel is in a slide deck somewhere. The same issue is called "auth timeout" in one channel and "login bug" in another. And your JIRA backlog doesn't connect to any of it.

**You spend 2-4 hours every day just gathering context** before you can make a single product decision.

What if all that context was already unified, resolved, and queryable — before you even sat down?

---

## The Solution

### One knowledge graph. Every source. Every entity resolved.

PM Intelligence ingests product signals from all the places they live and unifies them into a continuously updated knowledge graph with high-quality entity resolution.

**"Acme Corp"**, **"Acme Corporation"**, and **"ACME"** are automatically recognized as the same customer — across Slack, meeting transcripts, documents, and web scrapes.

Then you just ask:

> *"Which customers are affected by the auth timeout issue?"*

And get an answer in seconds, backed by real data with a traceable source chain.

---

## How It Works

### 1. Ingest

Data flows in from multiple sources — automatically from Slack, manually for transcripts and documents.

- Slack channels (continuous monitoring)
- Meeting transcripts (paste or upload)
- Documents (PDF, PowerPoint, Word, Excel)
- Web scrapes (competitive intel)
- Emails (as PDF uploads)

### 2. Understand

A two-pass LLM extraction pipeline identifies entities (customers, features, issues, themes), relationships, sentiment, and urgency from every signal.

### 3. Resolve

The entity resolution engine — powered by pyJedAI, embedding similarity, and LLM-assisted matching — connects the same entity across every source. When it's not sure, it asks you. Your feedback makes it smarter.

### 4. Connect

Entities are connected in a knowledge graph. Customers use features. Customers have issues. Issues relate to features. Themes span product areas. You can traverse these connections with natural language.

### 5. Query

Ask anything through ChatGPT Enterprise Actions, the built-in Web UI, or Claude Code/Cowork. MCP tools and the Agent Gateway work behind the scenes. You never see a query language — just natural conversation.

---

## What You Can Do

### Morning Briefing

> "What happened overnight?"

Get emerging issues, trending topics, and pending reviews — every morning in 10 seconds.

### Customer Deep-Dives

> "Tell me everything about Acme Corporation"

Full profile: features used, active issues, recent signals, health trend, segment, and tier.

### Issue Heatmaps

> "Show me a heatmap of top issues by customer"

Visual intelligence matrix showing issue severity across your customer base.

### Artifact Generation

> "Create a PRD for the bulk export feature based on customer feedback"

PRDs, JIRA issues, and reports generated directly from knowledge graph data — with provenance.

### Strategic Insights

> "What should be on our roadmap for next quarter?"

Data-driven recommendations based on cross-source signal analysis.

### Provenance

> "Where did that insight come from?"

Every answer traces back to source signals. You can always verify.

---

## Who It's For

### Product Managers

Use it daily. Morning briefings, customer investigations, entity reviews, artifact generation. Save 2+ hours per day on context gathering.

### PM Leaders

Use it weekly. Portfolio heatmaps, trend reports, shareable executive summaries. See across all product areas without reading every Slack channel.

### New PMs

Use it from day one. Absorb months of product context in days. Browse the knowledge graph, learn canonical names, understand customer relationships.

### Stakeholders

Self-service factual queries. Engineers, designers, and sales leads can check customer impact and issue status without waiting for the PM.

### AI Agents

Programmatic access via REST API and A2A protocol. Build triage agents, report schedulers, JIRA sync agents, and more.

---

## Key Numbers

| Metric | Value |
|--------|-------|
| MCP tools for human interaction | 35 |
| ChatGPT Actions supported | Yes |
| Web UI available | Yes |
| A2A skills for agent interaction | 8 |
| Data sources supported | 6 |
| Human personas served | 4 |
| Built-in AI agents | 7 |
| Query response time (p95) | <5 seconds |
| Entity resolution accuracy | >90% (90-day target) |
| Time saved per PM per day | 2+ hours (estimated) |

---

## Architecture at a Glance

```
Sources                Knowledge                Consumers
────────             ──────────────            ──────────
Slack          ──→                         ──→  ChatGPT / UI / Claude
Transcripts    ──→   Entity Resolution     ──→  ChatGPT / UI / Claude
Documents      ──→   Knowledge Graph       ──→  AI Agents
Web Scrapes    ──→   (Neo4j + PostgreSQL)  ──→  Stakeholders
JIRA (TBD)     ──→                         ──→  Automation
```

- **7-plane architecture** — Ingestion, Extraction, Entity Resolution, Knowledge, Intelligence, Event Bus, Consumption
- **Three-protocol model** — MCP (humans), A2A (agents), REST (integrations + ChatGPT Actions)
- **Two-pass LLM** — GPT-4o-mini for speed, GPT-4o for accuracy
- **Human-in-the-loop** — Your feedback improves every aspect of the system

---

## Trust & Transparency

### Every insight has a source chain

When we say "12 customers reported auth timeout," you can see exactly which 12, from which channels, on which dates. No black boxes.

### Confidence scores on everything

Entity matches, extraction results, and intelligence outputs all carry calibrated confidence scores. You always know how certain the system is.

### Your corrections make it better

Every entity review, every classification correction, every alias you add flows back into the system. PM Intelligence gets smarter the more you use it.

---

## Technology

Built on open standards and proven open-source technologies:

- **Neo4j Community Edition** — knowledge graph
- **PostgreSQL + pgvector** — source of truth + vector search
- **Redis** — queue, cache, event bus
- **pyJedAI** — entity resolution
- **Microsoft GraphRAG** — graph-based RAG
- **MCP** (Anthropic) — human-AI tool protocol (optional)
- **ChatGPT Actions** — OpenAPI integration via Agent Gateway
- **A2A** (Google) — agent-to-agent protocol
- **Azure OpenAI** — LLM extraction (GPT-4o, GPT-4o-mini)

---

## Getting Started

### For PMs

1. Ensure PM Intelligence is deployed (ask your admin)
2. Open ChatGPT Enterprise or the PM Intelligence UI (`/ui`)
3. Ask: "What are the top customer issues this week?"
4. That's it. No training required.

### For Developers

1. Clone the repository
2. `docker compose up -d` (infrastructure)
3. `npm install && npm run dev` (application)
4. Configure ChatGPT Actions or MCP server (optional)
5. See the [Developer Guide](../DEVELOPER_GUIDE.md) for details

### For Agent Developers

1. Register an agent via the Agent Gateway
2. Fetch the Agent Card at `/.well-known/agent.json`
3. Use the REST API or A2A protocol
4. See the [API Reference](../API_REFERENCE.md) for details

---

## Footer

**PM Intelligence** — The context layer for product management.

Stop synthesizing. Start deciding.

[Documentation](../USER_GUIDE.md) | [Developer Guide](../DEVELOPER_GUIDE.md) | [API Reference](../API_REFERENCE.md) | [GitHub](#)
