# V2 UX & Interaction Design

> **Version:** 2.3 (Updated — stakeholder self-service, agent management UX) (Updated — persona-driven design, artifact templates, gap fixes)
> **Date:** 2026-02-09
> **Status:** Approved for Build

---

## 1. Design Philosophy

### 1.1 Conversation-First + Web UI (V2)

The system serves **multiple personas** (see §1.3) through **ChatGPT Enterprise Actions**, **Claude MCP tools**, and a lightweight **Web UI** at `/ui`.

**Why:**
- Conversation remains the fastest path to answers and artifacts
- UI enables onboarding, admin workflows, and visual exploration
- ChatGPT Actions standardize tool access for enterprise teams
- MCP remains available for Claude users and existing workflows

**The primary interface is still natural language, with the UI providing structured views and controls.**

### 1.2 Conversation and UI as Interface

The interaction model is:
```
User speaks naturally → ChatGPT/Claude selects appropriate tool(s) → 
System returns structured data → Claude synthesizes into natural language response
```

The user never needs to know which tool is being called. ChatGPT/Claude handles tool selection, parameter mapping, and response formatting.

### 1.3 Personas Driving UX Decisions

The UX design is informed by four personas (fully defined in `01_MASTER_PRD.md` §4):

| Persona | Role | Interaction Style | Frequency | Key UX Need |
|---------|------|-------------------|-----------|-------------|
| **PM — Daily Driver** | IC Product Manager | Deep, frequent, operational | Daily | Speed to insight, entity feedback, artifact generation |
| **PM Leader — Strategist** | VP Product / PM Director | Broad, aggregated, strategic | Weekly | Portfolio heatmaps, trend reports, shareable summaries |
| **New PM — Ramp-Up** | Onboarding PM | Exploratory, learning, comprehensive | Daily (first 2-4 weeks) | Context absorption, knowledge graph browsing, entity glossary |
| **Stakeholder — Consumer** | Eng Manager, Designer, Sales, CS | Indirect (receives PM-generated artifacts) | Never (direct) | Artifact quality, data backing, clear structure |
| **Ops/Admin** | Platform, IT, Security | Operational oversight | Weekly | Health checks, event logs, access control |
| **Agent Builder** | Automation / Integration engineer | API-driven | Weekly | API keys, OpenAPI, event subscriptions |

**Design implication:** Every interaction pattern below is tagged with the persona(s) it serves. MCP tool responses must be rich enough for all persona needs without requiring persona-specific tool variants.

---

### 1.4 Web UI Views (V2)

The Web UI at `/ui` ships as a lightweight, role-based interface for quick exploration and admin workflows.

| Persona | Primary UI Views |
|---------|------------------|
| PM — Daily Driver | Signal search, customer profile, manual ingestion |
| PM Leader — Strategist | Heatmaps, trends, roadmap opportunities |
| New PM — Ramp-Up | Entity search and entity detail |
| Stakeholder — Consumer | Shareable report generation |
| Ops/Admin | System health, event history |
| Agent Builder | Agent registration, API key management |

---

### 1.5 UI Interaction Patterns

- **PM Dashboard:** search signals by query and filters, view customer profile, ingest manual signals.
- **PM Leader:** generate heatmaps, trends, and opportunity lists for weekly planning.
- **New PM:** browse entities and open detail views with aliases and provenance.
- **Stakeholder:** generate shareable reports for leadership, CS, and engineering.
- **Ops/Admin:** monitor system health and event history; register agents for integrations.

---

## 2. Interaction Patterns

### 2.1 Morning Briefing
**Personas:** PM (Daily Driver), PM Leader (Strategist)

```
PM: "What happened overnight?"

Claude internally calls:
  - get_trends(entity_type='issue', direction='emerging', window_days=1)
  - search_signals(date_from='yesterday', sort='relevance', limit=10)
  - review_pending_entities(limit=5)

Claude responds:
  "Here's your morning briefing:
   
   3 emerging issues since yesterday:
   1. Authentication timeout reports increased 40% (12 new signals from 4 customers)
   2. Dashboard loading performance complaints from 2 enterprise customers
   3. New feature request for bulk export in #product-feedback
   
   You have 5 entity reviews pending (3 high-confidence, 2 medium).
   
   Want me to dive into any of these, or should we handle the entity reviews first?"
```

**PM Leader variant:**
```
PM Leader: "Give me the weekly portfolio summary"

Claude internally calls:
  - get_heatmap(dimension='issues_by_product_area', metric='severity_weighted', limit=20)
  - get_trends(entity_type='issue', direction='all', window_days=7)
  - get_trends(entity_type='customer', direction='declining', window_days=7)

Claude responds:
  "Weekly portfolio summary (Feb 3–9):
   
   Highest pain product areas:
   1. Authentication — 28 reports, 12 customers, trend: worsening (+40%)
   2. Dashboard — 17 reports, 8 customers, trend: stable
   3. API Gateway — 13 reports, 6 customers, trend: improving (-20%)
   
   Customer health changes:
   - 2 customers declined: Acme Corp (72→65), BigCorp (81→74)
   - 1 customer improved: DataFlow (68→75)
   
   Across all product areas, 4 new opportunities emerged this week.
   
   Want me to generate a shareable summary for the leadership team,
   or dive into a specific product area?"
```

### 2.2 Customer Deep-Dive
**Personas:** PM (Daily Driver), New PM (Ramp-Up)

```
PM: "Tell me everything about Acme Corporation"

Claude internally calls:
  - get_customer_profile(customer_name='Acme Corporation')

Claude responds:
  "Here's the Acme Corporation profile:
   
   Segment: Enterprise | Tier: Tier-1 | Health Score: 72 (declining)
   
   Features Used (8):
   - Authentication Service (daily)
   - Dashboard Analytics (weekly)
   - API Gateway (daily)
   ... [5 more]
   
   Active Issues (3):
   - Authentication Timeout (High severity, 12 reports, first reported Jan 15)
   - Dashboard Loading Slow (Medium, 5 reports)
   - Missing Bulk Export (Feature Gap, 3 mentions)
   
   Recent Signals (last 30 days): 23 total
   - 15 from #customer-support
   - 5 from meeting transcripts
   - 3 from sales team Slack
   
   Trend: Signal volume up 35% vs. previous 30 days. Sentiment declining.
   
   Want me to trace the auth timeout issue or generate a JIRA ticket for any of these?"
```

### 2.3 Heatmap Query
**Personas:** PM (Daily Driver), PM Leader (Strategist)

```
PM: "Show me a heatmap of top issues by customer"

Claude internally calls:
  - get_heatmap(dimension='issues_by_customer', metric='severity_weighted', limit=15)

Claude responds:
  "Top Issues by Customer (severity-weighted):

   Issue                    | Acme | BigCorp | DataFlow | TechStart | Total
   ─────────────────────────┼──────┼─────────┼──────────┼───────────┼──────
   Auth Timeout             |  12  |    8    |    5     |     3     |  28
   Dashboard Slow           |   5  |    3    |    7     |     2     |  17
   API Rate Limiting        |   2  |    6    |    1     |     4     |  13
   Missing Bulk Export      |   3  |    -    |    4     |     1     |   8
   
   Auth Timeout is the clear priority: 28 reports, 4 customers, all segments.
   
   Want me to generate a PRD or JIRA issues for the auth timeout opportunity?"
```

### 2.4 Entity Management
**Personas:** PM (Daily Driver)

```
PM: "Show me entity reviews"

Claude internally calls:
  - review_pending_entities(limit=10)

Claude responds:
  "You have 7 pending entity reviews:
   
   HIGH CONFIDENCE (quick approval):
   1. Customer: 'DataFlow Inc' → 'DataFlow Inc.' (89%) — punctuation only
   2. Feature: 'SSO' → 'Single Sign-On' (92%) — abbreviation
   3. Customer: 'TechStart' → 'TechStart.io' (85%) — domain vs. name
   
   MEDIUM CONFIDENCE (needs your judgment):
   4. Issue: 'login slow' → 'Authentication Timeout' (72%) — related but maybe different?
   5. Feature: 'export API' → 'Bulk Export' (68%) — could be different features
   
   LOW CONFIDENCE (likely different):
   6. Customer: 'Summit Health' → 'Summit Technologies' (45%) — same first word only
   7. Issue: 'UI glitch' → 'Dashboard Rendering Bug' (41%) — vague match
   
   Which would you like to review?"

PM: "Approve 1, 2, 3. For 4: no, login slow is a frontend perf issue, not auth timeout. 
     For 5: yes, export API is what we call Bulk Export. Reject 6 and 7."

Claude internally calls (sequence):
  - confirm_entity_merge(feedback_id=1)
  - confirm_entity_merge(feedback_id=2)  
  - confirm_entity_merge(feedback_id=3)
  - reject_entity_merge(feedback_id=4, notes="login slow is frontend perf, not auth timeout")
  - confirm_entity_merge(feedback_id=5)
  - reject_entity_merge(feedback_id=6)
  - reject_entity_merge(feedback_id=7)

Claude responds:
  "Done! 4 merged, 3 rejected. 
   
   I've added 'login slow' as a separate issue from 'Auth Timeout' — 
   I'll remember that distinction going forward.
   
   Entity resolution accuracy this week: 89% (91 auto-resolved correctly out of 102 total)"
```

### 2.5 Ingestion
**Personas:** PM (Daily Driver), New PM (Ramp-Up — bulk historical ingestion)

```
PM: "I just had a call with Acme Corp about their auth issues. Here's the transcript."
[PM pastes transcript text]

Claude internally calls:
  - ingest_transcript(
      title='Acme Corp Call - Auth Issues',
      content='[pasted text]',
      meeting_type='customer_call',
      customer='Acme Corporation',
      date='2026-02-09'
    )

Claude responds:
  "Transcript ingested. Here's what I found:
   
   12 segments processed (8 relevant, 4 filtered as social/filler)
   
   Entities extracted:
   - Customer: Acme Corporation (matched existing)
   - Issues: Authentication Timeout (3 mentions), Dashboard Performance (1 mention)
   - Feature: SSO Integration (2 mentions, NEW feature request)
   - Stakeholder: John Smith, VP Engineering at Acme (new)
   
   Action items detected:
   1. 'Follow up on auth timeout timeline' (assigned: PM)
   2. 'Share SSO integration roadmap' (assigned: PM)
   
   Knowledge graph updated. Acme's signal count is now 26 (was 23).
   
   Want me to add 'SSO Integration' as a new feature entity or does it map to an existing feature?"
```

### 2.6 Knowledge Graph Exploration (Onboarding)
**Personas:** New PM (Ramp-Up — primary), PM (Daily Driver — occasional)

This pattern serves the "I just joined, teach me everything" use case. The New PM doesn't know what to ask because they don't know what exists.

```
New PM: "I just took over the Payments product area. Give me the full picture."

Claude internally calls:
  - get_knowledge_summary(scope='product_area', name='Payments')
  - browse_knowledge_graph(root_entity_type='feature', filter_area='Payments', depth=2)
  - get_trends(entity_type='all', window_days=30, filter_area='Payments')

Claude responds:
  "Here's the full context for the Payments product area:
   
   CUSTOMERS (12 active):
   Top 3 by signal volume: Acme Corp (34 signals), BigCorp (21), TechStart (15)
   Enterprise: 5 | Mid-Market: 4 | SMB: 3
   
   FEATURES (8 tracked):
   - Payment Processing (core, 45 mentions)
   - Invoice Generation (mature, 23 mentions)
   - Subscription Billing (growing, 18 mentions)
   - Refund API (new, 7 mentions)
   - ... [4 more]
   
   ACTIVE ISSUES (6):
   - Payment timeout on large batches (Critical, 8 customers)
   - Invoice PDF rendering broken in Safari (High, 3 customers)
   - ... [4 more]
   
   RECENT TRENDS (last 30 days):
   - Subscription billing mentions up 60% (growing demand)
   - Payment timeout reports up 25% (worsening)
   - Refund API is a new entity — first appeared 12 days ago
   
   KEY STAKEHOLDERS mentioned in signals:
   - Sarah Chen (VP Eng at Acme) — mentioned 7 times
   - Mike Rodriguez (Billing Lead at BigCorp) — mentioned 5 times
   
   OPEN OPPORTUNITIES (3):
   1. Subscription Billing enhancements (Impact: High, 6 customers requesting)
   2. Batch payment performance fix (Impact: Critical, 8 customers)
   3. Refund self-service (Impact: Medium, 3 customers)
   
   This is your starting landscape. Want me to dive deeper into any area,
   show you the entity glossary, or walk through the top opportunity?"
```

```
New PM: "Show me the entity glossary for Payments"

Claude internally calls:
  - browse_knowledge_graph(root_entity_type='all', filter_area='Payments', 
      include_aliases=true, include_descriptions=true)

Claude responds:
  "Entity Glossary — Payments Product Area:
   
   CUSTOMERS:
   - 'Acme Corporation' (aliases: Acme Corp, Acme, ACME Inc) — Enterprise, Tier 1
   - 'BigCorp' (aliases: Big Corporation, BigCorp Ltd) — Enterprise, Tier 1
   ... [10 more]
   
   FEATURES:
   - 'Payment Processing' (aliases: payments, payment service, pay API) — Core billing feature
   - 'Invoice Generation' (aliases: invoicing, invoice API, PDF invoices) — Document generation
   ... [6 more]
   
   ISSUES:
   - 'Payment Timeout' (aliases: payment slow, batch timeout, pay timeout) — Performance issue
   - 'Invoice Rendering Bug' (aliases: PDF broken, Safari invoice) — Frontend display bug
   ... [4 more]
   
   This glossary shows how the system recognizes each entity. If you notice
   something incorrect — like a wrong alias or a missing entity — just tell me
   and I'll fix it."
```

### 2.7 Batch Entity Review Session
**Personas:** PM (Daily Driver)

When the entity review queue grows large, a structured batch review workflow is more efficient than one-at-a-time.

```
PM: "I have time for entity reviews, let's do a batch session"

Claude internally calls:
  - review_pending_entities(limit=25, sort_by='confidence_desc')

Claude responds:
  "Let's do a batch review. You have 23 pending.
   
   I'll group them by confidence level so we can go quickly.
   
   ━━━ AUTO-APPROVABLE (High confidence, >85%) — 11 items ━━━
   These are almost certainly correct. Say 'approve all' or flag exceptions:
   
    1. 'DataFlow Inc' → 'DataFlow Inc.' (89%) — punctuation
    2. 'SSO' → 'Single Sign-On' (92%) — abbreviation
    3. 'auth' → 'Authentication Service' (91%) — alias
    4. 'TechStart' → 'TechStart.io' (85%) — domain suffix
    ... [7 more]
   
   ━━━ NEEDS JUDGMENT (Medium confidence, 60-85%) — 8 items ━━━
   These need your input. I'll show each with context:
   
    12. 'login slow' → 'Authentication Timeout' (72%)
        Context: 3 signals about frontend rendering, 2 about auth
        My take: Probably DIFFERENT — the frontend perf signals suggest a separate issue
    
    13. 'export API' → 'Bulk Export' (68%)
        Context: All 4 signals discuss the same CSV export feature
        My take: Probably SAME — different names for the same capability
    ... [6 more]
   
   ━━━ LIKELY DIFFERENT (Low confidence, <60%) — 4 items ━━━
    20. 'Summit Health' → 'Summit Technologies' (45%) — same first word
    ... [3 more]
   
   Quick actions: 'approve high confidence', 'reject low confidence', 
   or review individually."

PM: "Approve high confidence. For medium: agree with your takes on 12 and 13.
     Show me 14-19. Reject all low confidence."

Claude: [processes batch efficiently, shows medium items for individual review]
```

### 2.8 Shareable Report Generation
**Personas:** PM Leader (Strategist — primary), PM (Daily Driver)
**Impact:** Stakeholder (Consumer — receives the output)

This pattern generates artifacts intended for people who DON'T use the system. The output must stand alone without system context.

```
PM Leader: "Generate a customer health report for the leadership team meeting"

Claude internally calls:
  - generate_shareable_report(
      report_type='customer_health_summary',
      time_window_days=30,
      format='executive_summary',
      audience='leadership'
    )

Claude responds:
  "Here's the executive customer health report:
   
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   CUSTOMER HEALTH REPORT — January 10 – February 9, 2026
   Prepared for Leadership Team
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   
   EXECUTIVE SUMMARY
   • 3 of 45 tracked customers show declining health (Acme, BigCorp, DataFlow)
   • Top systemic issue: Authentication Timeout — 28 reports, 12 customers
   • 1 emerging opportunity: Subscription Billing (6 enterprise customers requesting)
   
   CUSTOMER HEALTH CHANGES
   | Customer    | Prev Score | Current | Δ    | Primary Driver              |
   |-------------|-----------|---------|------|-----------------------------|
   | Acme Corp   | 72        | 65      | -7   | Auth timeout (12 reports)   |
   | BigCorp     | 81        | 74      | -7   | API rate limiting (6 rpts)  |
   | DataFlow    | 68        | 75      | +7   | Dashboard fix resolved      |
   
   TOP ISSUES BY CUSTOMER IMPACT
   1. Authentication Timeout — 12 customers, 28 reports, worsening
   2. Dashboard Performance — 8 customers, 17 reports, stable
   3. API Rate Limiting — 6 customers, 13 reports, improving
   
   STRATEGIC OPPORTUNITIES
   1. Subscription Billing enhancements — 6 enterprise customers, est. high revenue impact
   2. Bulk Export capability — 4 customers, competitive gap
   
   DATA SOURCES: 847 signals from Slack (612), meeting transcripts (145), 
   documents (90). Entity resolution accuracy: 91%.
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   
   This is ready to paste into an email or slide deck.
   Want me to adjust the focus, add/remove sections, or generate a 
   product-area-specific version?"
```

### 2.9 Artifact Generation with Stakeholder Context
**Personas:** PM (Daily Driver)
**Impact:** Stakeholder (Consumer — receives PRD/JIRA/RFC)

Artifacts generated for cross-functional stakeholders must include data provenance and be self-contained.

```
PM: "Generate a PRD for the Authentication Timeout fix"

Claude internally calls:
  - generate_artifact(
      artifact_type='prd',
      opportunity_id='OPP-127',
      include_provenance=true,
      audience='engineering'
    )

Claude responds:
  "Here's the PRD draft:
   
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   PRD: Authentication Timeout Resolution
   Author: [PM Name] | Date: 2026-02-09 | Status: Draft
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   
   PROBLEM STATEMENT
   Authentication timeout errors affect 12 of 45 tracked customers (27%),
   generating 28 support reports in the last 30 days. The issue is worsening:
   +40% report volume vs. prior 30 days. Affected customers span all segments
   (Enterprise: 5, Mid-Market: 4, SMB: 3).
   
   Evidence: 28 signals from Slack #customer-support (18), meeting transcripts
   (7), and escalation emails (3). First reported: Jan 15, 2026.
   
   CUSTOMER IMPACT
   | Customer       | Reports | Severity | First Report | Segment    |
   |---------------|---------|----------|-------------|------------|
   | Acme Corp     | 12      | Critical | Jan 15      | Enterprise |
   | BigCorp       | 8       | High     | Jan 22      | Enterprise |
   | ... [10 more rows]
   
   PROPOSED SOLUTION
   [To be filled by PM — system provides context, not prescriptive solutions]
   
   SUCCESS METRICS
   - Timeout reports reduced by 80% within 2 weeks of deployment
   - Affected customer health scores recover to pre-incident baseline
   - Zero P1 escalations related to auth timeout
   
   PRIORITY JUSTIFICATION
   - Impact Score: 9.2/10 (12 customers, all segments, worsening trend)
   - Confidence: High (28 signals from 4 independent sources)
   - Strategic Alignment: Core reliability — affects trust and retention
   
   SOURCE PROVENANCE
   This PRD was generated from 28 signals across 3 sources.
   Full signal list available via: get_provenance(opportunity_id='OPP-127')
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   
   The 'Proposed Solution' section is left for you to fill in.
   Want me to also generate JIRA issues for the engineering team?"
```

### 2.10 First-Day Onboarding Flow
**Personas:** New PM (Ramp-Up — primary)

A guided sequence for a PM's first interaction with the system. This is not a single query but a suggested conversation flow.

```
New PM: "I just joined as the PM for the API Platform. How do I get started?"

Claude responds:
  "Welcome! Let me help you get up to speed on the API Platform area.
   Here's a suggested onboarding sequence — we can go at your pace:
   
   Step 1: LANDSCAPE OVERVIEW (let's start here)
   I'll give you the full picture: customers, features, issues, and trends.
   
   Step 2: ENTITY GLOSSARY
   Learn the vocabulary the system uses — canonical names, aliases, and 
   what each entity means. This helps you recognize things across sources.
   
   Step 3: TOP PRIORITIES
   See the current opportunity stack with scoring and customer impact.
   
   Step 4: RECENT HISTORY
   Review what happened in the last 30-60 days: new issues, resolved items,
   customer sentiment shifts.
   
   Step 5: KEY STAKEHOLDERS
   See which customer contacts, internal team members, and escalation
   paths appear most frequently in signals.
   
   Ready for Step 1? Or do you want to jump to a specific area?"

New PM: "Let's start with Step 1"
Claude: [proceeds with get_knowledge_summary for API Platform area]
```

---

## 3. Response Format Guidelines

### 3.1 MCP Tool Response Formatting

MCP tools return structured JSON. Claude formats this for the PM. Guidelines for tool responses:

```typescript
// DO: Return structured data that Claude can format naturally
{
  data: {
    customers: [
      { name: "Acme Corp", issues: 12, features: 8, trend: "declining" },
      { name: "BigCorp", issues: 8, features: 5, trend: "stable" }
    ],
    total_count: 2
  },
  metadata: { confidence: 0.92, query_time_ms: 150 }
}

// DON'T: Return pre-formatted text (let Claude handle formatting)
// DON'T: Return raw SQL results or Neo4j records
// DON'T: Return internal IDs without human-readable names
```

### 3.2 Error Response Formatting

```typescript
// When entity not found, suggest alternatives
{
  error: {
    code: "NOT_FOUND",
    message: "No customer matching 'Acma' found",
    suggestions: ["Acme Corporation", "Acuma Technologies"],
    hint: "Did you mean 'Acme Corporation'?"
  }
}
```

---

## 4. Lessons from OpenAI Frontier UI Patterns

### 4.1 Patterns We Adopt (via MCP, not UI)

| Frontier Pattern | Our MCP Equivalent |
|---|---|
| **Business Context Layer** | Knowledge Graph is our context layer, exposed via MCP tools |
| **Connector Registry UI** | `source_registry_service` exposed via `get_system_health` MCP tool |
| **Evaluation Dashboard** | `get_entity_resolution_stats` MCP tool returns accuracy metrics |
| **Agent trace/observability** | `audit_log` + `get_provenance` MCP tool |

### 4.2 Patterns We Defer to V3

| Frontier Pattern | Why Deferred |
|---|---|
| Visual Agent Builder (drag-and-drop) | We don't build agents — Claude Code IS the agent |
| ChatKit (embeddable chat) | Claude Code/Cowork already provide the chat interface |
| Custom dashboard | Premature investment; MCP-first approach validates needs first |
| Connector Registry UI | CLI/MCP sufficient for single PM |

### 4.3 V3 UI Considerations

If V3 adds a dashboard, adopt these Frontier-inspired patterns, prioritized by persona need:

| V3 Feature | Primary Persona | Justification |
|------------|----------------|---------------|
| **Knowledge graph visualizer** | New PM (Ramp-Up) | Visual exploration dramatically accelerates onboarding; hard to replicate in text |
| **Entity review queue** (one-click approve/reject) | PM (Daily Driver) | Batch review is faster with a GUI than conversational back-and-forth |
| **Customer health dashboard** | PM Leader (Strategist) | Portfolio-level views benefit from visual layout and persistent display |
| **Live signal feed** | PM (Daily Driver) | Streaming real-time entity tagging; useful for "passive monitoring" |
| **Accuracy dashboard** | PM (Daily Driver) | ER accuracy trending over time, feedback impact visualization |
| **Shareable report builder** | PM Leader, Stakeholder (Consumer) | Drag-and-drop sections for custom executive reports |
| **Single pane of glass** (all sources + pipeline health) | All personas | System-wide status at a glance |

**V3 UI Priority:** Knowledge graph visualizer and entity review queue should be built first — they address the largest gaps in the text-only V2 experience, particularly for the New PM and batch-review workflows.

---

## 5. Artifact Templates

### 5.1 Design Principles for Artifacts

Artifacts are the bridge between the system (used by PMs) and stakeholders (who never touch the system). Every artifact must:

1. **Stand alone** — Readable without system access or context
2. **Cite sources** — Every claim backed by signal count, source type, and confidence
3. **Declare freshness** — Include data date range and staleness warning if applicable
4. **Match audience** — Language and detail level calibrated to the recipient (engineering vs. leadership vs. CS/Sales)
5. **Leave room for judgment** — System provides data and structure; PM fills in strategy and recommendations

### 5.2 Supported Artifact Types

| Artifact Type | Primary Audience | Key Sections | MCP Tool |
|--------------|-----------------|-------------|----------|
| **PRD** | Engineering, Design | Problem Statement (data-backed), Customer Impact, Success Metrics, Priority Justification, Provenance | `generate_artifact(type='prd')` |
| **JIRA Issue** | Engineering | Summary, Context, Acceptance Criteria, Customer Evidence, Priority, Linked Entities | `generate_artifact(type='jira')` |
| **Customer Health Report** | Leadership, CS/Sales | Exec Summary, Health Changes, Top Issues, Opportunities, Data Sources | `generate_shareable_report(type='customer_health_summary')` |
| **Roadmap Summary** | Leadership, All stakeholders | Prioritized Items, Scoring Breakdown, Customer Impact, Strategic Alignment | `generate_shareable_report(type='roadmap_summary')` |
| **Customer Impact Brief** | CS/Sales | Customer Profile, Active Issues, Feature Gaps, Action Items | `generate_shareable_report(type='customer_impact_brief')` |
| **Weekly Digest** | PM Leader | Portfolio Changes, New Issues, Resolved Items, ER Accuracy, Ingestion Stats | `generate_shareable_report(type='weekly_digest')` |
| **Competitive Intel Summary** | PM, PM Leader | Competitor Mentions, Feature Gap Analysis, Customer Sentiment Comparison | `generate_shareable_report(type='competitive_intel')` |

### 5.3 Template Structure — PRD

```
━━━ PRD: [Title] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Author: [PM Name] | Date: [auto] | Status: Draft
Data range: [start_date] – [end_date]

1. PROBLEM STATEMENT
   [Auto-generated from signal synthesis]
   Evidence: [N] signals from [sources]. Confidence: [high/medium/low].

2. CUSTOMER IMPACT
   [Table: Customer, Reports, Severity, First Report, Segment]
   Total: [N] customers, [N] reports

3. PROPOSED SOLUTION
   [Blank — PM fills in]

4. SUCCESS METRICS
   [Auto-suggested based on issue type and historical patterns]

5. PRIORITY JUSTIFICATION
   Impact: [score], Confidence: [score], Strategic: [alignment]
   Scoring methodology: [brief explanation]

6. SOURCE PROVENANCE
   Signal breakdown by source type.
   Full evidence chain available via get_provenance.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### 5.4 Template Structure — Executive Summary / Shareable Report

```
━━━ [REPORT TITLE] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Prepared for: [Audience] | Period: [date range]
Generated: [timestamp] | Data freshness: [age of most recent signal]

EXECUTIVE SUMMARY (3-5 bullet points max)
• [Key finding 1]
• [Key finding 2]
• [Key finding 3]

[BODY SECTIONS — varies by report type]

DATA METHODOLOGY
Sources: [N] signals from [source breakdown]
Entity resolution accuracy: [N]%
Confidence: [methodology note]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### 5.5 Audience-Specific Language Guidelines

| Audience | Language Level | Detail Level | What to Include | What to Exclude |
|----------|---------------|-------------|-----------------|-----------------|
| Engineering | Technical | High detail | Specific error types, reproduction signals, customer env details | Business strategy, revenue impact |
| Design | User-centric | Medium detail | User quotes, behavior patterns, pain descriptions | Technical root causes, raw signal counts |
| Leadership | Strategic | Summary only | Trend direction, customer count, revenue risk, opportunity size | Technical details, individual signals |
| CS/Sales | Customer-facing | Medium detail | Customer names, issue status, resolution timeline, contact history | Internal scoring, ER accuracy |

---

## 6. Handling Ambiguous Queries
**Personas:** All direct users (PM, PM Leader, New PM)

### 6.1 Entity Disambiguation

When a user's query matches multiple entities, Claude presents candidates for clarification:

```
PM: "What's happening with Acme?"

Claude (internally: search found Customer "Acme Corporation" and Feature "Acme Integration"):
  "I found two matches for 'Acme':
   1. Customer 'Acme Corporation' — 47 signals, enterprise tier
   2. Feature 'Acme Integration' — 3 signals, API feature
   
   Which one did you mean?"

PM: "The customer"
Claude: [proceeds with get_customer_profile for Acme Corporation]
```

### 6.2 Progressive Disclosure (Summary → Detail)

Large result sets return a summary first. User can drill down. This is especially important for the PM Leader persona who typically queries at a broader scope.

```
PM Leader: "What are all the issues our customers face?"

Claude (gets heatmap with 87 issues):
  "There are 87 active issues across 45 customers. Here's the top-level view:
   
   Critical (3 issues, 28 customers affected):
   1. Authentication Timeout — 12 customers, 28 reports
   2. API Rate Limiting — 8 customers, 13 reports
   3. Data Loss on Export — 8 customers, 11 reports
   
   High (12 issues), Medium (34 issues), Low (38 issues)
   
   Want me to dive into the critical issues, or show a specific severity level?"

PM Leader: "Tell me more about Authentication Timeout"
Claude: [calls get_issue_impact for detailed view]
```

### 6.3 Handling Empty Results

When queries return no results, suggest next steps. For New PMs, also offer to explain how the entity vocabulary works:

```
New PM: "Show me issues with the billing feature"

Claude (gets empty result):
  "No issues found for 'billing feature'. This could mean:
   1. The feature might have a different name in the system
   2. No issues have been reported for this feature yet
   
   Similar features I found: 'Payment Processing' (12 issues), 'Invoice Generation' (3 issues)
   
   Tip: The system maintains an entity glossary with canonical names and aliases.
   You can ask me to 'show the entity glossary' to see what vocabulary the system uses.
   
   Would you like to search one of those instead, or browse the glossary?"
```

### 6.4 Handling Degraded System State

When system components are down, be transparent with all users:

```
PM: "Show me the customer impact heatmap"

Claude (Neo4j circuit breaker is OPEN):
  "I can provide a partial answer. The knowledge graph is currently unavailable,
   so I'm using cached data from 2 hours ago. The numbers may not include
   the most recent signals.
   
   [shows cached heatmap data]
   
   For real-time data, I can try again in a few minutes when the graph service recovers."
```

---

## 7. Accessibility & Inclusivity

Even without a custom UI, ensure:
- MCP tool responses are screen-reader compatible (structured text, no visual-only data)
- Color-coded data (heatmaps) include text labels and numerical values
- All data is accessible via text-based queries (no chart-only insights)
- Response formatting works in both terminal (Claude Code) and desktop (Cowork) contexts
- Artifact templates use clear section headers and structured layout for readability across different consumption contexts

---

### 2.11 Agent Output Review (PM)
**Personas:** PM (Daily Driver)

PMs review and correct agent outputs to maintain quality and improve agent accuracy over time:

```
PM: "Show me agent outputs to review"

Claude: "Here are 8 agent outputs pending your review:

📋 Triage Agent (5 outputs):
  1. Signal #4521 classified as P0 (auth service timeout — 3 customer reports)
     Confidence: 0.89 | Your call: [Accept ✓] [Correct ✏️] [Reject ✗]
  2. Signal #4522 classified as P1 (dashboard slow load — 1 report)
     Confidence: 0.72 | Your call: [Accept ✓] [Correct ✏️] [Reject ✗]
  ... (3 more)

📋 Competitive Intel Agent (2 outputs):
  1. Extracted competitor mention: 'Datadog' from web scrape signal #4530
     Your call: [Accept ✓] [Correct — not a competitor ✏️] [Reject ✗]
  ... (1 more)

📋 Data Quality Agent (1 output):
  1. Proposed cleanup: entity 'Login Widget v1' has 0 signals, 0 relationships
     Your call: [Accept cleanup ✓] [Keep entity ✗]

Triage Agent accuracy (30d): 94.2% | Competitive Intel: 87.1%"

PM: "Accept items 1, 3-5 from Triage. Correct item 2 — that's P2, not P1.
     Reject the Datadog extraction — they're a partner, not competitor.
     Accept the orphan cleanup."

Claude: "Done. Updated 8 items:
  - 5 accepted, 1 corrected (P1→P2), 1 rejected (false competitor), 1 cleanup approved
  - Triage Agent accuracy updated: 94.2% → 93.8% (correction counted)
  - Competitive Intel accuracy updated: 87.1% → 85.3%
  - 'Login Widget v1' queued for cleanup (will be removed in next ER cycle)"
```

### 2.12 Agent Health Dashboard (PM, PM Leader)
**Personas:** PM (Daily Driver), PM Leader (Strategist)

PMs monitor agent health, SLOs, costs, and take action when needed:

```
PM: "How are my agents doing?"

Claude: "Agent Health Summary (10 agents registered):

✅ Healthy (7):
  Triage Agent v1.0.0 — accuracy 94.2% (SLO: >95% ⚠️ close), latency p95: 1.2s, cost: $8.42/$20
  Report Scheduler v1.1.0 — reliability 100%, latency p95: 12s, cost: $14.20/$30
  Slack Alert Bot v1.0.0 — uptime 99.9%, latency p95: 0.4s, cost: $0.80/$2
  Data Quality Agent v1.0.0 — accuracy 91.0%, cost: $3.20/$10
  Sprint Planning Agent v1.0.0 — latency p95: 2.1s (read-only), cost: $1.50/$5
  Competitive Intel v1.0.0 — accuracy 85.3% (SLO: >85% ✅), cost: $9.80/$20
  Executive Briefing v1.0.0 — reliability 100%, cost: $11.00/$30

⚠️ Warning (2):
  JIRA Sync Agent v1.2.0 — response time 8.2s (SLO: <5s) — JIRA API timeouts
    SLO breach count: 2/7 days
  CS Agent v1.0.0 — accuracy 88.0% (SLO: >90%) — recent false positive health alerts
    SLO breach count: 3/7 days

🔴 Paused (1):
  Workflow Agent v0.9.0 — cost limit reached ($5.10/$5.00)
    Paused since: 2026-02-07. Resets: 2026-03-01.

Total monthly cost: $62.42 (all agents)"

PM: "Roll back JIRA Sync to v1.1.0 — those timeouts started after the upgrade"

Claude: "Rolling back JIRA Sync Agent from v1.2.0 to v1.1.0...
  ✓ Performance snapshot saved for v1.2.0
  ✓ Config restored from v1.1.0
  ✓ SLO breach counter reset
  ✓ Agent restarted with previous config
  Monitoring for 24 hours. I'll alert you if issues persist."
```

### 2.13 Stakeholder Self-Service Query (Stakeholder)
**Personas:** Stakeholder (Consumer)

Stakeholders can query the system directly for simple factual questions without involving the PM:

```
Engineering Manager (via Stakeholder Access Agent):
  "Which customers are affected by the auth timeout issue?"

System: "Auth Timeout Issue — Customer Impact:
  12 customers affected (based on 47 signals from 3 sources)
  
  Top affected:
  1. Acme Corp — 8 reports, severity: high, since 2026-01-15
  2. GlobalTech — 6 reports, severity: high, since 2026-01-18
  3. StartupCo — 4 reports, severity: medium, since 2026-01-22
  ... (9 more)
  
  Current status: In Progress (JIRA-1234)
  Data freshness: Updated 2 hours ago
  
  ℹ️ For detailed signal analysis or to request action, contact your PM."
```

```
Sales Lead (via Stakeholder Access Agent):
  "What does customer Acme Corp use and value?"

System: "Acme Corporation — Customer Profile Summary:
  Health Score: 72/100 (declining — was 79 last month)
  
  Features Used: Authentication (heavy), API Gateway (moderate), Dashboard (light)
  Top Issues: Auth timeout (active, high severity), API rate limiting (resolved)
  
  Key Signals (last 30 days):
  - 8 auth timeout reports (escalating)
  - 3 positive mentions of new dashboard features
  - 1 feature request for SSO integration
  
  ℹ️ This is a read-only summary. For deeper analysis, contact your PM."
```

**Design principles for stakeholder UX:**
- **Simple, direct answers** — no progressive disclosure, no "would you like to explore more?"
- **Always include data freshness** — stakeholders must know how current the data is
- **Always link to PM** — "For more detail, contact your PM" on every response
- **Scoped access** — stakeholders only see their PM-configured product areas
- **No entity jargon** — use plain language, not canonical entity names
- **No raw signals** — stakeholders see aggregated data, not individual signal content

---

## 8. Persona-Specific UX Summary

| Aspect | PM (Daily Driver) | PM Leader (Strategist) | New PM (Ramp-Up) | Stakeholder (Consumer) |
|--------|:--:|:--:|:--:|:--:|
| **Primary interaction patterns** | §2.1–2.5, §2.7, §2.11 | §2.1 (variant), §2.3, §2.8, §2.12 | §2.6, §2.10 | §2.13 (Stakeholder Self-Service) |
| **Query scope** | Single product area, specific entities | Portfolio-wide, aggregate | Exploratory, broad then narrow | Scoped to PM-configured product area |
| **Typical session length** | 5–15 min, multiple per day | 15–30 min, weekly | 30–60 min, daily (first weeks) | 2–5 min, ad-hoc |
| **Feedback contribution** | High (entity reviews, corrections, agent output feedback) | Low (occasional overrides) | Low (learning phase) | None |
| **Artifact generation** | Regular (PRDs, JIRA) | Regular (reports, summaries) | Rare (learning phase) | Receives artifacts |
| **Key tools** | search_signals, review_pending_entities, review_agent_outputs, generate_artifact | get_heatmap, generate_shareable_report, list_registered_agents | browse_knowledge_graph, get_knowledge_summary | Stakeholder Access Agent (A2A/REST read-only) |
| **Empty result handling** | Suggest alternatives | Widen scope automatically | Offer glossary + guidance | "Ask your PM to expand data scope" |
| **Progressive disclosure** | Start with detail | Start with summary | Start with overview | Simple answer first, "ask PM for more" |
| **Error tolerance** | Low (expects speed) | Medium (expects completeness) | High (still learning) | Very low (non-technical users) |

---

## 9. Identified Gaps & V2/V3 Roadmap

### 9.1 Gaps Addressed in This Version

| Gap | Resolution | Section |
|-----|-----------|---------|
| No onboarding experience for new PMs | Added §2.6 (Knowledge Graph Exploration) and §2.10 (First-Day Onboarding Flow) | §2.6, §2.10 |
| No batch entity review workflow | Added §2.7 (Batch Entity Review Session) | §2.7 |
| No shareable report generation patterns | Added §2.8 (Shareable Report Generation) with executive-ready templates | §2.8 |
| Artifacts not designed for non-PM audiences | Added §5 (Artifact Templates) with audience-specific language guidelines | §5 |
| PM Leader persona had no dedicated interaction patterns | Added PM Leader variant to Morning Briefing (§2.1) and dedicated patterns (§2.8) | §2.1, §2.8 |
| Stakeholder persona had no system impact | Stakeholder needs now drive artifact template design (§5) + self-service via Stakeholder Access Agent (§2.13) | §5, §2.13 |
| No persona-to-pattern mapping | Added persona tags to all patterns and summary matrix (§8) | §8 |

### 9.2 Gaps Remaining for V3

| Gap | Why Deferred | V3 Resolution |
|-----|-------------|---------------|
| Visual knowledge graph exploration | Text-based exploration works but is slower for spatial understanding | Interactive graph visualizer in V3 UI |
| Drag-and-drop report builder | Text templates are sufficient for V2 | Visual report composer in V3 |
| Real-time notification/alert UX | MCP is pull-based; push notifications need a different architecture | Webhook/notification system in V3 |
| Multi-PM collaboration patterns | V2 assumes single PM; no shared entity review or conflict resolution | Collaborative workspace in V3 |
| Undo/history for entity decisions | Currently no way to see a timeline of ER decisions and roll back | Decision audit log with rollback in V3 |
