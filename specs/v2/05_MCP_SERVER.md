# V2 MCP Server, A2A Server & Agent Gateway Design

> **Version:** 2.6 (Updated — API versioning, deprecation policy, 35 MCP tools)
> **Date:** 2026-02-09
> **Status:** Approved for Build

---

## 1. Purpose

The system exposes three consumption interfaces:

1. **MCP Server (`pm_intelligence_mcp_server`)** — Primary interface for **human personas** via Claude Code and Claude Cowork. Exposes 31 MCP tools. Protocol: MCP (Anthropic open standard).
2. **A2A Server (`a2a_server_service`)** — Primary interface for **external AI agents**. Exposes 8 A2A skills via Agent Card. Protocol: A2A (Google open standard, JSON-RPC 2.0).
3. **Agent Gateway (`agent_gateway_service`)** — Fallback interface for **simple integrations** (n8n, Zapier, JIRA). REST API with API key auth, rate limiting, event subscription, and idempotent writes.

All three interfaces route to the same underlying services. MCP is for conversational, human-in-the-loop interactions. A2A is for discoverable, interoperable, async agent interactions. Agent Gateway REST is for deterministic integrations that can't implement A2A.

**Design principle:** All three interfaces are thin routing layers. All business logic lives in services. The interfaces only handle protocol translation, authentication, parameter validation, and response formatting.

**Protocol selection logic:**
- If the consumer is a human via Claude Code/Cowork → use **MCP**
- If the consumer is an external AI agent that supports A2A → use **A2A**
- If the consumer is a simple integration (webhook, JIRA, n8n) → use **Agent Gateway REST**
- If the consumer is a co-located internal agent → use **Internal Event Bus** (no HTTP)

See [16_AGENTIC_INTERACTIONS.md](./16_AGENTIC_INTERACTIONS.md) §10 for the complete protocol strategy, A2A Agent Card, and decision matrix.

---

## 2. MCP Server Configuration

### 2.1 Server Metadata

```typescript
const server = new McpServer({
  name: "pm-intelligence",
  version: "2.0.0",
  description: "PM Intelligence Context Layer — query your product knowledge graph, manage entities, generate insights"
});
```

### 2.2 Cursor MCP Configuration (.cursor/mcp.json)

```json
{
  "mcpServers": {
    "pm-intelligence": {
      "command": "node",
      "args": ["backend/mcp/server.ts"],
      "env": {
        "MCP_SERVER_PORT": "3001"
      }
    }
  }
}
```

---

## 3. MCP Tool Definitions

### 3.1 Search & Query Tools

#### `search_signals`

```typescript
{
  name: "search_signals",
  description: "Search signals by keyword, source type, date range, customer, feature, or theme. Uses hybrid search (vector + full-text) for best results.",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Natural language search query" },
      source: { type: "string", enum: ["slack", "meeting_transcript", "document", "web_scrape", "jira", "wiki", "all"], description: "Filter by source type" },
      customer: { type: "string", description: "Filter by customer name" },
      feature: { type: "string", description: "Filter by feature name" },
      theme: { type: "string", description: "Filter by theme" },
      date_from: { type: "string", description: "Start date (ISO 8601)" },
      date_to: { type: "string", description: "End date (ISO 8601)" },
      limit: { type: "number", description: "Max results (default 20)" }
    },
    required: ["query"]
  }
}
```

#### `get_customer_profile`

```typescript
{
  name: "get_customer_profile",
  description: "Get comprehensive profile for a customer: features used, issues reported, signal history, sentiment trend. Uses knowledge graph for complete picture.",
  inputSchema: {
    type: "object",
    properties: {
      customer_name: { type: "string", description: "Customer name (fuzzy matching supported)" }
    },
    required: ["customer_name"]
  }
}
```

#### `get_feature_health`

```typescript
{
  name: "get_feature_health",
  description: "Get health report for a feature: adoption count, open issues, recent signals, customer sentiment, dependencies.",
  inputSchema: {
    type: "object",
    properties: {
      feature_name: { type: "string", description: "Feature name (fuzzy matching supported)" }
    },
    required: ["feature_name"]
  }
}
```

#### `get_issue_impact`

```typescript
{
  name: "get_issue_impact",
  description: "Get impact analysis for an issue: affected customers (count and list), severity, frequency, trend direction, related issues.",
  inputSchema: {
    type: "object",
    properties: {
      issue_name: { type: "string", description: "Issue name or description (fuzzy matching supported)" }
    },
    required: ["issue_name"]
  }
}
```

#### `find_related_entities`

```typescript
{
  name: "find_related_entities",
  description: "Find entities related to a given entity using knowledge graph traversal. Discovers non-obvious connections between customers, features, issues, and themes.",
  inputSchema: {
    type: "object",
    properties: {
      entity_name: { type: "string", description: "Entity name to find connections for" },
      entity_type: { type: "string", enum: ["customer", "feature", "issue", "theme", "any"], description: "Type of entity" },
      max_hops: { type: "number", description: "Max relationship hops (1-4, default 2)" }
    },
    required: ["entity_name"]
  }
}
```

### 3.2 Intelligence Tools

#### `get_heatmap`

```typescript
{
  name: "get_heatmap",
  description: "Generate a heatmap showing top issues, features, or themes by customer impact, signal volume, or severity. Returns structured data suitable for analysis.",
  inputSchema: {
    type: "object",
    properties: {
      dimension: { type: "string", enum: ["issues_by_feature", "issues_by_customer", "features_by_customer", "themes_by_signal_volume"], description: "What to visualize" },
      metric: { type: "string", enum: ["customer_count", "signal_count", "severity_weighted"], description: "How to measure (default: customer_count)" },
      limit: { type: "number", description: "Top N items (default 20)" },
      date_from: { type: "string", description: "Start date filter" }
    },
    required: ["dimension"]
  }
}
```

#### `get_trends`

```typescript
{
  name: "get_trends",
  description: "Get trend analysis: emerging, growing, stable, and declining themes/issues/features over a configurable time window.",
  inputSchema: {
    type: "object",
    properties: {
      entity_type: { type: "string", enum: ["theme", "issue", "feature", "customer"], description: "What to analyze trends for" },
      direction: { type: "string", enum: ["emerging", "growing", "stable", "declining", "all"], description: "Filter by trend direction (default: all)" },
      window_days: { type: "number", description: "Time window in days (default: 28)" },
      limit: { type: "number", description: "Top N results (default 15)" }
    },
    required: ["entity_type"]
  }
}
```

#### `get_roadmap_priorities`

```typescript
{
  name: "get_roadmap_priorities",
  description: "Get prioritized list of opportunities with RICE-like scoring breakdown (impact, confidence, effort, strategic alignment, urgency).",
  inputSchema: {
    type: "object",
    properties: {
      filter: { type: "string", enum: ["all", "quick_wins", "strategic", "emerging", "high_confidence"], description: "Priority filter" },
      limit: { type: "number", description: "Max results (default 10)" }
    }
  }
}
```

#### `get_strategic_insights`

```typescript
{
  name: "get_strategic_insights",
  description: "Generate strategic insights by synthesizing signals across all sources. Identifies patterns, risks, and opportunities that span multiple data sources.",
  inputSchema: {
    type: "object",
    properties: {
      focus_area: { type: "string", description: "Optional focus area (e.g., 'security', 'enterprise customers', 'performance')" },
      time_window_days: { type: "number", description: "Time window (default: 30)" }
    }
  }
}
```

### 3.3 Opportunity & Artifact Tools

#### `list_opportunities`

```typescript
{
  name: "list_opportunities",
  description: "List detected opportunities with signal counts and scoring. Opportunities are clusters of related signals that suggest product work.",
  inputSchema: {
    type: "object",
    properties: {
      status: { type: "string", enum: ["new", "reviewing", "accepted", "rejected", "all"], description: "Filter by status" },
      sort_by: { type: "string", enum: ["score", "signal_count", "created_at"], description: "Sort order (default: score)" },
      limit: { type: "number", description: "Max results (default 20)" }
    }
  }
}
```

#### `generate_prd_draft`

```typescript
{
  name: "generate_prd_draft",
  description: "Generate a PRD draft for an opportunity, pulling in all relevant context from the knowledge graph: customer impact, related issues, feature dependencies, competitive context.",
  inputSchema: {
    type: "object",
    properties: {
      opportunity_id: { type: "string", description: "Opportunity UUID to generate PRD for" },
      template: { type: "string", enum: ["standard", "lightweight", "detailed"], description: "PRD template (default: standard)" }
    },
    required: ["opportunity_id"]
  }
}
```

#### `generate_jira_issues`

```typescript
{
  name: "generate_jira_issues",
  description: "Generate JIRA issue drafts from an opportunity. Includes title, description, acceptance criteria, labels, and priority derived from scoring.",
  inputSchema: {
    type: "object",
    properties: {
      opportunity_id: { type: "string", description: "Opportunity UUID" },
      issue_type: { type: "string", enum: ["epic", "story", "bug", "task"], description: "JIRA issue type (default: story)" }
    },
    required: ["opportunity_id"]
  }
}
```

### 3.4 Entity Management Tools

#### `review_pending_entities`

```typescript
{
  name: "review_pending_entities",
  description: "Show entities pending human review — these are entity matches where the system isn't confident enough to auto-merge. Review and accept/reject to improve system accuracy.",
  inputSchema: {
    type: "object",
    properties: {
      entity_type: { type: "string", enum: ["customer", "feature", "issue", "theme", "all"], description: "Filter by type" },
      limit: { type: "number", description: "Max items (default 10)" }
    }
  }
}
```

#### `confirm_entity_merge`

```typescript
{
  name: "confirm_entity_merge",
  description: "Confirm that two entities are the same. This merges them, adds aliases, and improves future resolution accuracy.",
  inputSchema: {
    type: "object",
    properties: {
      feedback_id: { type: "string", description: "Feedback item ID from review_pending_entities" },
      notes: { type: "string", description: "Optional reasoning for the merge" }
    },
    required: ["feedback_id"]
  }
}
```

#### `reject_entity_merge`

```typescript
{
  name: "reject_entity_merge",
  description: "Reject a proposed entity merge — these are different entities that should remain separate.",
  inputSchema: {
    type: "object",
    properties: {
      feedback_id: { type: "string", description: "Feedback item ID from review_pending_entities" },
      notes: { type: "string", description: "Optional reasoning for the rejection" }
    },
    required: ["feedback_id"]
  }
}
```

#### `add_entity_alias`

```typescript
{
  name: "add_entity_alias",
  description: "Manually add an alias to an entity. E.g., tell the system that 'auth' should always resolve to 'Authentication Service'.",
  inputSchema: {
    type: "object",
    properties: {
      entity_name: { type: "string", description: "Canonical entity name" },
      entity_type: { type: "string", enum: ["customer", "feature", "issue", "theme"] },
      alias: { type: "string", description: "New alias to add" }
    },
    required: ["entity_name", "entity_type", "alias"]
  }
}
```

#### `list_entities`

```typescript
{
  name: "list_entities",
  description: "List canonical entities with their aliases, signal counts, and metadata. Useful for reviewing entity coverage.",
  inputSchema: {
    type: "object",
    properties: {
      entity_type: { type: "string", enum: ["customer", "feature", "issue", "theme", "stakeholder"] },
      search: { type: "string", description: "Optional search query to filter entities" },
      limit: { type: "number", description: "Max results (default 25)" }
    },
    required: ["entity_type"]
  }
}
```

### 3.5 Ingestion Tools

#### `ingest_transcript`

```typescript
{
  name: "ingest_transcript",
  description: "Ingest a meeting transcript. Paste the transcript text or provide a file path. The system will extract entities, update the knowledge graph, and make it searchable.",
  inputSchema: {
    type: "object",
    properties: {
      title: { type: "string", description: "Meeting title (e.g., 'Sprint Review - Feb 3')" },
      date: { type: "string", description: "Meeting date (ISO 8601)" },
      content: { type: "string", description: "Transcript text content" },
      file_path: { type: "string", description: "OR path to transcript file (PDF, DOCX, VTT, SRT, TXT)" },
      meeting_type: { type: "string", enum: ["sprint_review", "customer_call", "stakeholder_sync", "team_standup", "product_review", "other"], description: "Type of meeting" },
      participants: { type: "array", items: { type: "string" }, description: "Meeting participants" },
      customer: { type: "string", description: "Customer name (if customer call)" }
    },
    required: ["title"]
  }
}
```

#### `ingest_document`

```typescript
{
  name: "ingest_document",
  description: "Ingest a document (PPT, Word, Excel, PDF). The system will parse, extract entities, and add to the knowledge graph.",
  inputSchema: {
    type: "object",
    properties: {
      file_path: { type: "string", description: "Path to the document file" },
      title: { type: "string", description: "Document title" },
      document_type: { type: "string", enum: ["competitive_analysis", "customer_email", "product_spec", "market_research", "internal_report", "presentation", "spreadsheet", "other"] },
      customer: { type: "string", description: "Related customer (if applicable)" },
      tags: { type: "array", items: { type: "string" }, description: "Tags for categorization" }
    },
    required: ["file_path"]
  }
}
```

### 3.6 Provenance & Confidence Tools

#### `get_provenance`

```typescript
{
  name: "get_provenance",
  description: "Trace any insight, number, or claim back to its source signals. Returns the full evidence chain.",
  inputSchema: {
    type: "object",
    properties: {
      claim: { type: "string", description: "The insight or claim to trace (e.g., '47 customers affected by auth issue')" },
      entity_id: { type: "string", description: "OR: entity ID to get provenance for" },
      opportunity_id: { type: "string", description: "OR: opportunity ID to trace" }
    }
  }
}
```

#### `get_entity_resolution_stats`

```typescript
{
  name: "get_entity_resolution_stats",
  description: "Show entity resolution accuracy metrics: auto-merge rate, human review rate, accuracy trend over time. Useful for monitoring system health.",
  inputSchema: {
    type: "object",
    properties: {
      window_days: { type: "number", description: "Time window (default: 30)" },
      entity_type: { type: "string", enum: ["customer", "feature", "issue", "theme", "all"] }
    }
  }
}
```

### 3.7 System Tools

#### `get_system_health`

```typescript
{
  name: "get_system_health",
  description: "Get system health: database status, Neo4j sync status, pending ingestion jobs, entity resolution queue size, last pipeline run.",
  inputSchema: { type: "object", properties: {} }
}
```

#### `run_pipeline`

```typescript
{
  name: "run_pipeline",
  description: "Trigger the full processing pipeline: re-run entity extraction, resolution, and graph sync for recent signals. Use after bulk ingestion.",
  inputSchema: {
    type: "object",
    properties: {
      scope: { type: "string", enum: ["recent", "unprocessed", "all"], description: "What to process (default: unprocessed)" },
      skip_ingestion: { type: "boolean", description: "Skip ingestion, only run extraction+resolution+sync" }
    }
  }
}
```

---

## 4. Response Format

All MCP tool responses follow a consistent format:

```typescript
interface McpToolResponse {
  data: any;                          // The actual response data
  metadata: {
    source: string;                   // Which service(s) produced this
    query_time_ms: number;            // Total query time
    confidence?: number;              // Overall confidence (0-1) if applicable
    provenance?: ProvenanceChain;     // Source chain if applicable
    result_count?: number;            // Number of items returned
    total_count?: number;             // Total items available (for pagination)
  };
}
```

---

## 5. Error Handling

```typescript
// MCP tools return structured errors
interface McpToolError {
  error: {
    code: string;                     // 'NOT_FOUND', 'VALIDATION_ERROR', 'SERVICE_UNAVAILABLE'
    message: string;                  // Human-readable error message
    suggestion?: string;              // "Did you mean 'Authentication Service'?"
    alternatives?: string[];          // Fuzzy matches if entity not found
  };
}
```

When an entity name doesn't match exactly, the MCP tool should:
1. Try fuzzy matching via alias table
2. Try embedding similarity search
3. If no match: return error with closest alternatives

---

### 3.8 Missing Capability Tools

#### `split_entity`

```typescript
{
  name: "split_entity",
  description: "Split a wrongly merged entity into two separate entities. The system will re-evaluate which signals belong to which entity. Use when you discover two different things were incorrectly merged.",
  inputSchema: {
    type: "object",
    properties: {
      entity_name: { type: "string", description: "Current canonical entity name to split" },
      entity_type: { type: "string", enum: ["customer", "feature", "issue", "theme"] },
      new_entity_name: { type: "string", description: "Name for the second entity after split" },
      notes: { type: "string", description: "Why these should be separate" }
    },
    required: ["entity_name", "entity_type", "new_entity_name"]
  }
}
```

#### `what_if_analysis`

```typescript
{
  name: "what_if_analysis",
  description: "Analyze the impact of fixing an issue or building a feature. Returns affected customers, related issues, downstream dependencies.",
  inputSchema: {
    type: "object",
    properties: {
      action: { type: "string", enum: ["fix_issue", "build_feature", "deprecate_feature"] },
      entity_name: { type: "string", description: "Issue or feature name" }
    },
    required: ["action", "entity_name"]
  }
}
```

#### `export_data`

```typescript
{
  name: "export_data",
  description: "Export system data for backup, reporting, or compliance. Returns structured data in the requested format.",
  inputSchema: {
    type: "object",
    properties: {
      export_type: { type: "string", enum: ["entities", "signals", "opportunities", "knowledge_graph", "feedback_log", "full_backup"] },
      format: { type: "string", enum: ["json", "csv"], description: "Output format (default: json)" },
      date_from: { type: "string", description: "Start date filter" },
      date_to: { type: "string", description: "End date filter" }
    },
    required: ["export_type"]
  }
}
```

#### `get_dlq_status`

```typescript
{
  name: "get_dlq_status",
  description: "Show dead letter queue status — signals that failed processing. Review and retry or abandon failed items.",
  inputSchema: {
    type: "object",
    properties: {
      failure_stage: { type: "string", enum: ["extraction", "entity_resolution", "neo4j_sync", "embedding", "all"] },
      limit: { type: "number", description: "Max items (default 10)" }
    }
  }
}
```

#### `retry_dlq_item`

```typescript
{
  name: "retry_dlq_item",
  description: "Retry a specific dead letter queue item that previously failed processing.",
  inputSchema: {
    type: "object",
    properties: {
      dlq_id: { type: "string", description: "Dead letter queue item ID" }
    },
    required: ["dlq_id"]
  }
}
```

### 3.9 Onboarding & Exploration Tools (New PM Persona)

#### `browse_knowledge_graph`

```typescript
{
  name: "browse_knowledge_graph",
  description: "Browse the knowledge graph for exploration and onboarding. Returns entities, relationships, and linked signals starting from a root entity or product area. Supports open-ended exploration when you don't know what to search for.",
  inputSchema: {
    type: "object",
    properties: {
      root_entity_type: { type: "string", enum: ["customer", "feature", "issue", "theme", "stakeholder", "all"], description: "Entity type to start browsing from" },
      root_entity_name: { type: "string", description: "Specific entity to start from (optional — omit for all entities of this type)" },
      filter_area: { type: "string", description: "Product area filter (e.g., 'Payments', 'API Platform')" },
      depth: { type: "number", description: "Relationship traversal depth (default: 1, max: 3)" },
      include_aliases: { type: "boolean", description: "Include entity aliases in response (default: false)" },
      include_descriptions: { type: "boolean", description: "Include entity descriptions (default: false)" },
      include_signal_counts: { type: "boolean", description: "Include signal counts per entity (default: true)" },
      limit: { type: "number", description: "Max entities to return (default: 25)" }
    }
  }
}
```

#### `get_knowledge_summary`

```typescript
{
  name: "get_knowledge_summary",
  description: "Get a comprehensive summary of a product area or the entire knowledge graph. Returns counts, top entities, trends, and health indicators. Designed for onboarding PMs who need the full landscape at a glance.",
  inputSchema: {
    type: "object",
    properties: {
      scope: { type: "string", enum: ["product_area", "full_system"], description: "Summary scope" },
      name: { type: "string", description: "Product area name (required if scope is 'product_area')" },
      include_trends: { type: "boolean", description: "Include 30-day trend data (default: true)" },
      include_stakeholders: { type: "boolean", description: "Include frequently mentioned stakeholders (default: true)" },
      include_opportunities: { type: "boolean", description: "Include open opportunities (default: true)" }
    }
  }
}
```

### 3.10 Report & Artifact Generation Tools (PM Leader + Stakeholder Personas)

#### `generate_shareable_report`

```typescript
{
  name: "generate_shareable_report",
  description: "Generate a self-contained, shareable report for stakeholders who don't use the system. Output is formatted text ready for email, Slack, or presentation. Includes data provenance and freshness indicators.",
  inputSchema: {
    type: "object",
    properties: {
      report_type: { 
        type: "string", 
        enum: [
          "customer_health_summary",
          "roadmap_summary", 
          "customer_impact_brief",
          "weekly_digest",
          "competitive_intel",
          "product_area_overview"
        ],
        description: "Type of report to generate" 
      },
      time_window_days: { type: "number", description: "Time window for data (default: 30)" },
      format: { type: "string", enum: ["executive_summary", "detailed", "one_pager"], description: "Level of detail (default: executive_summary)" },
      audience: { type: "string", enum: ["leadership", "engineering", "design", "cs_sales", "general"], description: "Target audience — affects language and focus" },
      filter_area: { type: "string", description: "Product area filter (optional — omit for portfolio-wide)" },
      filter_customer: { type: "string", description: "Customer filter (optional — for customer-specific reports)" }
    },
    required: ["report_type"]
  }
}
```

#### `generate_artifact`

```typescript
{
  name: "generate_artifact",
  description: "Generate a structured artifact (PRD, JIRA issue, RFC) with data-backed sections and source provenance. Designed for cross-functional consumption. Leaves strategic/solution sections for PM to fill in.",
  inputSchema: {
    type: "object",
    properties: {
      artifact_type: { type: "string", enum: ["prd", "jira", "rfc", "one_pager"], description: "Artifact type" },
      opportunity_id: { type: "string", description: "Opportunity to base the artifact on" },
      entity_name: { type: "string", description: "OR: entity name to base the artifact on (if no opportunity)" },
      include_provenance: { type: "boolean", description: "Include full source provenance (default: true)" },
      audience: { type: "string", enum: ["engineering", "design", "leadership", "cs_sales", "general"], description: "Target audience — adjusts language and detail level" }
    },
    required: ["artifact_type"]
  }
}
```

---

## 6. Authentication & Security

For V2 (single-PM, local deployment):
- MCP server runs on localhost only
- No authentication required for MCP tool calls
- All operations logged to audit trail
- LLM prompts are sandboxed (no prompt injection from signal content)

For V3+ (multi-PM, multi-persona):
- API key authentication per MCP connection
- Role-based tool access (PM vs. PM Leader vs. read-only)
- Rate limiting per user
- Audit log tags user persona for tool usage analytics

---

## 7. Disambiguation & Ambiguity Handling

When a PM query is ambiguous, the MCP tool should help disambiguate:

```typescript
// Example: PM asks about "Acme" — could be Customer "Acme Corporation" or Feature "Acme Integration"

// Tool response when ambiguous:
{
  error: {
    code: "AMBIGUOUS_ENTITY",
    message: "Found multiple entities matching 'Acme'",
    candidates: [
      { type: "customer", name: "Acme Corporation", signal_count: 47, confidence: 0.95 },
      { type: "feature", name: "Acme Integration", signal_count: 3, confidence: 0.60 }
    ],
    suggestion: "Did you mean customer 'Acme Corporation' (47 signals) or feature 'Acme Integration' (3 signals)?"
  }
}

// Claude then asks PM to clarify, and retries with the specific entity
```

---

## 8. Progressive Disclosure

For large result sets, MCP tools return summaries first with the ability to drill down:

```typescript
// get_heatmap returns summary + top items
{
  data: {
    summary: "23 active issues across 12 features affecting 45 customers",
    top_items: [ /* top 10 */ ],
    total_items: 87,
    has_more: true,
    drill_down_hint: "Use get_issue_impact with a specific issue name for details"
  }
}
```

---

## 9. Complete Tool Count (V2)

Total MCP tools: **31**

| Category | Count | Tools | Primary Persona |
|----------|-------|-------|-----------------|
| Search & Query | 5 | search_signals, get_customer_profile, get_feature_health, get_issue_impact, find_related_entities | PM (Daily Driver) |
| Intelligence | 4 | get_heatmap, get_trends, get_roadmap_priorities, get_strategic_insights | PM, PM Leader |
| Opportunities & Artifacts | 2 | list_opportunities, generate_artifact | PM, Stakeholder (indirect) |
| Report Generation | 1 | generate_shareable_report | PM Leader, Stakeholder (indirect) |
| Entity Management | 6 | review_pending_entities, confirm_entity_merge, reject_entity_merge, add_entity_alias, list_entities, split_entity | PM (Daily Driver) |
| Onboarding & Exploration | 2 | browse_knowledge_graph, get_knowledge_summary | New PM (Ramp-Up) |
| Ingestion | 2 | ingest_transcript, ingest_document | PM, New PM (bulk) |
| Provenance & Stats | 2 | get_provenance, get_entity_resolution_stats | PM, PM Leader |
| Analysis | 2 | what_if_analysis, export_data | PM, PM Leader |
| System | 4 | get_system_health, run_pipeline, get_dlq_status, retry_dlq_item | PM |
| Agent Management | 5 | review_agent_outputs, rollback_agent, list_registered_agents, deactivate_agent, configure_stakeholder_access | PM |

**Total: 35 MCP tools** (31 previous + 4 new agent management + stakeholder access configuration)

**New tools (agent management):**

| Tool | Purpose | Primary Persona |
|------|---------|-----------------|
| `review_agent_outputs` | Review agent outputs pending PM feedback (grouped by agent) — accept, correct, reject | PM |
| `rollback_agent` | Roll back an agent to a previous version when quality degrades | PM |
| `list_registered_agents` | List all agents with status, version, SLOs, cost, recent activity | PM, PM Leader |
| `deactivate_agent` | Manually pause an agent (with reason) | PM |
| `configure_stakeholder_access` | Set stakeholder team access scope (product areas, entity types, data freshness) | PM |

### 9.1 Persona-to-Tool Mapping (MCP — Human Personas)

| Persona | Most Used Tools | Frequency |
|---------|----------------|-----------|
| **PM (Daily Driver)** | search_signals, get_customer_profile, review_pending_entities, review_agent_outputs, get_trends, generate_artifact, ingest_transcript | Daily, multiple times |
| **PM Leader (Strategist)** | get_heatmap, get_trends, get_roadmap_priorities, generate_shareable_report, get_strategic_insights, list_registered_agents | Weekly |
| **New PM (Ramp-Up)** | browse_knowledge_graph, get_knowledge_summary, get_customer_profile, list_entities | Daily during onboarding |

### 9.2 Agent Gateway API (Agent Personas)

Agents do NOT use MCP tools. They use the Agent Gateway REST API which exposes equivalent functionality with agent-appropriate semantics (API key auth, rate limiting, idempotent writes, event subscription).

See [16_AGENTIC_INTERACTIONS.md §5.2](./16_AGENTIC_INTERACTIONS.md) for the full Agent Gateway endpoint specification.

| Agent | Primary Endpoints | Direction |
|-------|------------------|-----------|
| **Triage Agent** | GET /api/agents/signals, POST /api/agents/issues/flag, SSE events | Bidirectional |
| **Report Scheduler** | POST /api/agents/reports/generate | Outbound (reads, generates) |
| **JIRA Sync Agent** | POST /api/agents/entities/link, POST /api/agents/entities/status | Bidirectional |
| **Slack Alert Bot** | SSE event subscription | Outbound (events → Slack) |
| **Data Quality Agent** | GET /api/agents/er-stats, POST /api/agents/entities/propose | Bidirectional |
| **Sprint Planning Agent** | GET /api/agents/opportunities, GET /api/agents/provenance | Read-only |
| **Workflow Agent (n8n/Zapier)** | POST /api/agents/ingest | Inbound (write) |
| **Stakeholder Access Agent** | GET /api/agents/entities, GET /api/agents/heatmap, GET /api/agents/health, GET /api/agents/reports/latest | Read-only (scoped) |

---

## 10. API Versioning & Deprecation Policy

### 10.1 Versioning Strategy

The system uses **three protocols** with distinct versioning approaches:

| Protocol | Versioning Mechanism | Current Version | Breaking Change Strategy |
|----------|---------------------|-----------------|--------------------------|
| **MCP Server** | `serverInfo.version` in MCP handshake | `2.0.0` | Additive only (new tools, new optional params). Never remove tools within a major version. |
| **A2A Server** | `version` field in Agent Card | `2.6.0` | Agent Card `version` bumped on skill changes. Clients re-fetch Agent Card to discover changes. |
| **Agent Gateway REST** | URL path prefix: `/api/agents/v1/...` | `v1` | New major versions use new prefix (`/api/agents/v2/...`). Old versions remain live for 90 days after deprecation. |

### 10.2 REST API Versioning Rules

```
1. BASE PATH: All Agent Gateway endpoints are prefixed with /api/agents/v1/
   Example: GET /api/agents/v1/signals?entity_type=customer

2. VERSION LIFECYCLE:
   Active     → Endpoint is fully supported, receives new features
   Deprecated → Endpoint returns Deprecation header, still functional, no new features
   Sunset     → Endpoint returns 410 Gone with migration guide URL

3. TIMELINE:
   - New version announced: V(n+1) endpoints go live alongside V(n)
   - Deprecation: V(n) marked deprecated, Deprecation header added
   - Sunset: V(n) removed after 90 days minimum from deprecation date

4. HEADERS (on deprecated endpoints):
   Deprecation: Sat, 01 Jan 2027 00:00:00 GMT
   Sunset: Sat, 01 Apr 2027 00:00:00 GMT
   Link: </api/agents/v2/signals>; rel="successor-version"
```

### 10.3 MCP Tool Evolution Rules

MCP tools are more constrained — Claude Code/Cowork cannot easily handle breaking tool changes.

```
ALLOWED (non-breaking):
  ✓ Add new MCP tools
  ✓ Add optional parameters to existing tools
  ✓ Add new fields to response objects
  ✓ Expand enum values (e.g., add new entity_type)
  ✓ Increase limits (e.g., raise max_results from 50 to 100)
  ✓ Improve descriptions and examples

NOT ALLOWED (breaking — requires major version bump):
  ✗ Remove an existing MCP tool
  ✗ Rename a tool
  ✗ Remove or rename a required parameter
  ✗ Change parameter types
  ✗ Reduce limits below previous defaults
  ✗ Change response structure for existing fields
```

### 10.4 MCP Tool Deprecation Process

When a tool must eventually be removed:

```
Step 1: Mark deprecated (V2.x — keep functional)
  - Add deprecation notice to tool description:
    "[DEPRECATED — use <new_tool> instead. Will be removed in V3.0.]"
  - Log a warning each time the deprecated tool is invoked
  - Add a "deprecated_tools" list to MCP server metadata

Step 2: Shadow period (minimum 30 days)
  - Deprecated tool delegates to replacement tool internally
  - Both tools return identical results
  - Monitor: if invocation count drops to 0 for 14 days, safe to remove

Step 3: Remove in next major version (V3.0)
  - Tool removed from MCP server
  - Migration guide published
```

### 10.5 A2A Agent Card Evolution

```
The Agent Card (/.well-known/agent.json) is the source of truth for external agents.

Rules:
  1. Skills can be ADDED at any time (bump Agent Card version)
  2. Skills can be DEPRECATED: add "deprecated: true" to skill metadata
  3. Skills REMOVED only in major version bumps (90-day notice)
  4. Agent Card MUST always be re-fetchable (agents poll for changes)
  5. Backward-compatible changes: bump minor version (2.6.0 → 2.7.0)
  6. Breaking changes: bump major version (2.6.0 → 3.0.0)
```

### 10.6 Schema Migration Compatibility

Database schema changes follow the same additive principle:

```
ALLOWED (V2.x):
  ✓ Add new tables
  ✓ Add nullable columns to existing tables
  ✓ Add new indexes
  ✓ Add new constraints on new columns only
  ✓ Backfill data into new columns

NOT ALLOWED (requires migration script + version bump):
  ✗ Drop tables or columns
  ✗ Rename columns
  ✗ Change column types
  ✗ Add NOT NULL constraint to existing column with NULL data
  ✗ Modify existing CHECK constraints
```
