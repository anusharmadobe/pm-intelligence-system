# Announcing PM Intelligence V2 — Your Product Context, Unified

*The knowledge graph that makes Product Managers 2-3x more productive.*

---

We're excited to announce **PM Intelligence V2** — a major evolution of our product management context layer. V2 transforms how Product Managers gather, synthesize, and act on product signals by unifying all your data into a continuously updated knowledge graph, accessible through natural language.

## The Problem We Solved

Every Product Manager knows this pain: your product signals live in a dozen different places. Customer feedback is in Slack. Meeting notes are in Google Docs. Competitor analysis is in a slide deck. Issue tracking is in JIRA. And the same customer, the same issue, the same feature request is described differently in each system.

PMs spend **2-4 hours per day** just gathering and synthesizing information before they can make a single decision. That's 40-50% of your working hours lost to context-gathering.

## What PM Intelligence V2 Does

PM Intelligence ingests data from all the places product signals live — Slack channels, meeting transcripts, documents (PDF, PowerPoint, Word, Excel), web scrapes, and more — and unifies them into a single **knowledge graph** with high-quality entity resolution.

Then it exposes that unified intelligence through **Claude Code** and **Claude Cowork** via 35 MCP tools. No new UI to learn. No dashboard to configure. Just ask a question in plain English and get an answer backed by real data with a traceable source chain.

## What's New in V2

### Multi-Source Ingestion

V1 was Slack-only. V2 ingests from everywhere:
- **Slack** — continuous automated monitoring
- **Meeting transcripts** — paste or upload after any call
- **Documents** — PDF, PowerPoint, Word, Excel, CSV
- **Web scrapes** — competitive intel from your crawler bot

### Knowledge Graph

Entities aren't flat records anymore. They're connected in a rich graph:
- Customers use features
- Customers have issues
- Issues relate to features
- Themes connect across product areas

This enables multi-hop queries: *"Which enterprise customers are affected by issues related to the Authentication feature?"*

### Entity Resolution Engine

The core differentiator. The system automatically recognizes that "Acme Corp", "Acme Corporation", and "ACME" are the same customer — across every data source. When it's not sure, it asks you to confirm. Your feedback makes it smarter over time.

Target accuracy: >90% within 90 days of use.

### 35 MCP Tools via Claude

From morning briefings to artifact generation, everything happens through natural conversation:
- *"What happened overnight?"* — instant briefing
- *"Tell me everything about Acme Corporation"* — deep customer profile
- *"Show me a heatmap of top issues by customer"* — visual intelligence
- *"Create a PRD for the bulk export feature"* — artifact with provenance
- *"Generate a weekly portfolio summary"* — shareable report

### AI Agent Ecosystem

V2 introduces an agent-friendly architecture:
- **Agent Gateway REST API** for programmatic access
- **A2A Protocol** (Google's Agent-to-Agent standard) for AI-to-AI interaction
- **Event Bus** for real-time notifications
- Built-in agents: Triage Agent, Report Scheduler, JIRA Sync, Slack Alerts, Data Quality Agent

### Provenance & Trust

Every insight traces back to its source signals. When PM Intelligence says "12 customers reported auth timeout," you can see exactly which 12 customers, from which channels, on which dates. This is what makes AI-generated insights trustworthy.

## Who It's For

| Persona | How They Use It |
|---------|-----------------|
| **Product Managers** | Daily operational queries, entity management, artifact generation |
| **PM Leaders** | Weekly portfolio views, heatmaps, shareable reports |
| **New PMs** | Accelerated onboarding — absorb months of context in days |
| **Stakeholders** | Self-service factual queries (read-only, scoped access) |
| **External Agents** | Programmatic access for automation and orchestration |

## By the Numbers

- **35** MCP tools for human interaction
- **8** A2A skills for agent interaction
- **6** data sources supported
- **4** human personas served
- **7** built-in AI agents
- **<5s** query response time (p95)
- **>90%** entity resolution accuracy target (90 days)

## Getting Started

If your team already uses Claude Code or Claude Cowork, getting started is straightforward:

1. Deploy the PM Intelligence system (Docker Compose for infrastructure, Node.js + Python for services)
2. Configure the MCP server in your Claude environment
3. Start asking questions

No training required. The interface is natural language.

## What's Next

V3 planning is underway. We're exploring:
- Custom UI dashboards (if MCP proves insufficient for any workflows)
- Multi-PM / multi-tenant support
- Real-time streaming ingestion
- Direct JIRA and Confluence connectors
- Advanced autonomous agent capabilities

## Try It

Check out the [User Guide](../USER_GUIDE.md) to see all interaction patterns, or the [Developer Guide](../DEVELOPER_GUIDE.md) to set up your own instance.

---

*PM Intelligence V2 — Stop synthesizing. Start deciding.*
