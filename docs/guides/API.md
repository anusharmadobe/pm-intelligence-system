# PM Intelligence System API Documentation

## Base URL

```
http://localhost:3000
```

## Authentication

Currently, the API does not require authentication for basic endpoints. RBAC can be enabled via `ENABLE_RBAC` environment variable (future enhancement).

## Endpoints

### Health Check

**GET** `/health`

Check if the API server is running.

**Response:**
```json
{
  "status": "ok",
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

---

### Signals

#### Ingest Signal

**POST** `/api/signals`

Ingest a raw signal into the system.

**Request Body:**
```json
{
  "source": "slack",
  "id": "optional_external_id",
  "type": "message",
  "text": "Raw signal content here",
  "severity": 3,
  "confidence": 0.8,
  "metadata": {
    "channel": "#support",
    "user": "user123"
  }
}
```

**Required Fields:**
- `source`: One of: `slack`, `teams`, `grafana`, `splunk`, `manual`
- `text` or `content`: Signal content (must be raw, no summaries)

**Optional Fields:**
- `id`: External reference ID
- `type`: Signal type (e.g., `message`, `alert_firing`, `search_result`)
- `severity`: Number between 1-5
- `confidence`: Number between 0-1
- `metadata`: JSON object with additional context

**Response:** `201 Created`
```json
{
  "id": "uuid",
  "source": "slack",
  "source_ref": "optional_external_id",
  "signal_type": "message",
  "content": "Raw signal content here",
  "normalized_content": "raw signal content here",
  "severity": 3,
  "confidence": 0.8,
  "metadata": {...},
  "created_at": "2024-01-01T00:00:00.000Z"
}
```

#### List Signals

**GET** `/api/signals`

**Query Parameters:**
- `source` (optional): Filter by source (e.g., `slack`, `grafana`)

**Response:** `200 OK`
```json
[
  {
    "id": "uuid",
    "source": "slack",
    ...
  }
]
```

---

### Opportunities

#### Detect Opportunities

**POST** `/api/opportunities/detect`

Detect and store opportunities by clustering existing signals.

**Response:** `200 OK`
```json
[
  {
    "id": "uuid",
    "title": "Opportunity title",
    "description": "Description",
    "status": "new",
    "created_at": "2024-01-01T00:00:00.000Z"
  }
]
```

#### List Opportunities

**GET** `/api/opportunities`

**Response:** `200 OK`
```json
[
  {
    "id": "uuid",
    "title": "Opportunity title",
    "description": "Description",
    "status": "new",
    "created_at": "2024-01-01T00:00:00.000Z"
  }
]
```

---

### Judgments

#### Create Judgment

**POST** `/api/judgments`

⚠️ **Note:** Judgment creation requires Cursor extension (human-in-the-loop + LLM). This endpoint returns `501 Not Implemented` when called via API.

Use the Cursor extension command `PM Intelligence: Create Judgment` instead.

#### Get Judgments for Opportunity

**GET** `/api/judgments/:opportunityId`

**Response:** `200 OK`
```json
[
  {
    "id": "uuid",
    "opportunity_id": "uuid",
    "summary": "Judgment summary",
    "assumptions": {"items": [...]},
    "missing_evidence": {"items": [...]},
    "confidence_level": "high",
    "created_at": "2024-01-01T00:00:00.000Z"
  }
]
```

---

### Metrics

#### Get Adoption Metrics

**GET** `/api/metrics`

**Response:** `200 OK`
```json
{
  "total_signals": 100,
  "total_opportunities": 15,
  "total_judgments": 8,
  "total_artifacts": 5,
  "signals_by_source": {
    "slack": 50,
    "grafana": 30,
    "teams": 20
  },
  "opportunities_by_status": {
    "new": 10,
    "in_progress": 5
  },
  "judgments_by_confidence": {
    "high": 3,
    "medium": 4,
    "low": 1
  },
  "artifacts_by_type": {
    "PRD": 3,
    "RFC": 2
  },
  "signals_per_day": [...],
  "opportunities_per_day": [...],
  "judgments_per_day": [...],
  "artifacts_per_day": [...]
}
```

---

## Webhooks

### Slack Webhook

**POST** `/webhooks/slack`

Accepts Slack Events API and Slash Command payloads.

**Slack Event Example:**
```json
{
  "type": "event_callback",
  "event": {
    "type": "message",
    "text": "User reported issue",
    "channel": "C123456",
    "user": "U123456",
    "ts": "1234567890.123456"
  }
}
```

### Teams Webhook

**POST** `/webhooks/teams`

Accepts Microsoft Teams activity payloads.

### Grafana Webhook

**POST** `/webhooks/grafana`

Accepts Grafana alert notifications.

**Grafana Alert Example:**
```json
{
  "alerts": [
    {
      "status": "firing",
      "labels": {
        "alertname": "High Response Time",
        "severity": "warning"
      },
      "annotations": {
        "summary": "Response time exceeded threshold",
        "description": "Average response time is 3.2s"
      }
    }
  ]
}
```

### Splunk Webhook

**POST** `/webhooks/splunk`

Accepts Splunk search results and alert payloads.

---

## Error Responses

All errors follow this format:

```json
{
  "error": "Error message description"
}
```

**Status Codes:**
- `400` - Bad Request (validation errors)
- `500` - Internal Server Error
- `501` - Not Implemented (requires Cursor extension)

---

## Example Usage

### Ingest a Signal

```bash
curl -X POST http://localhost:3000/api/signals \
  -H "Content-Type: application/json" \
  -d '{
    "source": "slack",
    "text": "Users reporting slow page load times",
    "type": "message",
    "severity": 3
  }'
```

### Detect Opportunities

```bash
curl -X POST http://localhost:3000/api/opportunities/detect
```

### Get Metrics

```bash
curl http://localhost:3000/api/metrics
```
