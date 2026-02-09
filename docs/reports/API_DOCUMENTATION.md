# PM Intelligence System - API Documentation

## Base URL

```
http://localhost:3000
```

---

## Authentication

Currently, the API does not require authentication. For production use, implement JWT or API key authentication.

---

## Rate Limiting

All endpoints are rate-limited:

- **General API**: 100 requests per 15 minutes
- **Signal Ingestion**: 50 requests per minute
- **Opportunity Detection**: 10 requests per minute
- **Webhooks**: 200 requests per minute

Rate limit headers:
- `X-RateLimit-Limit`: Maximum requests allowed
- `X-RateLimit-Remaining`: Requests remaining
- `X-RateLimit-Reset`: ISO timestamp when limit resets

---

## Endpoints

### Health Checks

#### GET /health
Get system health status.

**Response:**
```json
{
  "status": "ok",
  "timestamp": "2025-01-XX...",
  "database": {
    "connected": true,
    "responseTime": 5
  },
  "uptime": 3600,
  "version": "1.0.0",
  "environment": "development",
  "memory": {
    "used": 50,
    "total": 100,
    "rss": 150
  },
  "disk": {
    "available": 10000,
    "total": 50000
  }
}
```

#### GET /ready
Kubernetes readiness check.

**Response:**
```json
{
  "status": "ready"
}
```

#### GET /live
Kubernetes liveness check.

**Response:**
```json
{
  "status": "alive"
}
```

---

### Signals

#### POST /api/signals
Ingest a new signal.

**Request Body:**
```json
{
  "source": "slack",
  "id": "optional-unique-id",
  "type": "message",
  "text": "Signal content here",
  "severity": 3,
  "confidence": 0.8,
  "metadata": {
    "channel_id": "C123456",
    "user": "U123456"
  }
}
```

**Response:** `201 Created`
```json
{
  "id": "uuid",
  "source": "slack",
  "source_ref": "optional-unique-id",
  "signal_type": "message",
  "content": "Signal content here",
  "normalized_content": "normalized version",
  "severity": 3,
  "confidence": 0.8,
  "metadata": {
    "customers": ["NFCU"],
    "topics": ["IC Editor"],
    "quality_score": 75
  },
  "created_at": "2025-01-XX..."
}
```

#### GET /api/signals
Get signals with filtering and pagination.

**Query Parameters:**
- `source` (string): Filter by source
- `signalType` (string): Filter by signal type
- `customer` (string): Filter by customer name (in-memory)
- `topic` (string): Filter by topic (in-memory)
- `startDate` (ISO date): Filter by start date
- `endDate` (ISO date): Filter by end date
- `minQualityScore` (number): Minimum quality score
- `limit` (number, default: 100): Results per page
- `offset` (number, default: 0): Pagination offset
- `orderBy` (string): Sort field (`created_at`, `quality_score`, `severity`)
- `orderDirection` (string): Sort direction (`ASC`, `DESC`)

**Example:**
```bash
GET /api/signals?source=slack&customer=NFCU&limit=10&offset=0
```

**Response:**
```json
{
  "signals": [...],
  "pagination": {
    "total": 100,
    "limit": 10,
    "offset": 0,
    "hasMore": true
  }
}
```

---

### Opportunities

#### POST /api/opportunities/detect
Detect opportunities from all signals (full re-clustering).

**Response:**
```json
[
  {
    "id": "uuid",
    "title": "NFCU - IC Editor - adoption (2 signals)",
    "description": "Cluster of 2 related signals...",
    "status": "new",
    "created_at": "2025-01-XX..."
  }
]
```

#### POST /api/opportunities/detect/incremental
Incremental opportunity detection (only processes new signals).

**Response:**
```json
{
  "newOpportunities": [...],
  "updatedOpportunities": [...],
  "signalsProcessed": 10
}
```

#### GET /api/opportunities
Get opportunities with filtering and pagination.

**Query Parameters:**
- `status` (string): Filter by status
- `startDate` (ISO date): Filter by start date
- `endDate` (ISO date): Filter by end date
- `limit` (number, default: 100): Results per page
- `offset` (number, default: 0): Pagination offset
- `orderBy` (string): Sort field (`created_at`, `title`)
- `orderDirection` (string): Sort direction (`ASC`, `DESC`)

**Response:**
```json
{
  "opportunities": [...],
  "pagination": {
    "total": 50,
    "limit": 10,
    "offset": 0,
    "hasMore": true
  }
}
```

#### POST /api/opportunities/merge
Merge related opportunities.

**Request Body:**
```json
{
  "similarityThreshold": 0.3
}
```

**Response:**
```json
{
  "merged": 2
}
```

#### GET /api/opportunities/:id/signals
Get signals for an opportunity.

**Response:**
```json
[
  {
    "id": "uuid",
    "source": "slack",
    "content": "...",
    ...
  }
]
```

---

### Judgments

#### POST /api/judgments
Create a judgment (requires Cursor extension - human-in-the-loop + LLM).

**Note:** This endpoint returns 501. Use Cursor extension commands instead.

#### GET /api/judgments/:opportunityId
Get judgments for an opportunity.

**Response:**
```json
[
  {
    "id": "uuid",
    "opportunity_id": "uuid",
    "summary": "Judgment summary...",
    "assumptions": {
      "items": ["Assumption 1", "Assumption 2"]
    },
    "missing_evidence": {
      "items": ["Evidence 1"]
    },
    "confidence_level": "high",
    "created_at": "2025-01-XX..."
  }
]
```

---

### Artifacts

#### POST /api/artifacts
Create an artifact (requires Cursor extension - human-in-the-loop + LLM).

**Note:** This endpoint returns 501. Use Cursor extension commands instead.

#### GET /api/artifacts/:judgmentId
Get artifacts for a judgment.

**Response:**
```json
[
  {
    "id": "uuid",
    "judgment_id": "uuid",
    "artifact_type": "PRD",
    "content": "Artifact content...",
    "created_at": "2025-01-XX..."
  }
]
```

---

### Metrics

#### GET /api/metrics
Get adoption metrics.

**Response:**
```json
{
  "total_signals": 100,
  "total_opportunities": 20,
  "total_judgments": 15,
  "total_artifacts": 10,
  "signals_per_day": [...],
  "opportunities_per_day": [...],
  "judgments_per_day": [...],
  "artifacts_per_day": [...]
}
```

---

### Webhooks

#### POST /webhooks/slack
Slack webhook endpoint for automatic signal ingestion.

**Payload:** Slack event payload (see Slack Events API)

#### POST /webhooks/teams
Microsoft Teams webhook endpoint.

#### POST /webhooks/grafana
Grafana alert notification endpoint.

#### POST /webhooks/splunk
Splunk webhook alert action endpoint.

---

## Error Responses

### 400 Bad Request
```json
{
  "error": "Missing required fields: source and text/content are required"
}
```

### 429 Too Many Requests
```json
{
  "error": "Too many requests",
  "message": "Rate limit exceeded. Try again after 2025-01-XX...",
  "retryAfter": 60
}
```

### 500 Internal Server Error
```json
{
  "error": "Error message here"
}
```

### 501 Not Implemented
```json
{
  "error": "Judgment creation requires Cursor extension (human-in-the-loop + LLM)"
}
```

### 503 Service Unavailable
```json
{
  "status": "not ready",
  "error": "Database connection failed"
}
```

---

## Data Models

### Signal
```typescript
{
  id: string;
  source: string;
  source_ref: string;
  signal_type: string;
  content: string;
  normalized_content: string;
  severity: number | null;
  confidence: number | null;
  metadata: {
    customers?: string[];
    topics?: string[];
    quality_score?: number;
    [key: string]: any;
  } | null;
  created_at: Date;
}
```

### Opportunity
```typescript
{
  id: string;
  title: string;
  description: string;
  status: string;
  created_at: Date;
}
```

### Judgment
```typescript
{
  id: string;
  opportunity_id: string;
  summary: string;
  assumptions: { items: string[] };
  missing_evidence: { items: string[] };
  confidence_level: "high" | "medium" | "low";
  created_at: Date;
}
```

### Artifact
```typescript
{
  id: string;
  judgment_id: string;
  artifact_type: "PRD" | "RFC";
  content: string;
  created_at: Date;
}
```

---

## Examples

### Complete Workflow

```bash
# 1. Ingest signals
curl -X POST http://localhost:3000/api/signals \
  -H "Content-Type: application/json" \
  -d '{"source": "slack", "type": "message", "text": "Customer NFCU wants IC Editor"}'

# 2. Detect opportunities
curl -X POST http://localhost:3000/api/opportunities/detect/incremental

# 3. Get opportunities
curl http://localhost:3000/api/opportunities

# 4. Get signals for an opportunity (use opportunity ID from step 3)
curl http://localhost:3000/api/opportunities/{opportunityId}/signals

# 5. Create judgment (via Cursor extension)
# 6. Generate artifact (via Cursor extension)
```

---

## Testing

See `TESTING_GUIDE.md` for testing instructions and examples.
