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
| **Agent Gateway REST** | Simple integrations (n8n, Zapier, scripts) | `/api/agents/v1/` | Bearer token |

This reference covers the **Agent Gateway REST API** and the **A2A Server**. For MCP tools, see the User Guide or `specs/v2/05_MCP_SERVER.md`.

---

## 1. Authentication

### API Key

Every registered agent gets a unique 256-bit API key at registration time. The key is shown once and stored as a bcrypt hash.

**For REST (Agent Gateway):**
```
Authorization: Bearer pm_intel_ak_abc123...
```

**For A2A:**
```
X-API-Key: pm_intel_ak_abc123...
```

### Rate Limits

| Type | Default | Header |
|------|---------|--------|
| Read requests | 60/minute | `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset` |
| Write requests | 20/minute | Same headers |

Exceeding limits returns `429 Too Many Requests`.

### Idempotency

All write endpoints require an `Idempotency-Key` header. Duplicate writes within 24 hours return the original response.

```
Idempotency-Key: unique-request-id-abc123
```

---

## 2. Agent Gateway REST API

### 2.1 Signals

#### Search Signals

```
GET /api/agents/v1/signals
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `entity_type` | string | No | Filter by entity type: `customer`, `feature`, `issue`, `theme` |
| `entity_name` | string | No | Filter by entity name |
| `date_from` | ISO date | No | Start date |
| `date_to` | ISO date | No | End date |
| `source` | string | No | Filter by source: `slack`, `transcript`, `document`, `web_scrape` |
| `limit` | integer | No | Max results (default 20, max 100) |
| `offset` | integer | No | Pagination offset |

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
POST /api/agents/v1/signals/ingest
```

Headers: `Idempotency-Key` required.

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

**Response:** `201 Created`
```json
{
  "signal_id": "sig_def456",
  "status": "processing",
  "idempotency_key": "your-key",
  "message": "Signal accepted for processing"
}
```

### 2.2 Entities

#### List Entities

```
GET /api/agents/v1/entities
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `type` | string | No | `customer`, `feature`, `issue`, `theme` |
| `search` | string | No | Fuzzy search by name |
| `limit` | integer | No | Default 50, max 200 |

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

#### Propose Entity Link

```
POST /api/agents/v1/entities/link
```

Agents can **propose** linking an external ID to an entity. This creates a feedback entry for human review.

```json
{
  "entity_id": "ent_abc123",
  "external_system": "jira",
  "external_id": "PROD-1234",
  "link_type": "tracks_issue"
}
```

**Response:** `202 Accepted` (queued for human review)

#### Propose Entity Status Update

```
POST /api/agents/v1/entities/status
```

```json
{
  "entity_id": "ent_abc123",
  "status": "resolved",
  "source": "jira_sync_agent",
  "evidence": "JIRA ticket PROD-1234 marked as Done"
}
```

**Response:** `202 Accepted`

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
      "name": "Auth Timeout",
      "type": "issue",
      "columns": {
        "Acme Corp": 12,
        "BigCorp": 8,
        "DataFlow": 5
      },
      "total": 28
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

**Response:** `202 Accepted` (report generated asynchronously)
```json
{
  "report_id": "rpt_abc123",
  "status": "generating",
  "estimated_completion_seconds": 30
}
```

#### Get Latest Report

```
GET /api/agents/v1/reports/latest?type=weekly_digest
```

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

### 2.6 Entity Resolution Stats

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

### 2.7 System Health

```
GET /api/agents/v1/health
```

**Response:**
```json
{
  "status": "healthy",
  "services": {
    "postgresql": "healthy",
    "neo4j": "healthy",
    "redis": "healthy",
    "entity_resolution": "healthy",
    "document_parser": "healthy"
  },
  "uptime_seconds": 86400,
  "pipeline_status": "idle",
  "dlq_count": 0
}
```

### 2.8 Events

#### Subscribe to Events (SSE)

```
GET /api/agents/v1/events/stream
```

Returns a Server-Sent Events stream. Events include:

| Event Type | Payload | When |
|-----------|---------|------|
| `signal.ingested` | `{ signal_id, source, entity_count }` | New signal processed |
| `entity.created` | `{ entity_id, name, type }` | New entity discovered |
| `entity.merged` | `{ canonical_id, merged_id }` | Entity merge completed |
| `issue.escalated` | `{ entity_id, urgency, reason }` | Issue flagged as critical |
| `report.generated` | `{ report_id, type }` | Report ready |

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
      "id": "query_knowledge",
      "name": "Query Knowledge Graph",
      "description": "Search and retrieve entities, signals, relationships from the PM knowledge graph"
    },
    {
      "id": "ingest_signal",
      "name": "Ingest Signal",
      "description": "Submit a new signal for processing through the extraction and ER pipeline"
    },
    {
      "id": "get_heatmap",
      "name": "Generate Heatmap",
      "description": "Generate issue/feature heatmaps across customers"
    },
    {
      "id": "get_trends",
      "name": "Get Trends",
      "description": "Retrieve emerging, declining, or stable trends"
    },
    {
      "id": "get_customer_profile",
      "name": "Get Customer Profile",
      "description": "Retrieve comprehensive customer profile with issues, features, signals"
    },
    {
      "id": "generate_report",
      "name": "Generate Report",
      "description": "Generate various report types (weekly digest, customer health, etc.)"
    },
    {
      "id": "flag_issue",
      "name": "Flag Issue",
      "description": "Flag an issue as urgent with evidence and recommended action"
    },
    {
      "id": "get_system_health",
      "name": "Get System Health",
      "description": "Check system health and service statuses"
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
    "skill_id": "query_knowledge"
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
    "skill_id": "generate_report"
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
    "data": { "available_skills": ["query_knowledge", "ingest_signal", "..."] }
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
POST /api/agents/v1/webhooks/register
```

```json
{
  "url": "https://my-agent.example.com/webhook",
  "event_types": ["signal.ingested", "issue.escalated"],
  "secret": "webhook-signing-secret"
}
```

Webhook payloads are signed with HMAC-SHA256 using the shared secret. Failed deliveries are retried 3 times with exponential backoff.

---

## 7. SDK Examples

### Python

```python
import requests

BASE_URL = "http://localhost:3000/api/agents/v1"
API_KEY = "pm_intel_ak_abc123..."
HEADERS = {"Authorization": f"Bearer {API_KEY}"}

# Search signals
signals = requests.get(f"{BASE_URL}/signals", 
    headers=HEADERS,
    params={"entity_type": "issue", "limit": 10}
).json()

# Get heatmap
heatmap = requests.get(f"{BASE_URL}/heatmap",
    headers=HEADERS,
    params={"dimension": "issues_by_customer", "metric": "severity_weighted"}
).json()

# Ingest a signal
resp = requests.post(f"{BASE_URL}/signals/ingest",
    headers={**HEADERS, "Idempotency-Key": "unique-id-001"},
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
const entities = await fetch(`${BASE_URL}/entities?type=customer`, {
  headers: { Authorization: `Bearer ${API_KEY}` },
}).then(r => r.json());

// Subscribe to events (SSE)
const eventSource = new EventSource(`${BASE_URL}/events/stream`, {
  headers: { Authorization: `Bearer ${API_KEY}` },
});
eventSource.addEventListener('signal.ingested', (event) => {
  const data = JSON.parse(event.data);
  console.log(`New signal: ${data.signal_id} from ${data.source}`);
});
```

### cURL

```bash
# List customers
curl -H "Authorization: Bearer $API_KEY" \
  "$BASE_URL/entities?type=customer&limit=5"

# Flag an issue
curl -X POST -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: flag-$(date +%s)" \
  -d '{"entity_name":"Auth Timeout","urgency":"critical","reason":"Spike detected"}' \
  "$BASE_URL/issues/flag"
```
