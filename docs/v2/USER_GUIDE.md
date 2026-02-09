# PM Intelligence System V2 — User Guide

> **For:** Product Managers, PM Leaders, New PMs, Stakeholders
> **Version:** 1.0
> **Last Updated:** 2026-02-09

---

## Welcome

PM Intelligence is a continuously updated knowledge graph that ingests data from all the places product signals live — Slack, meeting transcripts, documents, web scrapes — and unifies them into a single queryable system. You interact with it through **Claude Code** or **Claude Cowork** using natural language. No dashboards to learn, no UIs to navigate.

Ask a question. Get an answer backed by real data with a traceable source chain.

---

## Table of Contents

1. [Getting Started](#1-getting-started)
2. [For Product Managers (Daily Drivers)](#2-for-product-managers-daily-drivers)
3. [For PM Leaders (Strategists)](#3-for-pm-leaders-strategists)
4. [For New PMs (Onboarding)](#4-for-new-pms-onboarding)
5. [For Stakeholders (Consumers)](#5-for-stakeholders-consumers)
6. [Ingesting Data](#6-ingesting-data)
7. [Entity Management](#7-entity-management)
8. [Generating Artifacts](#8-generating-artifacts)
9. [Understanding Confidence & Provenance](#9-understanding-confidence--provenance)
10. [Tips & Best Practices](#10-tips--best-practices)

---

## 1. Getting Started

### Prerequisites

- Access to **Claude Code** or **Claude Cowork** with the PM Intelligence MCP server configured
- Your instance of PM Intelligence running (ask your admin if unsure)

### Your First Interaction

Open Claude Code (or Cowork) and simply ask a question:

```
You: "What are the top customer issues this week?"
```

Claude will query the knowledge graph, synthesize the data, and respond with a structured answer including signal counts, affected customers, severity, and trends. You never need to know which tools are running behind the scenes.

### What You Can Do

| Category | Example Questions |
|----------|-------------------|
| **Search & Query** | "Which customers are affected by the auth timeout issue?" |
| **Trends & Heatmaps** | "Show me a heatmap of top issues by customer" |
| **Customer Profiles** | "Tell me everything about Acme Corporation" |
| **Ingest Data** | "Here's the transcript from today's customer call" |
| **Entity Management** | "Show me pending entity reviews" |
| **Generate Artifacts** | "Create a PRD for the bulk export feature" |
| **Reports** | "Generate a weekly portfolio summary" |
| **Strategic Insights** | "What should be on our roadmap for Q2?" |
| **Provenance** | "Where did the insight about auth timeout come from?" |

---

## 2. For Product Managers (Daily Drivers)

You use PM Intelligence daily to stay on top of customer signals, prioritize work, and generate artifacts. Here are the workflows that will save you the most time.

### 2.1 Morning Briefing

Start your day with:

```
"What happened overnight?"
```

You'll get:
- Emerging issues from the last 24 hours (with signal counts and customer names)
- Trending topics (increasing, declining, or new)
- Pending entity reviews that need your attention
- A count of new signals ingested since you last checked

**Pro tip:** Make this your first Claude conversation each morning. Over time, the system learns your product area's patterns and surfaces more relevant signals.

### 2.2 Customer Impact Analysis

When an issue is reported, immediately understand its breadth:

```
"How many customers are affected by the dashboard loading issue?"
```

or

```
"Which enterprise customers mentioned authentication problems this month?"
```

The system searches across ALL sources — Slack, meeting transcripts, uploaded documents, web scrapes — not just the channel where you first heard about it.

### 2.3 Issue Investigation

Dig deeper into any topic:

```
"Trace the auth timeout issue — when did it start, which customers reported it, 
and what's the timeline?"
```

The system returns a provenance chain: every signal, every source, every date. You can trust the answer because you can verify it.

### 2.4 Quick Artifact Generation

Generate work artifacts directly from the knowledge graph:

```
"Create a JIRA issue for the auth timeout problem with customer evidence"
```

```
"Write a PRD for the bulk export feature based on customer feedback"
```

```
"Generate a customer impact summary for the engineering team"
```

Every generated artifact includes provenance — which signals and customers informed it.

### 2.5 Competitive Intelligence

If you've ingested competitive intel (web scrapes, analyst reports):

```
"What are competitors doing in the payments space?"
```

```
"Compare our feature set to CompetitorX based on recent intel"
```

---

## 3. For PM Leaders (Strategists)

You use PM Intelligence weekly for portfolio-level visibility and strategic planning.

### 3.1 Weekly Portfolio Summary

```
"Give me the weekly portfolio summary"
```

You'll get:
- Highest-pain product areas (severity-weighted)
- Customer health changes (declining, improving)
- New opportunities that emerged this week
- Cross-cutting trends across all product areas

### 3.2 Heatmap Queries

```
"Show me a heatmap of issues by product area"
```

```
"Which product areas have the most customer complaints this month?"
```

The response is a structured matrix showing issues across customers and product areas, weighted by severity and frequency.

### 3.3 Shareable Reports

Generate self-contained reports for stakeholders:

```
"Generate a shareable executive summary of the Payments product area for the 
leadership team"
```

The report includes:
- Key metrics and trends
- Top issues with customer impact
- Opportunities and recommendations
- All data backed by source references

Reports are designed to be shared outside the system — they contain all context needed to understand the findings without access to PM Intelligence.

### 3.4 Strategic Insights

```
"What should be on our roadmap for next quarter based on customer signals?"
```

```
"Which themes are growing fastest across our customer base?"
```

The system identifies patterns across all sources to surface strategic recommendations backed by data.

### 3.5 Agent Health & Cost

Monitor the AI agents working on your behalf:

```
"Show me agent health and costs this month"
```

You'll see per-agent accuracy, response times, uptime, and monthly spend. If an agent's quality has degraded:

```
"Roll back the Triage Agent to its previous version"
```

---

## 4. For New PMs (Onboarding)

You just joined the team and need to absorb months of product context quickly. PM Intelligence is your onboarding accelerator.

### 4.1 Get the Full Picture

```
"I just took over the Payments product area. Give me the full picture."
```

You'll get a comprehensive overview:
- All customers in this area (with signal volumes and health scores)
- All tracked features (with maturity and mention counts)
- Active issues (with severity and customer impact)
- Recent trends (last 30 days)

### 4.2 Browse the Knowledge Graph

Explore entities and their relationships:

```
"Show me all entities related to Acme Corporation"
```

```
"What features does the authentication service connect to?"
```

This lets you build a mental model of how customers, features, issues, and themes relate to each other.

### 4.3 Entity Glossary

Learn the canonical names your team uses:

```
"What do we call the single sign-on feature? What aliases does it have?"
```

The system tracks canonical names and all their variants (abbreviations, informal names, JIRA IDs). This helps you speak the same language as the rest of the team.

### 4.4 Historical Context

```
"What were the biggest issues in the last quarter for my product area?"
```

```
"Show me the timeline of the auth timeout issue from the very beginning"
```

### 4.5 Bulk Historical Ingestion

If you have historical documents to add:

```
"I have 15 meeting transcripts from the last 3 months. Let me upload them."
```

The system processes them through the full pipeline — extraction, entity resolution, graph update — and adds them to your knowledge base.

---

## 5. For Stakeholders (Consumers)

You receive outputs from the PM team — reports, JIRA issues, summaries. Starting in V2, you also have limited direct access for self-service queries.

### 5.1 What You Receive (from PMs)

- **JIRA issues** with customer evidence and priority justification
- **PRDs** with provenance-backed requirements
- **Executive summaries** with trend analysis
- **Customer impact reports** for engineering planning

All of these artifacts include data provenance, so you can trust the numbers.

### 5.2 Self-Service Queries (via Stakeholder Access Agent)

For simple factual questions, you don't need to wait for the PM:

```
Engineering Manager: "Which customers are affected by the auth timeout issue?"

System: "Auth Timeout Issue — Customer Impact:
  12 customers affected (based on 47 signals from 3 sources)
  
  Top affected:
  1. Acme Corp — 8 reports, severity: high, since 2026-01-15
  2. GlobalTech — 6 reports, severity: high, since 2026-01-18
  3. StartupCo — 4 reports, severity: medium, since 2026-01-22
  
  Current status: In Progress (JIRA-1234)
  Data freshness: Updated 2 hours ago
  
  For detailed signal analysis or to request action, contact your PM."
```

**Scope:** Stakeholder access is read-only and scoped to specific product areas configured by your PM. You can query customer impact, issue status, and feature health. You cannot modify entities, ingest data, or generate artifacts.

---

## 6. Ingesting Data

### 6.1 Meeting Transcripts

Paste the transcript directly into your conversation:

```
"Here's the transcript from today's Acme Corp call:"
[paste transcript text]
```

Or for file uploads:

```
"Ingest this meeting transcript"
[attach .vtt or .txt file]
```

**Supported formats:** `.vtt`, `.srt`, `.txt`
**Max file size:** 50MB

### 6.2 Documents

Upload documents for processing:

```
"Ingest this competitive analysis document"
[attach file]
```

**Supported formats:** `.pdf`, `.docx`, `.pptx`, `.xlsx`, `.csv`
**Max file size:** 50MB per file, 20 files per batch, 200MB total per batch

### 6.3 What Happens After Ingestion

1. **Parsing:** The document is parsed into processable sections
2. **Extraction:** The LLM extracts entities (customers, features, issues, themes), relationships, sentiment, and urgency
3. **Entity Resolution:** Extracted entities are matched against the canonical knowledge graph — duplicates are merged, new entities are created
4. **Graph Update:** Neo4j knowledge graph is updated with new nodes and relationships
5. **Confirmation:** You see a summary of what was extracted and added

The entire process typically takes 1-3 minutes depending on document size.

### 6.4 Slack (Automatic)

Slack channels are monitored continuously. New messages and threads are automatically ingested — no action needed from you.

### 6.5 Web Scrapes

If your team has an external crawler bot, its output can be ingested:

```
"Ingest this web scrape data"
[attach JSON file with scraped content]
```

---

## 7. Entity Management

The system's value depends on high-quality entity resolution — making sure "MSFT", "Microsoft", and "Microsoft Corporation" all map to the same canonical entity.

### 7.1 Review Pending Merges

```
"Show me entity reviews"
```

You'll see three buckets:
- **High confidence (>85%):** Quick approvals — abbreviations, punctuation differences
- **Medium confidence (60-85%):** Needs your judgment — related but potentially different
- **Low confidence (<60%):** Likely different entities — quick rejections

### 7.2 Approve or Reject

```
"Approve merges 1, 2, 3. Reject 4 and 5."
```

Or with notes:

```
"Reject merge 4 — 'login slow' is a frontend performance issue, not the 
auth timeout bug."
```

Your notes improve future matching. The system learns from every decision you make.

### 7.3 Add Aliases

```
"Add alias 'MSFT' for Microsoft Corporation"
```

```
"The customer 'Acme' is also known as 'Acme Corp' and 'Acme Corporation'"
```

### 7.4 Split Entities

If two concepts were incorrectly merged:

```
"Split 'Login Issues' — 'Login Timeout' and 'Login UI Bug' are separate issues"
```

### 7.5 Impact of Your Feedback

Every merge/reject/alias decision:
- Immediately updates the knowledge graph
- Improves the matching algorithm's weights for future entities
- Is recorded in an immutable audit trail
- Feeds back into the entity resolution model within 24 hours

---

## 8. Generating Artifacts

### 8.1 PRDs

```
"Generate a PRD for the bulk export feature"
```

The generated PRD includes:
- Problem statement (from customer signals)
- User stories (derived from actual customer needs)
- Priority justification (based on customer count, severity, trend)
- Provenance (which signals informed each section)

### 8.2 JIRA Issues

```
"Create a JIRA issue for the auth timeout with full customer evidence"
```

Generates:
- Title and description
- Customer impact summary (names, counts, severity)
- Source references
- Suggested priority and labels

### 8.3 Executive Summaries

```
"Write an executive summary of the Q1 customer feedback for the leadership team"
```

### 8.4 Roadmap Inputs

```
"Based on all customer signals, what are the top 5 things we should build next quarter?"
```

### 8.5 What-If Analysis

```
"If we fix the auth timeout issue, how many customers does it impact and 
what's the estimated satisfaction improvement?"
```

---

## 9. Understanding Confidence & Provenance

### 9.1 Confidence Scores

Every entity match and insight comes with a confidence score:
- **90-100%:** Very high confidence — direct string match or well-established alias
- **70-89%:** High confidence — strong semantic match, corroborated across sources
- **50-69%:** Medium confidence — partial match, may need human review
- **Below 50%:** Low confidence — system flags for review, not auto-merged

### 9.2 Provenance Chains

Ask about the source of any insight:

```
"Where did the data about Acme's auth issues come from?"
```

Response:
```
Provenance for 'Acme Corp — Auth Timeout':
  - 8 Slack messages (#customer-support, Jan 15 - Feb 5)
  - 3 meeting transcript segments (Acme calls, Jan 22, Jan 29, Feb 5)
  - 1 document section (Acme QBR deck, slide 14)
  
  First reported: Jan 15, 2026 (Slack message by @sarah in #customer-support)
  Last signal: Feb 5, 2026 (customer call transcript)
```

This is what makes PM Intelligence trustworthy — you can always verify where an answer came from.

### 9.3 Data Freshness

Every response indicates how recent the data is. The system tracks:
- When each signal was ingested
- When each entity was last updated
- How many sources corroborate each insight

---

## 10. Tips & Best Practices

### Daily Habits

1. **Start with a morning briefing** — get ahead of emerging issues before anyone pings you
2. **Review entity merges daily** — 5 minutes of feedback dramatically improves future accuracy
3. **Ingest meeting transcripts immediately after calls** — while context is fresh

### Making the Most of It

1. **Be specific in queries** — "Which enterprise customers mentioned auth issues in the last 2 weeks?" works better than "any auth problems?"
2. **Use entity names consistently** — the system resolves aliases, but canonical names get faster results
3. **Provide feedback on entity merges** — the more you correct, the smarter the system gets
4. **Add aliases proactively** — when you know a customer has multiple names, tell the system

### What NOT to Do

1. **Don't expect real-time data** — signals are processed in batches, typically within minutes
2. **Don't upload sensitive PII documents** — the system stores content; be mindful of data classification
3. **Don't ignore entity reviews** — unresolved entities degrade query accuracy over time
4. **Don't rely solely on low-confidence insights** — always check the provenance for important decisions

### Getting Help

- **System health:** Ask "What's the system status?" to see health of all services
- **DLQ status:** Ask "Are there any failed processing items?" to check the dead letter queue
- **Entity stats:** Ask "What are the entity resolution stats?" to see accuracy trends

---

## Appendix: Quick Reference — All 35 MCP Tools

You don't need to know tool names — Claude selects them automatically. But for reference:

| Category | Tools | What They Do |
|----------|-------|-------------|
| Search & Query | `search_signals`, `get_customer_profile`, `get_feature_health`, `get_issue_impact`, `find_related_entities` | Find signals, customer data, feature/issue details |
| Intelligence | `get_heatmap`, `get_trends`, `get_roadmap_priorities`, `get_strategic_insights` | Trends, heatmaps, strategic analysis |
| Opportunities & Artifacts | `list_opportunities`, `generate_artifact` | Find opportunities, create PRDs/issues/summaries |
| Reports | `generate_shareable_report` | Self-contained reports for external sharing |
| Entity Management | `review_pending_entities`, `confirm_entity_merge`, `reject_entity_merge`, `add_entity_alias`, `list_entities`, `split_entity` | Manage the knowledge graph |
| Onboarding | `browse_knowledge_graph`, `get_knowledge_summary` | Explore and learn product areas |
| Ingestion | `ingest_transcript`, `ingest_document` | Add data to the knowledge graph |
| Provenance & Stats | `get_provenance`, `get_entity_resolution_stats` | Trace data sources, check ER accuracy |
| Analysis | `what_if_analysis`, `export_data` | Impact analysis, data export |
| System | `get_system_health`, `run_pipeline`, `get_dlq_status`, `retry_dlq_item` | System monitoring and maintenance |
| Agent Management | `review_agent_outputs`, `rollback_agent`, `list_registered_agents`, `deactivate_agent`, `configure_stakeholder_access` | Manage AI agent behavior and access |
