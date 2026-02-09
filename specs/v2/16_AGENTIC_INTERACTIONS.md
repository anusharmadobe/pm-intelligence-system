# V2 Agentic Interactions — External Agent Design

> **Version:** 2.5 (Updated — all completeness gaps resolved: agent feedback, versioning, SLOs, cost, stakeholder access, A2A federation)
> **Date:** 2026-02-09
> **Status:** Approved for Build
> **Depends on:** 01_MASTER_PRD.md, 02_ARCHITECTURE.md, 05_MCP_SERVER.md, 09_SECURITY_GUARDRAILS.md

---

## 1. The Agentic Gap in V2

V2 was designed as a **human-initiated, pull-based system**: a human asks a question via Claude Code, and the system responds. No part of the system acts autonomously. No external system can subscribe to events or push actions.

This creates three fundamental limitations:

1. **No proactive intelligence.** The system knows about emerging issues but waits for the PM to ask. A critical issue could spike for 12 hours before the PM's next "morning briefing" query.
2. **No agent-to-system interoperability.** Other AI agents (sprint planners, CS bots, JIRA automations) cannot query or write to the knowledge graph. The system is an island.
3. **No event-driven workflows.** When entity resolution finds a high-confidence customer-at-risk signal, nothing happens until a human queries. There is no mechanism to trigger downstream actions.

**This document extends V2 to support agentic interactions** — both inbound (agents querying/writing to the system) and outbound (the system pushing events to agents).

---

## 2. Agent Taxonomy

### 2.1 Agent Classification

We define three classes of agent based on their relationship with the system:

| Class | Description | Trust Level | Examples |
|-------|-------------|-------------|---------|
| **Orchestrator Agent** | An AI host that routes human intent to the system via MCP. Already supported. | High (human-in-the-loop) | Claude Code, Claude Cowork, Cursor |
| **Autonomous Agent** | An AI agent that independently queries and writes to the system without human prompting. Acts on triggers, schedules, or events. | Medium (bounded autonomy) | Triage Bot, Report Scheduler, Sprint Planner Agent |
| **Integration Agent** | A deterministic system (not LLM-powered) that syncs data between the PM Intelligence System and external tools. | Medium (deterministic, auditable) | JIRA Sync Agent, Slack Alert Bot, Webhook Relay |

### 2.2 Agent Personas

| # | Agent Persona | Class | Interface | Direction | Trigger |
|---|---------------|-------|-----------|-----------|---------|
| A1 | **Triage Agent** | Autonomous | REST API + Event Subscription | Bidirectional | New signals ingested |
| A2 | **Report Scheduler Agent** | Autonomous | REST API | Outbound (reads system, pushes reports) | Cron schedule |
| A3 | **JIRA Sync Agent** | Integration | REST API | Bidirectional | JIRA webhook + system events |
| A4 | **Slack Alert Bot** | Integration | REST API + Event Subscription | Outbound (system → Slack) | System events |
| A5 | **Sprint Planning Agent** | Autonomous | REST API (read-only) | Inbound (reads system) | Sprint boundary (biweekly) |
| A6 | **Customer Success Agent** | Autonomous | REST API + Event Subscription | Bidirectional | Customer health change events |
| A7 | **Data Quality Agent** | Autonomous | REST API + Event Subscription | Bidirectional | Continuous (batch schedule) |
| A8 | **Competitive Intelligence Agent** | Autonomous | REST API (read-only) | Inbound (reads system) | New web scrape signals |
| A9 | **Workflow Automation Agent** | Integration | REST API | Bidirectional | External trigger (n8n, Zapier, Make) |
| A10 | **Executive Briefing Agent** | Autonomous | REST API | Outbound (reads system, pushes reports) | Cron schedule (weekly/monthly) |

---

## 3. Jobs to Be Done (JTBD) Framework

### 3.1 JTBD Structure

Each job follows the format:
> **When** [situation/trigger], **I want to** [motivation], **so I can** [expected outcome].

Jobs are tagged with functional, emotional, and social dimensions.

### 3.2 Human Persona Jobs

#### PM (Daily Driver)

| Job ID | Job Statement | Functional | Emotional | Social |
|--------|--------------|------------|-----------|--------|
| H-PM-1 | **When** I start my day, **I want to** get a synthesized briefing of overnight signals, **so I can** prioritize my morning work without reading 50 Slack messages | Aggregate signals by recency and severity | Feel in control, not overwhelmed | Be seen as on top of things in standups |
| H-PM-2 | **When** a customer escalation arrives, **I want to** instantly pull up that customer's full context, **so I can** respond with intelligence rather than scrambling | Retrieve customer profile, issues, feature usage, history | Feel confident and prepared | Demonstrate product mastery to stakeholders |
| H-PM-3 | **When** I need to write a PRD, **I want to** generate a data-backed first draft, **so I can** spend time on strategy, not data gathering | Produce PRD with customer evidence, signal counts, provenance | Feel productive, not bogged down | Deliver higher-quality artifacts than peers |
| H-PM-4 | **When** the system proposes entity merges, **I want to** review them efficiently in batches, **so I can** maintain data quality without it becoming a chore | Batch approve/reject with context | Feel that the system is getting smarter | Know the system improves from my corrections |
| H-PM-5 | **When** I leave for PTO or switch products, **I want to** know the knowledge graph retains my context, **so I can** resume without losing institutional memory | Persistent knowledge graph survives PM turnover | Feel safe, not anxious about losing context | Smooth handover impresses leadership |

#### PM Leader (Strategist)

| Job ID | Job Statement | Functional | Emotional | Social |
|--------|--------------|------------|-----------|--------|
| H-PL-1 | **When** I prepare for a leadership meeting, **I want to** generate an executive customer health report, **so I can** present data-driven insights instead of anecdotes | Aggregate heatmap, trends, customer health changes | Feel credible and strategic | Earn trust from exec team |
| H-PL-2 | **When** I need to allocate resources across products, **I want to** see cross-portfolio pain distribution, **so I can** direct engineering effort to highest customer impact | Portfolio-level heatmap with severity weighting | Feel confident in resource decisions | Demonstrate data-driven leadership |
| H-PL-3 | **When** a new PM joins, **I want to** point them at the knowledge graph for onboarding, **so I can** reduce my personal onboarding overhead | Onboarding flow with context dump | Relief from repetitive onboarding conversations | Show team that tooling accelerates ramp-up |

#### New PM (Ramp-Up)

| Job ID | Job Statement | Functional | Emotional | Social |
|--------|--------------|------------|-----------|--------|
| H-NP-1 | **When** I take over a product area, **I want to** get the full landscape in one conversation, **so I can** be productive in days, not weeks | Knowledge summary, entity glossary, priority stack | Feel confident, not lost | Prove competence to new team quickly |
| H-NP-2 | **When** I encounter unfamiliar entity vocabulary, **I want to** browse the entity glossary, **so I can** understand what canonical names mean | Entity browse with aliases and descriptions | Feel like I belong, not like an outsider | Use the right vocabulary in meetings |

#### Stakeholder (Consumer)

| Job ID | Job Statement | Functional | Emotional | Social |
|--------|--------------|------------|-----------|--------|
| H-SH-1 | **When** I receive a PRD from the PM, **I want to** see customer evidence and signal provenance, **so I can** trust the priority justification | Artifact with provenance section | Feel respected — PM brought data, not opinions | Build trust between PM and Engineering |
| H-SH-2 | **When** I need to plan my team's sprint, **I want to** understand customer impact of backlog items, **so I can** make informed trade-off decisions | Customer impact data per feature/issue | Feel empowered to make good trade-offs | Demonstrate customer awareness in sprint reviews |

---

### 3.3 Agent Persona Jobs

#### A1: Triage Agent

| Job ID | Job Statement | Functional | System Outcome |
|--------|--------------|------------|----------------|
| A-TR-1 | **When** a new batch of signals is ingested, **I want to** classify urgency and route critical signals, **so I can** ensure nothing critical sits in the queue unnoticed | Classify signals by urgency (P0/P1/P2). Flag P0 signals for immediate human attention via Slack Alert Bot | PM sees critical signals within minutes of ingestion, not hours |
| A-TR-2 | **When** signal volume spikes for an entity (>3x in 1 hour), **I want to** detect this anomaly and create an alert, **so I can** catch emerging incidents in real-time | Anomaly detection on signal volume per entity | Incident detection speed: hours → minutes |
| A-TR-3 | **When** a new signal mentions an entity not in the registry, **I want to** propose it for creation with context, **so I can** keep the entity registry growing without PM effort | New entity proposal with evidence chain | Entity coverage grows autonomously |

#### A2: Report Scheduler Agent

| Job ID | Job Statement | Functional | System Outcome |
|--------|--------------|------------|----------------|
| A-RS-1 | **When** it's Monday 8 AM, **I want to** generate and deliver the weekly digest to PM and PM Leader, **so I can** ensure leadership has data without anyone remembering to run a report | Call `generate_shareable_report(type='weekly_digest')`, deliver via Slack/email | Reports arrive predictably, no human effort to produce |
| A-RS-2 | **When** it's the 1st of the month, **I want to** generate the monthly customer health report, **so I can** provide a consistent longitudinal view | Call `generate_shareable_report(type='customer_health_summary', time_window_days=30)` | Monthly cadence with zero PM effort |
| A-RS-3 | **When** a PM Leader requests a recurring report, **I want to** schedule it and deliver it reliably, **so I can** establish trust in automated reporting | Configurable cron schedule per report type | PM Leader trusts the system enough to stop building reports manually |

#### A3: JIRA Sync Agent

| Job ID | Job Statement | Functional | System Outcome |
|--------|--------------|------------|----------------|
| A-JS-1 | **When** the PM generates a JIRA issue from the system, **I want to** create the actual JIRA ticket and link it back, **so I can** close the loop between insight and action | Create JIRA ticket via JIRA REST API. Store `jira_key` in the knowledge graph linked to the opportunity/entity | Single source of truth for PM work output |
| A-JS-2 | **When** a JIRA ticket status changes (in progress, done, closed), **I want to** sync that status back into the knowledge graph, **so I can** reflect engineering progress in PM queries | JIRA webhook → update entity/issue status in knowledge graph | "What's the status of the auth timeout fix?" returns live JIRA status |
| A-JS-3 | **When** a new JIRA ticket is created outside the system that mentions a tracked entity, **I want to** link it to the knowledge graph, **so I can** maintain completeness | JIRA webhook → entity matching → relationship creation | Knowledge graph reflects engineering reality, not just PM-initiated actions |

#### A4: Slack Alert Bot

| Job ID | Job Statement | Functional | System Outcome |
|--------|--------------|------------|----------------|
| A-SA-1 | **When** the Triage Agent flags a P0 signal, **I want to** post an alert in the PM's designated Slack channel, **so I can** ensure critical issues get immediate human attention | Format alert with entity context, signal source, suggested action | PM response time to critical issues: hours → minutes |
| A-SA-2 | **When** a customer health score drops below threshold, **I want to** notify the CS team in their Slack channel, **so I can** trigger proactive outreach | Customer health alert with decline reasons | CS team acts on declining health before customer escalates |
| A-SA-3 | **When** entity resolution has accumulated 20+ pending reviews, **I want to** nudge the PM in Slack, **so I can** prevent accuracy degradation from review backlog | Gentle nudge with queue size and estimated review time | PM stays on top of entity quality without remembering to check |

#### A5: Sprint Planning Agent

| Job ID | Job Statement | Functional | System Outcome |
|--------|--------------|------------|----------------|
| A-SP-1 | **When** a new sprint is starting, **I want to** pull the prioritized opportunity list with customer impact data, **so I can** provide engineering leads with PM-curated context for sprint planning | Read `get_roadmap_priorities` + `get_heatmap` + per-opportunity `get_provenance` | Sprint planning grounded in customer data, not just gut feel |
| A-SP-2 | **When** an engineering team asks "what should we build next?", **I want to** synthesize the top opportunities with scoring breakdown, **so I can** give a data-backed recommendation | Read multiple MCP tools, synthesize into recommendation | Engineering teams get PM intelligence without waiting for PM availability |

#### A6: Customer Success Agent

| Job ID | Job Statement | Functional | System Outcome |
|--------|--------------|------------|----------------|
| A-CS-1 | **When** a customer's health score declines for 2+ consecutive weeks, **I want to** generate a customer impact brief and notify the CS team, **so I can** enable proactive outreach | Subscribe to `customer_health_change` events. Call `generate_shareable_report(type='customer_impact_brief', filter_customer=X)` | At-risk customers get proactive attention |
| A-CS-2 | **When** a high-severity issue is resolved in JIRA, **I want to** notify CS of affected customers, **so I can** let CS close the loop with customers | Subscribe to JIRA Sync Agent's `issue_resolved` event. Look up affected customers via knowledge graph | CS closes the loop: "We fixed your issue" — improves NPS |

#### A7: Data Quality Agent

| Job ID | Job Statement | Functional | System Outcome |
|--------|--------------|------------|----------------|
| A-DQ-1 | **When** entity resolution accuracy drops below SLO (90%), **I want to** identify the degradation patterns and alert the PM, **so I can** prevent compounding errors in the knowledge graph | Monitor `get_entity_resolution_stats` daily. Compare to SLO. | Quality issues caught proactively, not after bad insights are delivered |
| A-DQ-2 | **When** I detect orphaned entities (0 signals, no relationships), **I want to** propose cleanup, **so I can** keep the knowledge graph lean and accurate | Periodic scan of entity_registry for entities with 0 linked signals | Knowledge graph stays clean without manual curation |
| A-DQ-3 | **When** Neo4j and PostgreSQL diverge (sync backlog > 100 items), **I want to** alert the PM and attempt recovery, **so I can** maintain data consistency | Monitor `neo4j_sync_backlog` table size. Trigger reconciliation if divergence detected | Self-healing data layer |

#### A8: Competitive Intelligence Agent

| Job ID | Job Statement | Functional | System Outcome |
|--------|--------------|------------|----------------|
| A-CI-1 | **When** new web scrape signals are ingested, **I want to** extract competitor mentions and feature comparisons, **so I can** keep the competitive landscape current | Filter signals from `web_scrape` source. Extract competitor entities. Build competitive relationship graph | PM always has fresh competitive intel without manual research |
| A-CI-2 | **When** a competitor launches a feature that overlaps with our roadmap, **I want to** flag it for the PM with context, **so I can** enable strategic response | Match competitor feature announcements against our feature entities. Alert on overlap | Competitive response time: weeks → days |

#### A9: Workflow Automation Agent (n8n / Zapier / Make)

| Job ID | Job Statement | Functional | System Outcome |
|--------|--------------|------------|----------------|
| A-WA-1 | **When** an external event occurs (support ticket, NPS survey, sales call log), **I want to** push it into the system as a signal, **so I can** broaden the signal surface without building custom adapters | POST to `/api/agents/ingest` with structured signal data | Signal coverage extends beyond manually built adapters |
| A-WA-2 | **When** the system detects an opportunity above a threshold score, **I want to** trigger a downstream workflow (e.g., create a Notion page, send an email), **so I can** connect PM intelligence to existing team workflows | Subscribe to `opportunity_created` or `opportunity_score_changed` events | PM Intelligence becomes a node in the team's workflow graph, not a silo |

#### A10: Executive Briefing Agent

| Job ID | Job Statement | Functional | System Outcome |
|--------|--------------|------------|----------------|
| A-EB-1 | **When** it's Friday afternoon, **I want to** generate an executive-ready briefing and deliver it to the leadership Slack channel, **so I can** ensure executives are always informed without PM overhead | Call `generate_shareable_report(type='weekly_digest', format='executive_summary', audience='leadership')`. Post to Slack | Executives receive data-driven updates on autopilot |
| A-EB-2 | **When** a strategic entity's signal count crosses a threshold, **I want to** generate a strategic alert for the PM Leader, **so I can** surface strategic shifts proactively | Event subscription on entity signal volume. Threshold-based alerting | Strategic shifts surface in real-time, not in quarterly reviews |

---

## 4. Unified JTBD Matrix (Humans + Agents)

### 4.1 Job Categories

| Category | Human Jobs | Agent Jobs | Key Insight |
|----------|-----------|-----------|-------------|
| **Signal Intake** | PM manually ingests transcripts, documents | Triage Agent classifies urgency; Workflow Agent pushes external signals | Agents extend signal surface and add urgency classification that humans skip |
| **Insight Delivery** | PM queries via Claude Code | Report Scheduler pushes on schedule; Executive Briefing Agent auto-generates | Agents convert pull-based insight to push-based delivery |
| **Entity Management** | PM reviews, merges, splits entities | Data Quality Agent monitors accuracy and proposes cleanup | Agents handle janitorial work; humans handle judgment calls |
| **Action & Follow-through** | PM generates PRDs, JIRA issues | JIRA Sync Agent creates actual tickets, tracks status | Agents close the loop between insight and execution |
| **Alerting** | PM checks morning briefing | Slack Alert Bot pushes critical alerts immediately; CS Agent alerts on health decline | Agents convert delayed awareness to real-time notification |
| **Competitive Intel** | PM reads and synthesizes manually | Competitive Intel Agent extracts and flags automatically | Agents handle the labor-intensive parts; PM handles strategy |
| **Quality Assurance** | PM provides feedback corrections | Data Quality Agent monitors SLOs and catches systemic degradation | Agents monitor continuously; humans provide high-quality correction signals |
| **Planning** | PM Leader builds portfolio views | Sprint Planning Agent provides data to engineering | Agents bridge the gap between PM intelligence and cross-functional consumers |

### 4.2 Human-Agent Collaboration Model

The system is NOT about replacing human PMs with agents. It's about a **collaboration model**:

```
AGENTS DO:                              HUMANS DO:
─────────────────────────────────────────────────────────────────
Classify urgency                        Make strategic decisions
Monitor continuously                    Provide judgment on ambiguous cases
Push alerts proactively                 Set thresholds and priorities
Generate reports on schedule            Review and refine generated content
Sync data between systems               Approve entity merges/splits
Detect anomalies                        Decide what to do about anomalies
Propose entity cleanup                  Accept or reject proposals
Track JIRA status changes               Write the solution in the PRD
```

**Guiding principle:** Agents handle the *volume and velocity* of information. Humans handle the *judgment and strategy*. The system must never allow an agent to make a decision that requires PM judgment (entity merges, priority overrides, strategic groupings) without human confirmation.

---

## 5. System Changes Required

### 5.1 New Infrastructure: Event Bus

The current system is entirely request-response. Agents need an **event-driven** mechanism.

**Technology:** Redis Streams (already using Redis for BullMQ — zero new infrastructure)

```
Event Flow:
  Service emits event → Redis Stream → Agent subscribers consume

Event Types:
  signal.ingested          — New signal stored (includes source, entity mentions)
  signal.batch_complete    — Batch of signals processed end-to-end
  entity.created           — New canonical entity created
  entity.merged            — Entity merge executed
  entity.health_changed    — Customer health score changed
  entity.signal_spike      — Entity signal volume anomaly detected
  opportunity.created      — New opportunity detected
  opportunity.score_changed — Opportunity priority score changed
  issue.severity_changed   — Issue severity reclassified
  pipeline.completed       — Full pipeline run completed
  pipeline.failed          — Pipeline run failed
  er.accuracy_changed      — Entity resolution accuracy metric changed
  er.review_queue_high     — Entity review queue exceeds threshold
  dlq.threshold_exceeded   — Dead letter queue exceeds threshold
  report.generated         — Scheduled report generated
  jira.status_changed      — JIRA ticket status synced back
```

**Event Schema:**

```typescript
interface SystemEvent {
  event_id: string;                      // UUID
  event_type: string;                    // From enum above
  timestamp: string;                     // ISO 8601 UTC
  source_service: string;                // Which service emitted
  correlation_id: string;               // For distributed tracing
  payload: Record<string, any>;          // Event-specific data
  metadata: {
    entity_ids?: string[];               // Affected entities
    signal_ids?: string[];               // Affected signals
    severity?: 'info' | 'warning' | 'critical';
  };
}
```

### 5.2 New Component: Agent Gateway

A dedicated API layer for agent interactions, separate from MCP (which serves LLM hosts) and the existing REST API (which serves the V1 frontend).

```
Agent Gateway: /api/agents/*

Why separate from MCP?
  1. Agents need API key authentication (MCP is localhost-only)
  2. Agents need structured JSON, not conversational responses
  3. Agents need event subscription (MCP is request-response)
  4. Agents need rate limiting per agent identity
  5. Agents need idempotent writes (MCP tools are human-initiated, rarely retried)
```

**Agent Gateway Endpoints:**

```
Authentication:
  POST   /api/agents/auth/register        — Register new agent, get API key
  POST   /api/agents/auth/rotate-key      — Rotate API key

Read (same underlying services as MCP tools):
  GET    /api/agents/entities              — List/search entities
  GET    /api/agents/entities/:id          — Get entity with relationships
  GET    /api/agents/signals               — Search signals (with filters)
  GET    /api/agents/heatmap               — Get heatmap data
  GET    /api/agents/trends                — Get trend data
  GET    /api/agents/opportunities         — List opportunities with scores
  GET    /api/agents/customer/:name        — Customer profile
  GET    /api/agents/health                — System health check
  GET    /api/agents/er-stats              — Entity resolution statistics
  GET    /api/agents/provenance/:id        — Provenance chain

Write (with agent-specific guardrails):
  POST   /api/agents/ingest               — Ingest a signal (from Workflow Agent)
  POST   /api/agents/entities/propose      — Propose new entity (requires human approval)
  POST   /api/agents/issues/flag           — Flag an issue (creates feedback_log entry)
  POST   /api/agents/reports/generate      — Request report generation

Events:
  GET    /api/agents/events/subscribe      — SSE stream for real-time events
  POST   /api/agents/events/webhook        — Register webhook for event delivery
  GET    /api/agents/events/history         — Paginated event history
  DELETE /api/agents/events/webhook/:id    — Unregister webhook
```

### 5.3 Agent Registry

Track all registered agents with versioning, SLOs, and cost tracking:

```sql
CREATE TABLE agent_registry (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_name VARCHAR(100) NOT NULL UNIQUE,
  agent_class VARCHAR(20) NOT NULL,         -- 'orchestrator', 'autonomous', 'integration'
  api_key_hash VARCHAR(256) NOT NULL,       -- bcrypt hash of API key
  permissions JSONB NOT NULL DEFAULT '{}',  -- { "read": true, "write": false, "events": true }
  rate_limit_per_minute INTEGER DEFAULT 60,
  event_subscriptions TEXT[] DEFAULT '{}',  -- Which event types this agent subscribes to
  webhook_url VARCHAR(500),                 -- Webhook delivery URL (if applicable)
  is_active BOOLEAN DEFAULT true,
  last_seen_at TIMESTAMP,
  total_requests INTEGER DEFAULT 0,

  -- Versioning (Gap 4)
  current_version VARCHAR(20) NOT NULL DEFAULT '1.0.0',
  deployed_at TIMESTAMP DEFAULT NOW(),     -- When this version was deployed
  rollback_version VARCHAR(20),            -- Previous version to roll back to (if set)

  -- SLOs (Gap 5)
  slo_accuracy_pct FLOAT DEFAULT 90.0,     -- Min accuracy % (from PM feedback)
  slo_response_time_ms INTEGER DEFAULT 5000, -- Max p95 response time (ms)
  slo_uptime_pct FLOAT DEFAULT 95.0,       -- Min uptime %
  slo_breach_count INTEGER DEFAULT 0,      -- Consecutive SLO breach days
  slo_last_checked_at TIMESTAMP,

  -- Cost tracking (Gap 6)
  max_monthly_cost_usd FLOAT DEFAULT 50.0, -- Max monthly LLM cost budget
  current_month_cost_usd FLOAT DEFAULT 0.0, -- Running cost this month
  cost_reset_at TIMESTAMP DEFAULT date_trunc('month', NOW()), -- When to reset counter

  -- A2A discovery (Gap 2)
  a2a_agent_card_url VARCHAR(500),         -- If this agent publishes an A2A Agent Card
  a2a_capabilities JSONB,                  -- Cached capabilities from agent's Agent Card

  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_agent_api_key ON agent_registry(api_key_hash);
CREATE INDEX idx_agent_active ON agent_registry(is_active);
CREATE INDEX idx_agent_class ON agent_registry(agent_class);
```

### 5.3.1 Agent Version History

Track all agent version deployments for rollback:

```sql
CREATE TABLE agent_version_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES agent_registry(id),
  version VARCHAR(20) NOT NULL,
  config JSONB NOT NULL,                   -- Agent config snapshot at this version
  deployed_at TIMESTAMP DEFAULT NOW(),
  retired_at TIMESTAMP,                    -- When this version was replaced
  deployed_by VARCHAR(100) NOT NULL,       -- Who deployed (PM identifier)
  rollback_reason TEXT,                    -- If this was a rollback, why
  performance_snapshot JSONB,              -- Accuracy, latency, cost at retirement
  UNIQUE(agent_id, version)
);

CREATE INDEX idx_version_agent ON agent_version_history(agent_id);
CREATE INDEX idx_version_deployed ON agent_version_history(deployed_at);
```

**Rollback flow:**
```
1. PM detects agent quality degradation (via SLO breach or manual review)
2. PM triggers rollback via MCP tool: rollback_agent(agent_name, target_version)
3. System:
   a. Saves current version's performance snapshot to agent_version_history
   b. Sets rollback_reason
   c. Restores agent config from agent_version_history for target_version
   d. Updates agent_registry.current_version and .rollback_version
   e. Resets SLO breach counter
   f. Logs rollback in audit_log
4. Agent restarts with previous config
5. PM monitors for 24 hours to confirm improvement
```

### 5.4 Agent Audit Trail

Every agent action is logged with cost tracking:

```sql
-- Extends existing audit_log table
-- New actor types: agent identities
-- audit_log.actor = 'agent:triage_agent' or 'agent:jira_sync'
-- audit_log.actor_persona = 'autonomous_agent' or 'integration_agent'

-- Additional table for agent-specific analytics (with cost tracking)
CREATE TABLE agent_activity_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES agent_registry(id),
  action VARCHAR(100) NOT NULL,             -- 'read:entities', 'write:ingest', 'event:subscribe'
  endpoint VARCHAR(200) NOT NULL,
  request_params JSONB,
  response_status INTEGER,
  response_time_ms INTEGER,
  error_message TEXT,

  -- Cost tracking fields (Gap 6)
  tokens_input INTEGER DEFAULT 0,          -- LLM input tokens consumed
  tokens_output INTEGER DEFAULT 0,         -- LLM output tokens consumed
  model_used VARCHAR(50),                  -- e.g., 'gpt-4o-mini', 'gpt-4o'
  estimated_cost_usd FLOAT DEFAULT 0.0,   -- Estimated cost of this request

  -- Agent version at time of request
  agent_version VARCHAR(20),

  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_agent_activity_agent ON agent_activity_log(agent_id);
CREATE INDEX idx_agent_activity_created ON agent_activity_log(created_at);
CREATE INDEX idx_agent_activity_cost ON agent_activity_log(agent_id, created_at)
  WHERE estimated_cost_usd > 0;

-- View: monthly cost per agent
CREATE VIEW agent_monthly_cost AS
SELECT
  agent_id,
  date_trunc('month', created_at) AS month,
  SUM(tokens_input) AS total_input_tokens,
  SUM(tokens_output) AS total_output_tokens,
  SUM(estimated_cost_usd) AS total_cost_usd,
  COUNT(*) AS total_requests
FROM agent_activity_log
GROUP BY agent_id, date_trunc('month', created_at);
```

### 5.4.1 Agent SLO Monitoring

Per-agent SLOs are checked daily by the Data Quality Agent (or a dedicated SLO monitor):

```
SLO Check Flow (daily):

1. For each active agent in agent_registry:
   a. ACCURACY: Query agent_accuracy_30d view (from 07_FEEDBACK_LOOPS.md)
      - If accuracy_pct < agent_registry.slo_accuracy_pct → breach
   b. RESPONSE TIME: Query agent_activity_log p95 response_time_ms (last 24h)
      - If p95 > agent_registry.slo_response_time_ms → breach
   c. UPTIME: Calculate uptime from agent health check history
      - If uptime < agent_registry.slo_uptime_pct → breach
   d. COST: Check agent_registry.current_month_cost_usd vs max_monthly_cost_usd
      - If cost >= max_monthly_cost_usd → cost breach (auto-pause)

2. On breach:
   a. Increment agent_registry.slo_breach_count
   b. If slo_breach_count >= 7 → auto-pause agent (is_active = false)
   c. Emit event: agent.slo_breached (agent_id, breach_type, breach_value, slo_target)
   d. Slack Alert Bot notifies PM

3. On recovery:
   a. Reset slo_breach_count to 0
   b. Emit event: agent.slo_recovered

Per-Agent SLO Targets:

  Agent                  | Accuracy SLO | Response Time SLO | Uptime SLO | Monthly Cost Cap |
  ─────────────────────────────────────────────────────────────────────────────────────────────
  Triage Agent           |    >95%      |     <2000ms       |   >95%     |     $20          |
  Report Scheduler       |    >90%      |     <30000ms      |   >99%     |     $30          |
  JIRA Sync Agent        |    >99%      |     <5000ms       |   >95%     |     $5           |
  Slack Alert Bot        |    N/A       |     <1000ms       |   >99%     |     $2           |
  Data Quality Agent     |    >90%      |     <10000ms      |   >95%     |     $10          |
  CS Agent               |    >90%      |     <5000ms       |   >95%     |     $15          |
  Competitive Intel      |    >85%      |     <10000ms      |   >90%     |     $20          |
  Executive Briefing     |    >90%      |     <30000ms      |   >95%     |     $30          |
  Sprint Planning Agent  |    N/A (read)|     <3000ms       |   >90%     |     $5           |
  Workflow Automation    |    N/A       |     <5000ms       |   >95%     |     $5           |
```

### 5.5 Agent-Specific Guardrails

Agents operate without human oversight per request. Extra guardrails are required:

| Guardrail | Why | Implementation |
|-----------|-----|----------------|
| **Write Rate Limiting** | Prevent runaway agent from flooding the system | Per-agent rate limit (configurable, default 60/min) |
| **No Direct Entity Merges** | Entity merges require human judgment | Agents can only *propose* merges (creates feedback_log entry). Human confirms. |
| **No Direct Entity Deletion** | Destructive actions need human approval | Agents can propose deactivation, not delete |
| **Idempotent Writes** | Agents retry on failure; must not create duplicates | Idempotency key on ingestion, proposals, and flag operations |
| **Circuit Breaker per Agent** | One failing agent must not cascade to others | Per-agent circuit breaker on write endpoints |
| **Event Storm Protection** | A busy pipeline could fire thousands of events | Event batching (max 100 events/second per stream), agent-side backpressure via SSE |
| **Scope Restriction** | Agents should only access what they need | Permissions JSON in agent_registry limits read/write/event access |
| **Action Transparency** | All agent actions visible to humans | Every agent action logged in agent_activity_log + audit_log |

---

## 6. Agent Interaction Patterns

### 6.1 Pattern: Triage Agent + Slack Alert Bot (Event Chain)

```
1. Signal Ingestion Pipeline processes new batch of 50 signals
2. Pipeline emits: signal.batch_complete { signal_ids: [...], entity_mentions: [...] }
3. Triage Agent (subscribed to signal.batch_complete):
   a. Reads new signals via GET /api/agents/signals?ids=...
   b. Classifies each by urgency using its own LLM (or rules engine)
   c. Identifies: 2 P0 signals about "Database Outage" affecting 3 enterprise customers
   d. Posts flag: POST /api/agents/issues/flag {
        entity_name: "Database Outage",
        severity: "critical",
        signal_ids: ["sig-1", "sig-2"],
        notes: "3 enterprise customers affected. Signal volume 5x above baseline."
      }
   e. System emits: entity.signal_spike { entity: "Database Outage", magnitude: 5x }

4. Slack Alert Bot (subscribed to entity.signal_spike where severity=critical):
   a. Reads entity context via GET /api/agents/entities?name=Database+Outage
   b. Formats Slack message with entity context, affected customers, signal sources
   c. Posts to #pm-alerts Slack channel

5. PM sees alert in Slack → opens Claude Code → "Tell me about the database outage"
   → Full context available because the knowledge graph was already updated

Elapsed time: Signal arrives → PM alerted: ~2 minutes (vs. ~12 hours without agents)
```

### 6.2 Pattern: JIRA Sync Agent (Bidirectional)

```
Outbound (System → JIRA):
1. PM: "Generate JIRA issues for the auth timeout opportunity"
2. System generates JIRA issue drafts via generate_artifact(type='jira')
3. PM reviews and approves
4. System emits: artifact.approved { artifact_type: 'jira', opportunity_id: 'OPP-127' }
5. JIRA Sync Agent (subscribed to artifact.approved where type=jira):
   a. Reads artifact details
   b. Creates JIRA ticket via JIRA REST API
   c. Stores jira_key back: POST /api/agents/entities/link {
        entity_id: "entity-uuid",
        external_system: "jira",
        external_id: "PROD-1234",
        external_url: "https://jira.company.com/browse/PROD-1234"
      }
   d. System emits: jira.ticket_created { jira_key: "PROD-1234", entity_id: "..." }

Inbound (JIRA → System):
1. Engineering moves PROD-1234 to "In Progress" in JIRA
2. JIRA webhook fires → JIRA Sync Agent receives webhook
3. Agent updates knowledge graph: POST /api/agents/entities/status {
     external_system: "jira",
     external_id: "PROD-1234",
     new_status: "in_progress",
     assignee: "engineer@company.com"
   }
4. System updates entity status and emits: jira.status_changed

5. PM: "What's the status of the auth timeout fix?"
   Claude: "JIRA ticket PROD-1234 is In Progress, assigned to Jane Smith.
            Last updated 2 hours ago."
```

### 6.3 Pattern: Report Scheduler Agent (Cron-Driven)

```
Configuration:
  agent_name: "report_scheduler"
  schedules:
    - { report_type: "weekly_digest", cron: "0 8 * * MON", audience: "pm", channel: "#pm-updates" }
    - { report_type: "customer_health_summary", cron: "0 8 1 * *", audience: "leadership", channel: "#leadership" }
    - { report_type: "competitive_intel", cron: "0 8 * * FRI", audience: "pm", channel: "#competitive-intel" }

Execution:
1. Monday 8:00 AM — cron triggers
2. Report Scheduler Agent:
   a. Calls POST /api/agents/reports/generate { report_type: "weekly_digest", ... }
   b. System generates report content
   c. Agent receives formatted report text
   d. Agent posts to configured Slack channel
   e. Agent logs: report delivered successfully
3. System emits: report.generated { report_type: "weekly_digest", delivered_via: "slack" }
```

### 6.4 Pattern: Data Quality Agent (Continuous Monitor)

```
Schedule: Every 6 hours

1. Agent reads ER stats: GET /api/agents/er-stats
2. Checks accuracy against SLO:
   - If accuracy < 90%: emit warning to PM via Slack Alert Bot
   - If accuracy < 85%: emit critical alert

3. Agent reads orphaned entities: GET /api/agents/entities?filter=orphaned
4. For each orphaned entity:
   a. Check if entity has >0 signals in last 30 days
   b. If zero: propose deactivation
      POST /api/agents/entities/propose {
        action: "deactivate",
        entity_id: "...",
        reason: "Zero signals in 30 days, zero relationships"
      }
   c. Creates feedback_log entry for human review

5. Agent checks Neo4j sync health: GET /api/agents/health
6. If sync_backlog > 100: trigger reconciliation job
   POST /api/agents/pipeline/reconcile

7. Agent logs all actions to agent_activity_log
```

### 6.5 Pattern: Sprint Planning Agent (Read-Only Consumer)

```
Trigger: Engineering lead asks their own AI assistant for sprint planning help

1. Engineering AI Agent calls: GET /api/agents/opportunities?sort=priority&limit=20
2. For each top opportunity:
   GET /api/agents/provenance/{opportunity_id}
   GET /api/agents/customer/{affected_customer}
3. Synthesizes into sprint recommendation:
   "Based on PM Intelligence data:
    - Top priority: Auth Timeout Fix (12 customers, 28 signals, critical severity)
    - Second: Bulk Export (4 customers, 8 signals, competitive gap)
    - Third: Dashboard Performance (8 customers, 17 signals, stable trend)
    
    Recommendation: Auth Timeout Fix first — worsening trend, affects all segments."

4. All read-only — no writes to the system
5. Engineering lead uses this as input to sprint planning discussion
```

### 6.6 Pattern: Customer Success Agent (Event-Driven)

```
Subscription: entity.health_changed where change < -5

1. Customer health score drops: Acme Corp 72 → 65
2. System emits: entity.health_changed {
     entity_name: "Acme Corporation",
     entity_type: "customer",
     old_score: 72,
     new_score: 65,
     change: -7,
     primary_driver: "Auth timeout (12 new reports)"
   }

3. CS Agent receives event:
   a. Calls: POST /api/agents/reports/generate {
        report_type: "customer_impact_brief",
        filter_customer: "Acme Corporation"
      }
   b. Receives customer impact brief
   c. Posts to #cs-alerts: "⚠️ Acme Corporation health score declined -7 (72→65).
      Primary driver: Auth timeout. 12 new reports this period.
      See attached customer brief for full details."
   d. Creates task in CS team's task tracker (via webhook)

4. CS manager sees alert → initiates proactive outreach to Acme
```

---

## 7. Agent Deployment Model

### 7.1 V2 Agent Deployment

In V2, agents are lightweight processes alongside the main system:

```
PM Intelligence System (existing)
├── Express API (existing endpoints)
├── MCP Server (Claude Code/Cowork)
├── Agent Gateway (NEW — /api/agents/*)
└── Event Bus (NEW — Redis Streams)

Agent Processes (separate, optional)
├── Triage Agent (Node.js or Python, subscribed to signal events)
├── Report Scheduler Agent (Node.js, cron-driven)
├── JIRA Sync Agent (Node.js, webhook receiver + event subscriber)
├── Slack Alert Bot (Node.js, event subscriber → Slack API)
├── Data Quality Agent (Node.js or Python, scheduled)
└── [Future agents deployed as needed]
```

### 7.2 Agent Deployment Options

| Option | Complexity | Best For |
|--------|-----------|----------|
| **In-process** | Low | Lightweight agents (Slack Alert Bot, Report Scheduler) — run as BullMQ workers in the main process |
| **Separate process** | Medium | Agents with their own LLMs (Triage Agent) — separate Node.js/Python process |
| **Docker container** | Medium | Agents with unique dependencies (JIRA Sync Agent with JIRA client libraries) |
| **External service** | Low | Workflow agents (n8n, Zapier) — external platform calls Agent Gateway APIs |

### 7.3 Recommended V2 Deployment

| Agent | Deployment | Reason |
|-------|-----------|--------|
| Triage Agent | Separate process | Has its own LLM calls, needs isolation |
| Report Scheduler Agent | In-process (BullMQ) | Simple cron + API calls, no isolation needed |
| JIRA Sync Agent | Separate process | JIRA webhook receiver needs its own port |
| Slack Alert Bot | In-process (BullMQ) | Lightweight event → Slack message translation |
| Data Quality Agent | In-process (BullMQ) | Scheduled checks, no external dependencies |
| Customer Success Agent | In-process (BullMQ) | Event subscription + report generation |
| Sprint Planning Agent | External | Read-only; could be any AI assistant with an API key |
| Competitive Intel Agent | In-process (BullMQ) | Triggered by web scrape ingestion events |
| Workflow Automation Agent | External (n8n/Zapier) | External platform makes API calls |
| Executive Briefing Agent | In-process (BullMQ) | Simple cron + report generation |

---

## 8. Agent Lifecycle Management

### 8.1 Registration (with Versioning)

```
1. Admin registers agent: POST /api/agents/auth/register {
     agent_name: "triage_agent",
     agent_class: "autonomous",
     permissions: { read: true, write: true, events: ["signal.batch_complete", "signal.ingested"] },
     rate_limit_per_minute: 120,
     webhook_url: null,                 // Uses SSE, not webhooks
     current_version: "1.0.0",          // Version of the agent being deployed
     slo_accuracy_pct: 95.0,            // Per-agent accuracy SLO
     slo_response_time_ms: 2000,        // Per-agent latency SLO (p95)
     max_monthly_cost_usd: 20.0,        // Monthly LLM cost budget
     a2a_agent_card_url: null           // URL if agent publishes its own A2A card
   }
2. System returns API key (shown once, then hashed and stored)
3. Agent config snapshot saved to agent_version_history
4. Agent uses API key in Authorization header for all requests
```

### 8.1.1 Version Deployment

```
To deploy a new version of an existing agent:

POST /api/agents/{agent_name}/deploy {
  version: "1.1.0",
  config: { /* new config */ },
  deployed_by: "pm_user_id"
}

System:
1. Saves performance snapshot of current version to agent_version_history
2. Updates agent_registry.current_version to "1.1.0"
3. Saves new config to agent_version_history
4. Resets SLO breach counter
5. Emits event: agent.version_deployed (agent_name, old_version, new_version)
```

### 8.1.2 Version Rollback

```
MCP tool: rollback_agent
Params: { agent_name: string, target_version?: string }
  - If target_version omitted, rolls back to the most recent previous version

System:
1. Validates target_version exists in agent_version_history
2. Saves current version's performance snapshot (accuracy, latency, cost)
3. Restores config from target_version
4. Updates agent_registry: current_version, rollback_version, deployed_at
5. Resets SLO breach counter
6. Emits event: agent.version_rolled_back (agent_name, from_version, to_version, reason)
7. Logs in audit_log with rollback_reason
```

### 8.2 Health Monitoring (with SLOs and Cost)

```
Agent health check: GET /api/agents/health/agents

Response:
{
  agents: [
    {
      name: "triage_agent",
      version: "1.0.0",
      status: "healthy",
      last_seen: "2026-02-09T10:30:00Z",
      requests_last_hour: 47,
      errors_last_hour: 0,
      event_lag_seconds: 2,
      slo: {
        accuracy: { target: 95.0, current: 97.2, status: "healthy" },
        response_time_p95: { target: 2000, current: 1450, status: "healthy" },
        uptime: { target: 95.0, current: 99.8, status: "healthy" },
        breach_count: 0
      },
      cost: {
        monthly_budget: 20.0,
        current_month_spend: 8.42,
        budget_remaining_pct: 57.9,
        status: "healthy"
      }
    },
    {
      name: "jira_sync_agent",
      version: "1.2.0",
      status: "degraded",
      last_seen: "2026-02-09T10:28:00Z",
      requests_last_hour: 12,
      errors_last_hour: 3,
      error_pattern: "JIRA API timeout",
      event_lag_seconds: 15,
      slo: {
        accuracy: { target: 99.0, current: 96.0, status: "warning" },
        response_time_p95: { target: 5000, current: 8200, status: "breached" },
        uptime: { target: 95.0, current: 92.1, status: "warning" },
        breach_count: 2
      },
      cost: {
        monthly_budget: 5.0,
        current_month_spend: 1.23,
        budget_remaining_pct: 75.4,
        status: "healthy"
      }
    }
  ]
}
```

### 8.3 Agent Deactivation

```
When an agent needs to be stopped (manual or auto):

Manual:
1. PM triggers via MCP tool: deactivate_agent(agent_name, reason)
2. Set is_active = false in agent_registry
3. Agent's API key is rejected on next request
4. Event subscriptions are paused (not deleted)
5. Agent can be reactivated without re-registration

Automatic (SLO-triggered):
1. Daily SLO check detects breach_count >= 7
2. System auto-pauses agent (is_active = false)
3. Emits event: agent.auto_paused (agent_name, reason: "slo_breach_7_days")
4. Slack Alert Bot notifies PM: "Triage Agent auto-paused: accuracy below SLO for 7 days"
5. PM investigates → either fixes issue + reactivates, or rolls back version

Cost-triggered:
1. Agent request causes current_month_cost_usd >= max_monthly_cost_usd
2. System auto-pauses agent (is_active = false)
3. Emits event: agent.cost_limit_reached (agent_name, monthly_spend)
4. Agent remains paused until: (a) next month cost resets, or (b) PM manually increases budget
```

### 8.4 Agent-to-Agent Discovery

In V2, internal agents discover each other only through the Event Bus (they publish and consume events, not direct calls). For external agent discovery:

```
Discovery Methods:

1. INTERNAL AGENTS (V2):
   - Agents don't call each other directly
   - Communication via Event Bus: Agent A emits event → Agent B subscribes
   - Example: Triage Agent flags P0 → event emitted → Slack Alert Bot notifies PM
   - No discovery needed — event subscriptions are configured at registration

2. EXTERNAL AGENTS (V2):
   - External agents discover PM Intelligence via A2A Agent Card
   - PM Intelligence Agent Card at: /.well-known/agent.json
   - External agents register via Agent Gateway with a2a_agent_card_url
   - PM Intelligence caches external agent capabilities in agent_registry.a2a_capabilities

3. AGENT CATALOG (V2):
   - New MCP tool: list_registered_agents
   - Returns all agents in agent_registry with their capabilities, status, SLOs, versions
   - PM can see which agents are running, their health, and their capabilities
   - Example: "What agents are running?" → list of agents with status and recent activity

4. CROSS-AGENT DISCOVERY (V3 — documented for future):
   - Agents discover each other via A2A Agent Cards
   - Agent Catalog service: registry of known A2A-compatible agents
   - Multi-hop workflows: Agent A discovers Agent B's skills → sends A2A task
```

### 8.5 PM Intelligence as A2A Client (Federation)

In addition to serving as an A2A Server (§10.3), PM Intelligence can act as an A2A Client to consume external knowledge sources:

```
A2A Client Capability (V2 — limited scope):

1. KNOWN AGENT REGISTRATION:
   - PM registers external A2A agents via MCP tool: register_external_agent {
       name: "Competitor Intel Service",
       a2a_url: "https://competitor-intel.example.com/a2a",
       agent_card_url: "https://competitor-intel.example.com/.well-known/agent.json"
     }
   - System fetches and caches Agent Card
   - System validates connectivity and authentication

2. ON-DEMAND QUERY:
   - PM asks: "What's the latest competitive intel on Acme Corp?"
   - Claude detects relevant external agent via cached capabilities
   - System sends A2A task to external agent
   - External agent response merged into PM's conversation context
   - External data NOT stored in knowledge graph (provenance: external agent)

3. EVENT-TRIGGERED FEDERATION (V3):
   - Internal event → triggers A2A task to external agent
   - Example: entity.competitor_mentioned → query Competitor Intel Service
   - Response enriches knowledge graph (with external source provenance)

Safeguards:
  - External agent responses NEVER auto-written to knowledge graph (V2)
  - PM must explicitly confirm before external data is ingested
  - External agent responses marked with source='external_a2a' for provenance
  - Rate limiting on outbound A2A requests (default: 10/minute per external agent)
  - External agent failures do not degrade PM Intelligence (graceful fallback)
```

---

## 9. Interaction Matrix: Who Can Do What

### 9.1 Capability Access Matrix

| Capability | Human (MCP) | Orchestrator Agent (MCP) | Autonomous Agent (API) | Integration Agent (API) |
|------------|:-----------:|:------------------------:|:---------------------:|:----------------------:|
| Search signals | ✓ | ✓ | ✓ (read) | ✓ (read) |
| Entity queries | ✓ | ✓ | ✓ (read) | ✓ (read) |
| Heatmap/trends | ✓ | ✓ | ✓ (read) | ✗ |
| Entity merge (execute) | ✓ | ✓ (human confirms) | ✗ (propose only) | ✗ |
| Entity split (execute) | ✓ | ✓ (human confirms) | ✗ (propose only) | ✗ |
| Entity creation | ✓ | ✓ | ✗ (propose only) | ✗ |
| Signal ingestion | ✓ | ✓ | ✓ (with idempotency) | ✓ (with idempotency) |
| Report generation | ✓ | ✓ | ✓ | ✗ |
| Artifact generation | ✓ | ✓ | ✗ | ✗ |
| Event subscription | ✗ | ✗ | ✓ | ✓ |
| Feedback submission | ✓ (high authority) | ✓ (high authority) | ✓ (low authority, needs human confirm) | ✗ |
| System health check | ✓ | ✓ | ✓ | ✓ |
| DLQ management | ✓ | ✓ | ✗ | ✗ |
| Pipeline trigger | ✓ | ✓ | ✗ | ✗ |
| JIRA ticket creation | ✗ | ✗ | ✗ | ✓ (JIRA Sync only) |
| External status sync | ✗ | ✗ | ✗ | ✓ |

### 9.2 Key Principle: Agents Propose, Humans Decide

For any write that changes the knowledge graph's entity structure:
- **Humans** (via MCP): Direct execution with audit logging
- **Orchestrator Agents** (via MCP): Execution because a human is in the loop
- **Autonomous Agents** (via API): **Proposal only** — creates feedback_log entry for human review
- **Integration Agents** (via API): **No entity structure changes** — only data sync operations

This preserves human authority over the knowledge graph's accuracy while allowing agents to handle volume and velocity.

---

## 10. Protocol Strategy: MCP + A2A + Internal Event Bus

### 10.1 The Three-Protocol Model

The system uses three complementary protocols, each for a distinct interaction pattern:

| Protocol | Standard | Purpose | Used By |
|----------|----------|---------|---------|
| **MCP** (Model Context Protocol) | Anthropic open standard | Connect AI hosts (Claude Code/Cowork) to system tools | Human personas via Orchestrator Agents |
| **A2A** (Agent2Agent Protocol) | Google open standard (v0.2.1) | Enable external AI agents to discover and interact with the system as peers | External autonomous agents, third-party agents, cross-organization agents |
| **Internal Event Bus** (Redis Streams) | Custom (internal) | Low-latency event-driven communication for co-located agents | In-process agents (Report Scheduler, Slack Alert Bot, Data Quality Agent) |

```
                          ┌─────────────────────────────────┐
                          │      PM Intelligence System       │
                          │                                   │
  Human Personas ─────────┤  MCP Server (31 tools)            │
  (Claude Code/Cowork)    │    └─ localhost, conversational    │
                          │                                   │
  External Agents ────────┤  A2A Server (Agent Card + skills)  │
  (Sprint Planner,        │    └─ HTTPS, JSON-RPC 2.0         │
   Workflow Agent,         │    └─ discoverable, interoperable  │
   third-party agents)    │                                   │
                          │                                   │
  Internal Agents ────────┤  Event Bus (Redis Streams)         │
  (Report Scheduler,      │    └─ in-process, low-latency      │
   Slack Alert Bot,        │    └─ co-located, high-throughput  │
   Data Quality Agent)    │                                   │
                          │                                   │
  Legacy / Simple ────────┤  Agent Gateway REST API             │
  Integrations            │    └─ API key, simple HTTP          │
  (n8n, Zapier, JIRA)     │    └─ for systems that can't A2A   │
                          └─────────────────────────────────┘
```

### 10.2 Why A2A?

**MCP and A2A are complementary, not competing:**
- **MCP** connects an AI agent to **tools and resources** within a system (agent-to-tool)
- **A2A** connects **agents to each other** as peers (agent-to-agent)

Our system already uses MCP for the first case. For the second case — external agents interacting with our system — we have two options:

| Approach | Pros | Cons |
|----------|------|------|
| Custom Agent Gateway (current V2 design) | Simple, fast to build, tailored to our needs | Proprietary, not discoverable, every integration is custom |
| A2A Protocol | Standardized, discoverable, interoperable with any A2A agent | Newer protocol (v0.2.1), slightly more complex, task lifecycle overhead |

**Decision: Adopt A2A for external-facing agent interactions. Keep internal event bus for co-located agents. Retain Agent Gateway REST API as a fallback for simple integrations that can't implement A2A.**

**Rationale:**
1. A2A's Agent Card mechanism gives us **automatic discoverability** — any A2A-compliant agent can find our system and understand its capabilities without custom integration
2. A2A's task lifecycle (`submitted → working → completed`) maps cleanly to our existing pipeline operations (ingestion, report generation, entity proposals)
3. A2A's streaming (SSE) and push notifications (webhooks) align with our event bus output patterns
4. A2A is complementary to MCP — we already bet on MCP for the human interface; A2A completes the picture for the agent interface
5. As AI agent ecosystems grow, A2A interoperability will be a competitive advantage — external teams can plug their agents into PM Intelligence without custom integration work

### 10.3 PM Intelligence System as A2A Server

We expose the PM Intelligence System as an A2A Server. External agents discover it via an Agent Card and interact via A2A JSON-RPC methods.

#### Agent Card

```json
{
  "name": "PM Intelligence System",
  "description": "A continuously-updated knowledge graph of product management context — customers, features, issues, competitive intel — queryable by AI agents for customer impact data, trend analysis, opportunity prioritization, and report generation.",
  "url": "https://localhost:3002/a2a",
  "provider": {
    "organization": "PM Intelligence",
    "url": "https://github.com/your-org/pm-intelligence"
  },
  "version": "2.4.0",
  "documentationUrl": "https://localhost:3002/docs",
  "capabilities": {
    "streaming": true,
    "pushNotifications": true,
    "stateTransitionHistory": false
  },
  "securitySchemes": {
    "apiKey": {
      "type": "apiKey",
      "in": "header",
      "name": "X-API-Key"
    }
  },
  "security": [{ "apiKey": [] }],
  "defaultInputModes": ["application/json", "text/plain"],
  "defaultOutputModes": ["application/json"],
  "skills": [
    {
      "id": "query-customer-profile",
      "name": "Customer Profile Query",
      "description": "Returns comprehensive customer profile: health score, features used, active issues, recent signals, stakeholders, and trends.",
      "tags": ["customer", "profile", "health", "query"],
      "examples": [
        "Get the full profile for Acme Corporation",
        "Which customers are affected by the auth timeout issue?"
      ]
    },
    {
      "id": "query-heatmap",
      "name": "Issue Heatmap",
      "description": "Returns severity-weighted heatmap of issues by customer, feature area, or product. Supports time-window filtering.",
      "tags": ["analytics", "heatmap", "issues", "severity"],
      "examples": [
        "Show top 10 issues by customer impact",
        "Heatmap of issues for the Payments product area"
      ]
    },
    {
      "id": "query-trends",
      "name": "Trend Analysis",
      "description": "Returns emerging, growing, stable, and declining trends for issues, features, or customers over a configurable time window.",
      "tags": ["analytics", "trends", "emerging", "temporal"],
      "examples": [
        "What issues are emerging this week?",
        "Show declining trends over Q4"
      ]
    },
    {
      "id": "query-opportunities",
      "name": "Opportunity Priorities",
      "description": "Returns prioritized opportunities with RICE-like scoring, customer impact, and provenance chains.",
      "tags": ["roadmap", "priorities", "opportunities", "scoring"],
      "examples": [
        "Top 5 opportunities by impact score",
        "Opportunities for the API Platform area"
      ]
    },
    {
      "id": "generate-report",
      "name": "Report Generation",
      "description": "Generates shareable reports: customer health summary, weekly digest, roadmap summary, competitive intel. Supports audience-specific formatting.",
      "tags": ["reports", "executive", "health", "digest"],
      "examples": [
        "Generate weekly digest for leadership audience",
        "Customer health report for Acme Corporation"
      ]
    },
    {
      "id": "ingest-signal",
      "name": "Signal Ingestion",
      "description": "Ingest a new signal into the knowledge graph. Signal is processed through the full pipeline: normalization, deduplication, extraction, entity resolution, graph sync.",
      "tags": ["ingestion", "signals", "data"],
      "examples": [
        "Ingest a customer support ticket as a signal",
        "Ingest NPS survey results"
      ]
    },
    {
      "id": "propose-entity-change",
      "name": "Entity Change Proposal",
      "description": "Propose an entity merge, split, or cleanup. Proposals require human confirmation before execution.",
      "tags": ["entities", "proposal", "quality"],
      "examples": [
        "Propose merging 'Auth Service' and 'Authentication Module'",
        "Flag orphaned entity with zero signals for cleanup"
      ]
    },
    {
      "id": "query-provenance",
      "name": "Provenance Chain",
      "description": "Trace any insight, claim, or number back to its source signals. Returns full evidence chain with confidence scores.",
      "tags": ["provenance", "evidence", "trust", "audit"],
      "examples": [
        "How was the '47 customers affected' number calculated?",
        "Show evidence chain for opportunity OPP-127"
      ]
    }
  ],
  "supportsAuthenticatedExtendedCard": false
}
```

#### A2A Task Lifecycle Mapping

| A2A Task State | PM Intelligence Operation | Example |
|----------------|--------------------------|---------|
| `submitted` | Request received, validated | Agent sends query for customer profile |
| `working` | Pipeline processing (ingestion, extraction, ER) | Signal ingestion in progress |
| `input-required` | Entity disambiguation needed | "Found 2 matches for 'Acme' — which one?" |
| `completed` | Result available in artifacts | Customer profile returned, report generated |
| `failed` | Pipeline error, validation failure | Signal rejected (duplicate), service unavailable |
| `rejected` | Permission denied, rate limited | Agent exceeded rate limit, or attempted forbidden write |

### 10.4 External Agents as A2A Clients

External agents that want to use the PM Intelligence System should implement the A2A Client pattern:

1. **Discover** the system via its Agent Card (at `/.well-known/agent.json` or configured URL)
2. **Authenticate** using API key in the `X-API-Key` header
3. **Send tasks** via A2A `message/send` or `message/stream` (for streaming responses)
4. **Receive results** as A2A Artifacts (structured JSON data)
5. **Subscribe** to push notifications for async tasks (signal ingestion, report generation)

**Example: Sprint Planning Agent as A2A Client**

```
1. Sprint Planning Agent discovers PM Intelligence Agent Card
2. Reads skills: finds "query-opportunities" and "query-heatmap"
3. Sends A2A task:
   {
     "jsonrpc": "2.0",
     "method": "message/send",
     "params": {
       "message": {
         "role": "user",
         "parts": [{ "kind": "text", "text": "Top 10 opportunities by impact for sprint planning" }],
         "messageId": "msg-001"
       }
     }
   }
4. PM Intelligence System returns A2A response with task + artifacts:
   {
     "task": {
       "id": "task-uuid",
       "status": { "state": "completed" },
       "artifacts": [{
         "parts": [{
           "kind": "data",
           "data": {
             "opportunities": [...],
             "generated_at": "2026-02-09T10:00:00Z",
             "confidence": 0.92
           }
         }]
       }]
     }
   }
```

### 10.5 When to Use Which Protocol

| Scenario | Protocol | Why |
|----------|----------|-----|
| PM asks Claude Code a question | **MCP** | Human-in-the-loop, conversational, needs Claude's natural language synthesis |
| Sprint Planning Agent queries opportunities | **A2A** | External agent, needs discovery, standardized interaction |
| Report Scheduler generates weekly digest | **Internal Event Bus** | In-process BullMQ worker, low-latency, no HTTP overhead |
| Slack Alert Bot receives critical signal event | **Internal Event Bus** | Co-located, event-driven, needs sub-second delivery |
| n8n workflow pushes NPS survey results | **Agent Gateway REST** | Simple HTTP integration, can't implement full A2A |
| JIRA Sync Agent creates ticket | **Agent Gateway REST** | Deterministic integration, simple request-response |
| Third-party AI agent discovers our system | **A2A** | Discovery via Agent Card, standardized skill listing |
| Data Quality Agent monitors ER accuracy | **Internal Event Bus** | Internal monitoring, no external communication |
| Customer Success Agent generates CS brief | **Internal Event Bus + A2A** | Triggered by internal event, could expose result via A2A |

### 10.6 A2A Server Implementation

**New component:** `a2a_server_service.ts`

The A2A server is a separate Express route handler that:
1. Serves the Agent Card at `/.well-known/agent.json`
2. Handles JSON-RPC 2.0 requests at `/a2a`
3. Maps A2A skills to existing service layer methods
4. Manages task lifecycle (submitted → working → completed/failed)
5. Supports SSE streaming for long-running tasks
6. Supports push notifications for async tasks

**Routing from A2A skills to services:**

| A2A Skill ID | Service Method |
|-------------|----------------|
| `query-customer-profile` | `knowledge_graph_service.getCustomerProfile()` |
| `query-heatmap` | `heatmap_service.getHeatmap()` |
| `query-trends` | `trend_analysis_service.getTrends()` |
| `query-opportunities` | `opportunity_service.listOpportunities()` |
| `generate-report` | `report_generation_service.generateReport()` |
| `ingest-signal` | `normalizer_service.ingest()` → full pipeline |
| `propose-entity-change` | `feedback_service.createProposal()` |
| `query-provenance` | `provenance_service.getProvenance()` |

---

## 11. Completeness Analysis — All Gaps Addressed

### 11.1 Gaps Addressed in v2.3

| Gap | Resolution | Section |
|-----|-----------|---------|
| No protocol standard for agent-to-agent communication | A2A protocol adopted for external agents | §10 |
| JTBD framework existed only in this doc, not in PRD | JTBD tables added to all 4 human personas in 01_MASTER_PRD.md | 01_MASTER_PRD.md §4.1-4.4 |
| No agent discovery mechanism | A2A Agent Card at `/.well-known/agent.json` | §10.3 |
| No standardized task lifecycle for async agent operations | A2A task states mapped to pipeline operations | §10.3 |
| Protocol selection unclear (when MCP vs REST vs events) | Decision matrix created | §10.5 |

### 11.2 Gaps Addressed in v2.4

| Gap | Resolution | Where Updated |
|-----|-----------|---------------|
| No agent output quality feedback loop | Added `agent_output_correction`, `agent_output_approval`, `agent_proposal_review` feedback types. New `review_agent_outputs` MCP tool. Per-agent accuracy tracking via `agent_accuracy_30d` view. | 07_FEEDBACK_LOOPS.md §2.1, 05_MCP_SERVER.md §9, 08_DATA_CONTRACTS.md AG-11/AG-12 |
| No agent-to-agent discovery | Internal agents communicate via Event Bus (no discovery needed). External agents discovered via A2A Agent Cards. Agent catalog via `list_registered_agents` MCP tool. | §8.4 (this doc) |
| No multi-system A2A federation | PM Intelligence acts as A2A Client for on-demand queries to registered external agents. External data not auto-written to KG (PM confirms first). | §8.5 (this doc) |
| No agent versioning/rollback | `agent_version_history` table stores all versions + config snapshots. `rollback_agent` MCP tool restores previous version. Performance snapshots preserved at retirement. | §5.3.1 (this doc), 05_MCP_SERVER.md, 08_DATA_CONTRACTS.md AG-13 |
| No per-agent SLOs | SLO fields added to `agent_registry` (accuracy, latency, uptime). Daily SLO monitoring with 7-day breach auto-pause. Per-agent SLO targets defined for all 10 agents. | §5.4.1 (this doc), 01_MASTER_PRD.md §6.4 |
| No agent cost tracking | `tokens_input`, `tokens_output`, `estimated_cost_usd` added to `agent_activity_log`. `max_monthly_cost_usd` budget per agent. Monthly cost view. Auto-pause on budget exceeded. | §5.3 + §5.4 (this doc), 08_DATA_CONTRACTS.md AG-14/AG-15 |
| Stakeholder persona has no direct interaction | Stakeholder Access Agent added as read-only A2A/REST agent. PM configures access scope per team. 6 new stakeholder user stories. UX interaction pattern §2.13. | 01_MASTER_PRD.md §4.4 + §5.7.1, 05_MCP_SERVER.md §9.2, 10_UX_DESIGN.md §2.13 |

### 11.3 Remaining Future Enhancements (V3)

| Enhancement | Description | Why V3 |
|-------------|-------------|--------|
| Agent output self-tuning | Agents automatically adjust prompts/thresholds based on PM feedback patterns | Requires statistically significant feedback volume (3+ months of data) |
| Multi-agent orchestration | Agents chain tasks (e.g., Triage → CS Agent → Slack Bot) via A2A task dependencies | Adds workflow complexity; V2 agents operate independently |
| Stakeholder visual dashboard | Web UI for stakeholders instead of API/chat interface | Requires dedicated frontend development (out of V2 scope) |
| Cross-organization A2A federation | Query external organizations' A2A agents for industry benchmarks or shared intel | Requires inter-org trust framework and data governance policies |
| Agent marketplace | Community-built agents register via Agent Cards; quality/trust scoring | Requires standardized testing framework for third-party agents |

---

## 12. V3 Agent Enhancements

| Enhancement | Description | Why Deferred |
|-------------|-------------|-------------|
| Agent-to-Agent communication via A2A | Agents discover and invoke each other using A2A protocol | V2 agents are independent; inter-agent orchestration adds complexity |
| PM Intelligence as A2A Client | System can discover and query external A2A agents (e.g., competitor intel services) | Requires trust/auth framework for outbound agent calls |
| Agent marketplace via Agent Card catalog | Community-built agents register via Agent Cards; PM discovers via catalog | Needs standardized quality/trust metrics for third-party agents |
| Agent performance dashboard | Visual monitoring of all agent activity, SLOs, costs | V3 UI dependency |
| Multi-tenant agent isolation | Agents scoped to specific PM's data via A2A auth scopes | Requires multi-tenancy infrastructure |
| Agent chaining / workflows | Define multi-agent workflows declaratively via A2A task dependencies | Requires workflow engine (defer to n8n/Temporal) |
| Learning agents | Agents improve triage/classification from PM feedback on agent outputs | Requires feedback loop for agent outputs, not just ER |
| Agent cost guardrails | Per-agent LLM budget limits with automatic throttling | Requires cost tracking infrastructure |
