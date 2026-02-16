# PM Intelligence System V2 — API Reference

> **For:** Agent developers, integration engineers, automation tool builders
> **Version:** 1.0
> **Last Updated:** 2026-02-09
> **Base URL:** `http://localhost:3000`

---

## Overview

PM Intelligence exposes three protocols for programmatic access:

| Protocol | Audience | Endpoint | Auth |
|----------|----------|----------|------|
| **MCP Server** | Human personas via Claude Code/Cowork | stdio or `:3001` | None (MCP host handles) |
| **A2A Server** | External AI agents | `/a2a` | API key (`X-API-Key`) |
| **Agent Gateway REST** | Simple integrations (n8n, Zapier, scripts, ChatGPT Actions) | `/api/agents/v1/` | `X-API-Key` |

This reference covers the **Agent Gateway REST API** and the **A2A Server**. For MCP tools, see the User Guide or `specs/v2/05_MCP_SERVER.md`.

---

## ChatGPT Enterprise Actions

Use the OpenAPI spec at `docs/v2/openapi/agent_gateway.json` to add the Agent Gateway as an Action in ChatGPT Enterprise. See `docs/v2/CHATGPT_ENTERPRISE_INTEGRATION.md`.
You can also fetch it from the running server at `http://localhost:3000/openapi/agent_gateway.json`.

---

## Web UI

The built-in UI is served at `http://localhost:3000/ui`. It uses the Agent Gateway API for data access.

---

## 1. Authentication

### API Key

Every registered agent gets a unique 256-bit API key at registration time. The key is shown once and stored as a bcrypt hash.

If `AGENT_REGISTRATION_SECRET` is configured, `POST /api/agents/v1/auth/register` requires
`X-Registration-Secret: <value>`.

**For REST (Agent Gateway):**
```
X-API-Key: agent_xxx
```

**For A2A:**
```
X-API-Key: agent_xxx
```

### Rate Limits

| Type | Default | Header |
|------|---------|--------|
| Read requests | 60/minute | `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset` |
| Write requests | 20/minute | Same headers |

Exceeding limits returns `429 Too Many Requests`.

### Idempotency

`Idempotency-Key` is supported for `POST /api/agents/v1/ingest`. When provided, the gateway will return the original `signal_id` for repeated requests from the same agent.

---

## 2. Agent Gateway REST API

### 2.1 Signals

#### Search Signals

```
GET /api/agents/v1/signals
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `query` | string | Yes | Natural language query |
| `source` | string | No | Filter by source (`slack`, `transcript`, `document`, `web_scrape`, `jira`, `wiki`) |
| `customer` | string | No | Filter by customer name |
| `feature` | string | No | Filter by feature name |
| `theme` | string | No | Filter by theme |
| `date_from` | ISO date | No | Start date |
| `date_to` | ISO date | No | End date |
| `limit` | integer | No | Max results (default 20, max 50) |

**Response:**
```json
{
  "signals": [
    {
      "id": "sig_abc123",
      "content": "Acme Corp reported auth timeout again...",
      "source": "slack",
      "source_channel": "#customer-support",
      "timestamp": "2026-02-09T10:30:00Z",
      "entities": [
        { "name": "Acme Corp", "type": "customer", "confidence": 0.95 },
        { "name": "Auth Timeout", "type": "issue", "confidence": 0.92 }
      ],
      "sentiment": "negative",
      "urgency": "high"
    }
  ],
  "total": 47,
  "limit": 20,
  "offset": 0
}
```

#### Ingest Signal

```
POST /api/agents/v1/ingest
```

Headers: `Idempotency-Key` optional (recommended for safe retries).

**Request body:**
```json
{
  "source": "external_agent",
  "source_identifier": "triage-agent-finding-001",
  "content": "Customer Acme Corp reports intermittent 502 errors on the API Gateway",
  "metadata": {
    "agent_name": "triage_agent",
    "detected_at": "2026-02-09T10:30:00Z",
    "urgency": "high"
  }
}
```

**Response:** `201 Created` (new signal) or `200 OK` (idempotent replay)
```json
{
  "signal_id": "sig_def456",
  "status": "ok",
  "idempotent": false
}
```

#### Query Knowledge

```
POST /api/agents/v1/query
```

**Request body:**
```json
{
  "query": "What are the top customer issues this month?",
  "limit": 10,
  "source": "slack",
  "customer": "Acme",
  "feature": "Checkout",
  "theme": "latency"
}
```

**Response:**
```json
{
  "query": "What are the top customer issues this month?",
  "answer": "…",
  "confidence": 0.72,
  "supporting_signals": [
    { "id": "sig_123", "source": "slack", "snippet": "…", "created_at": "2026-02-10T10:00:00Z" }
  ]
}
```

### 2.2 Entities

#### List Entities

```
GET /api/agents/v1/entities
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `query` | string | No | Search by name (fuzzy) |
| `limit` | integer | No | Default 25, max 100 |

**Response:**
```json
{
  "entities": [
    {
      "id": "ent_abc123",
      "canonical_name": "Acme Corporation",
      "type": "customer",
      "aliases": ["Acme Corp", "Acme", "ACME"],
      "signal_count": 47,
      "confidence": 0.95,
      "first_seen": "2025-11-01T00:00:00Z",
      "last_signal": "2026-02-09T10:30:00Z"
    }
  ],
  "total": 312
}
```

#### Propose Entity Merge

```
POST /api/agents/v1/entities/propose
```

Agents can propose entity merges or aliasing. This creates a feedback entry for human review.

```json
{
  "entity_name": "Acme Corp",
  "entity_type": "customer",
  "candidate_entity_id": "ent_abc123",
  "confidence": 0.82,
  "notes": "Alias from CRM import"
}
```

**Response:** `201 Created` (queued for human review)

### 2.3 Intelligence

#### Get Heatmap

```
GET /api/agents/v1/heatmap
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `dimension` | string | Yes | `issues_by_customer`, `issues_by_product_area`, `features_by_customer` |
| `metric` | string | No | `count` (default), `severity_weighted` |
| `limit` | integer | No | Max rows (default 15) |

**Response:**
```json
{
  "dimension": "issues_by_customer",
  "metric": "severity_weighted",
  "rows": [
    {
      "x": "Auth Timeout",
      "y": "Acme Corp",
      "value": 12
    }
  ],
  "generated_at": "2026-02-09T14:30:00Z"
}
```

#### Get Trends

```
GET /api/agents/v1/trends
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `entity_type` | string | No | `customer`, `feature`, `issue`, `theme` |
| `direction` | string | No | `emerging`, `declining`, `stable`, `all` |
| `window_days` | integer | No | Time window (default 7, max 90) |

### 2.4 Reports

#### Generate Report

```
POST /api/agents/v1/reports/generate
```

```json
{
  "report_type": "weekly_digest",
  "scope": "all",
  "format": "markdown"
}
```

Report types: `weekly_digest`, `customer_health`, `issue_summary`, `trend_analysis`, `executive_brief`, `competitive_intel`.

**Response:** `200 OK`
```json
{
  "report": "# WEEKLY DIGEST\n\nTime window: last 30 days\n..."
}
```

#### Get Latest Report

_Note: `/api/agents/v1/reports/latest` is not implemented in V2. Use `POST /api/agents/v1/reports/generate`._

### 2.5 Issues

#### Flag Issue

```
POST /api/agents/v1/issues/flag
```

```json
{
  "entity_name": "Auth Timeout",
  "urgency": "critical",
  "reason": "12 new reports in last 4 hours from 3 enterprise customers",
  "affected_customers": ["Acme Corp", "BigCorp", "DataFlow"],
  "recommended_action": "Escalate to engineering on-call"
}
```

**Response:** `202 Accepted` (creates feedback entry + alert)

### 2.6 Source Registry

#### List Sources

```
GET /api/agents/v1/sources
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `type` | string | No | Filter by source type |
| `status` | string | No | `connected`, `error`, `disabled` |

#### Register Source

```
POST /api/agents/v1/sources
```

```json
{
  "source_name": "crawler_bot",
  "source_type": "web_scrape",
  "status": "connected",
  "config": { "schedule": "0 */6 * * *" }
}
```

#### Update Source

```
PATCH /api/agents/v1/sources/{id}
```

```json
{
  "status": "error",
  "config": { "last_error": "timeout" }
}
```

### 2.7 Entity Resolution Stats

```
GET /api/agents/v1/er-stats
```

**Response:**
```json
{
  "accuracy_30d": 0.91,
  "total_entities": 487,
  "pending_reviews": 7,
  "auto_merged_30d": 145,
  "human_reviewed_30d": 23,
  "false_positive_rate_30d": 0.03
}
```

### 2.8 System Health

```
GET /api/agents/v1/health
```

**Response:**
```json
{
  "status": "ok",
  "timestamp": "2026-02-09T14:30:00Z"
}
```

### 2.9 Events

#### Subscribe to Events (SSE)

```
GET /api/agents/v1/events/stream
```

Returns a Server-Sent Events stream. Events include:

| Event Type | Payload | When |
|-----------|---------|------|
| `signal.ingested` | `{ signal_id, source }` | New signal processed |
| `pipeline.completed` | `{ signal_id }` | Pipeline finished for a signal |
| `entity.created` | `{ entity_id, canonical_name, entity_type }` | New entity discovered |
| `entity.merged` | `{ canonical_entity_id, alias, feedback_id }` | Alias merge accepted |

**Example SSE stream:**
```
event: signal.ingested
data: {"signal_id":"sig_abc","source":"slack","entity_count":3}

event: entity.created
data: {"entity_id":"ent_def","name":"New Feature X","type":"feature"}
```

#### Event History (Replay)

```
GET /api/agents/v1/events/history
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `event_type` | string | No | Filter by event type |
| `since` | ISO date | No | Events after this time |
| `limit` | integer | No | Default 100, max 1000 |

---

## 2.10 Ingestion REST API (Internal)

These endpoints are intended for internal workflows and manual uploads. For external agents, use the Agent Gateway `/ingest` endpoint.

### Ingest Transcript

```
POST /api/ingest/transcript
```

```json
{
  "title": "Customer sync - Feb 10",
  "content": "...",
  "meeting_type": "customer",
  "customer": "Acme Corp",
  "date": "2026-02-10T10:00:00Z",
  "metadata": { "source": "manual" }
}
```

### Ingest Document

```
POST /api/ingest/document
```

Multipart form with `file` and optional `metadata` JSON string.

### Ingest Crawled Web Content

```
POST /api/ingest/crawled
```

```json
{
  "url": "https://example.com",
  "content": "extracted page text",
  "captured_at": "2026-02-10T10:00:00Z",
  "metadata": { "source": "crawler" }
}
```

---

## 3. A2A Server (Agent-to-Agent Protocol)

### 3.1 Discovery

Fetch the Agent Card:

```
GET /.well-known/agent.json
```

**Response:**
```json
{
  "name": "PM Intelligence System",
  "description": "Product management knowledge graph with customer, feature, and issue intelligence",
  "version": "2.6.0",
  "url": "http://localhost:3000/a2a",
  "authentication": {
    "schemes": ["apiKey"],
    "credentials": { "in": "header", "name": "X-API-Key" }
  },
  "skills": [
    {
      "id": "query-knowledge",
      "name": "Query Knowledge",
      "description": "Answer a natural language question with supporting signals"
    },
    {
      "id": "ingest-signal",
      "name": "Ingest Signal",
      "description": "Submit a new signal for processing through the extraction and ER pipeline"
    },
    {
      "id": "query-heatmap",
      "name": "Issue Heatmap",
      "description": "Generate issue/feature heatmaps across customers"
    },
    {
      "id": "query-trends",
      "name": "Get Trends",
      "description": "Retrieve emerging, declining, or stable trends"
    },
    {
      "id": "query-customer-profile",
      "name": "Customer Profile",
      "description": "Retrieve comprehensive customer profile with issues, features, signals"
    },
    {
      "id": "query-opportunities",
      "name": "Opportunity Priorities",
      "description": "Retrieve prioritized opportunities and scores"
    },
    {
      "id": "generate-report",
      "name": "Generate Report",
      "description": "Generate various report types (weekly digest, customer health, etc.)"
    },
    {
      "id": "propose-entity-change",
      "name": "Entity Change Proposal",
      "description": "Propose entity merges or cleanup for human review"
    },
    {
      "id": "query-provenance",
      "name": "Provenance Chain",
      "description": "Trace an insight back to source signals"
    }
  ]
}
```

### 3.2 Sending Tasks (JSON-RPC 2.0)

```
POST /a2a
Content-Type: application/json
X-API-Key: pm_intel_ak_abc123...
```

**Request:**
```json
{
  "jsonrpc": "2.0",
  "method": "tasks/send",
  "params": {
    "id": "task-unique-id-001",
    "message": {
      "role": "user",
      "parts": [
        {
          "type": "text",
          "text": "Which customers are affected by the auth timeout issue?"
        }
      ]
    },
    "skill_id": "query-knowledge"
  },
  "id": "req-001"
}
```

**Response:**
```json
{
  "jsonrpc": "2.0",
  "result": {
    "id": "task-unique-id-001",
    "status": {
      "state": "completed"
    },
    "artifacts": [
      {
        "parts": [
          {
            "type": "text",
            "text": "12 customers are affected by Auth Timeout...\n\nTop affected:\n1. Acme Corp — 8 reports..."
          }
        ]
      }
    ]
  },
  "id": "req-001"
}
```

### 3.3 Task Lifecycle

A2A tasks go through these states:

```
submitted → working → completed
                    → failed
                    → canceled
```

For long-running tasks (report generation, bulk ingestion), use streaming:

```
POST /a2a
```
```json
{
  "jsonrpc": "2.0",
  "method": "tasks/sendSubscribe",
  "params": {
    "id": "task-long-001",
    "message": {
      "role": "user",
      "parts": [{ "type": "text", "text": "Generate a full portfolio report" }]
    },
    "skill_id": "generate-report"
  },
  "id": "req-002"
}
```

The response streams as SSE with task status updates.

### 3.4 Checking Task Status

```json
{
  "jsonrpc": "2.0",
  "method": "tasks/get",
  "params": { "id": "task-unique-id-001" },
  "id": "req-003"
}
```

---

## 4. Error Responses

### HTTP Error Codes

| Code | Meaning | When |
|------|---------|------|
| `400` | Bad Request | Invalid parameters, malformed JSON, validation failure |
| `401` | Unauthorized | Missing or invalid API key |
| `403` | Forbidden | Agent lacks permission for this operation |
| `404` | Not Found | Entity, signal, or resource not found |
| `413` | Payload Too Large | File exceeds 50MB limit |
| `415` | Unsupported Media Type | File type not in allowlist |
| `429` | Too Many Requests | Rate limit exceeded |
| `503` | Service Unavailable | Agent circuit breaker open; dependency down |

### Error Response Format

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "entity_type must be one of: customer, feature, issue, theme",
    "details": {
      "field": "entity_type",
      "provided": "unknown",
      "allowed": ["customer", "feature", "issue", "theme"]
    }
  }
}
```

### A2A Error Format (JSON-RPC)

```json
{
  "jsonrpc": "2.0",
  "error": {
    "code": -32602,
    "message": "Invalid params: skill_id 'unknown_skill' not found",
  "data": { "available_skills": ["query-knowledge", "ingest-signal", "..."] }
  },
  "id": "req-001"
}
```

---

## 5. Rate Limits & Quotas

| Resource | Limit | Per |
|----------|-------|-----|
| Read requests | 60 | minute per agent |
| Write requests | 20 | minute per agent |
| Signal ingestion | 100 | per batch |
| File upload | 50MB | per file |
| File batch | 20 files / 200MB | per batch |
| Monthly LLM cost | $50 (configurable) | per agent per month |
| Event SSE connections | 1 | per agent |
| Event history replay | 10 | requests per minute |

---

## 6. Webhooks (Alternative to SSE)

For agents that cannot maintain SSE connections, register a webhook:

```
POST /api/agents/v1/events/webhook
To unregister:
```
DELETE /api/agents/v1/events/webhook
```
```

```json
{
  "webhook_url": "https://my-agent.example.com/webhook",
  "event_subscriptions": ["signal.ingested", "pipeline.completed"]
}
```

Webhook delivery is handled by the event dispatcher. Failed deliveries are logged in `agent_activity_log`.

---

## 7. SDK Examples

### Python

```python
import requests

BASE_URL = "http://localhost:3000/api/agents/v1"
API_KEY = "pm_intel_ak_abc123..."
HEADERS = {"X-API-Key": API_KEY}

# Search signals
signals = requests.get(f"{BASE_URL}/signals",
    headers=HEADERS,
    params={"query": "auth timeout", "limit": 10}
).json()

# Get heatmap
heatmap = requests.get(f"{BASE_URL}/heatmap",
    headers=HEADERS,
    params={"dimension": "issues_by_customer", "metric": "severity_weighted"}
).json()

# Ingest a signal
resp = requests.post(f"{BASE_URL}/ingest",
    headers=HEADERS,
    json={
        "source": "external_agent",
        "source_identifier": "my-agent-finding-001",
        "content": "Customer reports intermittent 502 errors"
    }
)
```

### Node.js / TypeScript

```typescript
const BASE_URL = 'http://localhost:3000/api/agents/v1';
const API_KEY = 'pm_intel_ak_abc123...';

// Search entities
const entities = await fetch(`${BASE_URL}/entities?query=payments`, {
  headers: { 'X-API-Key': API_KEY },
}).then(r => r.json());

// Poll events history
const events = await fetch(`${BASE_URL}/events/history`, {
  headers: { 'X-API-Key': API_KEY },
}).then(r => r.json());
eventSource.addEventListener('signal.ingested', (event) => {
  const data = JSON.parse(event.data);
  console.log(`New signal: ${data.signal_id} from ${data.source}`);
});
```

### cURL

```bash
# List customers
curl -H "X-API-Key: $API_KEY" \
  "$BASE_URL/entities?type=customer&limit=5"

# Flag an issue
curl -X POST -H "X-API-Key: $API_KEY" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: flag-$(date +%s)" \
  -d '{"entity_name":"Auth Timeout","urgency":"critical","reason":"Spike detected"}' \
  "$BASE_URL/issues/flag"
```
