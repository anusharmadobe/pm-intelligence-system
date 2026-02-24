# PM Intelligence System — Detailed Description for Deep Research

## 1. What the system is (one-liner)

**A PM Intelligence Context Layer** that turns scattered product signals (Slack, transcripts, documents, web scrapes) into a **single, queryable knowledge graph** with entity resolution, so PMs can ask questions in natural language and get answers with traceable sources. It does **not** replace JIRA/Slack/Confluence; it sits on top of them as a "context layer."

---

## 2. Problem it solves for PMs

- **Scattered context:** Signals live in Slack, meeting notes, Jira, Confluence, emails, decks, dashboards.
- **Manual synthesis:** PMs spend **2–4 hours/day** gathering and synthesizing before deciding.
- **Entity fragmentation:** "Auth timeout," "login bug," "PROD-1234" are the same thing but no system links them.
- **No persistent memory:** Context is lost when switching products or after PTO.
- **Slow insights:** Trends and patterns show up weeks late because nothing watches all channels continuously.

---

## 3. High-level architecture

- **Ingestion:** Slack (continuous), meeting transcripts (paste/upload), documents (PPT/Word/Excel/PDF via Unstructured.io), web scrapes (crawler bot), webhooks (Grafana, Splunk, Teams). All normalized to a common **RawSignal** format and deduplicated (exact hash + semantic similarity).
- **Extraction:** LLM extracts **customers, features, issues, themes** from each signal; output is validated (Zod, entity limits, hallucination guard, confidence bounds). Optional relationship extraction and GraphRAG for hierarchical communities.
- **Entity resolution:** Extracted mentions are resolved to **canonical entities** (e.g. "MSFT" / "Microsoft" → one entity). Uses algorithmic + LLM + human feedback; merges are reversible; aliases are append-only; corrections improve the system over time.
- **Knowledge graph:** **PostgreSQL is source of truth** (signals, extractions, entity registry, opportunities, judgments, artifacts). **Neo4j** is a derived graph (customers, features, issues, themes and relationships) synced from PostgreSQL; used for multi-hop queries.
- **Embeddings:** Azure OpenAI embeddings stored in **pgvector** for semantic search and clustering.
- **Opportunity detection:** Signals are clustered (hybrid: text + embeddings). Clusters are scored (impact, confidence, effort, strategic fit, urgency) and turned into **opportunities**; related opportunities can be merged.
- **JIRA generation:** Top opportunities are turned into **JIRA issue templates** (title, description, customer evidence, priority) and exported to JSON (and optionally created in JIRA).
- **Pipeline:** A single **full LLM pipeline** script runs: ingestion → embeddings → deduplication → clustering → opportunity merge → JIRA generation → export (run state + report written to `output/`). Supports resume from checkpoint (DB + file).
- **Consumption:**  
  - **ChatGPT Enterprise Actions** (OpenAPI / Agent Gateway).  
  - **Web UI** at `/ui` (static + Next.js chat-ui): signal search, customer profile, manual ingest, heatmaps, trends, opportunities, entity browse, report generation, health, agent registration.  
  - **Claude / Cursor** via **MCP server** (31 tools): search signals, get trends, get heatmap, list opportunities, entity resolution stats, generate artifacts, etc.  
  - **Agent Gateway REST** and **A2A server** for external agents (API key auth, rate limits, audit).

---

## 4. Data flow (simplified)

```
Sources (Slack, transcripts, docs, web)
  → Adapters → Normalizer → Deduplication
  → Signals (PostgreSQL, immutable)
  → LLM extraction → Entity resolution → Extractions + canonical entities
  → Embeddings (pgvector) + Neo4j sync
  → Clustering → Opportunities (with roadmap scoring)
  → JIRA templates (export / push to JIRA)
  → Consumed via Agent Gateway, MCP, Web UI
```

Artifacts (PRDs, JIRA issues, reports) are generated from **judgments** (human-in-the-loop); judgments reference opportunities and signals. **Provenance:** every insight can be traced back to specific signals.

---

## 5. Personas and how they use it

| Persona | Who | Main use |
|--------|-----|----------|
| **PM (Daily Driver)** | IC PM | Morning briefing, customer deep-dives, signal search, manual ingest, entity feedback, PRD/JIRA drafts, roadmap summaries. Daily. |
| **PM Leader (Strategist)** | VP Product / Director | Portfolio heatmaps, trend analysis (e.g. Q4), resource allocation signals, executive summaries, shareable reports. Weekly. |
| **New PM (Ramp-Up)** | Onboarding PM | "Full context on my product area," browse knowledge graph, entity glossary, why something was prioritized, customer landscape. Heavy in first 2–4 weeks. |
| **Stakeholder** | Eng, Design, Sales, CS, Exec | Consume PM-generated artifacts (PRDs, JIRA, reports). Specs also define a **Stakeholder Access Agent** (read-only self-service queries); implementation may be partial. |
| **Ops/Admin** | Platform/IT | Health checks, event history, agent registration, API keys. |
| **Agent Builder** | Integration engineer | Agent Gateway API, OpenAPI, event subscriptions, webhooks. |

---

## 6. Core capabilities (what it does today)

- **Ingest** from Slack, transcripts, documents, web scrapes; normalize and deduplicate.
- **Extract** customers, features, issues, themes (and optionally relationships) with validation and hallucination guards.
- **Resolve** entities to canonical IDs; human feedback to confirm/reject merges, add aliases, split bad merges; system improves over time.
- **Search** signals by natural language and filters (source, customer, feature, theme, date).
- **Heatmaps** (e.g. issues by product/area, severity-weighted).
- **Trends** (emerging/declining/stable by entity type over a time window).
- **Opportunities** with roadmap scoring; merge related opportunities; list top opportunities.
- **JIRA** templates generated from top opportunities (customer evidence, priority); export to JSON; optional sync to JIRA.
- **Provenance** from any insight back to signals; confidence scores.
- **Artifacts:** PRD drafts, JIRA issues, reports (from judgments; human-in-the-loop).
- **Cost tracking** and **agent budgets** (per-agent cost, pause when over budget).
- **Pipeline:** Single full pipeline (ingestion → embeddings → dedup → clustering → opportunity merge → JIRA → export) with resume from checkpoint; run state and report in `output/`.

---

## 7. Explicit non-goals (current scope)

- No large custom UI rebuild (lightweight UI only).
- Not a general-purpose agent platform.
- No real-time streaming; batch/on-demand ingestion.
- Single-PM deployment (multi-tenant is future).
- No built-in email/calendar connectors (e.g. manual transcript upload).
- No in-house web scraping (external crawler feeds the system).
- No custom LLM or fine-tuning (Azure OpenAI only).
- **Does not** set product priorities or replace PM judgment; it **surfaces** signals and **structures** thinking.

---

## 8. Success metrics (from PRD)

- Entity resolution auto-merge accuracy: >85% (30 days), >92% (90 days).
- Time to answer "who's affected by issue X?": from 30–60 min manual to <30 s.
- Weekly trend synthesis: from 2–4 hours to ~10 min review.
- PRD draft: from 8–12 hours to 2–3 hours (review + refine).
- Context switch recovery: from 30–60 min to <5 min.

---

## 9. Known gaps and limitations (from recent analysis)

- **Bugs/robustness:** Cost tracking can use DB pool after shutdown ("pool after end"); some scripts don't close DB pool; dedup service can throw uncaught errors; Neo4j backlog has a retry cap (items can be dropped); pipeline report sometimes shows "export" as "running"; static UI and chat-ui can throw on invalid JSON (metadata/error body).
- **Logging:** Pipeline, Neo4j sync, and embedding services lack module-level log levels and structured debug (e.g. batch sizes, durations, skip/resume); CONFIGURABLE_LOGGING doc doesn't list them.
- **UI:** Static UI has no loading spinners or clear empty states; errors shown as raw text; ingest metadata JSON not validated. Chat-ui: Cost page not linked in nav; AdminBudgetManagement not mounted; cost dashboard assumes a specific API shape; non-JSON error bodies can throw; health check URL may not match production backend.
- **Visibility:** No API/UI for "last pipeline run" or "pipeline status"; JIRA "last export" not exposed in UI.
- **Partial failures:** Ingestion can partially fail (e.g. Neo4j sync fails for some signals); no clear "partial failure" summary in API or run state for operators.

---

## 10. Tech stack (brief)

- **Backend:** Node/TypeScript (API, services, MCP, Agent Gateway, A2A).
- **DB:** PostgreSQL (signals, extractions, entities, opportunities, judgments, artifacts, cost, agents); pgvector (embeddings); Neo4j (knowledge graph, derived from PostgreSQL).
- **LLM/Embeddings:** Azure OpenAI.
- **Optional:** Python services for document parsing (Unstructured.io) and GraphRAG (ports 5002, 5003).
- **Frontend:** Static UI (vanilla JS) + Next.js chat-ui.

---

## 11. What to ask ChatGPT Deep Research

You can ask ChatGPT Deep Research to focus on:

1. **Product/UX:** How to make this system **more valuable and powerful specifically for Product Managers** (daily drivers, leaders, new PMs): workflows, metrics, visualizations, and interaction patterns that would increase adoption and impact.
2. **Differentiation:** What similar tools or research exist (e.g. "product context layer," "PM knowledge graph," "signal-to-roadmap"), and what differentiators would make this system defensible and high-impact.
3. **Personas:** Concrete feature and UX improvements for each persona (PM Daily Driver, PM Leader, New PM, Stakeholder) and for edge cases (e.g. first-time use, PTO handoff, executive reporting).
4. **Metrics and ROI:** How to measure and communicate "2–3x more productive" and which leading indicators (e.g. time-to-first-insight, entity resolution accuracy, artifact reuse) matter most.
5. **Roadmap:** Prioritized enhancements (e.g. pipeline status in UI, stakeholder self-service, better logging, cost/pool fixes) that would most increase value for PMs without turning the system into a different product.

Use the sections above as the "current system" context and ask for **actionable, specific suggestions** (features, UX changes, metrics, and sequencing) rather than generic advice.
