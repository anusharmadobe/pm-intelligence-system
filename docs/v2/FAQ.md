# PM Intelligence System V2 — Frequently Asked Questions

> **Last Updated:** 2026-02-09

---

## General

### What is PM Intelligence?

PM Intelligence is a continuously updated knowledge graph that ingests product signals from multiple sources — Slack, meeting transcripts, documents, web scrapes — and unifies them into a single queryable system. It performs entity resolution to connect the same customer, feature, or issue across sources, and exposes the intelligence via natural language through Claude Code or Claude Cowork.

### How is it different from a regular database or search tool?

Three things set it apart:
1. **Entity Resolution** — "MSFT", "Microsoft", and "Microsoft Corporation" are recognized as the same entity across all sources. This is the core differentiator.
2. **Knowledge Graph** — entities aren't flat rows; they have rich relationships (customers use features, customers have issues, issues relate to features). You can ask multi-hop questions.
3. **Natural Language Interface** — you ask questions in plain English via Claude. No query languages, no dashboards, no training.

### Who is this for?

Four personas:
- **Product Managers** (daily operational use)
- **PM Leaders** (weekly strategic and portfolio-level views)
- **New PMs** (accelerated onboarding into a product area)
- **Stakeholders** (limited self-service for factual queries)

### Do I need to learn a new tool?

No. If you already use Claude Code or Claude Cowork, you already know the interface. PM Intelligence adds MCP tools behind the scenes, but you interact through the same natural language conversation.

### Does this replace JIRA, Confluence, or Slack?

No. PM Intelligence **reads from** these systems and synthesizes their data. It generates artifacts (JIRA issues, PRDs) that you then put into those systems. It's a context layer, not a replacement for any existing tool.

---

## Data & Ingestion

### What data sources are supported?

| Source | Method | Status |
|--------|--------|--------|
| Slack | Automatic (continuous monitoring) | Active |
| Meeting transcripts | Manual upload (paste text or upload .vtt/.srt/.txt) | Active |
| Documents (PDF, PPTX, DOCX, XLSX, CSV) | Manual upload | Active |
| Web scrapes | External crawler bot output (JSON) | Active |
| JIRA | MCP configuration (TBD) | Planned |
| Confluence/Wiki | MCP configuration (TBD) | Planned |
| Emails | Manual PDF upload | Active (workaround) |

### How do I add data?

For Slack, it's automatic. For everything else, use natural language:
- "Here's the transcript from today's customer call" (paste or attach)
- "Ingest this competitive analysis document" (attach file)
- "Upload these meeting notes" (attach .vtt or .txt file)

### What file formats are supported?

`.pdf`, `.docx`, `.pptx`, `.xlsx`, `.csv`, `.txt`, `.vtt`, `.srt`

### What's the file size limit?

50MB per file, 20 files per batch, 200MB total per batch.

### How long does ingestion take?

Typically 1-3 minutes depending on document size. The system parses the document, runs LLM extraction, performs entity resolution, and updates the knowledge graph.

### Can I ingest historical data?

Yes. You can upload documents from any time period. The system processes them through the full pipeline. New PMs often do a bulk upload of historical meeting transcripts during their first week.

### Is my data stored permanently?

Signals are retained for 365 days by default (configurable). Entities are retained indefinitely (soft-delete only). Uploaded files are deleted after 24 hours — only the extracted data persists.

### Can I delete data?

Entities can be deactivated (soft-deleted) but not hard-deleted. Signals are immutable once ingested. This preserves the audit trail and provenance chain. If you need data removed for compliance reasons, contact your admin.

---

## Entity Resolution

### What is entity resolution?

Entity resolution is the process of recognizing that different mentions refer to the same real-world thing. For example:
- "Acme Corp", "Acme Corporation", "Acme" → same customer
- "auth timeout", "login bug", "PROD-1234" → same issue (if they actually are)
- "SSO", "Single Sign-On", "SAML integration" → same feature

### How accurate is it?

The target is >85% auto-resolution accuracy within 30 days and >92% within 90 days. Accuracy improves continuously as you provide feedback on entity merge decisions.

### What happens when the system isn't sure?

Uncertain matches are queued for human review. You'll see them when you ask "Show me entity reviews." They're bucketed by confidence:
- High confidence (>85%): Quick approvals
- Medium (60-85%): Needs your judgment
- Low (<60%): Likely different, quick rejections

### How does my feedback improve the system?

Every merge/reject/alias decision you make:
1. Immediately updates the knowledge graph
2. Adjusts matching weights for similar future cases
3. Gets incorporated into the entity resolution model within 24 hours
4. Is recorded in an immutable audit trail

Over time, the system makes fewer mistakes and needs less of your time.

### Can I undo a merge?

Yes. Use the "split entity" command to separate incorrectly merged entities. The system will remember the split decision for future matching.

---

## Queries & Intelligence

### What kinds of questions can I ask?

Anything about your product context:
- Customer impact: "Which customers are affected by issue X?"
- Trends: "What issues are growing fastest this month?"
- Heatmaps: "Show me a heatmap of issues by customer"
- Profiles: "Tell me everything about Customer Y"
- Strategic: "What should be on our roadmap for next quarter?"
- Provenance: "Where did this insight come from?"
- What-if: "If we fix issue X, how many customers are impacted?"

### How fresh is the data?

Slack signals are ingested within minutes of being posted. Manually uploaded documents are processed within 1-3 minutes. Every response indicates data freshness.

### Can I trust the answers?

Every insight includes a confidence score and a provenance chain — the trail from the answer back to the source signals. You can always verify where a number came from. If the system is unsure, it tells you.

### What if the system gives a wrong answer?

Wrong answers usually stem from entity resolution errors (two things incorrectly merged or not merged). Review entity merges regularly and provide feedback. You can also directly correct entity classifications.

---

## Artifacts & Reports

### What artifacts can the system generate?

- PRDs (with customer evidence and provenance)
- JIRA issues (with impact summary)
- Executive summaries
- Customer impact reports
- Competitive intelligence reports
- Weekly digests
- Roadmap priority recommendations

### Are generated artifacts ready to share?

Yes. Reports generated via "generate shareable report" are self-contained — they include all context needed to understand the findings without access to PM Intelligence. PRDs and JIRA issues include provenance references.

### Can I customize the report format?

Report types are predefined (weekly digest, customer health, issue summary, trend analysis, executive brief, competitive intel). Within those types, you can scope by product area, time window, and entity filters. Custom templates are planned for V3.

---

## Agents & Automation

### What are agents?

Agents are AI-powered processes that interact with PM Intelligence programmatically. They can monitor for events, generate reports on schedule, sync data with JIRA, or flag urgent issues — all without human intervention.

### Which agents are available?

| Agent | What It Does |
|-------|-------------|
| **Triage Agent** | Monitors signals and flags critical issues to the PM |
| **Report Scheduler** | Generates weekly digests and delivers them on schedule |
| **JIRA Sync Agent** | Syncs entity status with JIRA (bi-directional) |
| **Slack Alert Bot** | Posts alerts to Slack when critical signals are detected |
| **Data Quality Agent** | Monitors entity resolution accuracy and proposes cleanup |
| **Sprint Planning Agent** | Reads knowledge graph to suggest sprint priorities |
| **Stakeholder Access Agent** | Serves read-only queries from non-PM stakeholders |

### Can agents modify the knowledge graph?

No. Agents can read data, ingest new signals (which go through the full pipeline), and **propose** changes. All proposed changes require human review. Agents cannot merge entities, delete data, or modify existing records.

### Can I build my own agent?

Yes. Register an agent via the Agent Gateway, get an API key, and use the REST API or A2A protocol. See the API Reference for details.

### How do I monitor agent quality?

Ask: "Show me agent health and costs." You'll see per-agent accuracy, response times, uptime, and monthly spend. If quality degrades, you can roll back an agent to a previous version.

---

## Security & Privacy

### Who can access the system?

V2 is a single-PM deployment. All human interaction goes through Claude Code/Cowork MCP tools. Agent access requires a unique API key per agent with scoped permissions.

### Is PII protected?

PII is detected during extraction and flagged in metadata. In V2, PII is stored as-is (acceptable for single-PM local deployment). V3 adds PII masking and encryption at rest.

### Are my conversations with Claude logged?

The system logs the MCP tool calls and their results (for debugging and audit). It does not log your full conversation with Claude — that's handled by Claude Code/Cowork.

### Can agents see all data?

Each agent has scoped permissions (read, write, events). Stakeholder agents have even more restricted access — limited to specific product areas configured by the PM.

---

## Troubleshooting

### The system isn't responding to my questions

1. Ask: "What's the system status?" to check service health
2. If services are down, check Docker containers: `docker compose ps`
3. Check logs in `data/logs/` for errors
4. See `docs/v2/TROUBLESHOOTING.md` for detailed guidance

### Entity resolution seems wrong

1. Review pending merges: "Show me entity reviews"
2. Check entity stats: "What are the entity resolution stats?"
3. Split incorrectly merged entities: "Split entity X into Y and Z"
4. Your corrections immediately improve future accuracy

### A document upload failed

Common causes:
- File exceeds 50MB limit
- Unsupported file format
- Corrupted or encrypted file
- File contains executable macros (blocked for security)

Check: "Are there any failed processing items?" to see the DLQ.

### Data seems stale

1. Check when data was last ingested: "When was the last signal from Slack?"
2. Verify Slack monitoring is active: check system health
3. For manual sources (transcripts, documents), you need to upload them — they don't auto-sync

---

## Performance

### How fast are queries?

Target: <5 seconds for 95th percentile MCP tool responses. Simple lookups are typically <1 second. Complex heatmaps and trend analyses may take 2-5 seconds.

### How many entities can the system handle?

V2 is designed for 500-1000+ canonical entities (customers, features, issues, themes). At 12 months, capacity planning estimates ~2000 entities and ~50,000 signals. Beyond that, performance tuning may be needed.

### What are the infrastructure requirements?

| Resource | Minimum |
|----------|---------|
| RAM | 8GB |
| CPU | 4 cores |
| Disk | 10GB |
| Python | 3.10+ |
| Node.js | 18+ |
| Docker | Latest |

---

## Future Plans

### What's coming in V3?

Planned V3 features include:
- Custom UI dashboard (if MCP proves insufficient)
- Multi-PM / multi-tenant support
- PII masking and encryption at rest
- Real-time streaming ingestion
- JIRA and Confluence MCP connectors (post TBD configuration)
- Load testing and performance optimization
- Feature flag service (for fine-grained feature control)
- Advanced agent capabilities (autonomous triage, proactive recommendations)
